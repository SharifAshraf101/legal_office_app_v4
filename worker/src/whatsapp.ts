// Per-office WhatsApp (Cloud API). Each office connects its OWN number: its
// Meta credentials live in the control DB (access token + app secret
// encrypted), its messages in its OWN data DB. One public webhook serves every
// office — Meta's payload names the receiving phone_number_id, which is how a
// message is routed to its office, and the X-Hub-Signature-256 header is
// checked against THAT office's app secret before anything is stored.
//
// The operator office keeps its original setup (credentials in Vercel, webhook
// on the Next app) until it connects here too; nothing below changes that path.

import { D1HttpDatabase } from './d1http';
import type { Env } from './db';
import { normalizePhone, portalLink } from './portal';

/** A client writing after this much silence starts a new conversation and gets
 *  the bot link again (same window as the operator's webhook). */
const SESSION_GAP_MS = 30 * 60 * 1000;

const GRAPH = 'https://graph.facebook.com/v19.0';

export interface WhatsAppConfig {
  tenant_id: string;
  phone_number_id: string;
  display_phone: string | null;
  verified_name: string | null;
  access_token: string; // decrypted
  app_secret: string; // decrypted
  verify_token: string;
}

// ---- Encryption --------------------------------------------------------------
// AES-GCM with a key derived (HKDF) from BETTER_AUTH_SECRET, so no new secret
// has to be provisioned. Rotating BETTER_AUTH_SECRET means every office
// re-enters its WhatsApp token.

async function aesKey(env: Env): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(env.BETTER_AUTH_SECRET),
    'HKDF',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new TextEncoder().encode('legal-office-whatsapp'),
      info: new TextEncoder().encode('wa-credentials-v1'),
    },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

// Chunked: spreading a whole voice clip into one fromCharCode call overflows
// the argument limit.
function b64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function encrypt(env: Env, plain: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    await aesKey(env),
    new TextEncoder().encode(plain),
  );
  return b64(iv) + '.' + b64(new Uint8Array(ct));
}

async function decrypt(env: Env, packed: string): Promise<string> {
  const [iv, ct] = packed.split('.');
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: unb64(iv) },
    await aesKey(env),
    unb64(ct),
  );
  return new TextDecoder().decode(pt);
}

async function hmacHex(secret: string, data: string | ArrayBuffer): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign(
    'HMAC',
    key,
    typeof data === 'string' ? new TextEncoder().encode(data) : data,
  );
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function safeEqual(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

// ---- Storage -------------------------------------------------------------------

/** Created on first use, so no manual migration is needed. */
export async function ensureWhatsAppTable(env: Env): Promise<void> {
  await env.CONTROL_DB.prepare(
    `CREATE TABLE IF NOT EXISTS whatsapp_config (
       tenant_id        TEXT PRIMARY KEY,
       phone_number_id  TEXT NOT NULL UNIQUE,
       display_phone    TEXT,
       verified_name    TEXT,
       access_token_enc TEXT NOT NULL,
       app_secret_enc   TEXT NOT NULL,
       verify_token     TEXT NOT NULL,
       created_at       TEXT NOT NULL,
       updated_at       TEXT NOT NULL
     )`,
  ).run();
}

type ConfigRow = {
  tenant_id: string;
  phone_number_id: string;
  display_phone: string | null;
  verified_name: string | null;
  access_token_enc: string;
  app_secret_enc: string;
  verify_token: string;
};

async function rowToConfig(env: Env, row: ConfigRow | null): Promise<WhatsAppConfig | null> {
  if (!row) return null;
  return {
    tenant_id: row.tenant_id,
    phone_number_id: row.phone_number_id,
    display_phone: row.display_phone,
    verified_name: row.verified_name,
    access_token: await decrypt(env, row.access_token_enc),
    app_secret: await decrypt(env, row.app_secret_enc),
    verify_token: row.verify_token,
  };
}

export async function configForTenant(env: Env, tenantId: string): Promise<WhatsAppConfig | null> {
  try {
    const row = await env.CONTROL_DB.prepare('SELECT * FROM whatsapp_config WHERE tenant_id = ?1')
      .bind(tenantId)
      .first<ConfigRow>();
    return rowToConfig(env, row);
  } catch {
    return null; // table not created yet
  }
}

async function configForPhoneNumberId(env: Env, id: string): Promise<WhatsAppConfig | null> {
  try {
    const row = await env.CONTROL_DB.prepare(
      'SELECT * FROM whatsapp_config WHERE phone_number_id = ?1',
    )
      .bind(id)
      .first<ConfigRow>();
    return rowToConfig(env, row);
  } catch {
    return null;
  }
}

/** The data DB of an ACTIVE office — the same rule resolveTenant applies. */
export async function tenantDb(env: Env, tenantId: string): Promise<D1Database | null> {
  if (tenantId === env.USER_ID) return env.DB;
  const row = await env.CONTROL_DB.prepare('SELECT status, data_db_name FROM tenant WHERE id = ?1')
    .bind(tenantId)
    .first<{ status: string; data_db_name: string | null }>();
  if (row?.status !== 'active' || !row.data_db_name) return null;
  if (row.data_db_name === env.NATIVE_DB_ID) return env.DB;
  if (!env.CF_ACCOUNT_ID || !env.CF_D1_TOKEN) return null;
  return new D1HttpDatabase({
    accountId: env.CF_ACCOUNT_ID,
    apiToken: env.CF_D1_TOKEN,
    databaseId: row.data_db_name,
  }) as unknown as D1Database;
}

/** Save (or replace) an office's connection after checking it against Meta. */
export async function saveConfig(
  env: Env,
  tenantId: string,
  input: { phone_number_id: string; access_token: string; app_secret: string },
): Promise<{ ok: true; display_phone: string | null; verified_name: string | null } | { ok: false; error: string }> {
  const id = input.phone_number_id.trim();
  const token = input.access_token.trim();
  const appSecret = input.app_secret.trim();
  if (!/^\d{6,}$/.test(id)) return { ok: false, error: 'מזהה המספר (Phone Number ID) צריך להכיל ספרות בלבד.' };
  if (token.length < 20) return { ok: false, error: 'מפתח הגישה (Access Token) קצר מדי.' };
  if (appSecret.length < 16) return { ok: false, error: 'סוד האפליקציה (App Secret) קצר מדי.' };

  // The token must actually open this number — the check the office relies on.
  const probe = await fetch(`${GRAPH}/${id}?fields=display_phone_number,verified_name`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const info = (await probe.json().catch(() => ({}))) as {
    display_phone_number?: string;
    verified_name?: string;
    error?: { message?: string };
  };
  if (!probe.ok) {
    return { ok: false, error: 'Meta דחתה את הפרטים: ' + (info.error?.message || probe.status) };
  }

  await ensureWhatsAppTable(env);
  const taken = await env.CONTROL_DB.prepare(
    'SELECT tenant_id FROM whatsapp_config WHERE phone_number_id = ?1 AND tenant_id <> ?2',
  )
    .bind(id, tenantId)
    .first();
  if (taken) return { ok: false, error: 'המספר הזה כבר מחובר למשרד אחר.' };

  const existing = await env.CONTROL_DB.prepare(
    'SELECT verify_token FROM whatsapp_config WHERE tenant_id = ?1',
  )
    .bind(tenantId)
    .first<{ verify_token: string }>();
  const verifyToken =
    existing?.verify_token ||
    [...crypto.getRandomValues(new Uint8Array(18))].map((b) => b.toString(16).padStart(2, '0')).join('');
  const now = new Date().toISOString();
  await env.CONTROL_DB.prepare(
    `INSERT INTO whatsapp_config (tenant_id, phone_number_id, display_phone, verified_name,
                                  access_token_enc, app_secret_enc, verify_token, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)
     ON CONFLICT(tenant_id) DO UPDATE SET
       phone_number_id = excluded.phone_number_id, display_phone = excluded.display_phone,
       verified_name = excluded.verified_name, access_token_enc = excluded.access_token_enc,
       app_secret_enc = excluded.app_secret_enc, updated_at = excluded.updated_at`,
  )
    .bind(
      tenantId,
      id,
      info.display_phone_number || null,
      info.verified_name || null,
      await encrypt(env, token),
      await encrypt(env, appSecret),
      verifyToken,
      now,
    )
    .run();
  return { ok: true, display_phone: info.display_phone_number || null, verified_name: info.verified_name || null };
}

export async function deleteConfig(env: Env, tenantId: string): Promise<void> {
  try {
    await env.CONTROL_DB.prepare('DELETE FROM whatsapp_config WHERE tenant_id = ?1').bind(tenantId).run();
  } catch {
    /* nothing stored */
  }
}

/** The office's connection as the settings screen sees it — never the secrets. */
export async function publicConfig(env: Env, tenantId: string, webhookUrl: string) {
  try {
    const row = await env.CONTROL_DB.prepare(
      'SELECT phone_number_id, display_phone, verified_name, verify_token, updated_at FROM whatsapp_config WHERE tenant_id = ?1',
    )
      .bind(tenantId)
      .first<{ phone_number_id: string; display_phone: string | null; verified_name: string | null; verify_token: string; updated_at: string }>();
    if (row) return { connected: true, ...row, webhook_url: webhookUrl };
  } catch {
    /* table not created yet */
  }
  // Not connected yet. The verify token is issued on the first save, and the
  // office then pastes it (with the webhook URL) into Meta.
  return { connected: false, webhook_url: webhookUrl };
}

// ---- Signed media links --------------------------------------------------------
// <img>/<audio> can't send an Authorization header, so media of a connected
// office is served from a short-lived signed URL instead.

const MEDIA_TTL_S = 60 * 60;

export async function signedMediaUrl(env: Env, origin: string, tenantId: string, mediaId: string): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + MEDIA_TTL_S;
  const sig = await hmacHex(env.BETTER_AUTH_SECRET, `media|${tenantId}|${mediaId}|${exp}`);
  return `${origin}/api/whatsapp-media/${encodeURIComponent(tenantId)}/${mediaId}?exp=${exp}&sig=${sig}`;
}

export async function serveMedia(env: Env, url: URL): Promise<Response> {
  const parts = url.pathname.split('/');
  const tenantId = decodeURIComponent(parts[3] || '');
  const mediaId = parts[4] || '';
  const exp = Number(url.searchParams.get('exp') || 0);
  const sig = url.searchParams.get('sig') || '';
  if (!tenantId || !/^\d+$/.test(mediaId) || !exp || exp < Date.now() / 1000) {
    return new Response('Not found', { status: 404 });
  }
  const want = await hmacHex(env.BETTER_AUTH_SECRET, `media|${tenantId}|${mediaId}|${exp}`);
  if (!safeEqual(sig, want)) return new Response('Forbidden', { status: 403 });
  const cfg = await configForTenant(env, tenantId);
  if (!cfg) return new Response('Not found', { status: 404 });
  const file = await downloadMedia(cfg.access_token, mediaId);
  if (!file) return new Response('Media unavailable', { status: 404 });
  return new Response(file.bytes, {
    headers: {
      'Content-Type': file.mime || 'application/octet-stream',
      'Cache-Control': 'private, max-age=3600',
    },
  });
}

async function downloadMedia(token: string, mediaId: string): Promise<{ bytes: ArrayBuffer; mime: string } | null> {
  const metaRes = await fetch(`${GRAPH}/${mediaId}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!metaRes.ok) return null;
  const meta = (await metaRes.json()) as { url?: string; mime_type?: string };
  if (!meta.url) return null;
  const fileRes = await fetch(meta.url, { headers: { Authorization: `Bearer ${token}` } });
  if (!fileRes.ok) return null;
  return { bytes: await fileRes.arrayBuffer(), mime: meta.mime_type || fileRes.headers.get('content-type') || '' };
}

// ---- Webhook -------------------------------------------------------------------

/** GET — Meta's subscription handshake, against any office's verify token. */
export async function webhookVerify(env: Env, url: URL): Promise<Response> {
  const mode = url.searchParams.get('hub.mode');
  const token = url.searchParams.get('hub.verify_token') || '';
  const challenge = url.searchParams.get('hub.challenge') || '';
  if (mode !== 'subscribe' || !token) return new Response('Forbidden', { status: 403 });
  try {
    const row = await env.CONTROL_DB.prepare('SELECT 1 AS ok FROM whatsapp_config WHERE verify_token = ?1')
      .bind(token)
      .first();
    if (row) return new Response(challenge, { status: 200 });
  } catch {
    /* no table yet */
  }
  return new Response('Forbidden', { status: 403 });
}

type IncomingMessage = Record<string, any>;

function parseIncoming(message: IncomingMessage) {
  let type = 'text';
  let text = '';
  let mediaId: string | null = null;
  let mime: string | null = null;
  let fileName: string | null = null;
  if (message.text) {
    text = message.text.body || '';
  } else if (message.audio) {
    type = 'audio';
    mediaId = message.audio.id;
    mime = message.audio.mime_type || 'audio/ogg';
    text = '[הודעה קולית]';
  } else if (message.image) {
    type = 'image';
    mediaId = message.image.id;
    mime = message.image.mime_type || 'image/jpeg';
    text = message.image.caption || '[תמונה]';
  } else if (message.document) {
    type = 'document';
    mediaId = message.document.id;
    mime = message.document.mime_type || 'application/pdf';
    fileName = message.document.filename || 'document';
    text = `[מסמך: ${fileName}]`;
  } else if (message.video) {
    type = 'video';
    mediaId = message.video.id;
    mime = message.video.mime_type || 'video/mp4';
    text = message.video.caption || '[סרטון]';
  } else {
    text = `[${message.type || 'הודעה'}]`;
  }
  return { type, text, mediaId, mime, fileName };
}

/** POST — store each incoming message in its office's DB. */
export async function webhookReceive(
  env: Env,
  request: Request,
  waitUntil: (p: Promise<unknown>) => void,
): Promise<Response> {
  const raw = await request.arrayBuffer();
  let body: any;
  try {
    body = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    return new Response('Bad request', { status: 400 });
  }
  const signature = (request.headers.get('x-hub-signature-256') || '').replace(/^sha256=/, '');

  for (const entry of body?.entry || []) {
    for (const change of entry?.changes || []) {
      const value = change?.value || {};
      const phoneNumberId = String(value?.metadata?.phone_number_id || '');
      const messages: IncomingMessage[] = value?.messages || [];
      if (!phoneNumberId || !messages.length) continue; // status callbacks
      const cfg = await configForPhoneNumberId(env, phoneNumberId);
      if (!cfg) continue; // not an office connected here
      // Only Meta, signing with THIS office's app secret, can write here.
      if (!safeEqual(signature, await hmacHex(cfg.app_secret, raw))) {
        return new Response('Bad signature', { status: 401 });
      }
      const db = await tenantDb(env, cfg.tenant_id);
      if (!db) continue; // office suspended / not provisioned
      for (const m of messages) {
        const p = parseIncoming(m);
        const ts = (parseInt(m.timestamp, 10) || Math.floor(Date.now() / 1000)) * 1000;
        const from = String(m.from || '');
        const prev = await db
          .prepare('SELECT MAX(timestamp) AS ts FROM whatsapp_messages WHERE client_phone = ?1')
          .bind(from)
          .first<{ ts: number | null }>();
        const newConversation = !prev?.ts || ts - Number(prev.ts) >= SESSION_GAP_MS;
        await db
          .prepare(
            'INSERT INTO whatsapp_messages (client_phone, direction, message_text, timestamp, message_type, media_url, media_mime_type, media_id, file_name) VALUES (?1, ?2, ?3, ?4, ?5, NULL, ?6, ?7, ?8)',
          )
          .bind(
            from,
            'incoming',
            p.text,
            ts,
            p.type,
            p.mime,
            p.mediaId,
            p.fileName,
          )
          .run();
        if (p.type === 'audio' && p.mediaId) {
          waitUntil(transcribeForOffice(env, db, cfg, p.mediaId));
        }
        if (newConversation) waitUntil(inviteToBot(env, db, cfg, from));
      }
    }
  }
  // Meta only needs a fast 200; everything above is a few quick writes.
  return new Response('ok', { status: 200 });
}

/** Voice -> text for a connected office (same Whisper model as the operator). */
async function transcribeForOffice(env: Env, db: D1Database, cfg: WhatsAppConfig, mediaId: string): Promise<void> {
  if (!env.AI) return;
  try {
    const file = await downloadMedia(cfg.access_token, mediaId);
    if (!file) return;
    const audio = b64(new Uint8Array(file.bytes));
    const out = (await env.AI.run('@cf/openai/whisper-large-v3-turbo', {
      audio,
      task: 'transcribe',
      vad_filter: true,
    })) as { text?: string };
    const text = String(out?.text || '').trim();
    await db
      .prepare("UPDATE whatsapp_messages SET message_text = ?1 WHERE media_id = ?2 AND message_type = 'audio'")
      .bind(text ? '🎤 ' + text : '🎤 [הודעה קולית — לא זוהה דיבור]', mediaId)
      .run();
  } catch (e) {
    console.warn('[whatsapp] transcription failed', e);
  }
}

/** First message of a conversation: a known client gets their signed bot
 *  link, an unknown number the office's "not recognised" reply. */
async function inviteToBot(env: Env, db: D1Database, cfg: WhatsAppConfig, from: string): Promise<void> {
  try {
    const rs = await db
      .prepare('SELECT full_name, full_name_ar, phone FROM clients WHERE user_id = ?1')
      .bind(cfg.tenant_id)
      .all<{ full_name: string | null; full_name_ar: string | null; phone: string | null }>();
    const me = normalizePhone(from);
    const client = (rs.results ?? []).find((c) => c.phone && normalizePhone(c.phone) === me);
    let message: string;
    if (client) {
      const name = String(client.full_name || client.full_name_ar || '').trim();
      const link = await portalLink(env, cfg.tenant_id, from);
      message =
        `שלום${name ? ' ' + name : ''}, כדי לקבל מידע על התיק שלך — סטטוס, דיונים, תשלומים ומסמכים — ` +
        `היכנס/י לבוט הלקוחות:\n${link}\n\n` +
        `مرحباً، للاطلاع على معلومات ملفك (الحالة، الجلسات، المدفوعات والمستندات) ادخل إلى بوت الموكلين عبر الرابط أعلاه.`;
    } else {
      const phone = cfg.display_phone || '';
      message =
        `שלום, מספר הטלפון אינו מזוהה כלקוח במערכת.${phone ? ` לפניות נא ליצור קשר עם המשרד: ${phone}.` : ''}\n\n` +
        `مرحباً، رقم هاتفك غير مسجّل كموكل لدينا.${phone ? ` للتواصل مع المكتب: ${phone}.` : ''}`;
    }
    await sendFromOffice(env, db, cfg, { to: from, message });
  } catch (e) {
    console.warn('[whatsapp] bot invite failed', e);
  }
}

// ---- Sending -------------------------------------------------------------------

/** Send from the office's own number and log it in the office's DB. */
export async function sendFromOffice(
  env: Env,
  db: D1Database,
  cfg: WhatsAppConfig,
  input: { to: string; message?: string; document?: { url?: string; name?: string } },
): Promise<{ status: number; body: unknown }> {
  const to = String(input.to || '').replace(/\D/g, '');
  if (!to) return { status: 400, body: { error: 'Missing recipient phone number' } };
  const docUrl = input.document?.url && /^https:\/\//.test(input.document.url) ? input.document.url : '';
  const payload = docUrl
    ? {
        messaging_product: 'whatsapp',
        to,
        type: 'document',
        document: { link: docUrl, filename: input.document?.name || 'document', caption: input.message || undefined },
      }
    : { messaging_product: 'whatsapp', to, type: 'text', text: { body: input.message || '' } };
  const res = await fetch(`${GRAPH}/${cfg.phone_number_id}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { status: res.status, body: { error: 'WhatsApp send failed', details: data } };
  try {
    await db
      .prepare(
        'INSERT INTO whatsapp_messages (client_phone, direction, message_text, timestamp, message_type, media_url, media_mime_type, media_id, file_name) VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL, NULL, ?7)',
      )
      .bind(
        to,
        'outgoing',
        input.message || (docUrl ? `📎 ${input.document?.name || 'document'}` : ''),
        Date.now(),
        docUrl ? 'document' : 'text',
        docUrl || null,
        input.document?.name || null,
      )
      .run();
  } catch (e) {
    // Already delivered — a logging failure must not make the UI re-send it.
    console.warn('[whatsapp] failed to log outgoing message', e);
  }
  return { status: 200, body: data };
}
