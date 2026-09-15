// Hearing dates read off the office's OWN documents — the app's safety net
// against a missing calendar entry.
//
// WHY THIS EXISTS
// ---------------
// Until now a hearing reached the calendar from exactly one writer: the make.com
// pipeline, which parses a document and POSTs a `calendar_events` row (source_id
// = "<dropbox path>-hearing"). Whenever that pipeline doesn't fire for a
// document — it errors, it doesn't handle that document type, or it runs before
// the document is linked to its case — NOTHING in the app notices. The case then
// keeps showing an OLD hearing (the case-detail card even labels a past date as
// "the NEXT hearing"), and the new date is missing from the calendar entirely.
// That is exactly what happened to case 5886/2026: "הזמנה לדיון ליום 09082026"
// was filed with a summary that states the hearing is on 09/08/2026 at 11:00,
// but no calendar event was ever created for it.
//
// The app already holds everything needed to catch this: every document carries
// its AI summary (documents.summary_he / summary_ar) and its case link. So we
// read the hearing straight off the document and file the event ourselves, for
// EVERY case — the pipeline stays the primary writer, this is the backstop.
//
// PRECISION RULES (a wrong hearing is worse than a missing one)
//   • A date only counts when the words AROUND it say the parties must appear /
//     that a session was scheduled ("להתייצב", "נקבע הדיון ליום", "الحضور",
//     "الجلسة القادمة"). Cue scoring runs over a window before each date.
//   • Dates introduced by "שנקבע ל…", "המחددة في…", "صادر بتاريخ…", "מיום…" are
//     the OLD / issue date and are scored DOWN, so a decision that postpones a
//     hearing files the NEW date, never the one it moved away from.
//   • The office's file-naming convention ("… לדיון ליום 09082026") corroborates
//     a day — unless the name itself says postponement/cancellation, where that
//     date is the old one.
//   • Only today-or-future hearings are filed. Back-filling old sessions would
//     flood the calendar with history nobody acted on.
//   • Deduplicated per (case, day) against what's already in the calendar, and
//     per persisted import key, so a hearing the user deleted never returns.

import { calendarDateValue, officeDateTimeToIso } from './dates';
import { isHearingImportNote } from './calendar';
import { decisionDateIsFilingDeadline } from './summary';
import type { CalendarEvent, Case, DocumentRecord } from '@/types';

/** A hearing stated by a single document. */
export interface DocumentHearing {
  /** Office-local calendar day, YYYY-MM-DD. */
  day: string;
  /** HH:MM as written in the document; '' when it gives only a date. */
  time: string;
  /** Which kind of document said so — drives the calendar note. */
  source: 'invitation' | 'decision';
}

// The calendar notes. Identical strings to the ones the Worker writes in
// consolidateHearings(), so an app-filed hearing and a pipeline-filed one are
// indistinguishable on screen (and both satisfy isHearingImportNote).
export const HEARING_FROM_INVITATION_HE =
  'מועד זה יובא מהזמנה לדיון על ידי הבינה המלאכותית (AI).';
export const HEARING_FROM_INVITATION_AR =
  'أُدرج هذا الموعد من دعوة/تبليغ لجلسة بواسطة الذكاء الاصطناعي (AI).';
export const HEARING_FROM_DECISION_HE =
  'מועד הדיון יובא מהחלטה שיפוטית על ידי הבינה המלאכותית (AI).';
export const HEARING_FROM_DECISION_AR =
  'أُدرج موعد الجلسة من قرار قضائي بواسطة الذكاء الاصطناعي (AI).';

// The office's default hearing hour (Asia/Jerusalem) when a document gives a
// date but no time — the same default the rest of the app uses, and the same one
// the make.com pipeline files. Because it doubles as "the time is unknown", it is
// also the ONLY clock value a time correction is allowed to overwrite (see
// planHearingImports): an event already showing 11:30 was set by something that
// knew better than a default, so it stands.
const DEFAULT_HEARING_TIME = '09:00';

// ---------------------------------------------------------------------------
// Cue vocabulary
// ---------------------------------------------------------------------------

/** Phrases that SCHEDULE a session / order an appearance. Weight +2 each, and
 *  their presence is what makes a date a hearing at all. */
const SCHEDULE_CUES: RegExp[] = [
  // Hebrew
  /להתייצב/,
  /להופיע\s*בפני/,
  /יתייצב/,
  /תתייצב/,
  /הזמנה\s*לדיון/,
  /זימון/,
  /נקבע[^\n]{0,25}(דיון|ישיבה|הוכחות)/,
  /קבע[^\n]{0,25}(את\s*)?ה?(דיון|ישיבה)/,
  /קביעת\s*(מועד\s*)?דיון/,
  // "מועד הדיון נקבע ל…" / "ישיבה קבועה בתאריך…" — the subject comes BEFORE the
  // verb here, which the two cues above (verb first) don't cover. Note the
  // definite "הדיון הקבוע ליום…" is an OLD-date marker, not this.
  /(דיון|ישיבה)\s*(נקבע|נקבעה|קבוע[הת]?)\s*(ל|ב|בתאריך|ביום)/,
  /ה?(דיון|ישיבה)\s*(הבא|הבאה|יתקיים|תתקיים|ייערך|תיערך)/,
  /(יתקיים|תתקיים|ייערך)[^\n]{0,15}ביום/,
  /נדח[הת][^\n]{0,25}(ליום|למועד|ל-)/,
  /מועד\s*ה?דיון\s*ה?חדש/,
  /לדיון\s*ליום/,
  // Arabic
  /الحضور/,
  /المثول/,
  /للحضور/,
  /الجلسة\s*(القادمة|المقبلة)/,
  /موعد\s*الجلسة\s*(ليوم|في|بتاريخ|إلى)/,
  /جلسة\s*(يوم|بتاريخ)/,
  /(حدد|حُدد|حُدّد|تحديد|تقرر|تقرّر)[^\n]{0,25}(ال)?جلسة/,
  // Deliberately tight: "الجلسة بتاريخ" / "جلسة يوم" are a court session, while
  // "جلسة علاج كيميائي بتاريخ" (a medical appointment quoted in the reasoning)
  // must NOT read as one.
  /(ال)?جلسة[^\n]{0,8}(ليوم|يوم\s|بتاريخ)/,
  /(أجل|أُجل|أجّل|أجلت|أُجلت|تأجلت)[^\n]{0,25}(إلى|الى|ليوم)/,
];

/** A bare "on <date>" marker. Weight +1: on its own it proves nothing (an issue
 *  date reads the same), but combined with a scheduling cue it confirms. */
const WEAK_DATE_CUES: RegExp[] = [/בתאריך/, /ביום/, /ליום/, /بتاريخ/, /يوم/, /ليوم/];

/** Phrases that mark a date as the OLD / already-past / issue date. Weight -3 —
 *  strong enough to overrule any positive cue in the same window, which is how a
 *  postponement decision ("לקדם מועד דיון שנקבע ל-10.8.2026 … וקבע את הדיון
 *  ליום 9.8.2026") files 9.8 and not 10.8. */
const OLD_DATE_CUES: RegExp[] = [
  // Hebrew
  /שנקבע\s*ל/,
  /שנקבעה\s*ל/,
  /הקבוע[הת]?\s*ל/,
  /שהיה\s*קבוע/,
  /המקורי/,
  /מיום/,
  /ניתנ[הת]\s*(ביום|בתאריך)/,
  /הוגש[הת]?\s*(ביום|בתאריך)/,
  /נחתם\s*(ביום|בתאריך)/,
  /בוטל/,
  /התקיים\s*ביום/,
  // Arabic
  /صادر[ةه]?\s*(بتاريخ|في)/,
  /صدر[ت]?\s*(بتاريخ|في)/,
  /المحدد[ةه]?\s*(في|بتاريخ)/,
  /المقرر[ةه]?\s*(في|بتاريخ)/,
  /بتاريخ\s*صدور/,
  /المؤرخ/,
  /قدم\s*بتاريخ/,
  /عقدت\s*بتاريخ/,
];

/** A date that is a deadline to FILE something is a task due-date, never a
 *  hearing. Checked in the immediate neighbourhood of the date. */
const SUBMISSION_CUES: RegExp[] = [
  /להג(י)?ש/,
  /להגשת/,
  /מועד\s*אחרון/,
  /לתגובה/,
  /لتقديم/,
  /تقديم\s*(رد|جواب|تعقيب|لائحة|مذكرة|بيان)/,
  /آخر\s*موعد/,
];

/** Document is a court SUMMONS / notice to appear (as opposed to a ruling). */
const INVITATION_RX =
  /הזמנה\s*לדיון|הזמנה\s*לבית|זימון|התייצבות|إعلان|اعلان|تبليغ|دعوة\s*لجلسة|استدعاء|إحضار|احضار/;

/** The document ANNOUNCES a change of an existing date, so a date in its NAME is
 *  the old one — only the summary may be trusted for the new date. */
const NAME_POSTPONE_RX =
  /דחיי[הת]|דחיית|נדחה|ביטול|שינוי\s*מועד|הקדמת|קדם\s*מועד|تأجيل|إلغاء|تغيير\s*موعد|تقديم\s*موعد/;

// ---------------------------------------------------------------------------
// Primitive parsers
// ---------------------------------------------------------------------------

/** `YYYY-MM-DD` for a day/month/year triple, or '' when it isn't a real date. */
function toDay(d: number, m: number, y: number): string {
  if (!d || !m || !y) return '';
  if (m < 1 || m > 12 || d < 1 || d > 31) return '';
  if (y < 2000 || y > 2100) return '';
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) {
    return '';
  }
  const pad2 = (n: number) => String(n).padStart(2, '0');
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

interface RawDate {
  day: string;
  /** Index of the match inside the text (for the cue window + time lookup). */
  at: number;
  /** Length of the matched date text. */
  len: number;
}

/** Every DD/MM/YYYY-shaped date in a text (also DD.MM.YYYY and DD-MM-YYYY).
 *  Deliberately day-first: that is how every Israeli court document writes it.
 *  A match glued to more digits (a case number like 5607/26, an id number) is
 *  rejected by the neighbour check rather than by a lookbehind, which older
 *  mobile Safari does not support. */
function findDates(text: string): RawDate[] {
  const out: RawDate[] = [];
  const rx = /(\d{1,2})[./-](\d{1,2})[./-](\d{4})/g;
  let m: RegExpExecArray | null;
  while ((m = rx.exec(text)) !== null) {
    const before = m.index > 0 ? text[m.index - 1] : '';
    const after = text[m.index + m[0].length] ?? '';
    if (/[\d./\-\\]/.test(before) || /\d/.test(after)) continue;
    const day = toDay(Number(m[1]), Number(m[2]), Number(m[3]));
    if (day) out.push({ day, at: m.index, len: m[0].length });
  }
  return out;
}

/** The compact DDMMYYYY the office uses in file names ("… לדיון ליום 09082026"),
 *  accepted only right after a day marker so an id/receipt number can't match. */
function findNameDate(name: string): string {
  const rx = /(?:ליום|ל-|ביום|בתאריך|يوم|ليوم|بتاريخ)\s*(\d{2})[./-]?(\d{2})[./-]?(\d{4})/g;
  let m: RegExpExecArray | null;
  let last = '';
  while ((m = rx.exec(name)) !== null) {
    const day = toDay(Number(m[1]), Number(m[2]), Number(m[3]));
    if (day) last = day;
  }
  return last;
}

/** `HH:MM` stated right after a date ("… 09/08/2026 בשעה 11:00"), or ''. */
function findTimeAfter(text: string, from: number): string {
  const window = text.slice(from, from + 60);
  const rx = /(\d{1,2}):(\d{2})/g;
  let m: RegExpExecArray | null;
  while ((m = rx.exec(window)) !== null) {
    const h = Number(m[1]);
    const mi = Number(m[2]);
    if (h >= 0 && h <= 23 && mi >= 0 && mi <= 59) {
      return `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
    }
  }
  return '';
}

function countCues(window: string, cues: RegExp[]): number {
  let n = 0;
  for (const rx of cues) if (rx.test(window)) n++;
  return n;
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

interface Candidate {
  day: string;
  time: string;
  score: number;
  /** At least one real scheduling cue backed this date. */
  scheduled: boolean;
}

/** Score every date in one text and return the best candidate per day. */
function candidatesFromText(text: string): Candidate[] {
  const found = findDates(text);
  if (!found.length) return [];
  const byDay = new Map<string, Candidate>();
  for (const hit of found) {
    // Words leading up to the date decide what the date IS. Scheduling cues get
    // a wide window (the verb can sit a clause away), but the "this is the OLD
    // date" markers are read ONLY from the few characters that introduce this
    // date — otherwise "הדיון הקבוע ליום 03/08 נדחה, והדיון הבא נקבע ליום
    // 10/08" would let the first clause's "הקבוע ליום" veto the NEW date too.
    const pre = text.slice(Math.max(0, hit.at - 90), hit.at);
    const preNear = text.slice(Math.max(0, hit.at - 28), hit.at);
    const near = text.slice(Math.max(0, hit.at - 40), hit.at + hit.len + 40);
    const strong = countCues(pre, SCHEDULE_CUES);
    const weak = countCues(pre, WEAK_DATE_CUES);
    const old = countCues(preNear, OLD_DATE_CUES);
    const submission = countCues(near, SUBMISSION_CUES);
    const score = strong * 2 + Math.min(weak, 1) - old * 3 - submission * 3;
    const cand: Candidate = {
      day: hit.day,
      // An hour is only believed when THIS mention actually schedules a session.
      // "אישור מסירה … ליום 01/12/2026 בשעה 11:00" times the service of process,
      // not the hearing — the day is still right (the file name confirms it), so
      // such an event keeps the 09:00 default instead of inheriting a wrong hour.
      time: strong > 0 ? findTimeAfter(text, hit.at + hit.len) : '',
      score,
      scheduled: strong > 0,
    };
    const prev = byDay.get(hit.day);
    // The same day can be mentioned twice ("הדיון שנקבע ל-9.8" … "יתקיים ב-9.8");
    // keep its BEST reading, and never lose a stated time.
    if (!prev || cand.score > prev.score) {
      byDay.set(hit.day, { ...cand, time: cand.time || prev?.time || '' });
    } else if (!prev.time && cand.time) {
      byDay.set(hit.day, { ...prev, time: cand.time });
    }
  }
  return [...byDay.values()];
}

/** The hearing a single document states, or null when it states none.
 *  Pure — no network, no clock beyond `now` (injected for tests). */
export function hearingFromDocument(
  doc: Pick<
    DocumentRecord,
    'fileName' | 'title' | 'titleAr' | 'date' | 'summaryHe' | 'summaryAr'
  >,
  now: Date = new Date(),
): DocumentHearing | null {
  const texts = [doc.summaryHe, doc.summaryAr]
    .map((t) => String(t ?? '').trim())
    .filter(Boolean);
  const name = [doc.fileName, doc.title, doc.titleAr]
    .map((t) => String(t ?? '').trim())
    .filter(Boolean)
    .join(' ');

  // Aggregate per day ACROSS both summaries: the Hebrew and the Arabic summary
  // describe the same document, so agreement between them is evidence, and a
  // clumsy translation in one language can't outvote the other.
  const merged = new Map<string, Candidate>();
  for (const text of texts) {
    for (const cand of candidatesFromText(text)) {
      const prev = merged.get(cand.day);
      if (!prev) {
        merged.set(cand.day, cand);
        continue;
      }
      merged.set(cand.day, {
        day: cand.day,
        time: prev.time || cand.time,
        score: prev.score + cand.score,
        scheduled: prev.scheduled || cand.scheduled,
      });
    }
  }

  // The file name corroborates a day — unless the name announces a POSTPONEMENT,
  // where the date in it is the session being moved, not the new one.
  const nameDay = NAME_POSTPONE_RX.test(name) ? '' : findNameDate(name);
  const nameSchedules = /דיון|ישיבה|جلسة/.test(name);
  if (nameDay && nameSchedules) {
    const prev = merged.get(nameDay);
    merged.set(nameDay, {
      day: nameDay,
      time: prev?.time || '',
      score: (prev?.score ?? 0) + 2,
      scheduled: true,
    });
  }
  if (!merged.size) return null;

  const today = calendarDateValue(now);
  const docDay = String(doc.date ?? '').slice(0, 10);
  const usable = [...merged.values()].filter(
    (c) =>
      c.scheduled &&
      c.score >= 2 &&
      c.day >= today && // a session already held needs no calendar entry
      (!docDay || c.day >= docDay), // …and never predates the document itself
  );
  if (!usable.length) return null;

  usable.sort((a, b) => (b.score !== a.score ? b.score - a.score : a.day < b.day ? -1 : 1));
  const best = usable[0];

  // Last guard: a pure filing deadline is a TASK due-date. Only applied when
  // nothing in the document orders an appearance, so a summons that also grants
  // a response period still files its hearing.
  const joined = texts.join('\n');
  const ordersAppearance =
    INVITATION_RX.test(name) ||
    /להתייצב|יתייצב|תתייצב|להופיע|الحضور|المثول|للحضور/.test(joined) ||
    /נקבע[^\n]{0,25}(דיון|ישיבה)|קבע[^\n]{0,25}ה?דיון|(דיון|ישיבה)\s*(נקבע|נקבעה|קבוע[הת]?)|الجلسة\s*(القادمة|المقبلة)|موعد\s*الجلسة/.test(
      joined,
    );
  if (!ordersAppearance && decisionDateIsFilingDeadline(joined)) return null;

  return {
    day: best.day,
    time: best.time,
    source: INVITATION_RX.test(name) || INVITATION_RX.test(joined) ? 'invitation' : 'decision',
  };
}

// ---------------------------------------------------------------------------
// Sweep planner
// ---------------------------------------------------------------------------

/** True for a hearing the app or the make.com pipeline filed automatically —
 *  the only events this module is ever allowed to adjust. A hearing the lawyer
 *  typed by hand is never touched. */
export function isAiImportedHearing(e: CalendarEvent): boolean {
  const id = String(e.id ?? '');
  return (
    isHearingImportNote(e.description) ||
    isHearingImportNote(e.descriptionAr) ||
    /-hearing$/i.test(id) ||
    /^EV-(HRG|DEC)-/i.test(id)
  );
}

/** Persisted-key namespace, shared with the case-detail decision importer so the
 *  two paths can never file the same (case, day) twice, and so a hearing the
 *  user deleted is not re-created by the other path. */
export function hearingImportKey(caseId: string, day: string): string {
  return 'hearing:' + caseId + ':' + day;
}

/** Key for a one-off time correction, so the office can still adjust the hour by
 *  hand afterwards without the sweep pulling it back. */
export function hearingTimeKey(eventId: string, day: string, time: string): string {
  return 'hearingtime:' + eventId + ':' + day + ':' + time;
}

export interface PlannedHearing {
  event: CalendarEvent;
  key: string;
  /** The document the hearing was read from (for logging / debugging). */
  documentId: string;
}

export interface PlannedRetime {
  id: string;
  dateTime: string;
  key: string;
  documentId: string;
}

export interface HearingSweepPlan {
  add: PlannedHearing[];
  retime: PlannedRetime[];
}

/** Office-local `YYYY-MM-DD` of an event instant. */
function eventDay(e: CalendarEvent): string {
  const d = new Date(e.dateTime);
  return isNaN(d.getTime()) ? '' : calendarDateValue(d);
}

/** Office-local `HH:MM` of an event instant. */
function eventTime(e: CalendarEvent): string {
  const d = new Date(e.dateTime);
  if (isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jerusalem',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(d);
}

function isHearingEvent(e: CalendarEvent): boolean {
  return String(e.type ?? '').toLowerCase().startsWith('hearing');
}

/**
 * What the calendar is missing, across ALL cases:
 *   • `add`    — a hearing a document states and no event covers yet.
 *   • `retime` — an auto-imported hearing filed on the right day at the wrong
 *                hour (the pipeline defaults to 09:00; the document may say
 *                10:30), corrected once.
 *
 * Pure: takes the current state, returns the intended changes. The caller
 * dispatches them and persists the returned keys.
 */
export function planHearingImports(opts: {
  documents: DocumentRecord[];
  events: CalendarEvent[];
  cases: Case[];
  /** Persisted import keys (lib/tasks.ts `loadDecisionImportKeys`). */
  importKeys: Set<string>;
  /** Persisted tombstones (lib/dismissedEvents.ts). */
  dismissedIds: Set<string>;
  now?: Date;
}): HearingSweepPlan {
  const { documents, events, cases, importKeys, dismissedIds } = opts;
  const now = opts.now ?? new Date();
  const add: PlannedHearing[] = [];
  const retime: PlannedRetime[] = [];
  // (case, day) already covered — by an existing event or by an earlier entry in
  // this same plan (two documents can announce the same session).
  const planned = new Set<string>();

  // Case ids reach the app as "CS-NNNN", but the external pipeline has written
  // some rows lower-case (the loader upper-cases document/event links but not
  // the case's own id), so the lookup is case-insensitive — otherwise a document
  // would silently look like it belonged to no case and file nothing.
  const caseById = new Map(cases.map((c) => [String(c.id).toUpperCase(), c]));

  // Newest documents first: when two documents of a case disagree about the same
  // day, the later filing is the one that matters.
  const ordered = [...documents].sort((a, b) => {
    const ta = new Date(a.uploadedAt || a.date || 0).getTime() || 0;
    const tb = new Date(b.uploadedAt || b.date || 0).getTime() || 0;
    return tb - ta;
  });

  for (const doc of ordered) {
    const caseId = String(doc.caseId ?? '').toUpperCase();
    if (!caseId) continue;
    const c = caseById.get(caseId);
    if (!c) continue; // a document whose case was deleted files nothing
    const hit = hearingFromDocument(doc, now);
    if (!hit) continue;

    const key = hearingImportKey(caseId, hit.day);
    const dayKey = caseId + '|' + hit.day;
    if (planned.has(dayKey)) continue;

    const existing = events.find(
      (e) =>
        String(e.caseId ?? '').toUpperCase() === caseId &&
        isHearingEvent(e) &&
        eventDay(e) === hit.day,
    );

    if (existing) {
      planned.add(dayKey);
      // Right day, hour unknown: the event sits on the 09:00 "time not known"
      // default while the document states an explicit hour (a lawyer who shows
      // up at 09:00 for an 08:30 session has a real problem). Corrected ONCE,
      // only for an auto-imported event, and only away from that default — a
      // time the lawyer set by hand, or one the pipeline actually read off the
      // PDF, is never overwritten.
      if (!hit.time || !isAiImportedHearing(existing)) continue;
      if (eventTime(existing) !== DEFAULT_HEARING_TIME) continue;
      if (eventTime(existing) === hit.time) continue;
      const tKey = hearingTimeKey(String(existing.id), hit.day, hit.time);
      if (importKeys.has(tKey)) continue;
      const iso = officeDateTimeToIso(hit.day, hit.time.slice(0, 2), hit.time.slice(3, 5));
      if (!iso) continue;
      retime.push({
        id: String(existing.id),
        dateTime: iso,
        key: tKey,
        documentId: String(doc.id),
      });
      continue;
    }

    // Never re-file a hearing this browser already filed once — the user deleted
    // it deliberately.
    if (importKeys.has(key)) continue;
    const id = 'EV-HRG-' + String(doc.id);
    if (dismissedIds.has(id)) continue;

    const iso = officeDateTimeToIso(
      hit.day,
      (hit.time || DEFAULT_HEARING_TIME).slice(0, 2),
      (hit.time || DEFAULT_HEARING_TIME).slice(3, 5),
    );
    if (!iso) continue;

    const clientId = String(doc.clientId || c.clientId || '');
    planned.add(dayKey);
    add.push({
      key,
      documentId: String(doc.id),
      event: {
        id,
        caseId,
        clientId,
        client_source_id: clientId,
        case_source_id: caseId,
        title: 'דיון',
        titleAr: 'جلسة',
        dateTime: iso,
        description:
          hit.source === 'invitation' ? HEARING_FROM_INVITATION_HE : HEARING_FROM_DECISION_HE,
        descriptionAr:
          hit.source === 'invitation' ? HEARING_FROM_INVITATION_AR : HEARING_FROM_DECISION_AR,
        type: 'hearingMeeting',
      },
    });
  }

  return { add, retime };
}
