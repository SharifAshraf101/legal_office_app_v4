// Better Auth on the Worker — the accounts + sessions layer for the
// multi-tenant SaaS (Phase 1). It runs against the CONTROL-plane DB only and
// never touches an office's case data. The existing single-office data path
// (env.DB / env.USER_ID / APP_TOKEN) is untouched and keeps working alongside.
//
// Better Auth >= 1.5 auto-detects a D1 binding, so `database: env.CONTROL_DB`
// is all the adapter needs. On Workers the binding exists only per-request, so
// the instance is built inside the fetch handler via createAuth(env).

import { betterAuth } from 'better-auth';
import { getMigrations } from 'better-auth/db/migration';
import type { Env } from './db';

/** Build a Better Auth instance bound to THIS request's control-plane DB. */
export function createAuth(env: Env) {
  const trustedOrigins = (env.ALLOWED_ORIGIN || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  return betterAuth({
    // D1 binding, auto-detected (Better Auth >= 1.5).
    database: env.CONTROL_DB,
    secret: env.BETTER_AUTH_SECRET,
    // basePath defaults to /api/auth. Set baseURL only when provided so links
    // and cookies use the real Worker URL; otherwise it's inferred per request.
    ...(env.AUTH_BASE_URL ? { baseURL: env.AUTH_BASE_URL } : {}),
    basePath: '/api/auth',
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      autoSignIn: true,
    },
    trustedOrigins,
    databaseHooks: {
      user: {
        create: {
          // Right after a new account is created, provision a PENDING office
          // for it plus an 'owner' membership. An admin activates the office
          // later (Phase 2 attaches its own data DB). All writes stay on the
          // control DB.
          after: async (user) => {
            const u = user as { id: string; email?: string | null; name?: string | null };
            const now = new Date().toISOString();
            const tenantId = crypto.randomUUID();
            const membershipId = crypto.randomUUID();
            const officeName =
              (u.name && String(u.name).trim()) ||
              String(u.email || '').split('@')[0] ||
              'Office';
            await env.CONTROL_DB.batch([
              env.CONTROL_DB.prepare(
                `INSERT INTO tenant (id, name, status, created_at)
                 VALUES (?1, ?2, 'pending', ?3)`,
              ).bind(tenantId, officeName, now),
              env.CONTROL_DB.prepare(
                `INSERT INTO membership (id, user_id, tenant_id, role, created_at)
                 VALUES (?1, ?2, ?3, 'owner', ?4)`,
              ).bind(membershipId, u.id, tenantId, now),
            ]);
          },
        },
      },
    },
  });
}

/**
 * Create Better Auth's OWN tables (user, session, account, verification) on the
 * control DB. Idempotent. The CLI can't run inside a Worker, so we use the
 * programmatic migrator — the Workers-supported path. Our custom registry
 * tables come from control-schema.sql, applied separately with wrangler.
 */
export async function runAuthMigrations(env: Env): Promise<void> {
  const auth = createAuth(env);
  const { runMigrations } = await getMigrations(auth.options);
  await runMigrations();
}
