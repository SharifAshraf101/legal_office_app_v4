// Per-request TENANT CONTEXT — the one place that decides WHOSE data a request
// may touch, and WHICH database it lives in. Dual-mode (Phase 2b):
//
//   • App-token  -> your original office, on the NATIVE D1 binding (env.DB).
//                   Fast and 100% unchanged — your office never leaves this path.
//   • Session    -> the logged-in office (Better Auth), on ITS OWN D1 reached
//                   over the Cloudflare REST API. Resolves ONLY once the office
//                   is ACTIVE and has a database assigned (Phase 2d); until then
//                   a session gets no data access (null -> 401).
//
// Handlers read ctx.db / ctx.tenantId instead of env.DB / env.USER_ID (migrated
// in Phase 2c), so the SAME handler serves your office and any tenant office.

import { createAuth } from './auth';
import { D1HttpDatabase } from './d1http';
import type { Env } from './db';

/** The resolved identity + database a request may read/write. */
export interface Ctx {
  /** Tenant key — bound to the D1 `user_id` column on every query. */
  tenantId: string;
  /** The database this request runs against (native binding or REST client). */
  db: D1Database;
  /** How we resolved: your office ('legacy') vs a logged-in tenant ('tenant'). */
  mode: 'legacy' | 'tenant';
}

/**
 * Resolve the tenant for a request, or null if it isn't authorized for data.
 * The app-token is checked FIRST, so your office never pays the session lookup.
 */
export async function resolveTenant(
  request: Request,
  env: Env,
): Promise<Ctx | null> {
  // 1) App-token → the original single office, on the native binding.
  const hdr = request.headers.get('Authorization') || '';
  const bearer = hdr.startsWith('Bearer ') ? hdr.slice(7).trim() : '';
  const appTokens = (env.APP_TOKEN || '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
  if (bearer && appTokens.includes(bearer)) {
    return { tenantId: env.USER_ID, db: env.DB, mode: 'legacy' };
  }

  // 2) Better Auth session → the caller's OWN office, on its own D1 (REST).
  const authResult = await createAuth(env)
    .api.getSession({ headers: request.headers })
    .catch(() => null);
  const userId = authResult?.user?.id;
  if (userId) {
    const row = await env.CONTROL_DB.prepare(
      `SELECT t.id AS tenant_id, t.status AS status, t.data_db_name AS data_db
         FROM membership m
         JOIN tenant t ON t.id = m.tenant_id
        WHERE m.user_id = ?1
        LIMIT 1`,
    )
      .bind(userId)
      .first<{ tenant_id: string; status: string; data_db: string | null }>();
    if (
      row?.status === 'active' &&
      row.data_db &&
      env.CF_ACCOUNT_ID &&
      env.CF_D1_TOKEN
    ) {
      const db = new D1HttpDatabase({
        accountId: env.CF_ACCOUNT_ID,
        apiToken: env.CF_D1_TOKEN,
        databaseId: row.data_db,
      }) as unknown as D1Database;
      return { tenantId: row.tenant_id, db, mode: 'tenant' };
    }
  }

  return null;
}
