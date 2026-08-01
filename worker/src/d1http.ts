// D1-over-HTTP client (multi-tenant · Phase 2a).
//
// Lets the Worker talk to ANY office's own D1 database by id, via the Cloudflare
// REST API — so per-office databases work with NO redeploy (create a DB, save
// its id in the registry, done). It mirrors the SLICE of the native D1Database
// binding the handlers actually use — prepare().bind().all()/first()/run() and
// batch() — so migrating a handler is just `env.DB` -> `ctx.db` (Phase 2c).
//
// Your office keeps the NATIVE binding (env.DB) via the dual-mode resolver
// (Phase 2b); only NEW offices are reached through this HTTP client.
//
// REST contract (verified against the Cloudflare API docs):
//   POST /accounts/{accountId}/d1/database/{databaseId}/query
//   Authorization: Bearer <token> ; body { sql, params }
//   -> { success, result: [ { results, success, meta } ], errors, messages }

export interface D1HttpConfig {
  accountId: string;
  databaseId: string;
  apiToken: string;
}

interface D1HttpResult<T = Record<string, unknown>> {
  results: T[];
  success: boolean;
  meta: Record<string, unknown>;
}

/** One POST to the D1 query endpoint. Returns one result block per statement. */
async function d1Query(
  cfg: D1HttpConfig,
  sql: string,
  params: unknown[],
): Promise<D1HttpResult[]> {
  const url =
    `https://api.cloudflare.com/client/v4/accounts/${cfg.accountId}` +
    `/d1/database/${cfg.databaseId}/query`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cfg.apiToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ sql, params }),
  });
  const body = (await res.json().catch(() => null)) as {
    success?: boolean;
    result?: D1HttpResult[];
    errors?: { code?: number; message?: string }[];
  } | null;
  if (!res.ok || !body || body.success === false) {
    const msg =
      body?.errors?.map((e) => e.message).filter(Boolean).join('; ') ||
      `HTTP ${res.status}`;
    throw new Error(`D1 HTTP query failed: ${msg}`);
  }
  return body.result ?? [];
}

/** Mirrors the D1PreparedStatement methods the handlers call. */
class D1HttpStatement {
  private boundParams: unknown[] = [];
  constructor(
    private readonly cfg: D1HttpConfig,
    private readonly sql: string,
  ) {}

  bind(...values: unknown[]): D1HttpStatement {
    this.boundParams = values;
    return this;
  }

  async all<T = Record<string, unknown>>(): Promise<D1HttpResult<T>> {
    const [r] = await d1Query(this.cfg, this.sql, this.boundParams);
    return {
      results: ((r?.results as T[]) ?? []),
      success: r?.success ?? true,
      meta: r?.meta ?? {},
    };
  }

  async first<T = Record<string, unknown>>(colName?: string): Promise<T | null> {
    const { results } = await this.all<Record<string, unknown>>();
    const row = results[0];
    if (row == null) return null;
    if (colName) return (row[colName] as T) ?? null;
    return row as unknown as T;
  }

  async run<T = Record<string, unknown>>(): Promise<D1HttpResult<T>> {
    return this.all<T>();
  }
}

/**
 * A drop-in for the slice of `D1Database` the handlers use, backed by HTTP.
 * Cast to `D1Database` at the assignment site (Phase 2b) — the unimplemented
 * members (exec/dump/withSession) are never called by the handlers.
 */
export class D1HttpDatabase {
  constructor(private readonly cfg: D1HttpConfig) {}

  prepare(sql: string): D1HttpStatement {
    return new D1HttpStatement(this.cfg, sql);
  }

  // Sequential, one round-trip per statement (NOT a single transaction) —
  // correct and simple. New offices start with little data, so batches are
  // tiny; your office keeps native atomic batch via env.DB. A later pass can
  // fold this into one joined-statement request once param mapping is proven.
  async batch<T = Record<string, unknown>>(
    statements: D1HttpStatement[],
  ): Promise<D1HttpResult<T>[]> {
    const out: D1HttpResult<T>[] = [];
    for (const s of statements) out.push(await s.all<T>());
    return out;
  }
}
