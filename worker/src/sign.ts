// Client signature on a document.
//
// The lawyer picks a PDF of a case, marks where the client signs and gets a
// link. The client opens the link on a phone (no login — the link's random
// token is the authorization), reads the document and draws a signature. The
// office's app then stamps that signature onto the PDF and files the signed
// copy in the case.
//
// A request lives in the CONTROL database, because the client's browser knows
// only the token — not which office it belongs to. The document itself is never
// copied: the public file route reads the original through the same storage
// path the app uses (see GET /api/sign/file in index.ts).
//
// The Worker never touches the PDF's bytes beyond streaming them (its CPU
// allowance is a few milliseconds); the stamping happens in the office's
// browser.

import type { Env } from './db';

type Row = Record<string, unknown>;
export type SignResult = { status: number; body: unknown };

const str = (v: unknown) => String(v ?? '').trim();
const now = () => new Date().toISOString();

let tableReady = false;
async function ensureTable(env: Env): Promise<void> {
  if (tableReady) return;
  await env.CONTROL_DB.prepare(
    `CREATE TABLE IF NOT EXISTS sign_request (
       token TEXT PRIMARY KEY,
       tenant_id TEXT NOT NULL,
       doc_id TEXT, case_id TEXT, client_id TEXT,
       relative_path TEXT NOT NULL, file_name TEXT, title TEXT,
       signer_name TEXT, phone TEXT, office_name TEXT, lang TEXT,
       page INTEGER NOT NULL, x REAL NOT NULL, y REAL NOT NULL, w REAL NOT NULL, h REAL NOT NULL,
       status TEXT NOT NULL,
       created_at TEXT NOT NULL, expires_at TEXT NOT NULL,
       opened_at TEXT, signed_at TEXT, signature TEXT,
       signer_ip TEXT, signer_ua TEXT,
       claimed_at TEXT, filed_at TEXT, signed_doc_id TEXT
     )`,
  ).run();
  await env.CONTROL_DB.prepare(
    'CREATE INDEX IF NOT EXISTS sign_request_tenant ON sign_request (tenant_id, status)',
  ).run();
  tableReady = true;
}

/** What the office sees of a request (never the signature image — that is
 *  returned only by the "signed, not yet filed" listing). */
function officeView(r: Row, withSignature = false): Row {
  return {
    token: r.token,
    doc_id: r.doc_id,
    case_id: r.case_id,
    client_id: r.client_id,
    relative_path: r.relative_path,
    file_name: r.file_name,
    title: r.title,
    signer_name: r.signer_name,
    phone: r.phone,
    lang: r.lang,
    page: r.page,
    x: r.x,
    y: r.y,
    w: r.w,
    h: r.h,
    status: r.status,
    created_at: r.created_at,
    expires_at: r.expires_at,
    opened_at: r.opened_at,
    signed_at: r.signed_at,
    filed_at: r.filed_at,
    signed_doc_id: r.signed_doc_id,
    ...(withSignature ? { signature: r.signature } : {}),
  };
}

// ---------------------------------------------------------------------------
// The office (authenticated; `tenantId` comes from the resolved session)
// ---------------------------------------------------------------------------

export async function createSignRequest(env: Env, tenantId: string, body: Row): Promise<SignResult> {
  await ensureTable(env);
  const relativePath = str(body.relative_path);
  if (!relativePath || !/\.pdf$/i.test(relativePath)) {
    return { status: 400, body: { error: 'pdf_required' } };
  }
  const num = (v: unknown) => Number(v);
  const page = Math.floor(num(body.page));
  const [x, y, w, h] = [num(body.x), num(body.y), num(body.w), num(body.h)];
  const frac = (n: number) => Number.isFinite(n) && n >= 0 && n <= 1;
  if (!(page >= 1) || ![x, y, w, h].every(frac) || w < 0.03 || h < 0.02 || x + w > 1.001 || y + h > 1.001) {
    return { status: 400, body: { error: 'bad_position' } };
  }
  const days = Math.min(30, Math.max(1, Math.floor(num(body.days)) || 7));
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const token = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  const created = now();
  const expires = new Date(Date.now() + days * 86_400_000).toISOString();
  await env.CONTROL_DB.prepare(
    `INSERT INTO sign_request
       (token, tenant_id, doc_id, case_id, client_id, relative_path, file_name, title,
        signer_name, phone, office_name, lang, page, x, y, w, h, status, created_at, expires_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, 'pending', ?18, ?19)`,
  )
    .bind(
      token,
      tenantId,
      str(body.doc_id) || null,
      str(body.case_id) || null,
      str(body.client_id) || null,
      relativePath,
      str(body.file_name).slice(0, 300) || null,
      str(body.title).slice(0, 300) || null,
      str(body.signer_name).slice(0, 200) || null,
      str(body.phone).replace(/[^\d+]/g, '').slice(0, 20) || null,
      str(body.office_name).slice(0, 200) || null,
      str(body.lang) === 'ar' ? 'ar' : 'he',
      page,
      x,
      y,
      w,
      h,
      created,
      expires,
    )
    .run();
  return { status: 200, body: { ok: true, token, expires_at: expires } };
}

export async function listSignRequests(env: Env, tenantId: string, url: URL): Promise<SignResult> {
  await ensureTable(env);
  // ?signed=1 — signed by the client and not yet filed in the case, WITH the
  // signature image: what the app needs to produce the signed copy.
  if (url.searchParams.get('signed') === '1') {
    const rs = await env.CONTROL_DB.prepare(
      "SELECT * FROM sign_request WHERE tenant_id = ?1 AND status = 'signed' AND filed_at IS NULL ORDER BY signed_at ASC LIMIT 10",
    )
      .bind(tenantId)
      .all();
    return { status: 200, body: { ok: true, requests: ((rs.results ?? []) as Row[]).map((r) => officeView(r, true)) } };
  }
  const caseId = str(url.searchParams.get('case'));
  const rs = caseId
    ? await env.CONTROL_DB.prepare(
        'SELECT * FROM sign_request WHERE tenant_id = ?1 AND upper(case_id) = upper(?2) ORDER BY created_at DESC LIMIT 100',
      )
        .bind(tenantId, caseId)
        .all()
    : await env.CONTROL_DB.prepare(
        'SELECT * FROM sign_request WHERE tenant_id = ?1 ORDER BY created_at DESC LIMIT 100',
      )
        .bind(tenantId)
        .all();
  return { status: 200, body: { ok: true, requests: ((rs.results ?? []) as Row[]).map((r) => officeView(r)) } };
}

/** One device takes the job of filing a signed document, so two open browsers
 *  of the same office don't both file a copy. A claim not completed within five
 *  minutes (the tab was closed) can be taken again. */
export async function claimSignRequest(env: Env, tenantId: string, body: Row): Promise<SignResult> {
  await ensureTable(env);
  const stale = new Date(Date.now() - 5 * 60_000).toISOString();
  const r = await env.CONTROL_DB.prepare(
    `UPDATE sign_request SET claimed_at = ?1
      WHERE token = ?2 AND tenant_id = ?3 AND status = 'signed' AND filed_at IS NULL
        AND (claimed_at IS NULL OR claimed_at < ?4)`,
  )
    .bind(now(), str(body.token), tenantId, stale)
    .run();
  return { status: 200, body: { ok: true, claimed: (r.meta?.changes ?? 0) === 1 } };
}

export async function markSignRequestFiled(env: Env, tenantId: string, body: Row): Promise<SignResult> {
  await ensureTable(env);
  await env.CONTROL_DB.prepare(
    "UPDATE sign_request SET status = 'filed', filed_at = ?1, signed_doc_id = ?2 WHERE token = ?3 AND tenant_id = ?4 AND status = 'signed'",
  )
    .bind(now(), str(body.signed_doc_id) || null, str(body.token), tenantId)
    .run();
  return { status: 200, body: { ok: true } };
}

export async function cancelSignRequest(env: Env, tenantId: string, body: Row): Promise<SignResult> {
  await ensureTable(env);
  await env.CONTROL_DB.prepare(
    "UPDATE sign_request SET status = 'cancelled' WHERE token = ?1 AND tenant_id = ?2 AND status = 'pending'",
  )
    .bind(str(body.token), tenantId)
    .run();
  return { status: 200, body: { ok: true } };
}

// ---------------------------------------------------------------------------
// The client (public — the token in the link is the only authorization)
// ---------------------------------------------------------------------------

async function rowByToken(env: Env, token: string): Promise<Row | null> {
  if (!/^[0-9a-f]{48}$/.test(token)) return null;
  await ensureTable(env);
  return (await env.CONTROL_DB.prepare('SELECT * FROM sign_request WHERE token = ?1').bind(token).first()) as Row | null;
}

const expired = (r: Row) => str(r.expires_at) < now();

export async function signMeta(env: Env, token: string): Promise<SignResult> {
  const r = await rowByToken(env, token);
  if (!r) return { status: 404, body: { error: 'not_found' } };
  const status = str(r.status);
  const state =
    status === 'cancelled' ? 'cancelled' : status === 'signed' || status === 'filed' ? 'signed' : expired(r) ? 'expired' : 'pending';
  if (state === 'pending' && !r.opened_at) {
    await env.CONTROL_DB.prepare('UPDATE sign_request SET opened_at = ?1 WHERE token = ?2 AND opened_at IS NULL')
      .bind(now(), token)
      .run();
  }
  return {
    status: 200,
    body: {
      ok: true,
      state,
      title: r.title || r.file_name || '',
      signer_name: r.signer_name || '',
      office_name: r.office_name || '',
      lang: r.lang || 'he',
      page: r.page,
      x: r.x,
      y: r.y,
      w: r.w,
      h: r.h,
    },
  };
}

/** Which stored file a link may read — only while the request awaits a signature. */
export async function signFileTarget(env: Env, token: string): Promise<{ tenantId: string; relativePath: string } | null> {
  const r = await rowByToken(env, token);
  if (!r || str(r.status) !== 'pending' || expired(r)) return null;
  return { tenantId: str(r.tenant_id), relativePath: str(r.relative_path) };
}

export async function submitSignature(env: Env, request: Request, body: Row): Promise<SignResult> {
  const token = str(body.t);
  const r = await rowByToken(env, token);
  if (!r) return { status: 404, body: { error: 'not_found' } };
  if (str(r.status) !== 'pending') return { status: 409, body: { error: 'already_' + str(r.status) } };
  if (expired(r)) return { status: 410, body: { error: 'expired' } };
  const signature = str(body.signature);
  if (body.consent !== true) return { status: 400, body: { error: 'consent_required' } };
  if (!signature.startsWith('data:image/png;base64,') || signature.length < 600 || signature.length > 600_000) {
    return { status: 400, body: { error: 'bad_signature' } };
  }
  const res = await env.CONTROL_DB.prepare(
    `UPDATE sign_request
        SET status = 'signed', signed_at = ?1, signature = ?2, signer_ip = ?3, signer_ua = ?4
      WHERE token = ?5 AND status = 'pending'`,
  )
    .bind(
      now(),
      signature,
      (request.headers.get('CF-Connecting-IP') || '').slice(0, 64) || null,
      (request.headers.get('User-Agent') || '').slice(0, 300) || null,
      token,
    )
    .run();
  if ((res.meta?.changes ?? 0) !== 1) return { status: 409, body: { error: 'already_signed' } };
  return { status: 200, body: { ok: true } };
}
