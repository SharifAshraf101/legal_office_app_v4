// "סנכרון נט" — what the browser extension (extensions/netmishpat-ext) sent
// from Net HaMishpat / the Sharia courts' site, read back for the office screen.
//
// The extension's own endpoint, POST /api/netmishpat/ingest, lives in
// extensions/worker-snippet/netmishpat-ingest.ts and writes the nm_* tables
// (extensions/worker-snippet/netmishpat.sql) in the OPERATOR office's database:
// it is authorised by one bridge token (NM_BRIDGE_TOKEN), which belongs to that
// office. These two routes are therefore the operator office's too.

import type { Env } from './db';
import type { Ctx } from './tenant';

type Result = { status: number; body: Record<string, unknown> };

const isOperator = (env: Env, ctx: Ctx) => ctx.tenantId === env.USER_ID;

const missingTable = (e: unknown) => /no such table/i.test(e instanceof Error ? e.message : String(e));

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
        `SELECT id, href, title, case_number, source, first_seen_at, reviewed
           FROM nm_documents ORDER BY reviewed ASC, first_seen_at DESC, id DESC LIMIT 300`,
      ),
      ctx.db.prepare(
        `SELECT case_number, case_type, source, last_seen_url, last_seen_at
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
    // The schema (netmishpat.sql) has not been run yet
    if (missingTable(e)) return { status: 200, body: { ...base, ready: false } };
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
