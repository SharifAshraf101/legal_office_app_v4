// The "Adam bridge": requests from the case-brain screen to Adam (Claude,
// running on the lawyer's own computer with a browser) and Adam's answers.
//
// Flow
//   1. The office clicks "שלח לאדם" → POST /api/adam/jobs stores a job with the
//      case package (document, current draft, decode, notes, case details).
//   2. Adam (scripts/adam-bridge.mjs on the lawyer's computer) lists pending
//      jobs, takes one (status → working), anonymizes it, consults Yosef
//      (ChatGPT project) and Saeed (Gemini Gem) in the browser, merges.
//   3. Adam posts the result → POST /api/adam/jobs/:id/result (status → done);
//      the case-brain screen shows it in the "טיוטת אדם" card.
//
import { buildUpsert } from './db';

// Office-session / APP_TOKEN auth like every other office route; each office's
// jobs live in its own database (ctx.db).

const DDL =
  'CREATE TABLE IF NOT EXISTS adam_jobs (' +
  'id TEXT PRIMARY KEY, case_id TEXT NOT NULL, document_id TEXT, ' +
  "status TEXT NOT NULL DEFAULT 'pending', title TEXT, package TEXT NOT NULL, " +
  'result TEXT, note TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)';

const MAX_JSON = 400_000;
const STATUSES = ['pending', 'working', 'question', 'answered', 'done', 'error', 'cancelled'] as const;
type Status = (typeof STATUSES)[number];

type Row = {
  id: string;
  case_id: string;
  document_id: string | null;
  status: Status;
  title: string | null;
  package: string;
  result: string | null;
  questions?: string | null;
  answers?: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
};

type Res = { status: number; body: unknown };

const parse = (s: string | null): unknown => {
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
};

function view(r: Row, full: boolean) {
  return {
    id: r.id,
    caseId: r.case_id,
    documentId: r.document_id,
    status: r.status,
    title: r.title || '',
    note: r.note || '',
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    ...(full ? { package: parse(r.package) } : {}),
    result: parse(r.result),
    questions: parse(r.questions ?? null),
    answers: parse(r.answers ?? null),
  };
}

async function ready(db: D1Database) {
  await db.prepare(DDL).run();
  // Columns added after the first release (questions from Adam / the lawyer's answers).
  for (const col of ['questions', 'answers']) {
    try {
      await db.prepare(`ALTER TABLE adam_jobs ADD COLUMN ${col} TEXT`).run();
    } catch {
      /* already there */
    }
  }
  // How many times a run that stopped by itself was put back in the queue.
  try {
    await db.prepare('ALTER TABLE adam_jobs ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0').run();
  } catch {
    /* already there */
  }
}

// A run that ends without a result is reported by the watcher with this note
// (scripts/adam-watch.mjs). About half of the runs stop like that a few minutes
// in, and sending the same request again then works — so the request goes back
// to the queue by itself instead of asking the lawyer to send it again.
const AUTO_STOP_NOTE = 'אדם לא השלים את הבקשה (הריצה האוטומטית נעצרה)';
const AUTO_RETRIES = 2;

/** POST /api/adam/jobs — `{ package: {...} }`; package.caseId is required. */
export async function createAdamJob(db: D1Database, body: { package?: Record<string, unknown> }): Promise<Res> {
  const pkg = body?.package;
  const caseId = String(pkg?.caseId || '').trim();
  if (!pkg || !caseId) return { status: 400, body: { error: 'package.caseId required' } };
  const json = JSON.stringify(pkg);
  if (json.length > MAX_JSON) return { status: 413, body: { error: 'package too large' } };
  await ready(db);
  const now = new Date().toISOString();
  const documentId = pkg.documentId ? String(pkg.documentId) : null;
  const title = String(pkg.docTitle || pkg.caseTitle || '').slice(0, 300);
  // One open request per case + document: a repeat click refreshes it.
  const open = await db
    .prepare(
      "SELECT * FROM adam_jobs WHERE case_id = ?1 AND IFNULL(document_id,'') = IFNULL(?2,'') AND status = 'pending' ORDER BY created_at DESC LIMIT 1",
    )
    .bind(caseId, documentId)
    .first<Row>();
  if (open) {
    await db
      .prepare('UPDATE adam_jobs SET package = ?2, title = ?3, updated_at = ?4 WHERE id = ?1')
      .bind(open.id, json, title, now)
      .run();
    const r = await db.prepare('SELECT * FROM adam_jobs WHERE id = ?1').bind(open.id).first<Row>();
    return { status: 200, body: { job: view(r!, false) } };
  }
  const id = 'ADM-' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 6).toUpperCase();
  await db
    .prepare(
      "INSERT INTO adam_jobs (id, case_id, document_id, status, title, package, created_at, updated_at) VALUES (?1, ?2, ?3, 'pending', ?4, ?5, ?6, ?6)",
    )
    .bind(id, caseId, documentId, title, json, now)
    .run();
  const r = await db.prepare('SELECT * FROM adam_jobs WHERE id = ?1').bind(id).first<Row>();
  return { status: 200, body: { job: view(r!, false) } };
}

/** GET /api/adam/jobs?status=&caseId=&documentId=&full=1 — newest first. */
export async function listAdamJobs(db: D1Database, url: URL): Promise<Res> {
  await ready(db);
  const where: string[] = [];
  const args: unknown[] = [];
  const status = url.searchParams.get('status');
  const caseId = url.searchParams.get('caseId');
  const documentId = url.searchParams.get('documentId');
  if (status) {
    args.push(status);
    where.push(`status = ?${args.length}`);
  }
  if (caseId) {
    args.push(caseId);
    where.push(`case_id = ?${args.length}`);
  }
  if (documentId) {
    args.push(documentId);
    where.push(`document_id = ?${args.length}`);
  }
  const full = url.searchParams.get('full') === '1';
  const rs = await db
    .prepare(
      `SELECT * FROM adam_jobs ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC LIMIT 50`,
    )
    .bind(...args)
    .all<Row>();
  return { status: 200, body: { jobs: (rs.results ?? []).map((r) => view(r, full)) } };
}

/** GET /api/adam/jobs/:id — the job with its full package. */
export async function getAdamJob(db: D1Database, id: string): Promise<Res> {
  await ready(db);
  const r = await db.prepare('SELECT * FROM adam_jobs WHERE id = ?1').bind(id).first<Row>();
  if (!r) return { status: 404, body: { error: 'not_found' } };
  return { status: 200, body: { job: view(r, true) } };
}

/** POST /api/adam/jobs/:id/status — `{ status, note? }` (Adam: working / error; office: cancelled). */
export async function setAdamJobStatus(db: D1Database, id: string, body: { status?: string; note?: string }): Promise<Res> {
  const status = String(body?.status || '') as Status;
  if (!STATUSES.includes(status) || status === 'done' || status === 'question' || status === 'answered') return { status: 400, body: { error: 'bad status' } };
  await ready(db);
  if (status === 'error' && String(body?.note || '').startsWith(AUTO_STOP_NOTE)) {
    const again = await db
      .prepare(
        "UPDATE adam_jobs SET status = 'pending', attempts = attempts + 1, note = ?2, updated_at = ?3 " +
          "WHERE id = ?1 AND attempts < ?4 AND status IN ('working', 'pending', 'answered')",
      )
      .bind(id, 'הריצה נעצרה — אדם מתחיל שוב אוטומטית', new Date().toISOString(), AUTO_RETRIES)
      .run();
    if (again.meta.changes) return getAdamJob(db, id);
  }
  const r = await db
    .prepare('UPDATE adam_jobs SET status = ?2, note = ?3, updated_at = ?4 WHERE id = ?1')
    .bind(id, status, String(body?.note || '').slice(0, 2000), new Date().toISOString())
    .run();
  if (!r.meta.changes) return { status: 404, body: { error: 'not_found' } };
  return getAdamJob(db, id);
}

/** POST /api/adam/jobs/:id/result — `{ result: {...}, note? }` → status done. */
export async function saveAdamResult(db: D1Database, id: string, body: { result?: Record<string, unknown>; note?: string }): Promise<Res> {
  const result = body?.result;
  if (!result || typeof result !== 'object' || !String((result as { draft?: unknown }).draft || '').trim()) {
    return { status: 400, body: { error: 'result.draft required' } };
  }
  const json = JSON.stringify(result);
  if (json.length > MAX_JSON) return { status: 413, body: { error: 'result too large' } };
  await ready(db);
  const r = await db
    .prepare("UPDATE adam_jobs SET status = 'done', result = ?2, note = ?3, updated_at = ?4 WHERE id = ?1")
    .bind(id, json, String(body?.note || '').slice(0, 2000), new Date().toISOString())
    .run();
  if (!r.meta.changes) return { status: 404, body: { error: 'not_found' } };
  return getAdamJob(db, id);
}

/** Adam: POST /api/adam/jobs/:id/questions — `{ questions: [{ q, hint? }] | string[], note? }`
 *  → status "question"; the case-brain card shows a form for them. */
export async function askAdamQuestions(db: D1Database, id: string, body: { questions?: unknown[]; note?: string }): Promise<Res> {
  const qs = (Array.isArray(body?.questions) ? body.questions : [])
    .map((x) => (typeof x === 'string' ? { q: x } : (x as { q?: string; hint?: string })))
    .filter((x) => x && String(x.q || '').trim())
    .slice(0, 30)
    .map((x, i) => ({ id: 'q' + (i + 1), q: String(x.q).slice(0, 2000), hint: String(x.hint || '').slice(0, 500) }));
  if (!qs.length) return { status: 400, body: { error: 'questions required' } };
  await ready(db);
  const r = await db
    .prepare("UPDATE adam_jobs SET status = 'question', questions = ?2, answers = NULL, note = ?3, updated_at = ?4 WHERE id = ?1")
    .bind(id, JSON.stringify(qs), String(body?.note || '').slice(0, 2000), new Date().toISOString())
    .run();
  if (!r.meta.changes) return { status: 404, body: { error: 'not_found' } };
  return getAdamJob(db, id);
}

/** Office: POST /api/adam/jobs/:id/answers — `{ answers: { [questionId]: text } }` → status "answered". */
export async function saveAdamAnswers(db: D1Database, id: string, body: { answers?: Record<string, string> }): Promise<Res> {
  const a = body?.answers;
  if (!a || typeof a !== 'object') return { status: 400, body: { error: 'answers required' } };
  const clean: Record<string, string> = {};
  for (const [k, v] of Object.entries(a)) clean[String(k).slice(0, 20)] = String(v ?? '').slice(0, 8000);
  await ready(db);
  const r = await db
    .prepare("UPDATE adam_jobs SET status = 'answered', answers = ?2, note = '', updated_at = ?3 WHERE id = ?1 AND status = 'question'")
    .bind(id, JSON.stringify(clean), new Date().toISOString())
    .run();
  if (!r.meta.changes) return { status: 409, body: { error: 'not_waiting_for_answers' } };
  return getAdamJob(db, id);
}

/** Office: POST /api/adam/jobs/:id/apply — copy Adam's merged draft into the
 *  document's reply draft (drafts row DRAFT-<documentId>), the "טיוטת תגובה"
 *  card. The draft it replaces is kept on the job (result.previousDraft). */
export async function applyAdamDraft(db: D1Database, tenantId: string, id: string): Promise<Res> {
  await ready(db);
  const r = await db.prepare('SELECT * FROM adam_jobs WHERE id = ?1').bind(id).first<Row>();
  if (!r) return { status: 404, body: { error: 'not_found' } };
  const result = (parse(r.result) || {}) as Record<string, unknown>;
  const draft = String(result.draft || '').trim();
  if (r.status !== 'done' || !draft) return { status: 409, body: { error: 'no_result' } };
  if (!r.document_id) return { status: 400, body: { error: 'no_document' } };
  const pkg = (parse(r.package) || {}) as Record<string, unknown>;
  const lang = String(pkg.language || 'he') === 'ar' ? 'ar' : 'he';
  const sourceId = 'DRAFT-' + r.document_id;
  const prev = await db
    .prepare('SELECT draft_he, draft_ar, draft_orig FROM drafts WHERE user_id = ?1 AND source_id = ?2')
    .bind(tenantId, sourceId)
    .first<{ draft_he: string | null; draft_ar: string | null; draft_orig: string | null }>();
  const row: Record<string, unknown> = {
    source_id: sourceId,
    document_source_id: r.document_id,
    case_source_id: r.case_id,
    draft_he: lang === 'he' ? draft : null,
    draft_ar: lang === 'ar' ? draft : null,
    draft_orig: draft,
    language: lang,
    status: 'approved',
    date: new Date().toISOString().slice(0, 10),
  };
  const built = buildUpsert('drafts', row, tenantId);
  if (!built) return { status: 500, body: { error: 'upsert_failed' } };
  await db.prepare(built.sql).bind(...built.binds).run();
  if (prev && result.previousDraft === undefined) {
    result.previousDraft = (lang === 'ar' ? prev.draft_ar : prev.draft_he) || prev.draft_orig || '';
  }
  result.appliedAt = new Date().toISOString();
  await db
    .prepare('UPDATE adam_jobs SET result = ?2, updated_at = ?3 WHERE id = ?1')
    .bind(id, JSON.stringify(result), new Date().toISOString())
    .run();
  return getAdamJob(db, id);
}

// ---------------------------------------------------------------------------
// One Adam for every office.
//
// Adam runs on the operator's computer and signs in with the system token, so
// by itself he only sees the operator office's database. Every OTHER office's
// request is therefore also noted in the CONTROL database (which office it
// belongs to, and whether it is still open), so that:
//   - Adam's list of waiting requests can include the other offices' ones;
//   - a request id Adam works on leads back to the right office's database.
// The request itself — the package, the questions, the result — stays in the
// office's own database, exactly like the operator's.
// ---------------------------------------------------------------------------

import type { Env } from './db';
import { tenantDb } from './whatsapp';

let queueReady = false;
async function ensureQueue(env: Env): Promise<void> {
  if (queueReady) return;
  await env.CONTROL_DB.prepare(
    `CREATE TABLE IF NOT EXISTS adam_queue (
       id TEXT PRIMARY KEY,
       tenant_id TEXT NOT NULL,
       open INTEGER NOT NULL DEFAULT 1,
       updated_at TEXT NOT NULL
     )`,
  ).run();
  queueReady = true;
}

const CLOSED: string[] = ['done', 'error', 'cancelled'];

/** After any change to a request of an office other than the operator: note
 *  whose it is and whether Adam still has something to do with it. */
export async function trackAdamJob(env: Env, tenantId: string, res: Res): Promise<void> {
  if (tenantId === env.USER_ID || res.status !== 200) return;
  const job = (res.body as { job?: { id?: string; status?: string } } | null)?.job;
  if (!job?.id) return;
  try {
    await ensureQueue(env);
    await env.CONTROL_DB.prepare(
      `INSERT INTO adam_queue (id, tenant_id, open, updated_at) VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT(id) DO UPDATE SET open = excluded.open, updated_at = excluded.updated_at`,
    )
      .bind(job.id, tenantId, CLOSED.includes(String(job.status)) ? 0 : 1, new Date().toISOString())
      .run();
  } catch {
    /* the request itself was saved; Adam's list simply will not show it */
  }
}

export type AdamHome = { db: D1Database; tenantId: string; officeName: string };

async function officeName(env: Env, tenantId: string): Promise<string> {
  const row = await env.CONTROL_DB.prepare('SELECT name FROM tenant WHERE id = ?1').bind(tenantId).first<{ name: string | null }>();
  return String(row?.name || '').trim();
}

/** The office a request belongs to, when it is NOT the operator's. */
export async function adamJobHome(env: Env, id: string): Promise<AdamHome | null> {
  try {
    await ensureQueue(env);
    const row = await env.CONTROL_DB.prepare('SELECT tenant_id FROM adam_queue WHERE id = ?1').bind(id).first<{ tenant_id: string }>();
    if (!row?.tenant_id || row.tenant_id === env.USER_ID) return null;
    const db = await tenantDb(env, row.tenant_id);
    if (!db) return null;
    return { db, tenantId: row.tenant_id, officeName: await officeName(env, row.tenant_id) };
  } catch {
    return null;
  }
}

/** Mark a request (as Adam sees it) with the office it came from. */
export function withOffice(res: Res, home: AdamHome): Res {
  const job = (res.body as { job?: Record<string, unknown> } | null)?.job;
  if (job) {
    job.office = { id: home.tenantId, name: home.officeName };
    if (job.package && typeof job.package === 'object') {
      (job.package as Record<string, unknown>).otherOffice = { name: home.officeName };
    }
  }
  return res;
}

/** The other offices' requests matching the same filters as listAdamJobs. */
export async function listOtherOfficesAdamJobs(env: Env, url: URL): Promise<unknown[]> {
  const out: unknown[] = [];
  try {
    await ensureQueue(env);
    const rs = await env.CONTROL_DB.prepare('SELECT DISTINCT tenant_id FROM adam_queue WHERE open = 1').all<{ tenant_id: string }>();
    for (const t of rs.results ?? []) {
      if (t.tenant_id === env.USER_ID) continue;
      try {
        const db = await tenantDb(env, t.tenant_id);
        if (!db) continue; // a suspended office gets no service
        const name = await officeName(env, t.tenant_id);
        const r = await listAdamJobs(db, url);
        for (const j of (r.body as { jobs?: Record<string, unknown>[] }).jobs ?? []) {
          out.push({ ...j, office: { id: t.tenant_id, name } });
        }
      } catch {
        /* one office's database not answering must not hide the others */
      }
    }
  } catch {
    /* no queue yet */
  }
  return out;
}
