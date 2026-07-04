// D1 helpers: the per-table column allow-lists and the upsert builder that
// turns a row from the client's *ToRow() output into an
// INSERT ... ON CONFLICT(user_id, source_id) DO UPDATE statement (the SQLite
// equivalent of Supabase PostgREST's `Prefer: resolution=merge-duplicates`).

export interface Env {
  DB: D1Database;
  PHOTOS: R2Bucket;
  ALLOWED_ORIGIN: string;
  USER_ID: string;
  APP_TOKEN: string;
  ANTHROPIC_API_KEY: string;
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

  const present = allowed.filter((c) => row[c] !== undefined);
  if (!present.includes('source_id')) return null;
  // Reject a corrupted source_id that is a file PATH instead of an id (the
  // external pipeline has written document rows keyed by the Dropbox path,
  // which then show up as duplicate junk rows). Real ids never contain '/'.
 if (table === "documents" && String(row.source_id ?? "").includes("/")) return null;

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