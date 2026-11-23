// The office calendar as a subscription feed (iCalendar), so it can be shown
// inside Google Calendar / a phone's calendar.
//
// One-way: the system -> the other calendar. The office gets one private link;
// Google Calendar ("Add calendar -> From URL") reads it every few hours and
// shows the office's hearings and reminders as a separate calendar. Nothing
// written in Google comes back.
//
// The link's random token is the only authorization (a calendar service cannot
// log in), so it lives in the CONTROL database next to the office it belongs
// to, and the office can replace it — the old link then stops working.

import type { Env } from './db';
import { tenantDb } from './whatsapp';
import { purgeDismissedEvents } from './dismissed';

type Row = Record<string, unknown>;
export type FeedResult = { status: number; body: unknown };

const str = (v: unknown) => String(v ?? '').trim();

let tableReady = false;
async function ensureTable(env: Env): Promise<void> {
  if (tableReady) return;
  await env.CONTROL_DB.prepare(
    `CREATE TABLE IF NOT EXISTS calendar_feed (
       tenant_id TEXT PRIMARY KEY,
       token TEXT NOT NULL UNIQUE,
       created_at TEXT NOT NULL,
       last_read_at TEXT
     )`,
  ).run();
  tableReady = true;
}

function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** The office's feed token — created on first request; `reset` replaces it. */
export async function officeFeed(env: Env, tenantId: string, reset: boolean): Promise<FeedResult> {
  await ensureTable(env);
  if (!reset) {
    const row = (await env.CONTROL_DB.prepare('SELECT token, last_read_at FROM calendar_feed WHERE tenant_id = ?1')
      .bind(tenantId)
      .first()) as Row | null;
    if (row) return { status: 200, body: { ok: true, token: row.token, last_read_at: row.last_read_at ?? null } };
  }
  const token = newToken();
  await env.CONTROL_DB.prepare(
    `INSERT INTO calendar_feed (tenant_id, token, created_at) VALUES (?1, ?2, ?3)
     ON CONFLICT(tenant_id) DO UPDATE SET token = excluded.token, created_at = excluded.created_at, last_read_at = NULL`,
  )
    .bind(tenantId, token, new Date().toISOString())
    .run();
  return { status: 200, body: { ok: true, token, last_read_at: null } };
}

// ---- iCalendar text --------------------------------------------------------

/** Escape a text value (RFC 5545 §3.3.11). */
const esc = (s: string) =>
  s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** Fold a content line to at most 75 OCTETS per physical line (§3.1); Hebrew
 *  and Arabic letters are two octets each, so the count is by bytes. */
function fold(line: string): string {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out: string[] = [];
  let cur = '';
  let bytes = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    // Continuation lines start with one space, which counts toward the 75.
    if (bytes + n > (out.length ? 74 : 75)) {
      out.push(cur);
      cur = '';
      bytes = 0;
    }
    cur += ch;
    bytes += n;
  }
  if (cur) out.push(cur);
  return out.join('\r\n ');
}

const pad = (n: number) => String(n).padStart(2, '0');
const utcStamp = (d: Date) =>
  `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
const dayStamp = (d: Date) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;

const TYPE_LABEL: Record<string, string> = {
  hearing: 'דיון',
  hearingmeeting: 'דיון / פגישה',
  meeting: 'פגישה',
  reminder: 'תזכורת משרדית',
  deadline: 'מועד אחרון',
};

function eventLines(e: Row, stamp: string): string[] {
  const raw = str(e.date_time);
  const allDay = /^\d{4}-\d{2}-\d{2}$/.test(raw);
  const start = new Date(allDay ? raw + 'T00:00:00Z' : raw);
  if (!raw || isNaN(start.getTime())) return [];

  const title = str(e.title) || str(e.title_ar) || TYPE_LABEL[str(e.type).toLowerCase()] || 'מועד';
  const client = str(e.client_name) || str(e.client_name_ar);
  // The client's name goes in the heading unless the title already carries it.
  const summary = client && !title.includes(client) ? `${title} – ${client}` : title;

  const court = str(e.court) || str(e.court_ar);
  const caseTitle = str(e.case_title) || str(e.case_title_ar);
  const caseNumber = str(e.case_number);
  const details = [
    TYPE_LABEL[str(e.type).toLowerCase()] ? 'סוג: ' + TYPE_LABEL[str(e.type).toLowerCase()] : '',
    client ? 'לקוח: ' + client : '',
    caseTitle ? 'תיק: ' + caseTitle : '',
    caseNumber ? 'מספר תיק בבית המשפט: ' + caseNumber : '',
    court ? 'בית משפט: ' + court : '',
    str(e.case_source_id) ? 'מספר תיק במשרד: ' + str(e.case_source_id) : '',
    str(e.description) || str(e.description_ar),
  ].filter(Boolean);

  const lines = [
    'BEGIN:VEVENT',
    'UID:' + esc(str(e.source_id) || str(e.id)) + '@legal-office-calendar',
    'DTSTAMP:' + stamp,
  ];
  if (allDay) {
    lines.push('DTSTART;VALUE=DATE:' + dayStamp(start));
    lines.push('DTEND;VALUE=DATE:' + dayStamp(new Date(start.getTime() + 86_400_000)));
  } else {
    lines.push('DTSTART:' + utcStamp(start));
    lines.push('DTEND:' + utcStamp(new Date(start.getTime() + 3_600_000)));
  }
  const updated = new Date(str(e.updated_at));
  if (!isNaN(updated.getTime())) lines.push('LAST-MODIFIED:' + utcStamp(updated));
  lines.push('SUMMARY:' + esc(summary));
  if (details.length) lines.push('DESCRIPTION:' + esc(details.join('\n')));
  if (court) lines.push('LOCATION:' + esc(court));
  lines.push('END:VEVENT');
  return lines;
}

/** The feed itself, for the calendar service holding the link. */
export async function calendarFeedResponse(env: Env, token: string): Promise<Response> {
  const notFound = new Response('Not found', { status: 404 });
  if (!/^[0-9a-f]{48}$/.test(token)) return notFound;
  await ensureTable(env);
  const feed = (await env.CONTROL_DB.prepare('SELECT tenant_id FROM calendar_feed WHERE token = ?1').bind(token).first()) as Row | null;
  if (!feed) return notFound;
  const tenantId = str(feed.tenant_id);
  const db = await tenantDb(env, tenantId);
  if (!db) return notFound;

  // An entry the office deleted must not reach Google either (dismissed.ts).
  await purgeDismissedEvents(db, tenantId).catch(() => 0);

  // Everything from a year back onwards — an old hearing is still worth seeing,
  // a calendar of every past year is not.
  const since = new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10);
  const rs = await db
    .prepare(
      `SELECT e.id, e.source_id, e.case_source_id, e.title, e.title_ar, e.date_time,
              e.description, e.description_ar, e.type, e.updated_at,
              c.title AS case_title, c.title_ar AS case_title_ar, c.case_number, c.court, c.court_ar,
              cl.full_name AS client_name, cl.full_name_ar AS client_name_ar
         FROM calendar_events e
         LEFT JOIN cases c ON c.user_id = e.user_id AND c.source_id = e.case_source_id
         LEFT JOIN clients cl ON cl.user_id = e.user_id AND cl.source_id = COALESCE(NULLIF(e.client_source_id, ''), c.client_source_id)
        WHERE e.user_id = ?1 AND e.date_time >= ?2
        ORDER BY e.date_time ASC
        LIMIT 3000`,
    )
    .bind(tenantId, since)
    .all();

  const stamp = utcStamp(new Date());
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Legal Office//Office Calendar//HE',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:יומן המשרד',
    'X-WR-TIMEZONE:Asia/Jerusalem',
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
    'X-PUBLISHED-TTL:PT1H',
  ];
  for (const e of (rs.results ?? []) as Row[]) lines.push(...eventLines(e, stamp));
  lines.push('END:VCALENDAR');

  // When the calendar service last fetched the link — shown to the office as
  // "connected". Kept to one write an hour.
  await env.CONTROL_DB.prepare(
    'UPDATE calendar_feed SET last_read_at = ?1 WHERE token = ?2 AND (last_read_at IS NULL OR last_read_at < ?3)',
  )
    .bind(new Date().toISOString(), token, new Date(Date.now() - 3_600_000).toISOString())
    .run()
    .catch(() => undefined);

  return new Response(lines.map(fold).join('\r\n') + '\r\n', {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'inline; filename="office-calendar.ics"',
      'Cache-Control': 'private, max-age=300',
    },
  });
}
