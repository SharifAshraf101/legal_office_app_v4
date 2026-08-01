// Office database provisioning (Phase 2d).
//
// When an admin approves a pending office, the Worker creates that office its
// OWN Cloudflare D1 database and applies the canonical office schema to it —
// with NO redeploy. The new database id is stored in the tenant registry, and
// from then on the office's session resolves to that database (see tenant.ts).

import { D1HttpDatabase } from './d1http';
import { OFFICE_SCHEMA } from './officeSchema';
import type { Env } from './db';

/** Create a D1 database on the account via the REST API; return its id + name. */
async function createOfficeDatabase(
  env: Env,
  name: string,
): Promise<{ id: string; name: string }> {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/d1/database`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.CF_D1_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name }),
    },
  );
  const body = (await res.json().catch(() => null)) as {
    success?: boolean;
    result?: { uuid?: string; name?: string };
    errors?: { message?: string }[];
  } | null;
  if (!res.ok || !body?.success || !body.result?.uuid) {
    const msg =
      body?.errors?.map((e) => e.message).filter(Boolean).join('; ') ||
      `HTTP ${res.status}`;
    throw new Error(`create D1 failed: ${msg}`);
  }
  return { id: body.result.uuid, name: body.result.name || name };
}

/**
 * Provision a brand-new office database: create it, then apply the full office
 * schema (worker/officeSchema.ts). Returns the new database id for the registry.
 */
export async function provisionOfficeDb(
  env: Env,
  officeName: string,
): Promise<string> {
  if (!env.CF_ACCOUNT_ID || !env.CF_D1_TOKEN) {
    throw new Error('CF_ACCOUNT_ID / CF_D1_TOKEN not configured');
  }
  // Cloudflare requires a unique database name per account. Derive a readable
  // slug from the office name + a short random suffix.
  const slug =
    officeName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 24) || 'office';
  const dbName = `legal-office-t-${slug}-${crypto.randomUUID().slice(0, 8)}`;

  const created = await createOfficeDatabase(env, dbName);

  // Apply the schema to the new DB (multi-statement DDL in one request).
  const db = new D1HttpDatabase({
    accountId: env.CF_ACCOUNT_ID,
    apiToken: env.CF_D1_TOKEN,
    databaseId: created.id,
  });
  await db.prepare(OFFICE_SCHEMA).run();

  return created.id;
}
