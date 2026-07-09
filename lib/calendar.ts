// Calendar helpers. Ports of source 4067-4106 + 4307-4310. Names preserved so ver 3sion of calendar modals can read directly from source without needing to import this module.
// porting the calendar modals in Stage 4b-4 reads directly from the source.

import { calendarDateValue, sameCalendarDay } from './dates';
import { caseName, clientName } from './cases';
import type {
  CalendarEvent,
  Case,
  Client,
  Lang,
  TimelineItem,
} from '@/types';

export type CalendarView = 'day' | 'week' | 'month' | 'list';

export interface CalendarItem {
  item: CalendarEvent | TimelineItem;
  date: Date;
  source: 'event' | 'task';
}

/** Source line 4067. v3 */
export function calendarText(key: string, lang: Lang): string {
  const labels: Record<Lang, Record<string, string>> = {
    he: {
      day: 'יומית',
      week: 'שבועית',
      month: 'חודשית',
      list: 'רשימה',
      today: 'היום',
      thisWeek: 'השבוע הנוכחי',
      thisMonth: 'החודש הנוכחי',
      allUpcoming: 'כל האירועים והמשימות',
      noItems: 'אין אירועים או משימות להצגה',
    },
    ar: {
      day: 'يومي',
      week: 'أسبوعي',
      month: 'شهري',
      list: 'قائمة',
      today: 'اليوم',
      thisWeek: 'الأسبوع الحالي',
      thisMonth: 'الشهر الحالي',
      allUpcoming: 'كل الأحداث والمهام',
      noItems: 'لا توجد أحداث أو مهام للعرض',
    },
  };
  return labels[lang]?.[key] || labels.he[key] || key;
}

/** Source line 4068. */
export function weekdayNames(lang: Lang, full = false): string[] {
  if (lang === 'ar') {
    return full
      ? ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت']
      : ['أحد', 'إثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة', 'سبت'];
  }
  return full
    ? ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת']
    : ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'];
}

/** Source line 4069. The `-u-nu-latn` Unicode extension forces
 *  Western Arabic numerals (0-9) in both languages — without it
 *  `ar-EG` would format dates/times/numbers with Eastern Arabic
 *  numerals (٠١٢٣٤٥٦٧٨٩) which the firm does not use. */
export function calendarLocale(lang: Lang): string {
  return lang === 'ar' ? 'ar-EG-u-nu-latn' : 'he-IL-u-nu-latn';
}

/** Source line 4308. */
export function eventTypeLabel(type: string, lang: Lang, t: (k: string) => string): string {
  if (type === 'hearingMeeting') return lang === 'ar' ? 'جلسة/اجتماع' : 'דיון';
  if (type === 'hearing') return t('hearing');
  if (type === 'meeting') return t('meeting');
  if (type === 'task') return t('task');
  if (type === 'call') return t('call');
  if (type === 'note') return t('note');
  if (type === 'document') return t('document');
  return t('events');
}

/** Source line 4070. */
export function calendarHearingNatureFallback(
  item: { id?: string } | null | undefined,
  lang: Lang,
): string {
  const naturesHe = ['דיון מקדמי', 'דיון הוכחות', 'סיכומים בעל פה', 'פגישה עם הלקוח'];
  const naturesAr = ['جلسة تمهيدية', 'جلسة إثباتات', 'تلخيصات شفوية', 'اجتماع مع الموكل'];
  const list = lang === 'ar' ? naturesAr : naturesHe;
  const id = String(item?.id || '');
  const m = id.match(/EV-H-(\d+)/);
  if (m) return list[(Number(m[1]) - 1) % list.length];
  return list[0];
}

/** Source line 4079. */
/** True when a piece of text is one of the AI import/merge notes we attach to
 *  hearings ("מועד זה יובא…" / "מועד זה אוחד…"). Used so the calendar row can
 *  render the note as a SECONDARY line and put the case details on top instead
 *  of letting the note become the event's bold title. */
export function isHearingImportNote(text: string | undefined | null): boolean {
  return /מועד זה יובא|מועד הדיון יובא|מועד זה אוחד|أُدرج هذا الموعد|أُدرج موعد الجلسة|دُمج هذا الموعد/.test(
    String(text ?? ''),
  );
}

/** True when a piece of text looks like the CONTENT / summary of a judicial
 *  decision or protocol (as opposed to one of our clean import notes). Used as a
 *  display guard so a hearing's calendar line NEVER shows decision content even
 *  if a stale event still carries it — we show a clean "imported from a decision
 *  by the AI" note instead. */
function looksLikeDecisionContent(text: string | undefined | null): boolean {
  const t = String(text ?? '').trim();
  if (!t || isHearingImportNote(t)) return false;
  return (
    t.length > 60 ||
    /החלט|בית המשפט|בית הדין|פסק[- ]?דין|פרוטוקול|قرر|المحكمة|المحكمه|حكم|محضر/.test(t)
  );
}

/** The calendar's SECOND line for an event. For an AI-imported hearing it is the
 *  clean import note; if a hearing still carries the decision's content/summary
 *  it is replaced with a canonical "imported from a judicial decision by the AI"
 *  note — the decision content is never shown in the calendar. Other events show
 *  their nature/title. */
export function calendarSecondaryLine(
  item: CalendarEvent | TimelineItem,
  lang: Lang,
): string {
  const title = calendarItemTitle(item, lang);
  const type = String(item.type ?? '');
  if (!['hearing', 'hearingMeeting', 'meeting'].includes(type)) return title;
  const descHe = String((item as CalendarEvent).description ?? '');
  const descAr = String((item as CalendarEvent).descriptionAr ?? '');
  // A clean import/merge note is already present → show it as-is.
  if (
    isHearingImportNote(title) ||
    isHearingImportNote(descHe) ||
    isHearingImportNote(descAr)
  ) {
    return title;
  }
  // Decision/protocol content leaked into the event → show a clean note instead.
  if (
    looksLikeDecisionContent(title) ||
    looksLikeDecisionContent(descHe) ||
    looksLikeDecisionContent(descAr)
  ) {
    return lang === 'ar'
      ? 'أُدرج موعد الجلسة من قرار قضائي بواسطة الذكاء الاصطناعي (AI).'
      : 'מועד הדיון יובא מהחלטה שיפוטית על ידי הבינה המלאכותית (AI).';
  }
  return title;
}

export function calendarItemTitle(
  item: CalendarEvent | TimelineItem,
  lang: Lang,
): string {
  const raw =
    lang === 'ar' ? item.titleAr || item.title : item.title || item.titleAr;
  const desc =
    lang === 'ar'
      ? item.descriptionAr || item.description
      : item.description || item.descriptionAr;
  if (['hearingMeeting', 'hearing', 'meeting'].includes(String(item.type ?? ''))) {
    const generic = [
      'דיון',
      'פגישה',
      'דיון/פגישה',
      'جلسة/اجتماع',
      'جلسة',
      'اجتماع',
      'hearingMeeting',
      'hearing',
      'meeting',
    ];
    if (desc && !generic.includes(String(desc).trim())) return String(desc);
    if (raw && !generic.includes(String(raw).trim())) return String(raw);
    return calendarHearingNatureFallback(item, lang);
  }
  return raw ?? '';
}

/** Source line 4090. */
export function calendarCaseParts(
  caseId: string | undefined,
  cases: Case[],
  clients: Client[],
  lang: Lang,
): { client: string; caseType: string; court: string; caseNumber: string } {
  const c = cases.find((x) => x.id === caseId);
  if (!c) {
    return {
      client: lang === 'ar' ? 'بدون موكل' : 'ללא לקוח',
      caseType: '-',
      court: '-',
      caseNumber: '-',
    };
  }
  const court = lang === 'ar' ? c.courtAr || c.court : c.court || c.courtAr;
  return {
    client: clientName(c.clientId, clients, lang) || '-',
    caseType: caseName(c, lang) || '-',
    court: court || '-',
    caseNumber: c.caseNumber || '-',
  };
}

/** The calendar's FIRST (bold) line for EVERY event: client · case type · court
 *  · case number, joined with " · " (empty "-" placeholders dropped). Falls
 *  back to `fallback` (the event nature) only when the item has no case. This
 *  is used across all calendar views so the case details are always on top and
 *  the event nature / AI-import note sits on the second line. */
export function calendarCaseLine(
  parts: { client: string; caseType: string; court: string; caseNumber: string },
  fallback: string,
): string {
  return (
    [parts.client, parts.caseType, parts.court, parts.caseNumber]
      .filter((p) => p && p !== '-')
      .join(' · ') || fallback
  );
}

/** Source line 4307. */
export function itemDateForAgenda(
  item: (CalendarEvent | TimelineItem) & { dueDateTime?: string },
): Date | null {
  const raw =
    item.type === 'task' && item.dueDateTime ? item.dueDateTime : (item as CalendarEvent).dateTime;
  return raw ? new Date(raw) : null;
}

/** Source line 4309. */
export function agendaTimeKey(date: Date | null | undefined): string {
  if (!date || isNaN(date.getTime())) return '';
  const d = new Date(date);
  d.setSeconds(0, 0);
  return d.toISOString().slice(0, 16);
}

/** Source line 4094. Merges events + tasks-from-timeline into a single sorted list. */
export function calendarAllItems(
  events: CalendarEvent[],
  timeline: TimelineItem[],
): CalendarItem[] {
  const fromEvents: CalendarItem[] = events.map((e) => ({
    item: e,
    date: itemDateForAgenda(e as CalendarEvent & { dueDateTime?: string }) ?? new Date(e.dateTime),
    source: 'event',
  }));
  const fromTasks: CalendarItem[] = timeline
    .filter((x) => x.type === 'task')
    .map((x) => {
      const ti = x as TimelineItem & { dueDateTime?: string; dueDate?: string };
      const raw = ti.dueDateTime || ti.dueDate || x.date || '';
      return {
        item: x,
        date: raw ? new Date(raw) : new Date(NaN),
        source: 'task' as const,
      };
    })
    .filter((x) => x.date && !isNaN(x.date.getTime()));
  const seen = new Set<string>();
  return [...fromEvents, ...fromTasks]
    .filter((x) => x.date && !isNaN(x.date.getTime()))
    .filter((x) => {
      const key = `${x.source}-${x.item.id || ''}-${x.item.caseId || ''}-${x.date.toISOString()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.date.getTime() - b.date.getTime());
}

/** Source line 4310. Items in the future, deduplicated against task events,
 *  capped at 40. */
export function upcomingAgendaItems(
  events: CalendarEvent[],
  timeline: TimelineItem[],
): CalendarItem[] {
  const now = new Date();
  const eventItems: CalendarItem[] = events
    .filter((e) => ['hearingMeeting', 'hearing', 'meeting', 'task'].includes(String(e.type ?? '')))
    .map((e) => ({
      item: e,
      date: itemDateForAgenda(e as CalendarEvent & { dueDateTime?: string }) ?? new Date(NaN),
      source: 'event' as const,
    }));
  const eventTaskKeys = new Set(
    events
      .filter((e) => e.type === 'task')
      .map(
        (e) =>
          `${e.caseId || ''}|${String(e.title || e.titleAr || '').trim()}|${(e as { dueDateTime?: string }).dueDateTime || ''}`,
      ),
  );
  const timelineTaskItems: (CalendarItem & { key: string })[] = timeline
    .filter((x) => x.type === 'task')
    .map((x) => {
      const ti = x as TimelineItem & {
        dueDateTime?: string;
        dueDate?: string;
        dateTime?: string;
      };
      const due = ti.dueDateTime || ti.dueDate || ti.dateTime || x.date || '';
      const normalizedDue = due ? new Date(due).toISOString() : '';
      return {
        item: {
          ...x,
          type: 'task',
          dateTime: due,
          dueDateTime: due,
          id: x.id || `TLTASK-${Math.random().toString(36).slice(2)}`,
        } as CalendarEvent & { dueDateTime?: string },
        date: due ? new Date(due) : new Date(NaN),
        source: 'task' as const,
        key: `${x.caseId || ''}|${String(x.title || x.titleAr || '').trim()}|${normalizedDue}`,
      };
    })
    .filter((x) => !eventTaskKeys.has(x.key));
  return [...eventItems, ...timelineTaskItems]
    .filter((x) => x.date && !isNaN(x.date.getTime()) && x.date >= now)
    .sort((a, b) => a.date.getTime() - b.date.getTime())
    .slice(0, 40);
}

/** Source line 4099. */
export function calendarRangeTitle(
  focus: Date,
  view: CalendarView,
  lang: Lang,
): string {
  const d = new Date(focus);
  if (view === 'day') {
    return d.toLocaleDateString(calendarLocale(lang), {
      weekday: 'long',
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    });
  }
  if (view === 'week') {
    const start = new Date(d);
    start.setDate(d.getDate() - d.getDay());
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    return (
      start.toLocaleDateString(calendarLocale(lang), {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      }) +
      ' - ' +
      end.toLocaleDateString(calendarLocale(lang), {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      })
    );
  }
  if (view === 'month') {
    return d.toLocaleDateString(calendarLocale(lang), {
      month: 'long',
      year: 'numeric',
    });
  }
  return calendarText('allUpcoming', lang);
}

/** Source line 4100. Shifts focus by ±1 unit of the current view. */
export function shiftCalendar(
  focus: Date,
  view: CalendarView,
  delta: number,
): Date {
  const d = new Date(focus);
  if (view === 'day') d.setDate(d.getDate() + delta);
  else if (view === 'week') d.setDate(d.getDate() + delta * 7);
  else if (view === 'month') d.setMonth(d.getMonth() + delta);
  else d.setDate(d.getDate() + delta * 7);
  return d;
}

export { calendarDateValue, sameCalendarDay };

/**
 * Find an existing event whose dateTime is within ±windowMinutes of the
 * candidate dateTime. Used by the "new event" flow to warn the user about a
 * scheduling conflict before saving. Excludes `excludeId` so editing an event
 * doesn't flag the event-being-edited as colliding with itself.
 */
export function findConflictingEvent(
  candidateIso: string,
  events: CalendarEvent[],
  windowMinutes = 30,
  excludeId?: string,
): CalendarEvent | null {
  const candidate = new Date(candidateIso).getTime();
  if (!Number.isFinite(candidate)) return null;
  const windowMs = windowMinutes * 60 * 1000;
  for (const ev of events) {
    if (excludeId && String(ev.id) === String(excludeId)) continue;
    if (!ev.dateTime) continue;
    const evTime = new Date(ev.dateTime).getTime();
    if (!Number.isFinite(evTime)) continue;
    if (Math.abs(evTime - candidate) <= windowMs) return ev;
  }
  return null;
}

/** Format a conflict warning string with the existing event's title + date/time. */
export function conflictWarningMessage(
  existing: CalendarEvent,
  lang: Lang,
): string {
  const dt = new Date(existing.dateTime || '');
  const dateStr = Number.isFinite(dt.getTime())
    ? dt.toLocaleString(lang === 'ar' ? 'ar-IL-u-nu-latn' : 'he-IL-u-nu-latn', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : (existing.dateTime || '');
  const title =
    (lang === 'ar' ? existing.titleAr || existing.title : existing.title || existing.titleAr) ||
    (lang === 'ar' ? '(بدون عنوان)' : '(ללא כותרת)');
  if (lang === 'ar') {
    return (
      'يوجد موعد سابق في اليومية يتعارض مع الموعد الجديد:\n\n' +
      `• العنوان: ${title}\n` +
      `• التاريخ والوقت: ${dateStr}\n\n` +
      'هل تريد المتابعة على أي حال؟'
    );
  }
  return (
    'יש מועד קודם ביומן שמתנגש עם המועד החדש:\n\n' +
    `• כותרת: ${title}\n` +
    `• תאריך ושעה: ${dateStr}\n\n` +
    'האם להמשיך בכל זאת?'
  );
}
