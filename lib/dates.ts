// Date helpers ported from the source. Names preserved so screen code that
// gets ported later can call them with no changes.

import { pad } from './utils';

// ------------------------------------------------------------------ *
//  OFFICE TIMEZONE PINNING
//
//  The firm and every court it appears before are in Israel, so a hearing is
//  at a fixed Israel wall-clock time (e.g. 11:30) REGARDLESS of what device
//  displays it. Event instants are stored in the DB as true UTC (both make.com
//  and the app's own save path call `.toISOString()`), so on an Israel-time
//  machine the round-trip was already correct — but on ANY device whose clock
//  is NOT set to Israel time, machine-local rendering shifted every hearing by
//  the offset (e.g. a UTC device showed 11:30 as 09:30). We therefore pin all
//  calendar date/time DISPLAY and ENTRY to Asia/Jerusalem, so the office's
//  times are authoritative on every device. This is a no-op on a machine
//  already in Israel time (no regression) and a correction on any other.
// ------------------------------------------------------------------ */
export const OFFICE_TZ = 'Asia/Jerusalem';

/** The Asia/Jerusalem wall-clock parts of an absolute instant (DST-correct via
 *  the platform tz database). Used so every formatter reads the office-local
 *  wall clock instead of the viewing machine's. */
function officeParts(d: Date): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
} {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: OFFICE_TZ,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const m: Record<string, string> = {};
  for (const p of dtf.formatToParts(d)) if (p.type !== 'literal') m[p.type] = p.value;
  const hour = Number(m.hour) === 24 ? 0 : Number(m.hour); // h23 guards this; belt-and-braces
  return {
    year: Number(m.year),
    month: Number(m.month),
    day: Number(m.day),
    hour,
    minute: Number(m.minute),
    second: Number(m.second),
  };
}

/** `{date, hour, minute}` (padded strings) of an instant, in office time — for
 *  pre-filling the date/hour/minute inputs of the edit/appointment modals so
 *  they show the Israel wall-clock, not the machine's. */
export function officeInputParts(d: Date): { date: string; hour: string; minute: string } {
  const p = officeParts(d);
  return {
    date: `${p.year}-${pad(p.month)}-${pad(p.day)}`,
    hour: pad(p.hour),
    minute: pad(p.minute),
  };
}

/** Milliseconds Asia/Jerusalem is ahead of UTC at the given instant. */
function officeOffsetMs(d: Date): number {
  const p = officeParts(d);
  const asUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUTC - d.getTime();
}

/** Interpret a picked wall-clock (date + hour + minute) as OFFICE-LOCAL
 *  (Asia/Jerusalem) and return the matching UTC instant as an ISO string.
 *  Replaces the old `new Date(\`${date}T${hour}:${minute}\`).toISOString()`,
 *  which interpreted the wall clock in the MACHINE's timezone — wrong on any
 *  non-Israel device. DST-correct via a two-pass offset resolution. Returns ''
 *  for an invalid/empty date. */
export function officeDateTimeToIso(date: string, hour: string, minute: string): string {
  if (!date) return '';
  const [y, mo, d] = date.split('-').map(Number);
  const h = Number(hour || '0');
  const mi = Number(minute || '0');
  if (!y || !mo || !d || Number.isNaN(h) || Number.isNaN(mi)) return '';
  // Treat the wall clock as if it were UTC, then subtract the office offset at
  // that instant; refine once so a DST boundary resolves to the right side.
  const guessUtc = Date.UTC(y, mo - 1, d, h, mi, 0);
  let offset = officeOffsetMs(new Date(guessUtc));
  let instant = new Date(guessUtc - offset);
  offset = officeOffsetMs(instant);
  instant = new Date(guessUtc - offset);
  return isNaN(instant.getTime()) ? '' : instant.toISOString();
}

/** `YYYY-MM-DDTHH:MM` for a date `days` from today, in OFFICE time. Source: line 4398. */
export function localInputDate(days = 0): string {
  const base = new Date();
  base.setDate(base.getDate() + days);
  const p = officeInputParts(base);
  return `${p.date}T${p.hour}:${p.minute}`;
}

/** Current date split into pieces (OFFICE time), minutes rounded to nearest 15.
 *  Source: line 4407. */
export function localDateParts(): { date: string; hour: string; minute: string } {
  const p = officeParts(new Date());
  let hour = p.hour;
  let minutes = Math.round(p.minute / 15) * 15;
  if (minutes === 60) {
    hour = (hour + 1) % 24;
    minutes = 0;
  }
  return {
    date: `${p.year}-${pad(p.month)}-${pad(p.day)}`,
    hour: pad(hour),
    minute: pad(minutes),
  };
}

/** Combine a date `<input>` value and an hour+minute select into ISO-ish string.
 *  Source: line 4418. The original looked up DOM elements directly; here we accept
 *  the three values so the function stays render-agnostic. */
export function composeDateTime(date: string, hour: string, minute: string): string {
  if (!date) return '';
  return `${date}T${hour || '00'}:${minute || '00'}`;
}

/** Two `<option>` strings for 24 hours. Source: line 4408. */
export function hourOptions(selected: string): string {
  return Array.from({ length: 24 }, (_, i) => {
    const h = pad(i);
    return `<option value="${h}" ${h === selected ? 'selected' : ''}>${h}</option>`;
  }).join('');
}

/** Hour options clamped to a range (default 7..20). Source: line 4409. */
export function limitedHourOptions(selected: string, start = 7, end = 20): string {
  const selectedValue = Number(selected);
  const safeSelected =
    selectedValue >= start && selectedValue <= end ? pad(selectedValue) : pad(start);
  const opts: string[] = [];
  for (let i = start; i <= end; i++) {
    opts.push(`<option value="${pad(i)}" ${pad(i) === safeSelected ? 'selected' : ''}>${pad(i)}</option>`);
  }
  return opts.join('');
}

/** `00 15 30 45` minute options. Source: line 4416. */
export function minuteOptions(selected: string): string {
  return ['00', '15', '30', '45']
    .map((m) => `<option value="${m}" ${m === selected ? 'selected' : ''}>${m}</option>`)
    .join('');
}

/** All 60 minute options. Source: line 4417. */
export function minuteOptionsRegular(selected: string): string {
  return Array.from({ length: 60 }, (_, i) => pad(i))
    .map((m) => `<option value="${m}" ${m === selected ? 'selected' : ''}>${m}</option>`)
    .join('');
}

/** Are two date-like values the same calendar day (in OFFICE time, so the
 *  day-grouping matches the office-local date shown on each row)? Source:
 *  implied by name `sameCalendarDay` used at line 4102. */
export function sameCalendarDay(a: string | Date, b: string | Date): boolean {
  const pa = officeParts(a instanceof Date ? a : new Date(a));
  const pb = officeParts(b instanceof Date ? b : new Date(b));
  return pa.year === pb.year && pa.month === pb.month && pa.day === pb.day;
}

/** `YYYY-MM-DD` value for a `<input type="date">`, in OFFICE time. Source name: line 4098. */
export function calendarDateValue(d: Date): string {
  const p = officeParts(d);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/* ------------------------------------------------------------------ *
 *  Display formatters — DD.MM.YYYY, deterministic across languages.
 *
 *  The office writes dates day-first with dot separators (05.10.2026).
 *  `toLocaleDateString` gives exactly that under `he-IL`, but under any
 *  Arabic locale it swaps the separator to '/', injects invisible RTL
 *  marks (U+200F) and — depending on the browser's ICU build — can flip
 *  the order to year-first (2026.10.05). So for the numeric parts we
 *  build the string by hand: Arabic then reads identically to Hebrew.
 *  Localized weekday / month *names* still come from the locale (see
 *  `localizedWeekday`) — only the digits are formatted manually.
 * ------------------------------------------------------------------ */

/** `DD.MM.YYYY` — same output in every language, in OFFICE time. */
export function formatDMY(d: Date): string {
  const p = officeParts(d);
  return `${pad(p.day)}.${pad(p.month)}.${p.year}`;
}

/** `DD.MM` — day + month only (no year), in OFFICE time. */
export function formatDM(d: Date): string {
  const p = officeParts(d);
  return `${pad(p.day)}.${pad(p.month)}`;
}

/** `HH:MM`, 24-hour, in OFFICE time (Asia/Jerusalem) — a court hearing shows its
 *  Israel wall-clock on every device, not the viewer's local time. */
export function formatHM(d: Date): string {
  const p = officeParts(d);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

/** `DD.MM.YYYY, HH:MM` — matches he-IL's "05.10.2026, 14:30". */
export function formatDMYTime(d: Date): string {
  return `${formatDMY(d)}, ${formatHM(d)}`;
}

/** Localized weekday name only (e.g. "יום שני" / "الاثنين"). Pass the same
 *  locale you'd give toLocaleDateString (via calendarLocale(lang)). */
export function localizedWeekday(
  d: Date,
  locale: string,
  style: 'long' | 'short' = 'long',
): string {
  return d.toLocaleDateString(locale, { weekday: style, timeZone: OFFICE_TZ });
}
