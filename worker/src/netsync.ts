// "סנכרון נט" — what the browser extension (extensions/netmishpat-ext) sent
// from Net HaMishpat / the Sharia courts' site, read back for the office screen.
//
// The extension's own endpoint, POST /api/netmishpat/ingest, lives in
// extensions/worker-snippet/netmishpat-ingest.ts and writes the nm_* tables
// (extensions/worker-snippet/netmishpat.sql) in the OPERATOR office's database:
// it is authorised by one bridge token (NM_BRIDGE_TOKEN), which belongs to that
// office. The routes here are therefore the operator office's too.

import type { Env } from './db';
import type { Ctx } from './tenant';

type Result = { status: number; body: Record<string, unknown> };

const isOperator = (env: Env, ctx: Ctx) => ctx.tenantId === env.USER_ID;

// netmishpat.sql or netmishpat-details.sql has not been run yet
const missingSchema = (e: unknown) =>
  /no such (table|column)/i.test(e instanceof Error ? e.message : String(e));

/** GET /api/netmishpat/overview */
export async function netSyncOverview(env: Env, ctx: Ctx): Promise<Result> {
  if (!isOperator(env, ctx)) return { status: 403, body: { error: 'not_available' } };
  const base = { configured: !!env.NM_BRIDGE_TOKEN };
  try {
    const [counts, documents, cases, snapshots] = await ctx.db.batch([
      ctx.db.prepare(
        `SELECT (SELECT COUNT(*) FROM nm_cases) AS cases,
                (SELECT COUNT(*) FROM nm_documents) AS documents,
                (SELECT COUNT(*) FROM nm_documents WHERE reviewed = 0) AS unreviewed,
                (SELECT COUNT(*) FROM nm_snapshots) AS snapshots,
                (SELECT MAX(created_at) FROM nm_snapshots) AS last_sync`,
      ),
      ctx.db.prepare(
        `SELECT id, href, title, case_number, source, first_seen_at, reviewed,
                doc_date, doc_type, summary, case_name,
                (file_key IS NOT NULL) AS has_file, file_size,
                filed_doc_id, filed_case_id, filing_status
           FROM nm_documents
          ORDER BY reviewed ASC, COALESCE(doc_date, substr(first_seen_at, 1, 10)) DESC, id ASC
          LIMIT 300`,
      ),
      ctx.db.prepare(
        `SELECT case_number, case_type, case_name, source, last_seen_url, last_seen_at
           FROM nm_cases ORDER BY last_seen_at DESC LIMIT 300`,
      ),
      ctx.db.prepare(
        `SELECT id, source, url, title, created_at FROM nm_snapshots ORDER BY id DESC LIMIT 20`,
      ),
    ]);
    return {
      status: 200,
      body: {
        ...base,
        ready: true,
        counts: counts.results[0] || {},
        hearings: await netSyncHearings(ctx.db),
        documents: documents.results,
        cases: cases.results,
        snapshots: snapshots.results,
      },
    };
  } catch (e) {
    if (missingSchema(e)) return { status: 200, body: { ...base, ready: false } };
    throw e;
  }
}

/** POST /api/netmishpat/reviewed  { id, reviewed } | { all: true } */
export async function netSyncReviewed(
  env: Env,
  ctx: Ctx,
  body: { id?: unknown; reviewed?: unknown; all?: unknown },
): Promise<Result> {
  if (!isOperator(env, ctx)) return { status: 403, body: { error: 'not_available' } };
  if (body.all === true) {
    await ctx.db.prepare('UPDATE nm_documents SET reviewed = 1 WHERE reviewed = 0').run();
    return { status: 200, body: { ok: true } };
  }
  const id = Number(body.id);
  if (!Number.isInteger(id)) return { status: 400, body: { error: 'id required' } };
  await ctx.db
    .prepare('UPDATE nm_documents SET reviewed = ?1 WHERE id = ?2')
    .bind(body.reviewed === false ? 0 : 1, id)
    .run();
  return { status: 200, body: { ok: true } };
}

// ---------------------------------------------------------------------------
// Details per decision / document.
//
// The extension sends the page as it is: the text, and the links. On the court
// site a list of decisions is not a table and its links are not addresses — a
// row is a few lines of text (date, kind, summary, case number, case name) and
// its link is a script whose text is just "החלטה". The extension's own handler
// can therefore only guess: it files every such link under the FIRST case
// number on the page, and takes the word before a case number as the case type.
//
// This step runs after that handler, on the same page, and puts it right: it
// reads the rows out of the text, pairs them with the links in page order, and
// writes the case, date, kind and case name onto each document and case.
// ---------------------------------------------------------------------------

type SentPage = {
  source?: unknown;
  url?: unknown;
  text?: unknown;
  caseNumbers?: { number?: unknown }[];
  docLinks?: { text?: unknown; href?: unknown }[];
};

export type ListRow = {
  date: string;
  kind: string;
  summary: string;
  caseNumber: string;
  caseName: string;
};

const DATE_LINE = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/;
const CASE_LINE = /^\d{3,6}-\d{2}-\d{2}$|^\d{3,6}\/\d{4}$/;
const HAS_CASE_NO = /\d{3,6}-\d{2}-\d{2}|\d{3,6}\/\d{4}/;

/** The rows of the lists on a page: a date line, then within a few lines a
 *  case-number line, then the case name. */
export function listRowsFromText(text: string): ListRow[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const rows: ListRow[] = [];
  for (let i = 0; i < lines.length; i++) {
    const d = DATE_LINE.exec(lines[i]);
    if (!d) continue;
    // date, kind, [summary …], case number — the case number within 4 lines
    let at = -1;
    for (let j = i + 1; j <= i + 4 && j < lines.length; j++) {
      if (DATE_LINE.test(lines[j])) break;
      if (CASE_LINE.test(lines[j])) {
        at = j;
        break;
      }
    }
    if (at < 0) continue;
    const between = lines.slice(i + 1, at);
    const next = lines[at + 1] || '';
    rows.push({
      date: `${d[3]}-${d[2].padStart(2, '0')}-${d[1].padStart(2, '0')}`,
      kind: between[0] || '',
      summary: between.slice(1).join(' '),
      caseNumber: lines[at],
      caseName: DATE_LINE.test(next) || CASE_LINE.test(next) ? '' : next,
    });
    i = at;
  }
  return rows;
}

/** "the parties | the kind of case" → its two halves. */
function splitCaseName(name: string): { parties: string; type: string } {
  const cut = name.lastIndexOf(' | ');
  return cut < 0
    ? { parties: name, type: '' }
    : { parties: name.slice(0, cut).trim(), type: name.slice(cut + 3).trim() };
}

/** The Sharia courts' site lists decisions as four lines per row: kind, date,
 *  a party's name, case number ("748/2026"). Nothing there is a link, so the
 *  extension's handler sees no documents; each row is written here, under the
 *  same key the extension gives it when its file is downloaded. */
async function enrichShariaPage(db: D1Database, text: string): Promise<void> {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const now = new Date().toISOString();
  const count = new Map<string, number>();
  const stmts: D1PreparedStatement[] = [];
  for (let i = 1; i + 2 < lines.length; i++) {
    const d = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(lines[i]);
    if (!d || !/^\d{1,6}\/\d{4}$/.test(lines[i + 2])) continue;
    const kind = lines[i - 1];
    const parties = lines[i + 1];
    const caseNo = lines[i + 2];
    const base = `sharia:${caseNo}|${lines[i]}|${kind}|${parties}`;
    const n = count.get(base) || 0;
    count.set(base, n + 1);
    stmts.push(
      db
        .prepare(
          `INSERT OR IGNORE INTO nm_documents
             (href, title, case_number, source, first_seen_at, doc_date, doc_type, case_name)
           VALUES (?1, ?2, ?3, 'net-batei-hadin', ?4, ?5, ?2, ?6)`,
        )
        .bind(
          n ? `${base}#${n}` : base,
          kind,
          caseNo,
          now,
          `${d[3]}-${d[2].padStart(2, '0')}-${d[1].padStart(2, '0')}`,
          parties,
        ),
      db.prepare('UPDATE nm_cases SET case_name = ?1 WHERE case_number = ?2').bind(parties, caseNo),
    );
  }
  if (stmts.length) await db.batch(stmts);
}

export async function enrichNetSync(db: D1Database, page: SentPage): Promise<void> {
  if (page.source === 'net-batei-hadin') {
    if (/\/discussions/i.test(String(page.url || ''))) return; // hearings: enrichHearings
    return enrichShariaPage(db, typeof page.text === 'string' ? page.text : '');
  }
  const rows = listRowsFromText(typeof page.text === 'string' ? page.text : '');
  const stmts: D1PreparedStatement[] = [];

  // Cases: the name and the real case type (not the word before the number)
  const seen = new Set<string>();
  for (const r of rows) {
    if (!r.caseName || seen.has(r.caseNumber)) continue;
    seen.add(r.caseNumber);
    const { parties, type } = splitCaseName(r.caseName);
    stmts.push(
      db
        .prepare(
          `UPDATE nm_cases SET case_name = ?1, case_type = COALESCE(NULLIF(?2, ''), case_type)
            WHERE case_number = ?3`,
        )
        .bind(parties, type, r.caseNumber),
    );
  }

  // Documents: a link whose own text names no case is one row of a list. Rows
  // and links are both in page order, so they pair one to one — but only when
  // their numbers agree; otherwise nothing is claimed.
  const links = (page.docLinks || [])
    .map((l) => ({ text: String(l.text || ''), href: String(l.href || '') }))
    .filter((l) => l.href && !HAS_CASE_NO.test(l.text));
  const unique = links.filter((l, i) => links.findIndex((o) => o.href === l.href) === i);
  if (rows.length > 0 && unique.length === rows.length) {
    unique.forEach((l, i) => {
      const r = rows[i];
      stmts.push(
        db
          .prepare(
            `UPDATE nm_documents
                SET case_number = ?1, doc_date = ?2, doc_type = ?3, summary = ?4, case_name = ?5
              WHERE href = ?6`,
          )
          .bind(
            r.caseNumber,
            r.date,
            r.kind || l.text,
            r.summary,
            splitCaseName(r.caseName).parties,
            l.href,
          ),
      );
    });
  } else if ((page.caseNumbers || []).length > 1) {
    // Could not be paired, and the page shows several cases: "the first case
    // on the page" is a guess, not a fact. Leave the case empty.
    for (const l of unique) {
      stmts.push(
        db
          .prepare('UPDATE nm_documents SET case_number = NULL WHERE href = ?1 AND doc_date IS NULL')
          .bind(l.href),
      );
    }
  }

  // A link to a place on the very page that was sent ("…#MessageA2") is part of
  // the page's own controls, not a document. The court's document viewer has
  // several, and its address contains "Document", so they were filed as such.
  const pageUrl = String(page.url || '').split('#')[0];
  for (const l of page.docLinks || []) {
    const href = String(l.href || '');
    if (pageUrl && href.includes('#') && href.split('#')[0] === pageUrl) {
      stmts.push(
        db
          .prepare('DELETE FROM nm_documents WHERE href = ?1 AND doc_date IS NULL AND file_key IS NULL')
          .bind(href),
      );
    }
  }

  // A script link whose whole text is a case number opens the CASE, not a
  // document ("btnCase" next to "btnDocument" in the court's lists). The
  // extension's handler files it as a document all the same; take it out.
  for (const l of page.docLinks || []) {
    const text = String(l.text || '').trim();
    const href = String(l.href || '');
    if (/^javascript:/i.test(href) && CASE_LINE.test(text)) {
      stmts.push(
        db
          .prepare('DELETE FROM nm_documents WHERE href = ?1 AND doc_date IS NULL AND file_key IS NULL')
          .bind(href),
      );
    }
  }

  if (stmts.length) await db.batch(stmts);
}

// ---------------------------------------------------------------------------
// The document itself.
//
// A decision's link on the court site only works inside the site. Its PDF
// reaches the office another way: when the lawyer saves a document from the
// court's viewer, the extension sends the same file here — with the link that
// was clicked to open it, which is how the file finds its row.
// ---------------------------------------------------------------------------

const MAX_FILE_BYTES = 100 * 1024 * 1024;

function sameToken(a: string, b: string): boolean {
  if (!a || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

/** POST /api/netmishpat/file?name=…[&href=…&text=…&context=…]
 *  (bridge token; the body is the PDF) */
export async function netSyncStoreFile(request: Request, env: Env): Promise<Result> {
  const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!env.NM_BRIDGE_TOKEN || !sameToken(token, env.NM_BRIDGE_TOKEN)) {
    return { status: 401, body: { error: 'unauthorized' } };
  }
  const q = new URL(request.url).searchParams;
  const name = (q.get('name') || '').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 180);
  if (!/\.pdf$/i.test(name)) return { status: 400, body: { error: 'name must be a .pdf' } };
  const size = Number(request.headers.get('Content-Length') || 0);
  if (size > MAX_FILE_BYTES) return { status: 413, body: { error: 'file too large' } };

  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > MAX_FILE_BYTES) return { status: 413, body: { error: 'file too large' } };
  // "%PDF" — anything else is not the document
  const head = new Uint8Array(bytes.slice(0, 4));
  if (!(head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46)) {
    return { status: 415, body: { error: 'not a PDF' } };
  }

  const key = `${env.USER_ID}/netmishpat/${name}`;
  await env.DOCS.put(key, bytes, { httpMetadata: { contentType: 'application/pdf' } });

  const now = new Date().toISOString();
  const href = q.get('href') || '';
  const row = listRowsFromText(q.get('context') || '')[0];
  const db = env.DB;
  // which site it came from: the civil courts' (default) or the Sharia courts'
  const source = q.get('source') === 'net-batei-hadin' ? 'net-batei-hadin' : 'net-hamishpat';

  if (href) {
    // The row of the link that was clicked. It exists if its list was sent
    // before; if not, it is created now from the clicked line of the list.
    await db
      .prepare(
        `INSERT OR IGNORE INTO nm_documents (href, title, case_number, source, first_seen_at)
         VALUES (?1, ?2, ?3, ?5, ?4)`,
      )
      .bind(href, q.get('text') || name, row ? row.caseNumber : null, now, source)
      .run();
    await db
      .prepare(
        `UPDATE nm_documents
            SET file_key = ?1, file_size = ?2, file_at = ?3,
                case_number = COALESCE(?4, case_number),
                doc_date = COALESCE(doc_date, ?5),
                doc_type = COALESCE(doc_type, ?6),
                case_name = COALESCE(case_name, ?7)
          WHERE href = ?8`,
      )
      .bind(
        key,
        bytes.byteLength,
        now,
        row ? row.caseNumber : null,
        row ? row.date : null,
        row ? row.kind || null : null,
        row ? splitCaseName(row.caseName).parties || null : null,
        href,
      )
      .run();
    const at = await db.prepare('SELECT id FROM nm_documents WHERE href = ?1').bind(href).first<{ id: number }>();
    return { status: 200, body: { ok: true, linked: true, id: at ? at.id : null } };
  }

  // Saved without a known link (the viewer was opened some other way): kept
  // on its own, under the file's name, with no case.
  const own = 'file:' + name;
  await db
    .prepare(
      `INSERT OR IGNORE INTO nm_documents (href, title, case_number, source, first_seen_at)
       VALUES (?1, ?2, NULL, ?4, ?3)`,
    )
    .bind(own, name, now, source)
    .run();
  await db
    .prepare('UPDATE nm_documents SET file_key = ?1, file_size = ?2, file_at = ?3 WHERE href = ?4')
    .bind(key, bytes.byteLength, now, own)
    .run();
  const at = await db.prepare('SELECT id FROM nm_documents WHERE href = ?1').bind(own).first<{ id: number }>();
  return { status: 200, body: { ok: true, linked: false, id: at ? at.id : null } };
}

/** GET /api/netmishpat/file?id=…   (the office's session) — the stored PDF */
export async function netSyncFile(env: Env, ctx: Ctx, id: string): Promise<Response | Result> {
  if (!isOperator(env, ctx)) return { status: 403, body: { error: 'not_available' } };
  const doc = await ctx.db
    .prepare('SELECT file_key FROM nm_documents WHERE id = ?1')
    .bind(Number(id))
    .first<{ file_key: string | null }>();
  if (!doc || !doc.file_key) return { status: 404, body: { error: 'no file' } };
  const obj = await env.DOCS.get(doc.file_key);
  if (!obj) return { status: 404, body: { error: 'no file' } };
  return new Response(obj.body, {
    headers: { 'Content-Type': 'application/pdf', 'Cache-Control': 'private, no-store' },
  });
}

// ---------------------------------------------------------------------------
// Filing a received PDF in the client's case.
//
// The court's case number on the document's row is looked up among the
// office's cases. One match: the PDF goes into that case's folder in the
// office's Dropbox under the next DOC number, named like every filed document
// ("CLT-127_CS-1056_<name>_DOC-364.pdf"), and its `documents` row is written —
// from there it is a document of the case like any other (make.com summarises
// it, the hearing sweep reads its dates).
//
// Nothing is filed on a guess: no case with that number, several cases with
// it, or a document that looks already filed by hand (same kind, same days) —
// each is recorded as the reason and left for the lawyer to decide on screen.
// ---------------------------------------------------------------------------

export type FilingDeps = {
  /** Put the bytes at this filing-relative path ("Clients/…") in the office's
   *  document storage; answers the path actually used. */
  upload: (relPath: string, bytes: ArrayBuffer) => Promise<{ ok: boolean; path?: string; error?: string }>;
};

export type Filing = { status: string; docId?: string; caseId?: string };

/** One spelling per case number, however it was typed.
 *  Civil courts: number-month-year, "76695-10-26".
 *  Sharia courts: number/year — "3392/2026", "תיק מס' 3392\2026" and
 *  "2026/3392" are all "3392-2026" (the year goes last). */
export function caseNumberKey(raw: unknown): string {
  const groups = (String(raw ?? '').match(/\d+/g) || []).map((g) => String(Number(g)));
  if (groups.length < 2) return '';
  const isYear = (g: string) => /^(19|20)\d\d$/.test(g);
  if (groups.length === 2 && isYear(groups[0]) && !isYear(groups[1])) groups.reverse();
  return groups.join('-');
}

function cleanSegment(name: string, fallback: string): string {
  const clean = name
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
    .trim();
  return clean || fallback;
}

const DAY_MS = 24 * 60 * 60 * 1000;

type NmRow = {
  id: number;
  title: string | null;
  case_number: string | null;
  doc_date: string | null;
  doc_type: string | null;
  case_name: string | null;
  file_key: string | null;
  filed_doc_id: string | null;
  filed_case_id: string | null;
  source: string | null;
};

export async function netSyncFileToCase(
  env: Env,
  db: D1Database,
  nmId: number,
  deps: FilingDeps,
  force = false,
): Promise<Filing> {
  const nm = await db
    .prepare(
      `SELECT id, title, case_number, doc_date, doc_type, case_name, file_key, filed_doc_id, filed_case_id, source
         FROM nm_documents WHERE id = ?1`,
    )
    .bind(nmId)
    .first<NmRow>();
  if (!nm) return { status: 'not_found' };
  if (nm.filed_doc_id) {
    return { status: 'filed', docId: nm.filed_doc_id, caseId: nm.filed_case_id || undefined };
  }
  if (!nm.file_key) return { status: 'no_file' };

  const note = async (status: string): Promise<Filing> => {
    await db.prepare('UPDATE nm_documents SET filing_status = ?1 WHERE id = ?2').bind(status, nmId).run();
    return { status };
  };

  const key = caseNumberKey(nm.case_number);
  if (!key) return note('no_case_number');

  const user = env.USER_ID;
  const cases = await db
    .prepare('SELECT source_id, client_source_id, case_number, title FROM cases WHERE user_id = ?1')
    .bind(user)
    .all<{ source_id: string; client_source_id: string | null; case_number: string | null; title: string | null }>();
  const matches = (cases.results || []).filter((c) => caseNumberKey(c.case_number) === key);
  if (matches.length === 0) return note('no_case');
  if (matches.length > 1) return note('ambiguous');
  const cs = matches[0];
  const caseId = String(cs.source_id).toUpperCase();
  const clientId = String(cs.client_source_id || '').toUpperCase();

  const docs = await db
    .prepare(
      `SELECT source_id, case_source_id, title, file_name, relative_path, date
         FROM documents WHERE user_id = ?1`,
    )
    .bind(user)
    .all<{
      source_id: string;
      case_source_id: string | null;
      title: string | null;
      file_name: string | null;
      relative_path: string | null;
      date: string | null;
    }>();
  const all = docs.results || [];
  const ofCase = all.filter((d) => String(d.case_source_id || '').toUpperCase() === caseId);

  const kind = (nm.doc_type || nm.title || 'מסמך').trim();
  // Already in the case, filed by hand? The same kind of document, dated the
  // court's day or up to three days after it (the day it was uploaded).
  if (!force && nm.doc_date) {
    const from = Date.parse(nm.doc_date);
    const twin = ofCase.find((d) => {
      const at = Date.parse(String(d.date || '').slice(0, 10));
      if (Number.isNaN(at) || at < from || at > from + 3 * DAY_MS) return false;
      return `${d.title || ''} ${d.file_name || ''}`.includes(kind);
    });
    if (twin) return note('duplicate:' + String(twin.source_id).toUpperCase());
  }

  // The next DOC number — over the ids and over the numbers carried in file
  // names, since a row written from a path may not have its own id yet.
  let max = 0;
  for (const d of all) {
    const own = /^DOC-(\d{1,6})$/i.exec(String(d.source_id || ''));
    const inPath = /_DOC-(\d{1,6})\.[A-Za-z0-9]+$/i.exec(String(d.relative_path || ''));
    for (const m of [own, inPath]) if (m && Number(m[1]) > max) max = Number(m[1]);
  }
  const docId = 'DOC-' + String(max + 1).padStart(3, '0');

  // The case's folder: the one its documents are already in; a new case gets
  // the folder the app itself would create.
  let folder = '';
  for (const d of ofCase) {
    const rel = String(d.relative_path || '');
    const m = /(?:^|\/)clients\/([^/]+)\/([^/]+)\/[^/]+$/i.exec(rel);
    if (!m) continue;
    const exact = /^Clients\//.test(rel); // written by the app, in its own spelling
    if (!folder || exact) folder = `Clients/${m[1]}/${m[2]}`;
    if (exact) break;
  }
  if (!folder) {
    const title = (cs.title || '').trim();
    folder =
      'Clients/' +
      (clientId ? cleanSegment(clientId, 'client').toLowerCase() + '/' : '') +
      cleanSegment(title ? `${caseId} - ${title}` : caseId, 'case');
  }

  const day = nm.doc_date ? nm.doc_date.split('-').reverse().join('.') : '';
  const stem = cleanSegment(
    [kind, day].filter(Boolean).join(' ') + (nm.case_name ? ' - ' + nm.case_name : ''),
    'מסמך',
  );
  const fileName =
    [clientId, caseId, stem, docId]
      .filter(Boolean)
      .map((p) => cleanSegment(p, 'x'))
      .join('_') + '.pdf';

  const obj = await env.DOCS.get(nm.file_key);
  if (!obj) return note('error:file_missing');
  const up = await deps.upload(`${folder}/${fileName}`, await obj.arrayBuffer());
  if (!up.ok) return note('error:' + String(up.error || 'upload_failed').slice(0, 80));

  const now = new Date().toISOString();
  await db.batch([
    db
      .prepare(
        `INSERT OR IGNORE INTO documents
           (id, user_id, source_id, case_source_id, client_source_id, title, title_ar,
            description, description_ar, file_name, relative_path, date, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?12)`,
      )
      .bind(
        crypto.randomUUID(),
        user,
        docId,
        cs.source_id,
        cs.client_source_id,
        stem,
        nm.source === 'net-batei-hadin' ? 'יובא מנט בתי הדין השרעיים' : 'יובא מנט המשפט',
        nm.source === 'net-batei-hadin' ? 'استُورد من موقع المحاكم الشرعية' : 'استُورد من نت همشباط',
        fileName,
        up.path || `${folder}/${fileName}`,
        nm.doc_date || now.slice(0, 10),
        now,
      ),
    db
      .prepare(
        `UPDATE nm_documents SET filed_doc_id = ?1, filed_case_id = ?2, filed_at = ?3, filing_status = 'filed'
          WHERE id = ?4`,
      )
      .bind(docId, caseId, now, nmId),
  ]);
  return { status: 'filed', docId, caseId };
}

/** Documents that arrived before their case existed in the office's system
 *  are filed as soon as it does: called when cases are saved, and when the
 *  screen is opened. Nothing waiting = one small query. */
export async function netSyncRetryPending(env: Env, db: D1Database, deps: FilingDeps): Promise<number> {
  const waiting = await db
    .prepare(
      `SELECT id FROM nm_documents
        WHERE file_key IS NOT NULL AND filed_doc_id IS NULL AND filing_status = 'no_case'
        ORDER BY id LIMIT 10`,
    )
    .all<{ id: number }>();
  let filed = 0;
  for (const w of waiting.results || []) {
    const f = await netSyncFileToCase(env, db, w.id, deps);
    if (f.status === 'filed') filed++;
  }
  return filed;
}

/** POST /api/netmishpat/file-to-case  { id, force? }   (the office's session) */
export async function netSyncFileToCaseRoute(
  env: Env,
  ctx: Ctx,
  body: { id?: unknown; force?: unknown },
  deps: FilingDeps,
): Promise<Result> {
  if (!isOperator(env, ctx)) return { status: 403, body: { error: 'not_available' } };
  const id = Number(body.id);
  if (!Number.isInteger(id)) return { status: 400, body: { error: 'id required' } };
  const filing = await netSyncFileToCase(env, ctx.db, id, deps, body.force === true);
  return { status: 200, body: { ok: filing.status === 'filed', filing } };
}

/** POST /api/netmishpat/pending  { hrefs, diag? }   (bridge token)
 *  Which of these documents have no file here yet — what the extension's
 *  "import everything on the page" still has to open. `diag` is a description
 *  of the court viewer's toolbar, kept for fixing the save-button lookup. */
export async function netSyncPending(request: Request, env: Env): Promise<Result> {
  const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!env.NM_BRIDGE_TOKEN || !sameToken(token, env.NM_BRIDGE_TOKEN)) {
    return { status: 401, body: { error: 'unauthorized' } };
  }
  const body = (await request.json().catch(() => ({}))) as { hrefs?: unknown; diag?: unknown };
  const db = env.DB;
  if (typeof body.diag === 'string' && body.diag) {
    const now = new Date().toISOString();
    await db
      .prepare(
        `INSERT INTO nm_snapshots (source, url, title, captured_at, text_content, created_at)
         VALUES ('diag', 'viewer-toolbar', 'viewer-toolbar', ?1, ?2, ?1)`,
      )
      .bind(now, body.diag.slice(0, 60000))
      .run();
  }
  const hrefs = (Array.isArray(body.hrefs) ? body.hrefs : []).map((h) => String(h)).slice(0, 100);
  const have = new Set<string>();
  for (let i = 0; i < hrefs.length; i += 40) {
    const chunk = hrefs.slice(i, i + 40);
    const rs = await db
      .prepare(
        `SELECT href FROM nm_documents WHERE file_key IS NOT NULL AND href IN (${chunk.map((_, j) => '?' + (j + 1)).join(', ')})`,
      )
      .bind(...chunk)
      .all<{ href: string }>();
    for (const r of rs.results || []) have.add(r.href);
  }
  return { status: 200, body: { ok: true, pending: hrefs.filter((h) => !have.has(h)) } };
}

// ---------------------------------------------------------------------------
// Hearings.
//
// The court site's "הדיונים שלי" report lists the lawyer's hearings: date, hour,
// court, case name, case number, kind of hearing, judge, status. When that page
// is sent, each row is kept (nm_hearings) and entered in the office calendar
// under its case — the case found by its court number, as for documents.
//
// The calendar keeps one hearing per case per day. A day that already has one
// is left as it is; a hearing the court cancelled is not entered; one the
// office deleted from its calendar is not brought back.
// ---------------------------------------------------------------------------

export type SittingRow = {
  date: string; // 2026-12-03
  time: string; // 10:00
  court: string;
  caseName: string;
  caseNumber: string;
  kind: string;
  judge: string;
  status: string;
};

const TIME_LINE = /^([01]?\d|2[0-3]):([0-5]\d)$/;
const STATUS_WORD = /^(נקבע|בוטל|מבוטל|נדחה|התקיים|לא התקיים|הסתיים|נדחה ללא מועד)$/;
const CANCELLED = /בוטל|נדחה|לא התקיים/;
const COURT_CASE_IN_LINE = /\d{3,6}-\d{2}-\d{2}/;

/** Rows of the hearings report: a date line, an hour line, then within a few
 *  lines the case number; what follows is the kind, the judge and the status. */
export function sittingsFromText(text: string): SittingRow[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const out: SittingRow[] = [];
  for (let i = 0; i + 1 < lines.length; i++) {
    const d = DATE_LINE.exec(lines[i]);
    const t = TIME_LINE.exec(lines[i + 1]);
    if (!d || !t) continue;
    let at = -1;
    for (let j = i + 2; j <= i + 5 && j < lines.length; j++) {
      if (DATE_LINE.test(lines[j])) break;
      if (COURT_CASE_IN_LINE.test(lines[j])) {
        at = j;
        break;
      }
    }
    if (at < 0) continue;
    const before = lines.slice(i + 2, at);
    const after: string[] = [];
    for (let j = at + 1; j < lines.length && after.length < 4; j++) {
      // the next row, or the grid's footer ("1 עד 1 מתוך 1")
      if (DATE_LINE.test(lines[j]) || /מתוך/.test(lines[j])) break;
      after.push(lines[j]);
    }
    const status = after.find((l) => STATUS_WORD.test(l)) || '';
    const rest = after.filter((l) => l !== status);
    out.push({
      date: `${d[3]}-${d[2].padStart(2, '0')}-${d[1].padStart(2, '0')}`,
      time: `${t[1].padStart(2, '0')}:${t[2]}`,
      court: before[0] || '',
      caseName: before.slice(1).join(' '),
      caseNumber: (COURT_CASE_IN_LINE.exec(lines[at]) || [''])[0],
      kind: rest[0] || '',
      judge: rest.length > 1 ? rest[rest.length - 1] : '',
      status,
    });
    i = at;
  }
  return out;
}

/** The Sharia courts' site, "הדיונים שלך": a row starts with the case number
 *  ("2217/2026"), then the chamber, the kind of case, the parties, the kind of
 *  hearing, its date and hour, the place, the judge and the lawyer's role. */
export function shariaSittingsFromText(text: string): SittingRow[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const isCase = (l: string) => /^\d{1,6}\/\d{4}$/.test(l);
  const out: SittingRow[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!isCase(lines[i])) continue;
    let at = -1;
    let d: RegExpExecArray | null = null;
    for (let j = i + 1; j <= i + 7 && j < lines.length; j++) {
      if (isCase(lines[j])) break;
      d = /(?:^|\D)(\d{1,2})\/(\d{1,2})\/(\d{4})(?!\d)/.exec(lines[j]);
      if (d) {
        at = j;
        break;
      }
    }
    if (at < 0 || !d) continue;
    // the hour: on the date's own line, or alone on the next one
    // "09/05/2027 בשעה 11:50 - 12:30": a range, and a right-to-left line may
    // hold its two hours in either order — the hearing starts at the earlier.
    const inLine = [...lines[at].matchAll(/(?:^|\D)([01]?\d|2[0-3]):([0-5]\d)(?!\d)/g)].sort(
      (a, b) => Number(a[1]) * 60 + Number(a[2]) - (Number(b[1]) * 60 + Number(b[2])),
    );
    const hour = inLine[0] || TIME_LINE.exec(lines[at + 1] || '');
    const hourOnNextLine = !/:/.test(lines[at]) && !!hour;
    const before = lines.slice(i + 1, at);
    const after: string[] = [];
    for (let j = at + (hourOnNextLine ? 2 : 1); j < lines.length && after.length < 3; j++) {
      if (isCase(lines[j]) || /מתוך/.test(lines[j])) break;
      after.push(lines[j]);
    }
    out.push({
      date: `${d[3]}-${d[2].padStart(2, '0')}-${d[1].padStart(2, '0')}`,
      time: hour ? `${hour[1].padStart(2, '0')}:${hour[2]}` : '',
      court: ['בית דין שרעי', before[0]].filter(Boolean).join(' '),
      caseName: before[2] || '',
      caseNumber: lines[i],
      kind: [before[3], before[1]].filter(Boolean).join(' - '),
      judge: after[1] || '',
      status: '',
    });
    i = at;
  }
  return out;
}

/** An Israel wall-clock day and hour → the true UTC instant (the calendar
 *  stores UTC and shows Israel time). */
export function israelToUtc(day: string, time: string): string {
  const [y, m, d] = day.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  for (const offset of [2, 3]) {
    const guess = new Date(Date.UTC(y, m - 1, d, hh - offset, mm));
    const shown = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Jerusalem',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(guess);
    if (shown === `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`) return guess.toISOString();
  }
  return new Date(Date.UTC(y, m - 1, d, hh - 2, mm)).toISOString();
}

type HearingRecord = {
  id: number;
  source: string;
  case_number: string;
  hearing_date: string;
  hearing_time: string;
  court: string | null;
  hearing_type: string | null;
  judge: string | null;
  status: string | null;
  event_id: string | null;
};

/** Enter one kept hearing in the calendar (or say why not). */
async function hearingToCalendar(env: Env, db: D1Database, h: HearingRecord): Promise<string> {
  const set = async (status: string, caseId: string | null, eventId: string | null) => {
    await db
      .prepare('UPDATE nm_hearings SET calendar_status = ?1, case_id = COALESCE(?2, case_id), event_id = COALESCE(?3, event_id) WHERE id = ?4')
      .bind(status, caseId, eventId, h.id)
      .run();
    return status;
  };
  if (h.event_id) return 'added';
  if (CANCELLED.test(h.status || '')) return set('cancelled', null, null);

  const user = env.USER_ID;
  const key = caseNumberKey(h.case_number);
  const cases = await db
    .prepare('SELECT source_id, client_source_id, case_number FROM cases WHERE user_id = ?1')
    .bind(user)
    .all<{ source_id: string; client_source_id: string | null; case_number: string | null }>();
  const matches = (cases.results || []).filter((c) => caseNumberKey(c.case_number) === key);
  if (matches.length === 0) return set('no_case', null, null);
  if (matches.length > 1) return set('ambiguous', null, null);
  const cs = matches[0];
  const caseId = String(cs.source_id).toUpperCase();
  const eventId = `EV-NM-${caseId}-${h.hearing_date.replace(/-/g, '')}`;

  // Deleted by the office from its calendar: not brought back.
  try {
    const gone = await db
      .prepare('SELECT 1 AS x FROM dismissed_events WHERE user_id = ?1 AND key IN (?2, ?3) LIMIT 1')
      .bind(user, 'id:' + eventId, `hearing:${caseId}|${h.hearing_date}`)
      .first();
    if (gone) return set('dismissed', caseId, null);
  } catch {
    /* no such table yet = nothing was deleted */
  }

  // One hearing per case per day: a day that has one already is left alone.
  const events = await db
    .prepare(
      `SELECT source_id, date_time FROM calendar_events
        WHERE user_id = ?1 AND upper(case_source_id) = ?2 AND lower(type) LIKE 'hearing%'`,
    )
    .bind(user, caseId)
    .all<{ source_id: string; date_time: string | null }>();
  const dayOf = (v: string | null) => {
    const raw = String(v || '');
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    const at = new Date(raw);
    return isNaN(at.getTime())
      ? ''
      : new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
  };
  const same = (events.results || []).find((e) => dayOf(e.date_time) === h.hearing_date);
  if (same) return set('exists', caseId, null);

  const now = new Date().toISOString();
  const details = [h.hearing_type, h.court, h.judge && 'בפני ' + h.judge].filter(Boolean).join(' · ');
  await db
    .prepare(
      `INSERT OR IGNORE INTO calendar_events
         (id, user_id, source_id, case_source_id, client_source_id, title, title_ar,
          date_time, description, description_ar, type, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 'hearingMeeting', ?11, ?11)`,
    )
    .bind(
      crypto.randomUUID(),
      user,
      eventId,
      cs.source_id,
      cs.client_source_id,
      !h.hearing_type ? 'דיון' : h.hearing_type.startsWith('דיון') ? h.hearing_type : `דיון - ${h.hearing_type}`,
      'جلسة',
      // no hour on the court's list: the day alone
      h.hearing_time ? israelToUtc(h.hearing_date, h.hearing_time) : h.hearing_date,
      (h.source === 'net-batei-hadin'
        ? 'מועד הדיון יובא מרשימת הדיונים בנט בתי הדין השרעיים.'
        : 'מועד הדיון יובא מיומן הדיונים בנט המשפט.') + (details ? ' ' + details : ''),
      h.source === 'net-batei-hadin'
        ? 'أُدرج موعد الجلسة من قائمة الجلسات في موقع المحاكم الشرعية.'
        : 'أُدرج موعد الجلسة من جدول الجلسات في نت همشباط.',
      now,
    )
    .run();
  return set('added', caseId, eventId);
}

/** The hearings on a sent page: kept, and entered in the calendar. */
export async function enrichHearings(env: Env, db: D1Database, page: SentPage): Promise<number> {
  const text = typeof page.text === 'string' ? page.text : '';
  const sharia = page.source === 'net-batei-hadin';
  if (sharia && !/\/discussions/i.test(String(page.url || ''))) return 0;
  const source = sharia ? 'net-batei-hadin' : 'net-hamishpat';
  const rows = sharia ? shariaSittingsFromText(text) : sittingsFromText(text);
  if (!rows.length) return 0;
  const now = new Date().toISOString();
  await db.batch(
    rows.map((r) =>
      db
        .prepare(
          `INSERT INTO nm_hearings
             (source, case_number, hearing_date, hearing_time, court, case_name, hearing_type, judge, status, first_seen_at, last_seen_at)
           VALUES (?10, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)
           ON CONFLICT (source, case_number, hearing_date, hearing_time) DO UPDATE SET
             court = excluded.court, case_name = excluded.case_name, hearing_type = excluded.hearing_type,
             judge = excluded.judge, status = excluded.status, last_seen_at = excluded.last_seen_at`,
        )
        .bind(r.caseNumber, r.date, r.time, r.court, r.caseName, r.kind, r.judge, r.status, now, source),
    ),
  );
  return netSyncHearingsToCalendar(env, db);
}

/** Every kept hearing that is not in the calendar yet and could be now — after
 *  a page was sent, and after a case was opened in the office's system. */
export async function netSyncHearingsToCalendar(env: Env, db: D1Database): Promise<number> {
  const waiting = await db
    .prepare(
      `SELECT id, source, case_number, hearing_date, hearing_time, court, hearing_type, judge, status, event_id
         FROM nm_hearings
        WHERE event_id IS NULL AND (calendar_status IS NULL OR calendar_status = 'no_case')
          AND hearing_date >= date('now', '-1 day')
        ORDER BY hearing_date LIMIT 40`,
    )
    .all<HearingRecord>();
  let added = 0;
  for (const h of waiting.results || []) {
    if ((await hearingToCalendar(env, db, h)) === 'added') added++;
  }
  return added;
}

/** GET part of the overview: the hearings, soonest first. */
export async function netSyncHearings(db: D1Database): Promise<unknown[]> {
  try {
    const rs = await db
      .prepare(
        `SELECT id, source, case_number, hearing_date, hearing_time, court, case_name, hearing_type, judge,
                status, case_id, event_id, calendar_status, last_seen_at
           FROM nm_hearings ORDER BY hearing_date DESC, hearing_time DESC LIMIT 300`,
      )
      .all();
    return rs.results || [];
  } catch (e) {
    if (missingSchema(e)) return [];
    throw e;
  }
}
