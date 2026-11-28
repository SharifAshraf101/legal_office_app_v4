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
                (file_key IS NOT NULL) AS has_file, file_size
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

export async function enrichNetSync(db: D1Database, page: SentPage): Promise<void> {
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

  if (href) {
    // The row of the link that was clicked. It exists if its list was sent
    // before; if not, it is created now from the clicked line of the list.
    await db
      .prepare(
        `INSERT OR IGNORE INTO nm_documents (href, title, case_number, source, first_seen_at)
         VALUES (?1, ?2, ?3, 'net-hamishpat', ?4)`,
      )
      .bind(href, q.get('text') || name, row ? row.caseNumber : null, now)
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
    return { status: 200, body: { ok: true, linked: true } };
  }

  // Saved without a known link (the viewer was opened some other way): kept
  // on its own, under the file's name, with no case.
  const own = 'file:' + name;
  await db
    .prepare(
      `INSERT OR IGNORE INTO nm_documents (href, title, case_number, source, first_seen_at)
       VALUES (?1, ?2, NULL, 'net-hamishpat', ?3)`,
    )
    .bind(own, name, now)
    .run();
  await db
    .prepare('UPDATE nm_documents SET file_key = ?1, file_size = ?2, file_at = ?3 WHERE href = ?4')
    .bind(key, bytes.byteLength, now, own)
    .run();
  return { status: 200, body: { ok: true, linked: false } };
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
