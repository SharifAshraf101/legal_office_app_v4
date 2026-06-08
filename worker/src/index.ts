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
    const rs = await env.DB.prepare(`SELECT * FROM ${table} WHERE user_id = ?`)
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
  const row = await env.DB.prepare(
    'SELECT summary_he, summary_ar, language FROM file_summary ' +
      "WHERE file_name = ?1 OR file_name = ?2 OR (?3 <> '' AND lower(case_id) LIKE lower(?3) || '%') " +
      'ORDER BY (file_name = ?1) DESC, (file_name = ?2) DESC, id DESC LIMIT 1',
  )
    .bind(file, orig, caseId)
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
  await env.DB.prepare('DELETE FROM file_summary WHERE file_name = ?')
    .bind(fileName)
    .run();
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
  return json({ ok: true, count: statements.length }, request, env);
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
