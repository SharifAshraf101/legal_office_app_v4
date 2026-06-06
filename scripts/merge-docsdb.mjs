// Build the SQL that merges legal-docs-db (AI pipeline) content into the
// legal-office-v3 app schema:
//   file_summary -> UPDATE documents.summary_he / summary_ar  (matched by DOC-id)
//   hearings     -> UPSERT calendar_events
//   tasks        -> UPSERT tasks
// clients/decisions are not copied: clients already exist, and the decision's
// summary is already on DOC-007 (its task + hearing come via the tables above).
//
// Reads the dumped JSON in migration-out/docs-db/, writes migration-out/docs-merge.sql.
// Idempotent: documents are UPDATEd in place; events/tasks upsert on (user_id, source_id).

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIR = resolve(__dirname, '..', 'migration-out', 'docs-db');
const OUT = resolve(__dirname, '..', 'migration-out', 'docs-merge.sql');
const USER_ID = 'c0307382-5fd2-4a2b-88df-40b22bb9ad26';

const rd = (f) => {
  const j = JSON.parse(readFileSync(join(DIR, f), 'utf8'));
  return (j[0] && j[0].results) || j.results || [];
};
const q = (v) => (v === null || v === undefined ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);
const now = '2026-06-07T00:00:00.000Z';

const fsum = rd('file_summary.json');
const hearings = rd('hearings.json');
const tasks = rd('tasks.json');

const lines = ['-- Merge legal-docs-db -> legal-office-v3 (app schema). Generated.'];
const plan = [];

// ---- 1. file_summary -> documents.summary_he/ar -------------------------
// Match by DOC-id parsed from file_name; row with no DOC-id (the original,
// un-renamed name) maps to DOC-001 (the only same-named doc not otherwise hit).
const NO_DOCID_FALLBACK = 'DOC-001';
for (const r of fsum) {
  const m = /DOC-(\d+)/i.exec(r.file_name || '');
  const docId = m ? `DOC-${m[1]}` : NO_DOCID_FALLBACK;
  lines.push(
    `UPDATE documents SET summary_he=${q(r.summary_he)}, summary_ar=${q(r.summary_ar)}, updated_at=${q(now)} ` +
      `WHERE user_id=${q(USER_ID)} AND source_id=${q(docId)};`,
  );
  plan.push(`  doc summary -> ${docId}  (from file_summary #${r.id}, ${r.language}, he:${(r.summary_he || '').length}/ar:${(r.summary_ar || '').length})${m ? '' : '  [no DOC-id in name -> fallback DOC-001]'}`);
}

// ---- 2. hearings -> calendar_events -------------------------------------
// hearing_date is date-only; default the time to 09:00 (the app's convention).
// decision-linked hearing -> CS-1001; the unlinked one -> CS-1001 (client's
// main case) as a flagged guess.
function shortId(id) {
  const parts = String(id).split('_');
  return parts[parts.length - 1] || id;
}
for (const h of hearings) {
  const sid = 'EV-HRG-' + shortId(h.id);
  const caseId = 'CS-1001';
  const dt = h.hearing_date ? `${h.hearing_date}T09:00:00.000Z` : null;
  lines.push(
    `INSERT INTO calendar_events (id, user_id, source_id, case_source_id, client_source_id, title, title_ar, date_time, description, description_ar, type, created_at, updated_at) ` +
      `VALUES (${q('mig-' + sid)}, ${q(USER_ID)}, ${q(sid)}, ${q(caseId)}, ${q('CLT-101')}, ${q('דיון')}, ${q('جلسة')}, ${q(dt)}, ${q(h.notes || 'דיון (יובא מ-AI)')}, ${q(h.notes || 'جلسة (مستورد)')}, 'hearingMeeting', ${q(now)}, ${q(now)}) ` +
      `ON CONFLICT(user_id, source_id) DO UPDATE SET case_source_id=excluded.case_source_id, client_source_id=excluded.client_source_id, title=excluded.title, title_ar=excluded.title_ar, date_time=excluded.date_time, description=excluded.description, description_ar=excluded.description_ar, type=excluded.type, updated_at=excluded.updated_at;`,
  );
  plan.push(`  hearing -> calendar_event ${sid}  date=${h.hearing_date} case=${caseId}${h.decision_id ? '' : '  [no decision link -> case guessed CS-1001]'}`);
}

// ---- 3. tasks -> tasks ---------------------------------------------------
for (const t of tasks) {
  const sid = 'TASK-DEC-' + shortId(t.id);
  const caseId = 'CS-1001';
  const status = t.status === 'pending' ? 'open' : t.status || 'open';
  lines.push(
    `INSERT INTO tasks (id, user_id, source_id, case_source_id, client_source_id, title, due_date, status, priority, notes, created_at, updated_at) ` +
      `VALUES (${q('mig-' + sid)}, ${q(USER_ID)}, ${q(sid)}, ${q(caseId)}, ${q('CLT-101')}, ${q(t.task_description)}, ${q(t.due_date)}, ${q(status)}, 'normal', ${q('יובא מ-AI (decision task)')}, ${q(now)}, ${q(now)}) ` +
      `ON CONFLICT(user_id, source_id) DO UPDATE SET case_source_id=excluded.case_source_id, client_source_id=excluded.client_source_id, title=excluded.title, due_date=excluded.due_date, status=excluded.status, notes=excluded.notes, updated_at=excluded.updated_at;`,
  );
  plan.push(`  task -> ${sid}  due=${t.due_date} status=${status} case=${caseId}`);
}

writeFileSync(OUT, lines.join('\n') + '\n');
console.log('PLAN:');
console.log(plan.join('\n'));
console.log(`\nWrote ${lines.length - 1} statements -> ${OUT}`);
