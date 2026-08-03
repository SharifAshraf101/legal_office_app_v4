// D1 helpers: the per-table column allow-lists and the upsert builder that
// turns a row from the client's *ToRow() output into an
// INSERT ... ON CONFLICT(user_id, source_id) DO UPDATE statement (the SQLite
// equivalent of Supabase PostgREST's `Prefer: resolution=merge-duplicates`).

export interface Env {
  DB: D1Database;
  PHOTOS: R2Bucket;
  // Per-office filing-document storage. Every office EXCEPT the operator office
  // (tenant #1, which keeps its Dropbox + make.com pipeline) stores its
  // documents here under `${tenantId}/documents/...` keys — isolated per office,
  // exactly like client photos in PHOTOS.
  DOCS: R2Bucket;
  ALLOWED_ORIGIN: string;
  USER_ID: string;
  APP_TOKEN: string;
  ANTHROPIC_API_KEY: string;
  // Server-side Dropbox access so a device WITHOUT its own Dropbox connection
  // (a client's phone opening the portal bot) can still download a filing
  // document: the Worker holds the office's credentials and streams the bytes.
  //   DROPBOX_APP_KEY       — the Dropbox app key / client_id (same value as the
  //                           browser's NEXT_PUBLIC_DROPBOX_APP_KEY). PKCE apps
  //                           refresh with just the client_id, no secret.
  //   DROPBOX_REFRESH_TOKEN — the office's long-lived refresh token (secret).
  //   DROPBOX_BASE_FOLDER   — the folder the office picked in Dropbox ("" for an
  //                           App-folder app, or e.g. "/Cases"). Optional.
  DROPBOX_APP_KEY?: string;
  DROPBOX_REFRESH_TOKEN?: string;
  DROPBOX_BASE_FOLDER?: string;

  // ── Multi-tenant control plane (Phase 1) ──────────────────────────────────
  // A SEPARATE D1 that holds ONLY the SaaS registry — accounts + sessions
  // (Better Auth) and the office/membership tables — never an office's case
  // data. Added alongside the single-office path (DB / USER_ID / APP_TOKEN),
  // which is left untouched.
  CONTROL_DB: D1Database;
  BETTER_AUTH_SECRET: string; // session-signing secret (set via wrangler secret)
  AUTH_BASE_URL?: string;     // the Worker's public URL (auth links/cookies)
  ADMIN_TOKEN?: string;       // gates /api/admin/* (migrate, list, approve)

  // Cloudflare REST creds so the Worker can reach each office's OWN D1 by id
  // (Phase 2 · D1-over-HTTP) and, later, provision new office databases. The
  // token needs D1 edit permission. The account id is not sensitive; the token
  // is a secret (wrangler secret put CF_D1_TOKEN).
  CF_ACCOUNT_ID?: string;
  CF_D1_TOKEN?: string;

  // The database_id of THIS Worker's native `DB` binding (your original office,
  // = tenant #1). When a resolved office's data_db matches it, the resolver
  // serves it from the fast native binding instead of the REST client.
  NATIVE_DB_ID?: string;
}

// The tables read by /api/load and written by /api/save, in the SAME key order
// the client sends. Each value is the set of columns the client is allowed to
// write — anything else in the payload is ignored (defends the SQL builder).
// `user_id`, `id`, `created_at` and `updated_at` are managed by the Worker and
// are intentionally absent here.
export const TABLE_COLUMNS: Record<string, string[]> = {
  clients: [
    'source_id', 'full_name', 'full_name_ar', 'phone', 'email', 'id_number',
    'address', 'address_ar', 'notes', 'notes_ar', 'photo_url',
  ],
  cases: [
    'source_id', 'client_source_id', 'case_number', 'title', 'title_ar',
    'status', 'description', 'description_ar', 'court', 'court_ar',
    'agreed_fee', 'last_hearing',
  ],
  tasks: [
    'source_id', 'case_source_id', 'client_source_id', 'title', 'due_date',
    'status', 'priority', 'notes', 'done_at',
  ],
  calendar_events: [
    'source_id', 'case_source_id', 'client_source_id', 'title', 'title_ar',
    'date_time', 'description', 'description_ar', 'type',
  ],
  documents: [
    'source_id', 'case_source_id', 'client_source_id', 'title', 'title_ar',
    'description', 'description_ar', 'file_name', 'relative_path', 'date',
    'summary_he', 'summary_ar',
  ],
  // AI-generated reply/response drafts (one per source document/decision),
  // written by the Make pipeline and pulled back by the app. `source_id`
  // should be stable per source document (e.g. DRAFT-DOC-020) so re-running
  // the pipeline UPDATES the draft instead of inserting a duplicate.
  drafts: [
    'source_id', 'case_source_id', 'client_source_id', 'document_source_id',
    'file_name', 'title', 'title_ar', 'draft_he', 'draft_ar', 'draft_orig',
    'language', 'doc_type', 'status', 'date',
  ],
  // GLOBAL drafting "skills" / guideline documents that Claude reads BEFORE
  // writing a draft (the lawyer's how-to-respond methodology). Not per-case.
  // `skill_key` selects which skill (e.g. 'legal-draft'); `status='active'`
  // marks the one(s) in use.
  skills: [
    'source_id', 'skill_key', 'title', 'title_ar', 'content', 'language',
    'status', 'date',
  ],
  payments: [
    'source_id', 'case_source_id', 'date', 'amount', 'type',
    'description', 'description_ar',
  ],
  timeline_items: [
    'source_id', 'case_source_id', 'type', 'title', 'title_ar', 'date',
    'description', 'description_ar',
  ],
};

export const LOAD_TABLES = Object.keys(TABLE_COLUMNS);

// Cache-like columns that must never be wiped to null by a client whose copy is
// empty — on update they keep the existing value unless a real value arrives.
const COALESCE_ON_UPDATE = new Set([
  'summary_he', 'summary_ar', 'draft_he', 'draft_ar', 'draft_orig',
]);

export interface BuiltStatement {
  sql: string;
  binds: unknown[];
}

/**
 * Build one upsert for `row` into `table`. Returns null when the table is
 * unknown or the row has no `source_id` (which is the conflict key). `user_id`
 * is forced from env — the client can never write another user's rows. `id` is
 * generated for new rows; on conflict the existing row keeps its id and
 * created_at, and every other present column plus updated_at is overwritten.
 */
export function buildUpsert(
  table: string,
  row: Record<string, unknown>,
  userId: string,
): BuiltStatement | null {
  const allowed = TABLE_COLUMNS[table];
  if (!allowed) return null;

  // The external pipeline (make.com) keys incoming `documents` rows by the
  // Dropbox PATH instead of the running DOC id, e.g.
  //   "Clients/clt-101/CS-1020 - .../CLT-101_CS-1020_..._DOC-099.pdf".
  // We used to DROP any document whose source_id contained '/', so those
  // path-keyed rows would not duplicate the canonical DOC-NNN row — but that
  // silently discarded every legitimate document the pipeline filed, so nothing
  // it produced ever reached the app (the scenario still saw 200 ok). Instead,
  // recover the DOC-NNN id embedded in the path/filename and use THAT as the
  // conflict key: the write now UPDATES the canonical row (idempotent) rather
  // than being lost or duplicated. Only reject when no id can be recovered.
  if (table === 'documents' && String(row.source_id ?? '').includes('/')) {
    const hay =
      String(row.source_id ?? '') +
      ' ' +
      String(row.file_name ?? '') +
      ' ' +
      String(row.relative_path ?? '');
    const ids = hay.match(/DOC-\d{1,6}/gi);
    if (!ids || ids.length === 0) return null;
    // Prefer the id closest to the filename (last match) — folder names could
    // in principle carry a different DOC id than the file itself.
    row = { ...row, source_id: ids[ids.length - 1].toUpperCase() };
  }

  const present = allowed.filter((c) => row[c] !== undefined);
  if (!present.includes('source_id')) return null;

  const now = new Date().toISOString();
  const id = typeof row.id === 'string' && row.id ? row.id : crypto.randomUUID();

  const cols = ['user_id', 'id', ...present, 'updated_at'];
  const binds: unknown[] = [
    userId,
    id,
    ...present.map((c) => (row[c] === undefined ? null : row[c])),
    now,
  ];
  const placeholders = cols.map(() => '?').join(', ');

  // Never overwrite the conflict key (source_id) or created_at on update.
  const updateCols = [...present.filter((c) => c !== 'source_id'), 'updated_at'];
  const setClause = updateCols
    .map((c) =>
      // Document summaries are a cache that must never be wiped by a client
      // whose copy is empty: keep the existing value when the incoming one is
      // null (COALESCE), only overwrite with a real new summary.
      COALESCE_ON_UPDATE.has(c)
        ? `${c}=COALESCE(excluded.${c}, ${c})`
        : `${c}=excluded.${c}`,
    )
    .join(', ');

  const sql =
    `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders}) ` +
    `ON CONFLICT(user_id, source_id) DO UPDATE SET ${setClause}`;

  return { sql, binds };
}

export function safeParse(s: unknown): unknown {
  if (typeof s !== 'string' || !s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}