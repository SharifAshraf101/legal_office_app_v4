// Client bot portal — works for EVERY office.
//
// A client opens the bot from a WhatsApp link carrying a SIGNED token that
// names one office and the client's phone (and an expiry). The Worker checks
// the signature and serves ONLY that client's records from that office's own
// database. The link used to be `/portal?phone=…`, which trusted the phone in
// the URL — changing the number would have opened another client's file.

import type { Env } from './db';
import { configForTenant, tenantDb } from './whatsapp';

const PORTAL_TTL_DAYS = 7;
const DEFAULT_PORTAL_BASE = 'https://legal-office-app-v4.vercel.app';

const b64url = (s: string) =>
  btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = (s: string) =>
  decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))));

async function sign(env: Env, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(env.BETTER_AUTH_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode('portal|' + data));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Digits in the international form the WhatsApp payload uses (972…). */
export function normalizePhone(phone: unknown): string {
  const d = String(phone || '').replace(/\D/g, '');
  if (d.startsWith('972')) return d;
  if (d.startsWith('0')) return '972' + d.slice(1);
  if (d.length >= 9 && d.length <= 10) return '972' + d;
  return d;
}

export async function signPortalToken(env: Env, tenantId: string, phone: string): Promise<string> {
  const payload = b64url(
    JSON.stringify({ t: tenantId, p: normalizePhone(phone), e: Math.floor(Date.now() / 1000) + PORTAL_TTL_DAYS * 86400 }),
  );
  return payload + '.' + (await sign(env, payload));
}

export async function verifyPortalToken(
  env: Env,
  token: string,
): Promise<{ tenantId: string; phone: string } | null> {
  const [payload, sig] = String(token || '').split('.');
  if (!payload || !sig) return null;
  const want = await sign(env, payload);
  if (want.length !== sig.length) return null;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ sig.charCodeAt(i);
  if (diff !== 0) return null;
  try {
    const data = JSON.parse(unb64url(payload)) as { t?: string; p?: string; e?: number };
    if (!data.t || !data.p || !data.e || data.e < Date.now() / 1000) return null;
    return { tenantId: data.t, phone: data.p };
  } catch {
    return null;
  }
}

export function portalBase(env: Env): string {
  return String(env.PORTAL_BASE_URL || DEFAULT_PORTAL_BASE).replace(/\/$/, '');
}

export async function portalLink(env: Env, tenantId: string, phone: string): Promise<string> {
  const t = await signPortalToken(env, tenantId, phone);
  return `${portalBase(env)}/portal?t=${encodeURIComponent(t)}`;
}

/** The office details the bot gives a client ("how do I contact the office"). */
async function officeContact(env: Env, db: D1Database, tenantId: string) {
  const out: { name: string; phone: string; email: string; address: string } = {
    name: '',
    phone: '',
    email: '',
    address: '',
  };
  try {
    const t = await env.CONTROL_DB.prepare(
      `SELECT t.name AS name,
              (SELECT u.email FROM membership m JOIN user u ON u.id = m.user_id
                WHERE m.tenant_id = t.id ORDER BY m.created_at ASC LIMIT 1) AS email
         FROM tenant t WHERE t.id = ?1`,
    )
      .bind(tenantId)
      .first<{ name?: string; email?: string }>();
    out.name = String(t?.name || '');
    out.email = String(t?.email || '');
  } catch {
    /* control lookup is best-effort */
  }
  const wa = await configForTenant(env, tenantId);
  if (wa?.display_phone) out.phone = wa.display_phone;
  try {
    const as = await db
      .prepare('SELECT state, payload, data FROM app_state WHERE user_id = ?1')
      .bind(tenantId)
      .first<{ state?: string; payload?: string; data?: string }>();
    for (const raw of [as?.state, as?.payload, as?.data]) {
      try {
        const s = JSON.parse(String(raw || '{}')) as { officeName?: string; officeAddress?: string };
        if (s.officeName && !out.name) out.name = s.officeName;
        if (s.officeAddress && !out.address) out.address = s.officeAddress;
      } catch {
        /* not JSON */
      }
    }
  } catch {
    /* no app_state */
  }
  return out;
}

/** GET /api/portal-context?t=… — ONLY the token's client, from its office's DB. */
export async function portalContext(env: Env, token: string): Promise<{ status: number; body: unknown }> {
  const who = await verifyPortalToken(env, token);
  if (!who) return { status: 401, body: { error: 'invalid_or_expired_link' } };
  const db = await tenantDb(env, who.tenantId);
  if (!db) return { status: 403, body: { error: 'office_unavailable' } };
  const tid = who.tenantId;

  // A phone can belong to two family-member clients — all of them are this
  // person's own files.
  const all = await db
    .prepare('SELECT source_id, phone FROM clients WHERE user_id = ?1')
    .bind(tid)
    .all<{ source_id: string; phone: string | null }>();
  const clientIds = (all.results ?? [])
    .filter((c) => c.phone && normalizePhone(c.phone) === who.phone)
    .map((c) => String(c.source_id));
  if (!clientIds.length) return { status: 404, body: { error: 'client_not_found' } };

  const inList = (n: number, start: number) =>
    Array.from({ length: n }, (_, i) => `upper(?${start + i})`).join(', ');
  const rows = async (sql: string, binds: unknown[]) =>
    ((await db.prepare(sql).bind(...binds).all()).results ?? []) as Record<string, unknown>[];

  const clients = await rows(
    `SELECT * FROM clients WHERE user_id = ?1 AND upper(source_id) IN (${inList(clientIds.length, 2)})`,
    [tid, ...clientIds],
  );
  const cases = await rows(
    `SELECT * FROM cases WHERE user_id = ?1 AND upper(client_source_id) IN (${inList(clientIds.length, 2)})`,
    [tid, ...clientIds],
  );
  const caseIds = cases.map((c) => String(c.source_id));
  const ids = [...clientIds, ...caseIds];
  const byClientOrCase = (table: string) =>
    rows(
      `SELECT * FROM ${table} WHERE user_id = ?1 AND (upper(client_source_id) IN (${inList(clientIds.length, 2)})` +
        (caseIds.length ? ` OR upper(case_source_id) IN (${inList(caseIds.length, 2 + clientIds.length)})` : '') +
        ')',
      [tid, ...ids],
    );
  const byCase = (table: string) =>
    caseIds.length
      ? rows(
          `SELECT * FROM ${table} WHERE user_id = ?1 AND upper(case_source_id) IN (${inList(caseIds.length, 2)})`,
          [tid, ...caseIds],
        )
      : Promise.resolve([]);

  const [calendar_events, documents, tasks, payments, timeline_items] = await Promise.all([
    byClientOrCase('calendar_events'),
    byClientOrCase('documents'),
    byClientOrCase('tasks'),
    byCase('payments'),
    byCase('timeline_items'),
  ]);

  return {
    status: 200,
    body: {
      clients,
      cases,
      calendar_events,
      documents,
      tasks,
      payments,
      timeline_items,
      office: {
        tenant_id: tid,
        is_operator: false,
        portal: true,
        portal_phone: who.phone,
        // The operator's clients get the bot's built-in operator details.
        contact: tid === env.USER_ID ? null : await officeContact(env, db, tid),
      },
    },
  };
}
