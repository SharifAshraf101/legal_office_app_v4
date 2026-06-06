// One-time migration: copy all data from Supabase into Cloudflare (D1 + R2).
//
// Read-only against Supabase, idempotent against D1 (every INSERT is an upsert
// on (user_id, source_id)). Runs in three phases:
//
//   node scripts/migrate-supabase-to-cloudflare.mjs          # dump + sql (default)
//   node scripts/migrate-supabase-to-cloudflare.mjs dump     # phase A only
//   node scripts/migrate-supabase-to-cloudflare.mjs sql      # phase B only (needs dump first)
//
// Outputs everything under ./migration-out :
//   <table>.json          raw dumped rows (rollback snapshot)
//   photos/<key>          downloaded client-photo files
//   seed.sql              D1 upserts (run with: wrangler d1 execute ... --file)
//   put-photos.ps1 / .sh  one `wrangler r2 object put` per photo
//
// See RUNBOOK.md for the exact command order. Config via env vars (defaults
// match the values currently hardcoded in lib/supabase.ts):
//   SUPABASE_URL, SUPABASE_KEY, USER_ID         (source)
//   WORKER_URL                                  (used to rewrite photo URLs)
//   D1_NAME (default 'legal-office'), R2_BUCKET (default 'legal-office-photos')

import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, '..', 'migration-out');
const PHOTOS_DIR = join(OUT_DIR, 'photos');

const SUPABASE_URL = (process.env.SUPABASE_URL || 'https://mtrsrfisfaxmtpujeddh.supabase.co').replace(/\/$/, '');
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'sb_publishable_XF-KIsQzJKokfdNCze3k6g_3WiG2CuU';
const USER_ID = process.env.USER_ID || 'c0307382-5fd2-4a2b-88df-40b22bb9ad26';
const WORKER_URL = (process.env.WORKER_URL || '').replace(/\/$/, '');
const D1_NAME = process.env.D1_NAME || 'legal-office-v3';
const R2_BUCKET = process.env.R2_BUCKET || 'legal-office-photos-v3';

const REST = SUPABASE_URL + '/rest/v1';
const STORAGE_PUBLIC_BASE = SUPABASE_URL + '/storage/v1/object/public/legal-office-documents/';

const headers = {
  apikey: SUPABASE_KEY,
  Authorization: 'Bearer ' + SUPABASE_KEY,
  'Content-Type': 'application/json',
};

// Source tables → canonical D1 table. The aliases (finances, timeline_entries)
// fold into payments / timeline_items.
const SOURCE_TABLES = [
  'clients', 'cases', 'tasks', 'calendar_events', 'documents',
  'payments', 'finances', 'timeline_items', 'timeline_entries', 'app_state',
];
const ALIAS = { finances: 'payments', timeline_entries: 'timeline_items' };

// Full D1 column set per canonical table (matches worker/schema.sql). Only these
// columns are carried over — Supabase extras (client_id/case_id FK uuids) are dropped.
const D1_COLUMNS = {
  clients: ['id', 'user_id', 'source_id', 'full_name', 'full_name_ar', 'phone', 'email', 'id_number', 'address', 'address_ar', 'notes', 'notes_ar', 'photo_url', 'created_at', 'updated_at'],
  cases: ['id', 'user_id', 'source_id', 'client_source_id', 'case_number', 'title', 'title_ar', 'status', 'description', 'description_ar', 'court', 'court_ar', 'agreed_fee', 'last_hearing', 'created_at', 'updated_at'],
  tasks: ['id', 'user_id', 'source_id', 'case_source_id', 'client_source_id', 'title', 'due_date', 'status', 'priority', 'notes', 'done_at', 'created_at', 'updated_at'],
  calendar_events: ['id', 'user_id', 'source_id', 'case_source_id', 'client_source_id', 'title', 'title_ar', 'date_time', 'description', 'description_ar', 'type', 'created_at', 'updated_at'],
  documents: ['id', 'user_id', 'source_id', 'case_source_id', 'client_source_id', 'title', 'title_ar', 'description', 'description_ar', 'file_name', 'relative_path', 'date', 'summary_he', 'summary_ar', 'created_at', 'updated_at'],
  payments: ['id', 'user_id', 'source_id', 'case_source_id', 'date', 'amount', 'type', 'description', 'description_ar', 'created_at', 'updated_at'],
  timeline_items: ['id', 'user_id', 'source_id', 'case_source_id', 'type', 'title', 'title_ar', 'date', 'description', 'description_ar', 'created_at', 'updated_at'],
  app_state: ['user_id', 'state', 'payload', 'data', 'created_at', 'updated_at'],
};

const NOT_NULL_DEFAULTS = {
  cases: { status: 'active', agreed_fee: 0 },
  tasks: { title: '', status: 'open', priority: 'normal' },
  calendar_events: { type: 'hearingMeeting' },
  payments: { amount: 0, type: 'payment' },
  timeline_items: { type: 'note' },
  app_state: { state: '{}', payload: '{}', data: '{}' },
};

// timestamptz columns: normalize to ISO 'Z'. date-only columns are left as-is.
const TS_COLUMNS = new Set(['created_at', 'updated_at', 'date_time', 'done_at']);
const JSON_COLUMNS = new Set(['state', 'payload', 'data']);

// ---------------------------------------------------------------------------

async function getTable(table) {
  const url = `${REST}/${table}?user_id=eq.${encodeURIComponent(USER_ID)}&select=*`;
  const res = await fetch(url, { headers });
  if (!res.ok) {
    console.warn(`  [skip] ${table}: ${res.status} ${await res.text()}`);
    return [];
  }
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

async function phaseDump() {
  console.log('Phase A — dump from Supabase (read-only)');
  mkdirSync(PHOTOS_DIR, { recursive: true });

  // canonical -> Map(source_id -> row), so aliases merge without duplicating.
  const merged = {};
  for (const t of Object.keys(D1_COLUMNS)) merged[t] = new Map();
  const appStateRows = [];

  for (const src of SOURCE_TABLES) {
    const rows = await getTable(src);
    console.log(`  ${src}: ${rows.length} rows`);
    if (src === 'app_state') {
      appStateRows.push(...rows);
      continue;
    }
    const canonical = ALIAS[src] || src;
    const map = merged[canonical];
    for (const row of rows) {
      const key = String(row.source_id ?? row.id ?? '');
      if (!key) continue;
      // canonical table wins over alias on key collision
      if (!map.has(key) || !ALIAS[src]) map.set(key, row);
    }
  }

  // Write per-table JSON snapshots.
  for (const t of Object.keys(D1_COLUMNS)) {
    if (t === 'app_state') continue;
    const arr = [...merged[t].values()];
    writeFileSync(join(OUT_DIR, `${t}.json`), JSON.stringify(arr, null, 2));
  }
  writeFileSync(join(OUT_DIR, 'app_state.json'), JSON.stringify(appStateRows, null, 2));

  // Download client photos referenced by clients.photo_url (no bucket-list
  // permission needed — we derive keys straight from the URLs).
  const clients = [...merged.clients.values()];
  const photoKeys = [];
  for (const c of clients) {
    const url = String(c.photo_url || '');
    if (!url.startsWith(STORAGE_PUBLIC_BASE)) continue; // skip data: URLs / empties
    const key = url.slice(STORAGE_PUBLIC_BASE.length);
    try {
      const res = await fetch(url);
      if (!res.ok) {
        console.warn(`  [photo skip] ${key}: ${res.status}`);
        continue;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      const dest = join(PHOTOS_DIR, key);
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, buf);
      photoKeys.push(key);
    } catch (e) {
      console.warn(`  [photo error] ${key}: ${e}`);
    }
  }
  writeFileSync(join(OUT_DIR, 'photo-keys.json'), JSON.stringify(photoKeys, null, 2));
  console.log(`  photos downloaded: ${photoKeys.length}`);

  // Emit R2 upload command scripts (cross-platform).
  writePhotoUploadScripts(photoKeys);
  console.log('Phase A done →', OUT_DIR);
}

function writePhotoUploadScripts(keys) {
  const ps = keys
    .map((k) => `wrangler r2 object put "${R2_BUCKET}/${k}" --file="photos/${k.replace(/\//g, '\\')}" --remote`)
    .join('\n');
  writeFileSync(join(OUT_DIR, 'put-photos.ps1'), (ps || '# no photos to upload') + '\n');

  const sh = keys
    .map((k) => `wrangler r2 object put "${R2_BUCKET}/${k}" --file="photos/${k}" --remote`)
    .join('\n');
  writeFileSync(join(OUT_DIR, 'put-photos.sh'), '#!/usr/bin/env bash\nset -e\n' + (sh || '# no photos to upload') + '\n');
}

// ---------------------------------------------------------------------------

function sqlVal(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  if (typeof v === 'boolean') return v ? '1' : '0';
  return `'${String(v).replace(/'/g, "''")}'`;
}

function normalizeColumn(col, value) {
  if (value === null || value === undefined) return null;
  if (JSON_COLUMNS.has(col)) {
    return typeof value === 'string' ? value : JSON.stringify(value);
  }
  if (TS_COLUMNS.has(col)) {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? String(value) : d.toISOString();
  }
  return value;
}

function rewritePhotoUrl(url) {
  const s = String(url || '');
  if (!s.startsWith(STORAGE_PUBLIC_BASE)) return url; // data: URL or already migrated
  const key = s.slice(STORAGE_PUBLIC_BASE.length);
  if (!WORKER_URL) {
    console.warn('  [warn] WORKER_URL not set — clients.photo_url left pointing at Supabase');
    return url;
  }
  return `${WORKER_URL}/api/photo/${key}`;
}

function rowToInsert(table, row) {
  const cols = D1_COLUMNS[table];
  const defaults = NOT_NULL_DEFAULTS[table] || {};
  const vals = cols.map((col) => {
    let v = row[col];
    if (col === 'id' && (v === undefined || v === null || v === '')) {
      v = cryptoRandomId();
    }
    if (col === 'photo_url') v = rewritePhotoUrl(v);
    v = normalizeColumn(col, v);
    if ((v === null || v === undefined) && col in defaults) v = defaults[col];
    if ((v === null || v === undefined) && col === 'user_id') v = USER_ID;
    // created_at / updated_at are NOT NULL; an explicit NULL would not pick up
    // the column DEFAULT, so stamp them when the source value is missing.
    if ((v === null || v === undefined) && (col === 'created_at' || col === 'updated_at')) {
      v = new Date().toISOString();
    }
    return sqlVal(v);
  });
  const conflict = table === 'app_state' ? 'user_id' : 'user_id, source_id';
  const updateCols = cols.filter(
    (c) => c !== 'id' && c !== 'user_id' && c !== 'source_id' && c !== 'created_at',
  );
  const setClause = updateCols.map((c) => `${c}=excluded.${c}`).join(', ');
  return (
    `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${vals.join(', ')}) ` +
    `ON CONFLICT(${conflict}) DO UPDATE SET ${setClause};`
  );
}

function cryptoRandomId() {
  // Node 18+ has global crypto.randomUUID.
  return globalThis.crypto?.randomUUID?.() ?? `mig-${Math.random().toString(16).slice(2)}`;
}

function phaseSql() {
  console.log('Phase B — generate seed.sql');
  // No BEGIN/COMMIT: `wrangler d1 execute --file` runs the whole file as one
  // atomic batch and rejects explicit transaction statements.
  const lines = ['-- Generated by migrate-supabase-to-cloudflare.mjs'];
  let count = 0;
  for (const table of Object.keys(D1_COLUMNS)) {
    const file = join(OUT_DIR, `${table}.json`);
    if (!existsSync(file)) {
      console.warn(`  [skip] ${table}.json not found — run the dump phase first`);
      continue;
    }
    const rows = JSON.parse(readFileSync(file, 'utf8'));
    if (!rows.length) continue;
    lines.push(`-- ${table} (${rows.length})`);
    for (const row of rows) {
      if (table !== 'app_state' && !row.source_id) continue;
      lines.push(rowToInsert(table, row));
      count++;
    }
  }
  writeFileSync(join(OUT_DIR, 'seed.sql'), lines.join('\n') + '\n');
  console.log(`  wrote ${count} upserts → ${join(OUT_DIR, 'seed.sql')}`);
  if (!WORKER_URL) {
    console.warn('  NOTE: set WORKER_URL and re-run `sql` so photo_url rewrites land.');
  }
}

// ---------------------------------------------------------------------------

async function main() {
  const phase = (process.argv[2] || 'all').toLowerCase();
  mkdirSync(OUT_DIR, { recursive: true });
  if (phase === 'dump' || phase === 'all') await phaseDump();
  if (phase === 'sql' || phase === 'all') phaseSql();
  console.log('\nNext: see RUNBOOK.md (apply seed.sql to D1, run put-photos for R2).');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
