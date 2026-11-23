// Calendar entries the office DELETED — remembered on the server.
//
// A deleted calendar entry used to be remembered only in the browser that
// deleted it (lib/dismissedEvents.ts). That browser hid the entry, but the row
// could stay in — or come back to — the database: another device that still
// held it saved it again, or a document pipeline filed it again. Everything
// that reads the database directly (the daily briefing, the client portal, the
// Google Calendar feed) then still showed a hearing the lawyer had deleted.
//
// So the deletion is recorded here, in the office's own database, and enforced
// on the rows themselves:
//   id:<source_id>            that exact entry
//   hearing:<CASE>|<day>      any IMPORTED hearing of that case on that day —
//                             the document stating it is still on file, so a
//                             pipeline would file it again under another id.
// A hearing the lawyer types in by hand for that day is not touched.

type Row = Record<string, unknown>;

const str = (v: unknown) => String(v ?? '').trim();

async function ensureTable(db: D1Database): Promise<void> {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS dismissed_events (
         user_id TEXT NOT NULL,
         key TEXT NOT NULL,
         created_at TEXT NOT NULL,
         PRIMARY KEY (user_id, key)
       )`,
    )
    .run();
}

/** The calendar day of an entry in Israel (a date-only value is that day). */
function israelDay(dateTime: unknown): string {
  const raw = str(dateTime);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const d = new Date(raw);
  if (!raw || isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/** Filed by a document pipeline (not typed in by the lawyer). */
const importedHearing = (r: Row) =>
  str(r.type).toLowerCase().startsWith('hearing') && /doc-\d+|-hearing$|^ev-(hrg|dec)-/i.test(str(r.source_id));

/** Record what the office deleted, then remove matching rows. */
export async function rememberDismissed(db: D1Database, tenantId: string, body: Row): Promise<{ saved: number; removed: number }> {
  await ensureTable(db);
  const keys = new Set<string>();
  for (const id of Array.isArray(body.ids) ? (body.ids as unknown[]) : []) {
    const s = str(id);
    if (s && s.length <= 200) keys.add('id:' + s);
  }
  for (const h of Array.isArray(body.hearings) ? (body.hearings as unknown[]) : []) {
    const o = (h && typeof h === 'object' ? h : {}) as Row;
    const c = str(o.caseId).toUpperCase();
    const day = str(o.day);
    if (c && c.length <= 100 && /^\d{4}-\d{2}-\d{2}$/.test(day)) keys.add('hearing:' + c + '|' + day);
  }
  const list = [...keys].slice(0, 2000);
  const now = new Date().toISOString();
  for (let i = 0; i < list.length; i += 40) {
    await db.batch(
      list
        .slice(i, i + 40)
        .map((k) =>
          db.prepare('INSERT OR IGNORE INTO dismissed_events (user_id, key, created_at) VALUES (?1, ?2, ?3)').bind(tenantId, k, now),
        ),
    );
  }
  return { saved: list.length, removed: await purgeDismissedEvents(db, tenantId) };
}

/** Remove every calendar row the office has deleted. Safe to call often: with
 *  nothing recorded it is one small query. Returns how many rows it removed. */
export async function purgeDismissedEvents(db: D1Database, tenantId: string): Promise<number> {
  let keys: string[];
  try {
    const rs = await db.prepare('SELECT key FROM dismissed_events WHERE user_id = ?1').bind(tenantId).all();
    keys = ((rs.results ?? []) as Row[]).map((r) => str(r.key));
  } catch {
    return 0; // the table does not exist yet — nothing was ever deleted
  }
  if (!keys.length) return 0;
  const ids = new Set(keys.filter((k) => k.startsWith('id:')).map((k) => k.slice(3)));
  const days = new Set(keys.filter((k) => k.startsWith('hearing:')).map((k) => k.slice(8)));

  const rs = await db
    .prepare('SELECT id, source_id, case_source_id, date_time, type FROM calendar_events WHERE user_id = ?1')
    .bind(tenantId)
    .all();
  const gone = ((rs.results ?? []) as Row[])
    .filter(
      (r) =>
        ids.has(str(r.source_id)) ||
        (importedHearing(r) && days.has(str(r.case_source_id).toUpperCase() + '|' + israelDay(r.date_time))),
    )
    .map((r) => str(r.id));
  for (let i = 0; i < gone.length; i += 50) {
    const chunk = gone.slice(i, i + 50);
    const ph = chunk.map((_, j) => '?' + (j + 2)).join(', ');
    await db.prepare(`DELETE FROM calendar_events WHERE user_id = ?1 AND id IN (${ph})`).bind(tenantId, ...chunk).run();
  }
  return gone.length;
}
