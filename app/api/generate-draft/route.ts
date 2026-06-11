import { NextResponse } from 'next/server';

/**
 * On-demand reply-draft GENERATION for a document that has none yet.
 *
 * Drafts normally come from the Make pipeline into the D1 `drafts` table, but
 * a document filed in the app (or one the pipeline missed) has none. This route
 * fills the gap: given a (short-lived Dropbox) URL to the PDF, it fetches the
 * file server-side (avoiding browser CORS), base64-encodes it, and forwards it
 * to the Worker's `POST /api/draft` — which reads the PDF with Claude using the
 * active drafting skill + the case notes, and saves the draft into `drafts`.
 *
 * The Worker holds ANTHROPIC_API_KEY, so this route needs NO Anthropic key of
 * its own (unlike /api/generate-summary).
 *
 * POST /api/generate-draft
 *   body: { fileUrl, fileName, clientId?, caseId?, documentId? }
 *   → the Worker's JSON ({ ok, has_draft, source_id, document_source_id, … })
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
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  const { fileUrl, fileName, clientId, caseId, documentId } = body;
  if (!fileUrl || !fileName) {
    return NextResponse.json({ error: 'missing_params' }, { status: 400 });
  }
  // Claude reads PDFs natively; other formats (.docx, …) aren't supported here.
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

  // 2. Forward to the Worker's /api/draft (it owns the Anthropic key + skill).
  const workerUrl = (process.env.NEXT_PUBLIC_WORKER_URL || '').replace(/\/$/, '');
  const token = process.env.NEXT_PUBLIC_APP_TOKEN || '';
  if (!workerUrl || !token) {
    return NextResponse.json({ error: 'worker_unconfigured' }, { status: 500 });
  }
  try {
    const res = await fetch(workerUrl + '/api/draft', {
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
