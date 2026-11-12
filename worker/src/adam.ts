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
// Office-session / APP_TOKEN auth like every other office route; each office's
// jobs live in its own database (ctx.db).

const DDL =
  'CREATE TABLE IF NOT EXISTS adam_jobs (' +
  'id TEXT PRIMARY KEY, case_id TEXT NOT NULL, document_id TEXT, ' +
  "status TEXT NOT NULL DEFAULT 'pending', title TEXT, package TEXT NOT NULL, " +
  'result TEXT, note TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)';

const MAX_JSON = 400_000;
const STATUSES = ['pending', 'working', 'done', 'error', 'cancelled'] as const;
type Status = (typeof STATUSES)[number];

type Row = {
  id: string;
  case_id: string;
  document_id: string | null;
  status: Status;
  title: string | null;
  package: string;
  result: string | null;
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
  };
}

async function ready(db: D1Database) {
  await db.prepare(DDL).run();
}

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
  if (!STATUSES.includes(status) || status === 'done') return { status: 400, body: { error: 'bad status' } };
  await ready(db);
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
