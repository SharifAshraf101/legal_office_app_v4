// Automatic document processing for every office whose files live in R2 (all
// but the operator, whose Dropbox + make.com pipeline does this job). When an
// office uploads a PDF, the upload enqueues a job; this consumer then runs —
// with no wall-clock cut-off, unlike waitUntil — the same steps make.com runs
// for the operator:
//   1. a bilingual summary → file_summary + the document row (the hearing
//      sweep and the notes tab read the summary off the document row);
//   2. the reply-draft step (/api/draft's handler: classify + draft by the
//      rule — decisions / opposing filings get a draft, our own filings don't).
// Tasks, hearings and the suggested action still come from the app (the brain
// screen and the hearing sweep), off what these steps store.

import { AR_GLOSSARY } from './arabicGlossary';
import type { Env } from './db';
import { callAnthropicWithRetry, oversizedPdfField } from './pdfLimits';
import { tenantDb } from './whatsapp';

export interface DocJob {
  tenantId: string;
  key: string; // R2 object key
  fileName: string;
  docId: string; // DOC-NNN
  caseId: string;
  clientId: string;
  /** 'process' = summary + draft; 'attach' = copy the summary onto the row. */
  stage: 'process' | 'attach';
  attempt: number;
}

/** The subset of the Worker's Ctx the draft handler uses. */
export interface PipelineCtx {
  tenantId: string;
  db: D1Database;
}

export type RunDraft = (ctx: PipelineCtx, body: Record<string, unknown>) => Promise<Response>;

const SUMMARY_MODEL = 'claude-haiku-4-5';
// The document row is saved from the app a moment after the upload; the
// summary is copied onto it once it exists (checked up to ATTACH_TRIES times).
const ATTACH_DELAY_S = 60;
const ATTACH_TRIES = 10;

const SUMMARY_PROMPT = `You are a legal assistant for a law office. The attached file is a legal document (a court filing, motion, ruling, claim, etc.), written in any language (Hebrew, Arabic, English, French, Russian, …).

Write a summary of the document's SUBSTANCE — its essence and, above all, the LEGAL ARGUMENTS it raises. When the document is information-rich the summary may run up to HALF A PAGE (roughly 8–12 sentences); use fewer sentences for a short document and never pad to reach the limit.

Convey the NATURE of the document (what kind of filing it is and what it seeks) WITHOUT restating its title. Focus on the LEGAL ARGUMENTS and claims raised, the main request/relief sought, key dates and deadlines (always write dates in full, DD.MM.YYYY, and say what each date is — e.g. "a hearing is set for 14.12.2026 at 10:30", "a response is due by 01.12.2026"), and any decision/ruling.

Do NOT re-narrate the factual background. Do NOT include the court's name, the parties' names or ID numbers, their lawyers' names, or addresses. No preamble, no opinions.

LANGUAGE RULE — decide "language" from the SUBSTANTIVE document, NOT from an automatic court e-filing cover page (a Hebrew "אישור הגשה" receipt page): ignore that page. If the document is connected to the Sharia court (בית הדין השרעי / المحكمة الشرعية) in any way, or its main body is in Arabic, "language" is "ar" and "orig" is written in Arabic.

Return ONLY valid JSON (no markdown, no code fences) with EXACTLY these keys:
{"language":"ISO code of the substantive document's language, e.g. he, ar, en","orig":"the summary in the document's OWN language","he":"the summary in Hebrew","ar":"the summary in Arabic"}

"he" and "ar" must always be filled (translate so both are present).

${AR_GLOSSARY}`;

function b64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

function extractJson(text: string): Record<string, string> {
  const cleaned = text.replace(/```json\s*/gi, '').replace(/```/g, '').trim();
  const a = cleaned.indexOf('{');
  const b = cleaned.lastIndexOf('}');
  if (a === -1 || b < a) return {};
  try {
    return JSON.parse(cleaned.slice(a, b + 1)) as Record<string, string>;
  } catch {
    return {};
  }
}

/** Ids for a filing named "CLT-1_CS-2_<title>_DOC-003.pdf" (the app's filing name). */
export function idsFromFileName(name: string): { clientId: string; caseId: string; docId: string } {
  const up = name.toUpperCase();
  return {
    clientId: /(CLT-\d+)/.exec(up)?.[1] || '',
    caseId: /(CS-\d+)/.exec(up)?.[1] || '',
    docId: /(DOC-\d+)/.exec(up)?.[1] || '',
  };
}

async function summarize(env: Env, pdfB64: string): Promise<Record<string, string> | null> {
  const call = await callAnthropicWithRetry(
    env.ANTHROPIC_API_KEY || '',
    JSON.stringify({
      model: SUMMARY_MODEL,
      max_tokens: 4000,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfB64 } },
            { type: 'text', text: SUMMARY_PROMPT },
          ],
        },
      ],
    }),
  );
  if (!call.response?.ok) return null;
  const data = (await call.response.json()) as { content?: Array<{ type: string; text?: string }> };
  const text = (data.content || []).filter((c) => c.type === 'text').map((c) => c.text || '').join('');
  const out = extractJson(text);
  return out.he || out.ar || out.orig ? out : null;
}

/** Copy the stored summary onto the document row; false when the row isn't there yet. */
async function attachSummary(db: D1Database, job: DocJob): Promise<boolean> {
  const row = await db
    .prepare(
      "SELECT summary_he, summary_ar FROM file_summary WHERE upper(file_name) LIKE '%' || ?1 || '.%' ORDER BY id DESC LIMIT 1",
    )
    .bind(job.docId)
    .first<{ summary_he: string | null; summary_ar: string | null }>();
  if (!row) return true; // nothing to attach
  const res = await db
    .prepare(
      'UPDATE documents SET summary_he = COALESCE(?1, summary_he), summary_ar = COALESCE(?2, summary_ar), updated_at = ?3 WHERE user_id = ?4 AND upper(source_id) = ?5',
    )
    .bind(row.summary_he, row.summary_ar, new Date().toISOString(), job.tenantId, job.docId)
    .run();
  return Number((res.meta as { changes?: number } | undefined)?.changes || 0) > 0;
}

async function officeLawyerName(env: Env, tenantId: string): Promise<string> {
  try {
    const r = await env.CONTROL_DB.prepare(
      `SELECT t.name AS office,
              (SELECT u.name FROM membership m JOIN user u ON u.id = m.user_id
                WHERE m.tenant_id = t.id ORDER BY m.created_at ASC LIMIT 1) AS owner
         FROM tenant t WHERE t.id = ?1`,
    )
      .bind(tenantId)
      .first<{ office?: string; owner?: string }>();
    return [r?.owner, r?.office].map((s) => String(s || '').trim()).filter(Boolean).join(' / ');
  } catch {
    return '';
  }
}

async function processJob(env: Env, job: DocJob, runDraft: RunDraft): Promise<void> {
  const db = await tenantDb(env, job.tenantId);
  if (!db) return; // office suspended / gone — nothing to do

  if (job.stage === 'attach') {
    if (!(await attachSummary(db, job)) && job.attempt < ATTACH_TRIES) {
      await env.DOC_QUEUE?.send({ ...job, attempt: job.attempt + 1 }, { delaySeconds: ATTACH_DELAY_S });
    }
    return;
  }

  const obj = await env.DOCS.get(job.key);
  if (!obj) return; // deleted before we got to it
  const pdfB64 = b64(new Uint8Array(await obj.arrayBuffer()));
  if (oversizedPdfField(pdfB64.length)) return; // too large for the model

  // 1. Summary → file_summary (+ the document row, now or once it exists).
  const s = await summarize(env, pdfB64);
  if (s) {
    await db.prepare("DELETE FROM file_summary WHERE upper(file_name) LIKE '%' || ?1 || '.%'").bind(job.docId).run();
    await db
      .prepare(
        'INSERT INTO file_summary (client_id, case_id, file_name, summary_he, summary_ar, summary_orig, language, ai_model) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)',
      )
      .bind(
        job.clientId.toLowerCase() || null,
        job.caseId.toLowerCase() || null,
        job.fileName,
        s.he || null,
        s.ar || null,
        s.orig || null,
        String(s.language || '').toLowerCase() || null,
        SUMMARY_MODEL,
      )
      .run();
    if (!(await attachSummary(db, job))) {
      await env.DOC_QUEUE?.send({ ...job, stage: 'attach', attempt: 1 }, { delaySeconds: ATTACH_DELAY_S });
    }
  }

  // 2. Reply draft, by the same rule and handler the app and make.com use.
  await runDraft(
    { tenantId: job.tenantId, db },
    {
      pdf_base64: pdfB64,
      client_source_id: job.clientId,
      case_source_id: job.caseId,
      file_name: job.fileName,
      document_source_id: job.docId,
      lawyer_name: await officeLawyerName(env, job.tenantId),
    },
  );
}

/** Queue consumer: one job per message; a failure retries (queue max_retries). */
export async function handleDocQueue(
  batch: MessageBatch<DocJob>,
  env: Env,
  runDraft: RunDraft,
): Promise<void> {
  for (const msg of batch.messages) {
    try {
      await processJob(env, msg.body, runDraft);
      msg.ack();
    } catch (e) {
      console.warn('[docpipeline] job failed, retrying', e);
      msg.retry({ delaySeconds: 120 });
    }
  }
}
