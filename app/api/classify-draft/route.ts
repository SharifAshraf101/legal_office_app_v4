import { NextResponse } from 'next/server';
import { forwardAuth, workerBase } from '@/lib/serverAuth';

/**
 * Cheap classification-only check for an EXISTING document (typically a
 * Make-written draft still marked status='draft'): decides whether a reply
 * draft is actually needed.
 *
 * Who filed the document is read off the SIGNATURE at its END: our registered
 * lawyer's signature (or a filing made for the client we represent) → no draft;
 * the opposing party's counsel → draft. A judge's decision always gets a draft.
 * Our own document with no court order → no draft (the case's suggested-action
 * / recommendation covers that case instead).
 *
 * Given a (short-lived Dropbox) URL to the PDF, this route fetches the file
 * server-side (avoiding browser CORS), base64-encodes it, and forwards it to
 * the Worker's `POST /api/draft-decision` — which reads the PDF with a small
 * model, decides, and updates the draft row's status to 'approved' (needed) or
 * 'not_needed' WITHOUT regenerating the draft text.
 *
 * MULTI-TENANT: the draft row it updates lives in whichever office database the
 * CALLER's session resolves to — this route forwards the caller's own
 * `Authorization` header and holds no operator token.
 *
 * POST /api/classify-draft
 *   headers: Authorization: Bearer <office session token>
 *   body: { fileUrl, fileName, clientId?, caseId?, documentId?, lawyerName? }
 *   → the Worker's JSON ({ ok, draft_needed, author_side, court_requires_response, … })
 *
 * Env: NEXT_PUBLIC_WORKER_URL.
 */
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: Request) {
  let body: {
    fileUrl?: string;
    fileName?: string;
    clientId?: string;
    caseId?: string;
    documentId?: string;
    lawyerName?: string;
    clientName?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  const { fileUrl, fileName, clientId, caseId, documentId, lawyerName, clientName } =
    body;
  if (!fileUrl || !fileName) {
    return NextResponse.json({ error: 'missing_params' }, { status: 400 });
  }
  // Claude reads PDFs natively; other formats aren't supported here. A
  // non-PDF document can't be classified — caller should treat that as
  // "draft needed" (safe default) on its side.
  if (!/\.pdf$/i.test(fileName)) {
    return NextResponse.json({ error: 'unsupported_type' }, { status: 415 });
  }

  // Authorize BEFORE the download + model call, so an anonymous request costs
  // nothing. The Worker re-checks the token; this only rejects missing ones.
  const auth = forwardAuth(req);
  if (!auth) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const workerUrl = workerBase();
  if (!workerUrl) {
    return NextResponse.json({ error: 'worker_unconfigured' }, { status: 500 });
  }

  // 1. Fetch the PDF server-side (no browser CORS on the Dropbox link).
  let base64: string;
  try {
    const res = await fetch(fileUrl);
    if (!res.ok) {
      return NextResponse.json(
        { error: 'fetch_failed', status: res.status },
        { status: 502 },
      );
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 28 * 1024 * 1024) {
      return NextResponse.json({ error: 'file_too_large' }, { status: 413 });
    }
    base64 = buf.toString('base64');
  } catch {
    return NextResponse.json({ error: 'fetch_error' }, { status: 502 });
  }

  // 2. Forward to the Worker's /api/draft-decision (it owns the Anthropic key),
  //    as the CALLING office.
  try {
    const res = await fetch(workerUrl + '/api/draft-decision', {
      method: 'POST',
      headers: {
        Authorization: auth,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        pdf_base64: base64,
        file_name: fileName,
        client_source_id: clientId || '',
        case_source_id: caseId || '',
        document_source_id: documentId || '',
        lawyer_name: lawyerName || '',
        client_name: clientName || '',
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    if (!res.ok) {
      return NextResponse.json({ error: 'worker_error', detail: data }, { status: 502 });
    }
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json(
      { error: 'worker_fetch_error', detail: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }
}
