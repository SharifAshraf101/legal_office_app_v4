import { NextResponse } from 'next/server';

/**
 * Cheap classification-only check for an EXISTING document (typically a
 * Make-written draft still marked status='draft'): decides whether a reply
 * draft is actually needed.
 *
 * A draft is needed ONLY when the document was authored by the OTHER side, or
 * the court ordered a reply. Our own document with no court order → no draft
 * (the case's suggested-action / recommendation covers that case instead).
 *
 * Given a (short-lived Dropbox) URL to the PDF, this route fetches the file
 * server-side (avoiding browser CORS), base64-encodes it, and forwards it to
 * the Worker's `POST /api/draft-decision` — which reads the PDF with a small
 * model, decides, and updates the draft row's status to 'approved' (needed) or
 * 'not_needed' WITHOUT regenerating the draft text.
 *
 * POST /api/classify-draft
 *   body: { fileUrl, fileName, clientId?, caseId?, documentId?, lawyerName? }
 *   → the Worker's JSON ({ ok, draft_needed, author_side, court_requires_response, … })
 *
 * Env: NEXT_PUBLIC_WORKER_URL, NEXT_PUBLIC_APP_TOKEN.
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
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  const { fileUrl, fileName, clientId, caseId, documentId, lawyerName } = body;
  if (!fileUrl || !fileName) {
    return NextResponse.json({ error: 'missing_params' }, { status: 400 });
  }
  // Claude reads PDFs natively; other formats aren't supported here. A
  // non-PDF document can't be classified — caller should treat that as
  // "draft needed" (safe default) on its side.
  if (!/\.pdf$/i.test(fileName)) {
    return NextResponse.json({ error: 'unsupported_type' }, { status: 415 });
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

  // 2. Forward to the Worker's /api/draft-decision (it owns the Anthropic key).
  const workerUrl = (process.env.NEXT_PUBLIC_WORKER_URL || '').replace(/\/$/, '');
  const token = process.env.NEXT_PUBLIC_APP_TOKEN || '';
  if (!workerUrl || !token) {
    return NextResponse.json({ error: 'worker_unconfigured' }, { status: 500 });
  }
  try {
    const res = await fetch(workerUrl + '/api/draft-decision', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        pdf_base64: base64,
        file_name: fileName,
        client_source_id: clientId || '',
        case_source_id: caseId || '',
        document_source_id: documentId || '',
        lawyer_name: lawyerName || '',
      }),
    });
    const data = await res.json().catch(() => ({}));
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
