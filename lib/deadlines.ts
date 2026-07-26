// Procedural-deadline helpers for the case-brain "הצעה לפעולה" box.
//
// The legal_actions rules store a deadline as free text ("60 ימים", "30 ימים",
// "45 / 30 / 15 ימים", "פותח את ההליך", "בלא דיחוי"). These helpers turn that —
// plus the triggering document's date (the anchor the lawyer can edit) — into a
// concrete due date and a live "days remaining" countdown, so the office sees
// e.g. "נותרו 18 ימים · עד 12/08/2026" instead of a static rule string.
//
// The worker's /api/suggest-action already returns a numeric `deadline_days`
// (extracted by the model for the specific action it chose); parseDeadlineDays
// is the client-side FALLBACK for cached rows written before that field existed.

import type { Lang } from '@/types';
import { pad } from './utils';

/** Urgency band of a deadline, derived from days remaining. */
export type DeadlineUrgency = 'overdue' | 'critical' | 'warning' | 'ok';

/** Visual tone the case-brain chip maps each urgency to. */
export type DeadlineTone = 'red' | 'orange' | 'emerald';

export interface DeadlineView {
  /** Whole days the deadline runs for (e.g. 60). */
  days: number;
  /** Computed due date at local midnight. */
  dueDate: Date;
  /** `DD/MM/YYYY` label of the due date. */
  dueDateLabel: string;
  /** Signed whole calendar days from today to the due date (negative = past). */
  daysRemaining: number;
  urgency: DeadlineUrgency;
  tone: DeadlineTone;
  /** Ready-to-render chip text, e.g. "נותרו 18 ימים · עד 12/08/2026". */
  chipLabel: string;
}

/** Parse the primary number of days out of a Hebrew deadline string. Returns
 *  null for non-numeric deadlines ("פותח את ההליך", "בלא דיחוי", "ללא שיהוי",
 *  "יחד עם כתב ההגנה"). When several appear ("45 / 30 / 15 ימים",
 *  "60 ימים; רשלנות רפואית - 120 ימים") it takes the FIRST — the model-provided
 *  `deadline_days` is preferred when present, so this is only a fallback. */
export function parseDeadlineDays(deadlineText?: string | null): number | null {
  const s = String(deadlineText ?? '');
  if (!s) return null;
  // Number immediately followed (allowing spaces) by "יום" / "ימים" / "ימי".
  const m = s.match(/(\d{1,3})\s*(?:ימים|ימי|יום|أيام|يوم|days?)/);
  if (m) {
    const n = parseInt(m[1], 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  return null;
}

/** Parse a `YYYY-MM-DD` (optionally with time) into a LOCAL midnight Date.
 *  Using new Date('YYYY-MM-DD') would parse as UTC and shift the day in most
 *  timezones, so we build it from the parts explicitly. */
function localMidnightFromYmd(value?: string | null): Date | null {
  const s = String(value ?? '').trim();
  if (!s) return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const y = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10);
  const d = parseInt(m[3], 10);
  const date = new Date(y, mo - 1, d);
  return isNaN(date.getTime()) ? null : date;
}

/** Local midnight of a Date (drops the time component). */
function toLocalMidnight(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Whole calendar days from `from` to `to` (both floored to local midnight). */
function wholeDaysBetween(from: Date, to: Date): number {
  const ms = toLocalMidnight(to).getTime() - toLocalMidnight(from).getTime();
  return Math.round(ms / 86400000);
}

/** `DD/MM/YYYY` for a Date. */
export function formatDueDate(d: Date): string {
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/** Map days remaining → urgency band. */
export function urgencyForDays(daysRemaining: number): DeadlineUrgency {
  if (daysRemaining < 0) return 'overdue';
  if (daysRemaining <= 3) return 'critical';
  if (daysRemaining <= 7) return 'warning';
  return 'ok';
}

/** Chip tone for an urgency band. */
export function toneForUrgency(urgency: DeadlineUrgency): DeadlineTone {
  if (urgency === 'overdue' || urgency === 'critical') return 'red';
  if (urgency === 'warning') return 'orange';
  return 'emerald';
}

const dayWordHe = (n: number): string => (n === 1 ? 'יום' : 'ימים');
const dayWordAr = (n: number): string => (n === 1 ? 'يوم' : 'أيام');

/** "נותרו 18 ימים · עד 12/08/2026" / "עבר המועד ב-3 ימים · היה עד 09/07/2026"
 *  (and the Arabic mirror). */
export function formatCountdown(
  daysRemaining: number,
  dueDate: Date,
  lang: Lang,
): string {
  const dateLabel = formatDueDate(dueDate);
  if (lang === 'ar') {
    if (daysRemaining < 0) {
      const n = Math.abs(daysRemaining);
      return `تجاوز الموعد بـ${n} ${dayWordAr(n)} · كان حتى ${dateLabel}`;
    }
    if (daysRemaining === 0) return `اليوم آخر موعد · ${dateLabel}`;
    return `تبقّى ${daysRemaining} ${dayWordAr(daysRemaining)} · حتى ${dateLabel}`;
  }
  if (daysRemaining < 0) {
    const n = Math.abs(daysRemaining);
    return `עבר המועד ב-${n} ${dayWordHe(n)} · היה עד ${dateLabel}`;
  }
  if (daysRemaining === 0) return `היום המועד האחרון · ${dateLabel}`;
  return `נותרו ${daysRemaining} ${dayWordHe(daysRemaining)} · עד ${dateLabel}`;
}

/** Build the full deadline view for the case-brain chip. Returns null when the
 *  deadline has no numeric day count, or there is no anchor date to count from.
 *  `deadlineDays` (from the worker) wins; otherwise we parse `deadlineText`. */
export function buildDeadlineView(opts: {
  anchorDate?: string | null;
  deadlineDays?: number | null;
  deadlineText?: string | null;
  lang: Lang;
  /** Injectable "now" for testing; defaults to the current date. */
  now?: Date;
}): DeadlineView | null {
  const { anchorDate, deadlineDays, deadlineText, lang, now } = opts;
  const days =
    typeof deadlineDays === 'number' && deadlineDays > 0
      ? Math.round(deadlineDays)
      : parseDeadlineDays(deadlineText);
  if (!days || days <= 0) return null;
  const anchor = localMidnightFromYmd(anchorDate);
  if (!anchor) return null;

  const dueDate = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() + days);
  const today = now ? toLocalMidnight(now) : toLocalMidnight(new Date());
  const daysRemaining = wholeDaysBetween(today, dueDate);
  const urgency = urgencyForDays(daysRemaining);
  return {
    days,
    dueDate,
    dueDateLabel: formatDueDate(dueDate),
    daysRemaining,
    urgency,
    tone: toneForUrgency(urgency),
    chipLabel: formatCountdown(daysRemaining, dueDate, lang),
  };
}
