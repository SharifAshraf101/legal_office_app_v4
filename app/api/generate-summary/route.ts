import Anthropic from '@anthropic-ai/sdk';
import { NextResponse } from 'next/server';

/**
 * On-demand document-summary GENERATION.
 *
 * Summaries normally come from an external AI pipeline into the D1
 * `file_summary` table, but that pipeline only covers some documents. This
 * route fills the gaps: given a (short-lived Dropbox) URL to a PDF, it fetches
 * the file server-side (avoiding browser CORS), asks Claude for a concise
 * bilingual summary, stores it in `file_summary` via the Worker, and returns it.
 *
 * POST /api/generate-summary
 *   body: { fileUrl, fileName, clientId?, caseId? }
 *   → { he, ar, language }
 *
 * Env: ANTHROPIC_API_KEY (server-side), NEXT_PUBLIC_WORKER_URL,
 *      NEXT_PUBLIC_APP_TOKEN (to store the result back in D1).
 */
export const runtime = 'nodejs';
export const maxDuration = 60;

const MODEL = 'claude-haiku-4-5';

const PROMPT = `You are a legal assistant for a law office. The attached file is a legal document (a court filing, motion, ruling, claim, etc.), usually written in Hebrew or Arabic.

Write a CONCISE, factual summary (3–6 sentences) covering, when present: the document type, the parties, the main request/claim, key dates and deadlines, and any decision/ruling. No preamble, no opinions — just the facts from the document.

Return ONLY valid JSON (no markdown, no code fences) with EXACTLY these keys:
{"language":"he or ar — the language the document ITSELF is written in","he":"the summary in Hebrew","ar":"the summary in Arabic"}

Both "he" and "ar" must be filled — translate the summary so both are present.`;

/** Pull a JSON object out of the model's reply, tolerating code fences. */
function extractJson(text: string): { he?: string; ar?: string; language?: string } {
  const cleaned = text.replace(/```json\s*/gi, '').replace(/```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return {};
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return {};
  }
}

export async function POST(req: Request) {
  let body: {
    fileUrl?: string;
    fileName?: string;
    clientId?: string;
    caseId?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  const { fileUrl, fileName, clientId, caseId } = body;
  if (!fileUrl || !fileName) {
    return NextResponse.json({ error: 'missing_params' }, { status: 400 });
  }
  // Claude reads PDFs natively; other formats (.docx, …) aren't supported here.
  if (!/\.pdf$/i.test(fileName)) {
    return NextResponse.json({ error: 'unsupported_type' }, { status: 415 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'api_key_missing' }, { status: 500 });
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

  // 2. Summarize with Claude (PDF in, bilingual JSON out).
  let he = '';
  let ar = '';
  let language = '';
  try {
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 1500,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'document',
              source: {
                type: 'base64',
                media_type: 'application/pdf',
                data: base64,
              },
            },
            { type: 'text', text: PROMPT },
          ],
        },
      ],
    });
    const text = response.content
      .filter((b): b is Anthropic.Messages.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();
    const parsed = extractJson(text);
    he = (parsed.he || '').trim();
    ar = (parsed.ar || '').trim();
    language = (parsed.language || '').toLowerCase();
  } catch (e) {
    return NextResponse.json(
      { error: 'ai_error', detail: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }
  if (!he && !ar) {
    return NextResponse.json({ error: 'empty_summary' }, { status: 502 });
  }

  // 3. Persist into file_summary (via the Worker) so future loads just fetch it.
  try {
    const workerUrl = (process.env.NEXT_PUBLIC_WORKER_URL || '').replace(
      /\/$/,
      '',
    );
    const token = process.env.NEXT_PUBLIC_APP_TOKEN || '';
    if (workerUrl && token) {
      await fetch(workerUrl + '/api/file-summary', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          file_name: fileName,
          client_id: clientId || '',
          case_id: caseId || '',
          summary_he: he,
          summary_ar: ar,
          language,
          ai_model: MODEL,
        }),
      });
    }
  } catch {
    // Non-fatal: still return the summary so the UI can show it now.
  }

  return NextResponse.json({ he, ar, language });
}
