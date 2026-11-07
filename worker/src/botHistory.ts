// Client ↔ bot conversations, stored in the office's own database so the
// office sees them (they used to live only in the browser of the phone the
// client chatted on).
//
// A client writes and reads ONLY their own turns, authorized by the signed
// portal link (`t`, see portal.ts): the turn's client must be one whose phone
// is the link's phone. The office reads / clears them with its session.

import type { Env } from './db';
import { normalizePhone, verifyPortalToken } from './portal';
import { tenantDb } from './whatsapp';

const DDL =
  'CREATE TABLE IF NOT EXISTS bot_history (' +
  'id TEXT PRIMARY KEY, client_source_id TEXT NOT NULL, client_name TEXT, ' +
  'question TEXT NOT NULL, answer TEXT NOT NULL, created_at TEXT NOT NULL)';
const MAX_TEXT = 8000;
const LIST_LIMIT = 500;

export interface BotTurn {
  id: string;
  clientId: string;
  clientName: string;
  question: string;
  answer: string;
  time: string;
}

type Row = {
  id: string;
  client_source_id: string;
  client_name: string | null;
  question: string;
  answer: string;
  created_at: string;
};
const toTurn = (r: Row): BotTurn => ({
  id: r.id,
  clientId: r.client_source_id,
  clientName: r.client_name || '',
  question: r.question,
  answer: r.answer,
  time: r.created_at,
});

/** The link's office DB and the ids of the clients whose phone is the link's. */
async function portalScope(env: Env, token: string): Promise<{ db: D1Database; clientIds: string[] } | null> {
  const who = await verifyPortalToken(env, token);
  if (!who) return null;
  const db = await tenantDb(env, who.tenantId);
  if (!db) return null;
  const all = await db
    .prepare('SELECT source_id, phone FROM clients WHERE user_id = ?1')
    .bind(who.tenantId)
    .all<{ source_id: string; phone: string | null }>();
  const clientIds = (all.results ?? [])
    .filter((c) => c.phone && normalizePhone(c.phone) === who.phone)
    .map((c) => String(c.source_id).toUpperCase());
  return { db, clientIds };
}

async function insertTurn(db: D1Database, b: Partial<BotTurn>): Promise<void> {
  await db.prepare(DDL).run();
  await db
    .prepare(
      'INSERT OR IGNORE INTO bot_history (id, client_source_id, client_name, question, answer, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)',
    )
    .bind(
      String(b.id).slice(0, 80),
      String(b.clientId),
      String(b.clientName || '').slice(0, 200),
      String(b.question).slice(0, MAX_TEXT),
      String(b.answer).slice(0, MAX_TEXT),
      String(b.time || new Date().toISOString()).slice(0, 40),
    )
    .run();
}

function validTurn(b: Partial<BotTurn>): boolean {
  return !!(b && b.id && b.clientId && b.question && b.answer);
}

/** POST /api/bot-history with `{ t, turn }` — a client saves their own turn. */
export async function portalSaveTurn(env: Env, body: { t?: string; turn?: Partial<BotTurn> }) {
  const scope = await portalScope(env, String(body?.t || ''));
  if (!scope) return { status: 401, body: { error: 'invalid_or_expired_link' } };
  const turn = body?.turn || {};
  if (!validTurn(turn)) return { status: 400, body: { error: 'missing_fields' } };
  if (!scope.clientIds.includes(String(turn.clientId).toUpperCase())) {
    return { status: 403, body: { error: 'not_this_client' } };
  }
  await insertTurn(scope.db, turn);
  return { status: 200, body: { ok: true } };
}

/** GET /api/bot-history?t=… — a client's own turns (newest first). */
export async function portalListTurns(env: Env, token: string) {
  const scope = await portalScope(env, token);
  if (!scope) return { status: 401, body: { error: 'invalid_or_expired_link' } };
  if (!scope.clientIds.length) return { status: 200, body: { turns: [] } };
  await scope.db.prepare(DDL).run();
  const marks = scope.clientIds.map((_, i) => `?${i + 1}`).join(', ');
  const rs = await scope.db
    .prepare(
      `SELECT * FROM bot_history WHERE upper(client_source_id) IN (${marks}) ORDER BY created_at DESC LIMIT ${LIST_LIMIT}`,
    )
    .bind(...scope.clientIds)
    .all<Row>();
  return { status: 200, body: { turns: (rs.results ?? []).map(toTurn) } };
}

/** Office (session): save a turn asked from an office device. */
export async function officeSaveTurn(db: D1Database, turn: Partial<BotTurn>) {
  if (!validTurn(turn)) return { status: 400, body: { error: 'missing_fields' } };
  await insertTurn(db, turn);
  return { status: 200, body: { ok: true } };
}

/** Office (session): every client's turns, newest first. */
export async function officeListTurns(db: D1Database) {
  await db.prepare(DDL).run();
  const rs = await db
    .prepare(`SELECT * FROM bot_history ORDER BY created_at DESC LIMIT ${LIST_LIMIT}`)
    .all<Row>();
  return { status: 200, body: { turns: (rs.results ?? []).map(toTurn) } };
}

/** Office (session): clear one client's conversation. */
export async function officeClearTurns(db: D1Database, clientId: string) {
  if (!clientId) return { status: 400, body: { error: 'clientId required' } };
  await db.prepare(DDL).run();
  await db.prepare('DELETE FROM bot_history WHERE upper(client_source_id) = upper(?1)').bind(clientId).run();
  return { status: 200, body: { ok: true } };
}
