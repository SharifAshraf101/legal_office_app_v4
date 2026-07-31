// Per-request TENANT CONTEXT — commercialization step 1a.
//
// The whole app is scoped to ONE office today via the single env.USER_ID. To
// become a multi-tenant SaaS, that scoping must come from the AUTHENTICATED
// caller, not from a fixed env var. This module is THE ONE PLACE that changes:
// resolveTenant() is the single swap-point. Every handler that reads
// `ctx.tenantId` (instead of `env.USER_ID`) becomes tenant-scoped for free once
// resolveTenant returns the caller's own tenant.
//
// STEP 1a (this commit): zero behaviour change — resolveTenant returns
// env.USER_ID, and handlers are migrated from env.USER_ID → ctx.tenantId one by
// one. The app keeps working exactly as before while the 20 scattered
// env.USER_ID reads collapse into this single resolver.
//
// STEP 1b (later): validate the session/JWT here (Better Auth) and return the
// caller's tenantId; extend Ctx with the tenant's own D1 handle (siloed
// per-office database via the D1 REST API), Dropbox creds and R2 prefix.

import type { Env } from './db';

/** The resolved identity of WHOSE data a request may read/write. */
export interface Ctx {
  /** Tenant key — the value bound to the D1 `user_id` column on every query. */
  tenantId: string;
  // Future (siloed multi-tenancy), all resolved per-request from a registry:
  //   db?: TenantD1;      // the tenant's OWN D1 database (REST-API client)
  //   dropbox?: {...};    // the tenant's OWN Dropbox credentials
  //   r2Prefix?: string;  // the tenant's object-storage namespace
  //   role?: 'owner' | 'lawyer' | 'staff';
}

/**
 * Resolve the tenant for an already-authenticated request.
 *
 * SINGLE SWAP-POINT: today it returns the one configured office (env.USER_ID).
 * To go multi-tenant, replace the body with a session/JWT lookup that returns
 * the caller's own tenantId — no handler needs to change, because they all read
 * `ctx.tenantId`. The auth gate in index.ts runs BEFORE this (a shared token
 * today; a real per-user session check later).
 */
export function resolveTenant(_request: Request, env: Env): Ctx {
  return { tenantId: env.USER_ID };
}
