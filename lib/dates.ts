// Date helpers ported from the source. Names preserved so screen code that
// gets ported later can call them with no changes.

import { pad } from './utils';

/** `YYYY-MM-DDTHH:MM` for a date `days` from today. Source: line 4398. */
export function localInputDate(days = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Current date split into pieces, with minutes rounded to nearest 15.
 *  Source: line 4407. */
export function localDateParts(): { date: string; hour: string; minute: string } {
  const d = new Date();
  let minutes = Math.round(d.getMinutes() / 15) * 15;
  if (minutes === 60) {
    d.setHours(d.getHours() + 1);
    minutes = 0;
  }
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    hour: pad(d.getHours()),
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

/** Are two date-like values the same calendar day? Source: implied by name
 *  `sameCalendarDay` used at line 4102. */
export function sameCalendarDay(a: string | Date, b: string | Date): boolean {
  const da = a instanceof Date ? a : new Date(a);
  const db = b instanceof Date ? b : new Date(b);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}

/** `YYYY-MM-DD` value for a `<input type="date">`. Source name: line 4098. */
export function calendarDateValue(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
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

/** `DD.MM.YYYY` — same output in every language. */
export function formatDMY(d: Date): string {
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
}

/** `DD.MM` — day + month only (no year). */
export function formatDM(d: Date): string {
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}`;
}

/** `HH:MM`, 24-hour. */
export function formatHM(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
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
  return d.toLocaleDateString(locale, { weekday: style });
}
