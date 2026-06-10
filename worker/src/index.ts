// Cloudflare Worker API for the legal-office app. Replaces the Supabase
// PostgREST + Storage endpoints the browser used to call directly.
//
//   GET  /api/health        -> { ok: true }                (no auth)
//   GET  /api/photo/<key>   -> streams the R2 object        (no auth: parity
//                              with the old public Storage bucket; <img> tags
//                              cannot send an Authorization header)
//   GET  /api/load          -> all rows for the configured user (auth)
//   POST /api/save          -> upsert all tables            (auth)
//   POST /api/upload-photo  -> store a client photo in R2   (auth)
//
// Auth is a shared bearer token (APP_TOKEN). CORS is locked to ALLOWED_ORIGIN.

import { corsHeaders, json, preflight } from './cors';
import { buildUpsert, LOAD_TABLES, safeParse, type Env } from './db';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    if (method === 'OPTIONS') return preflight(request, env);

    // ----- public endpoints (no bearer token) -----
    if (path === '/api/health') {
      return json({ ok: true }, request, env);
    }
    if (method === 'GET' && path.startsWith('/api/photo/')) {
      return servePhoto(env, path.slice('/api/photo/'.length));
    }

    // ----- everything below requires a shared token -----
    // APP_TOKEN may hold a COMMA-SEPARATED list of accepted tokens so the
    // localhost/desktop build and the deployed (Vercel) build — which were
    // generated with DIFFERENT NEXT_PUBLIC_APP_TOKEN values — both work at the
    // same time. Previously only one matched, so whichever side was set last
    // broke the other with a 401.
    const auth = request.headers.get('Authorization') || '';
    const provided = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    const allowed = (env.APP_TOKEN || '')
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    if (!provided || !allowed.includes(provided)) {
      return json({ error: 'unauthorized' }, request, env, 401);
    }

    if (method === 'GET' && path === '/api/load') return handleLoad(request, env);
    if (method === 'GET' && path === '/api/file-summary') {
      return handleFileSummary(request, env);
    }
    if (method === 'POST' && path === '/api/file-summary') {
      return handleStoreFileSummary(request, env);
    }
    if (method === 'POST' && path === '/api/save') return handleSave(request, env);
    if (method === 'GET' && path === '/api/case-notes') {
      return handleCaseNotes(request, env);
    }
    if (method === 'GET' && path === '/api/drafts') {
      return handleDrafts(request, env);
    }
    if (method === 'GET' && path === '/api/skills') {
      return handleSkills(request, env);
    }
    if (method === 'POST' && path === '/api/upload-photo') {
      return handleUploadPhoto(request, env);
    }

    return json({ error: 'not found' }, request, env, 404);
  },
};

// ---------------------------------------------------------------------------
// GET /api/load — one JSON object with every table's rows (snake_case, exactly
// as PostgREST returned them) so the client's normalize* code is reused as-is.
// ---------------------------------------------------------------------------
async function handleLoad(request: Request, env: Env): Promise<Response> {
  const out: Record<string, unknown> = {};
  for (const table of LOAD_TABLES) {
    // Defensive: a reprocess pipeline can write a `documents` row keyed by the
    // full Dropbox path instead of the DOC-NNN id (directly to D1, bypassing
    // the /api/save guard), duplicating the real row. Never surface those — a
    // real source_id never contains '/'.
    const extra = table === 'documents' ? " AND source_id NOT LIKE '%/%'" : '';
    const rs = await env.DB.prepare(
      `SELECT * FROM ${table} WHERE user_id = ?${extra}`,
    )
      .bind(env.USER_ID)
      .all();
    out[table] = rs.results ?? [];
  }
  // Whole-app JSON fallback the loader reads when every table is empty.
  const asRow = await env.DB.prepare(
    `SELECT state, payload, data FROM app_state WHERE user_id = ?`,
  )
    .bind(env.USER_ID)
    .first<{ state?: string; payload?: string; data?: string }>();
  out.app_state = asRow
    ? safeParse(asRow.state) ?? safeParse(asRow.payload) ?? safeParse(asRow.data)
    : null;

  return json(out, request, env);
}

// ---------------------------------------------------------------------------
// GET /api/file-summary — look up a document's AI summary in the file_summary
// table (the single source of truth for summaries; they are NOT stored on the
// documents row). Matches the renamed file name, then the original name, then
// a case-insensitive case_id prefix (newest first). Returns { he, ar, language }.
// ---------------------------------------------------------------------------
async function handleFileSummary(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const file = (url.searchParams.get('file') || '').trim();
  const orig = (url.searchParams.get('orig') || '').trim();
  const caseId = (url.searchParams.get('caseId') || '').trim();
  if (!file && !orig && !caseId) {
    return json({ he: '', ar: '', language: '' }, request, env);
  }
  // Also match by the stable DOC-NNN id so a row stored under a slightly
  // different path is still found (otherwise a "not found" triggers a
  // regenerate → yet another duplicate). Ranked below the exact file matches.
  const docMatch = /(DOC-\d+)/i.exec(file) || /(DOC-\d+)/i.exec(orig);
  const docId = docMatch ? docMatch[1].toUpperCase() : '';
  const row = await env.DB.prepare(
    'SELECT summary_he, summary_ar, language FROM file_summary ' +
      'WHERE file_name = ?1 OR file_name = ?2 ' +
      "OR (?4 <> '' AND (upper(file_name) LIKE '%' || ?4 || '.%' OR upper(file_name) LIKE '%' || ?4)) " +
      "OR (?3 <> '' AND lower(case_id) LIKE lower(?3) || '%') " +
      'ORDER BY (file_name = ?1) DESC, (file_name = ?2) DESC, ' +
      "(?4 <> '' AND upper(file_name) LIKE '%' || ?4 || '.%') DESC, id DESC LIMIT 1",
  )
    .bind(file, orig, caseId, docId)
    .first<{ summary_he?: string; summary_ar?: string; language?: string }>();
  return json(
    {
      he: row?.summary_he || '',
      ar: row?.summary_ar || '',
      language: String(row?.language || '').toLowerCase(),
    },
    request,
    env,
  );
}

// ---------------------------------------------------------------------------
// POST /api/file-summary — store (upsert) an AI-generated summary for a file.
// Body: { file_name, client_id?, case_id?, summary_he?, summary_ar?, language?,
//         ai_model? }. Replaces any existing row with the same file_name so a
// document keeps exactly one summary.
// ---------------------------------------------------------------------------
async function handleStoreFileSummary(
  request: Request,
  env: Env,
): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'invalid json' }, request, env, 400);
  }
  const fileName = String(body.file_name || '').trim();
  if (!fileName) {
    return json({ error: 'file_name required' }, request, env, 400);
  }
  const str = (v: unknown) => {
    const s = String(v ?? '').trim();
    return s || null;
  };
  // Dedup by the STABLE DOC-NNN id embedded in the filing name, not by the
  // exact file_name. A reprocess whose Dropbox path/name differs even slightly
  // (different stem, casing, .docx→.pdf, folder prefix) would otherwise fail
  // the exact match and INSERT a duplicate instead of replacing the old row.
  // The token boundary ('DOC-12.' or end-of-string) avoids DOC-12 ≡ DOC-120.
  const docMatch = /(DOC-\d+)/i.exec(fileName);
  const docId = docMatch ? docMatch[1].toUpperCase() : '';
  if (docId) {
    await env.DB.prepare(
      'DELETE FROM file_summary WHERE file_name = ?1 ' +
        "OR upper(file_name) LIKE '%' || ?2 || '.%' " +
        "OR upper(file_name) LIKE '%' || ?2",
    )
      .bind(fileName, docId)
      .run();
  } else {
    await env.DB.prepare('DELETE FROM file_summary WHERE file_name = ?')
      .bind(fileName)
      .run();
  }
  await env.DB.prepare(
    'INSERT INTO file_summary (client_id, case_id, file_name, summary_he, summary_ar, language, ai_model) ' +
      'VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)',
  )
    .bind(
      str(String(body.client_id ?? '').toLowerCase()),
      str(String(body.case_id ?? '').toLowerCase()),
      fileName,
      str(body.summary_he),
      str(body.summary_ar),
      str(String(body.language ?? '').toLowerCase()),
      str(body.ai_model),
    )
    .run();
  return json({ ok: true }, request, env);
}

// ---------------------------------------------------------------------------
// POST /api/save — upsert every table in a single D1 batch (transaction).
// Body shape matches the client's *ToRow() output, keyed by table name.
// ---------------------------------------------------------------------------
async function handleSave(request: Request, env: Env): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'invalid json' }, request, env, 400);
  }

  const statements: D1PreparedStatement[] = [];
  for (const table of LOAD_TABLES) {
    const rows = Array.isArray(body[table]) ? (body[table] as unknown[]) : [];
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      const built = buildUpsert(table, row as Record<string, unknown>, env.USER_ID);
      if (built) statements.push(env.DB.prepare(built.sql).bind(...built.binds));
    }
  }

  if (statements.length) await env.DB.batch(statements);
  // Keep the dedicated `case_notes` table in sync. It's a DERIVED MIRROR of the
  // note-type timeline rows (joined to cases for the client id), so it can never
  // drift out of sync the way an independently-edited copy would. Rebuilt only
  // when notes or cases changed in this save.
  if (Array.isArray(body.timeline_items) || Array.isArray(body.cases)) {
    try {
      await syncCaseNotes(env);
    } catch {
      // never fail the save because the mirror rebuild hiccuped
    }
  }
  return json({ ok: true, count: statements.length }, request, env);
}

// Rebuild `case_notes` for this user from the note-type timeline_items, joining
// `cases` to resolve the client id. One row per note, keyed by the note's own
// stable source_id — same document/note, any path. See /api/case-notes.
async function syncCaseNotes(env: Env): Promise<void> {
  await env.DB.prepare('DELETE FROM case_notes WHERE user_id = ?')
    .bind(env.USER_ID)
    .run();
  await env.DB.prepare(
    'INSERT INTO case_notes ' +
      '(id, user_id, source_id, client_id, case_id, note, note_ar, date, created_at, updated_at) ' +
      'SELECT ti.id, ti.user_id, ti.source_id, c.client_source_id, ti.case_source_id, ' +
      'ti.description, ti.description_ar, ti.date, ti.created_at, ti.updated_at ' +
      'FROM timeline_items ti ' +
      'LEFT JOIN cases c ON c.user_id = ti.user_id AND c.source_id = ti.case_source_id ' +
      "WHERE ti.user_id = ?1 AND lower(coalesce(ti.type, 'note')) = 'note' " +
      "AND coalesce(trim(ti.description), '') <> ''",
  )
    .bind(env.USER_ID)
    .run();
}

// ---------------------------------------------------------------------------
// GET /api/case-notes?caseId=&clientId= — the dedicated per-client+case notes
// list (mirror of the note-type timeline rows). Either filter is optional;
// without filters it returns every note for the user. Newest first.
// ---------------------------------------------------------------------------
async function handleCaseNotes(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const caseId = (url.searchParams.get('caseId') || '').trim();
  const clientId = (url.searchParams.get('clientId') || '').trim();
  const binds: unknown[] = [env.USER_ID];
  let sql =
    'SELECT source_id, client_id, case_id, note, note_ar, date, created_at ' +
    'FROM case_notes WHERE user_id = ?1';
  if (caseId) {
    binds.push(caseId);
    sql += ` AND upper(case_id) = upper(?${binds.length})`;
  }
  if (clientId) {
    binds.push(clientId);
    sql += ` AND lower(client_id) = lower(?${binds.length})`;
  }
  sql += ' ORDER BY date DESC, created_at DESC';
  const rs = await env.DB.prepare(sql)
    .bind(...binds)
    .all();
  return json({ notes: rs.results ?? [] }, request, env);
}

// ---------------------------------------------------------------------------
// GET /api/drafts?caseId=&clientId=&documentId= — pull AI-generated reply
// drafts. All filters optional; newest first. Drafts are WRITTEN by the Make
// pipeline via POST /api/save ({ drafts: [...] }) — this is the read side.
// ---------------------------------------------------------------------------
async function handleDrafts(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const caseId = (url.searchParams.get('caseId') || '').trim();
  const clientId = (url.searchParams.get('clientId') || '').trim();
  const documentId = (url.searchParams.get('documentId') || '').trim();
  const binds: unknown[] = [env.USER_ID];
  // Never surface drafts a pipeline wrote keyed by the full Dropbox path
  // instead of a DOC-NNN id (same defense as /api/load for documents).
  let sql =
    'SELECT source_id, case_source_id, client_source_id, document_source_id, ' +
    'file_name, title, title_ar, draft_he, draft_ar, language, doc_type, ' +
    "status, date, updated_at FROM drafts WHERE user_id = ?1 " +
    "AND source_id NOT LIKE '%/%'";
  if (caseId) {
    binds.push(caseId);
    sql += ` AND upper(case_source_id) = upper(?${binds.length})`;
  }
  if (clientId) {
    binds.push(clientId);
    sql += ` AND lower(client_source_id) = lower(?${binds.length})`;
  }
  if (documentId) {
    binds.push(documentId);
    sql += ` AND upper(document_source_id) = upper(?${binds.length})`;
  }
  sql += ' ORDER BY date DESC, updated_at DESC';
  const rs = await env.DB.prepare(sql)
    .bind(...binds)
    .all();
  return json({ drafts: rs.results ?? [] }, request, env);
}

// ---------------------------------------------------------------------------
// GET /api/skills?key=&all=1 — pull the global drafting "skill" document(s)
// Claude reads before writing a draft. Default: only status='active' rows.
// `key` filters to one skill_key; `all=1` includes inactive ones too.
// ---------------------------------------------------------------------------
async function handleSkills(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const key = (url.searchParams.get('key') || '').trim();
  const all = (url.searchParams.get('all') || '').trim() === '1';
  const binds: unknown[] = [env.USER_ID];
  let sql =
    'SELECT source_id, skill_key, title, title_ar, content, language, ' +
    'status, date, updated_at FROM skills WHERE user_id = ?1';
  if (!all) sql += " AND lower(coalesce(status, 'active')) = 'active'";
  if (key) {
    binds.push(key);
    sql += ` AND skill_key = ?${binds.length}`;
  }
  sql += ' ORDER BY updated_at DESC';
  const rs = await env.DB.prepare(sql)
    .bind(...binds)
    .all();
  return json({ skills: rs.results ?? [] }, request, env);
}

// ---------------------------------------------------------------------------
// POST /api/upload-photo — multipart (file, clientId). Stores under the same
// key layout the old Supabase Storage path used, returns a URL back at /api/photo.
// ---------------------------------------------------------------------------
async function handleUploadPhoto(request: Request, env: Env): Promise<Response> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ error: 'expected multipart/form-data' }, request, env, 400);
  }
  const entry = form.get('file');
  const clientId = String(form.get('clientId') || 'misc');
  // form.get() returns the uploaded file (a Blob/File) or a string; a real
  // upload is the object branch. Cast to the Blob shape we use.
  if (!entry || typeof entry === 'string') {
    return json({ error: 'no file' }, request, env, 400);
  }
  const file = entry as unknown as {
    name?: string;
    type?: string;
    arrayBuffer(): Promise<ArrayBuffer>;
  };

  const fileName = typeof file.name === 'string' ? file.name : 'file';
  const key = `${env.USER_ID}/client-photos/${clientId}/${Date.now()}-${safeName(fileName)}`;
  await env.PHOTOS.put(key, await file.arrayBuffer(), {
    httpMetadata: { contentType: file.type || 'image/jpeg' },
  });

  const origin = new URL(request.url).origin;
  const url = `${origin}/api/photo/${key}`;
  return json({ url }, request, env);
}

// ---------------------------------------------------------------------------
// GET /api/photo/<key> — stream an R2 object back. Public so <img src> works.
// ---------------------------------------------------------------------------
async function servePhoto(env: Env, rawKey: string): Promise<Response> {
  const key = decodeURIComponent(rawKey);
  if (!key) return new Response('not found', { status: 404 });

  const obj = await env.PHOTOS.get(key);
  if (!obj) return new Response('not found', { status: 404 });

  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set('etag', obj.httpEtag);
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  return new Response(obj.body, { headers });
}

// Mirror lib/supabase.ts safeStorageName: strip anything non-url-safe, keep dots.
function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 180) || 'file';
}
