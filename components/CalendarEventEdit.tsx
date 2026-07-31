'use client';

import { useState, type FormEvent } from 'react';
import { useAppState } from '@/hooks/useAppState';
import { useModalStack } from '@/hooks/useModalStack';
import { useT } from '@/hooks/useT';
import { calendarItemTitle, findConflictingEvent } from '@/lib/calendar';
import { useConflictConfirm } from '@/hooks/useConflictConfirm';
import { useDeleteConfirm } from '@/hooks/useDeleteConfirm';
import { caseName, clientName } from '@/lib/cases';
import { removeTaskEverywhere } from '@/lib/tasks';
import { rememberDismissedEventId } from '@/lib/dismissedEvents';
import { officeInputParts, officeDateTimeToIso } from '@/lib/dates';
import { pad } from '@/lib/utils';
import { Modal } from './Modal';
import { CalendarEventDetail } from './CalendarEventDetail';
import type { CalendarEvent, TimelineItem } from '@/types';

/**
 * Port of showCalendarEdit (source line 4367) + saveCalendarEdit (4375).
 *
 * Edits either:
 *   - a calendar event (source==='event') — writes to eventsList[].dateTime/title/etc
 *   - a timeline-task (source==='task') — writes to timelineItems[].dueDateTime/etc
 *
 * The "nature" select stamps both `title` (Hebrew canonical) and `titleAr`
 * (Arabic translation lookup). Saving updates calendarFocusDate so the
 * calendar view re-centers on the edited date.
 */

const NATURE_AR_MAP: Record<string, string> = {
  'דיון מקדמי': 'جلسة تمهيدية',
  'דיון הוכחות': 'جلسة إثباتات',
  'סיכומים בעל פה': 'تلخيصات شفوية',
  'פגישה עם הלקוח': 'اجتماع مع الموكل',
  'תזכורת': 'تذكير',
};

const HOURS = Array.from({ length: 24 }, (_, h) => pad(h));
// Quarter-hour steps, matching the "new appointment" modal (minuteOptions).
const MINUTE_STEPS = ['00', '15', '30', '45'];

export interface CalendarEventEditProps {
  source: 'event' | 'task';
  id: string;
}

export function CalendarEventEdit({ source, id }: CalendarEventEditProps) {
  const { state, dispatch } = useAppState();
  const { t, lang } = useT();
  const modalStack = useModalStack();
  const confirmConflict = useConflictConfirm();
  const confirmDelete = useDeleteConfirm();

  const onDeleteItem = async () => {
    const ok = await confirmDelete(
      source === 'event'
        ? lang === 'ar'
          ? 'هل تريد حذف هذا الموعد؟'
          : 'האם למחוק את המועד?'
        : lang === 'ar'
          ? 'هل تريد حذف هذا البند؟'
          : 'האם למחוק את הפריט?',
    );
    if (!ok) return;
    if (source === 'event') {
      // Tombstone the event so it can't resurrect (a lingering D1 row that
      // outlives the delete/poll race, or a make.com re-import) — it's filtered
      // out on every subsequent load. See lib/dismissedEvents.ts.
      rememberDismissedEventId(String(id));
      dispatch({
        type: 'SET_EVENTS',
        events: state.eventsList.filter((e) => String(e.id) !== String(id)),
      });
    } else {
      const item = state.timelineItems.find((ti) => String(ti.id) === String(id));
      if (item?.type === 'task') {
        // A task: clear every copy (tasksArr record + timeline twin) so it
        // disappears from all screens, not just the timeline.
        const next = removeTaskEverywhere(
          String(id),
          state.tasksArr,
          state.timelineItems,
        );
        dispatch({ type: 'SET_TASKS', tasks: next.tasks });
        dispatch({ type: 'SET_TIMELINE', timeline: next.timeline });
      } else {
        dispatch({
          type: 'SET_TIMELINE',
          timeline: state.timelineItems.filter(
            (ti) => String(ti.id) !== String(id),
          ),
        });
      }
    }
    modalStack.closeAll();
  };

  const item: CalendarEvent | TimelineItem | undefined =
    source === 'task'
      ? state.timelineItems.find((x) => String(x.id) === String(id))
      : state.eventsList.find((x) => String(x.id) === String(id));

  // Hooks below must run before the `if (!item)` early return (Rules of Hooks),
  // so the initial values are derived null-safely from `item`.
  const initialRaw = !item
    ? undefined
    : source === 'task'
      ? (item as TimelineItem & { dueDateTime?: string; dueDate?: string }).dueDateTime ||
        (item as TimelineItem & { dueDate?: string }).dueDate ||
        (item as TimelineItem).date
      : (item as CalendarEvent).dateTime || (item as CalendarEvent & { date?: string }).date;
  const initialDate = initialRaw ? new Date(initialRaw) : new Date();
  // Pre-fill the date/hour/minute inputs with the event's OFFICE-time wall clock
  // (Asia/Jerusalem), not the viewing machine's, so editing on any device shows
  // — and keeps — the real Israel hearing time.
  const initialParts = officeInputParts(initialDate);
  // Offer the four quarter-hour steps, but keep the event's real minute as an
  // extra option when it's off-grid (e.g. an AI-imported :23) so opening the
  // edit form never silently snaps — and loses — the stored hearing time.
  const minuteChoices = MINUTE_STEPS.includes(initialParts.minute)
    ? MINUTE_STEPS
    : [...MINUTE_STEPS, initialParts.minute].sort();

  const [dateStr, setDateStr] = useState(initialParts.date);
  const [hour, setHour] = useState(initialParts.hour);
  const [minute, setMinute] = useState(initialParts.minute);
  // The canonical nature is stored in `title`; use it directly when it's a known
  // nature (covers client-less reminders/meetings whose description holds the
  // contact name — calendarItemTitle would otherwise return that name). Fall
  // back to calendarItemTitle for AI-imported hearings whose title isn't a nature.
  const rawTitle = String(item?.title ?? '');
  const [nature, setNature] = useState(
    NATURE_AR_MAP[rawTitle]
      ? rawTitle
      : (item ? calendarItemTitle(item, lang) : '') || 'דיון מקדמי',
  );
  const [caseId, setCaseId] = useState(item?.caseId || '');
  const [description, setDescription] = useState(
    lang === 'ar'
      ? item?.descriptionAr || item?.description || ''
      : item?.description || item?.descriptionAr || '',
  );

  if (!item) return null;

  const close = () => modalStack.close(modalStack.topId() ?? 0);
  const backToDetail = () => {
    close();
    modalStack.open(<CalendarEventDetail source={source} id={id} />);
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const iso = officeDateTimeToIso(dateStr, hour, minute);
    if (!dateStr || !iso) {
      window.alert(lang === 'ar' ? 'أدخل تاريخاً صحيحاً' : 'יש להזין תאריך תקין');
      return;
    }
    const desc = description.trim() || nature;
    const natureAr = NATURE_AR_MAP[nature] || nature;

    if (source === 'task') {
      const next = state.timelineItems.map((x) => {
        if (String(x.id) !== String(id)) return x;
        const updated = {
          ...x,
          caseId,
          dueDateTime: iso,
          dueDate: iso.slice(0, 10),
        } as TimelineItem & { dueDateTime?: string };
        if (lang === 'ar') {
          updated.titleAr = natureAr;
          updated.descriptionAr = desc;
        } else {
          updated.title = nature;
          updated.description = desc;
        }
        return updated;
      });
      dispatch({ type: 'SET_TIMELINE', timeline: next });
    } else {
      // Conflict check — exclude the event being edited so it isn't flagged
      // against itself when the time hasn't moved.
      const conflict = findConflictingEvent(iso, state.eventsList, 30, String(id));
      if (conflict) {
        const proceed = await confirmConflict(conflict);
        if (!proceed) return;
      }
      const next = state.eventsList.map((x) => {
        if (String(x.id) !== String(id)) return x;
        const evType =
          nature === 'תזכורת'
            ? 'reminder'
            : nature === 'פגישה עם הלקוח'
              ? 'meeting'
              : 'hearingMeeting';
        // A client-less reminder/meeting carries the contact NAME on its
        // description in BOTH languages (there is no case to derive a client
        // from). Keep the name in descriptionAr too instead of overwriting it
        // with the nature — otherwise the Arabic view would show the nature
        // instead of the name after an edit.
        const contactEvent = !caseId && (evType === 'reminder' || evType === 'meeting');
        const updated: CalendarEvent = {
          ...x,
          caseId,
          dateTime: iso,
          title: nature,
          titleAr: natureAr,
          description: desc,
          descriptionAr: contactEvent ? desc : natureAr,
          type: evType,
        };
        return updated;
      });
      dispatch({ type: 'SET_EVENTS', events: next });
    }

    dispatch({ type: 'SET_CALENDAR_FOCUS', date: new Date(iso) });
    backToDetail();
  };

  const title = lang === 'ar' ? 'تفاصيل الموعد' : 'פרטי יומן';
  const natureLabel = lang === 'ar' ? 'ماهية الموعد' : 'מהות המועד';
  // Same shared header the "new appointment" modal uses over its date/time row.
  const dateTimeLabel = lang === 'ar' ? 'تاريخ ووقت الجلسة' : 'תאריך ושעת דיון';
  const hourLabel = lang === 'ar' ? 'الساعة' : 'שעה';
  const minuteLabel = lang === 'ar' ? 'الدقائق' : 'דקות';

  // Source's nature options use Hebrew canonical values for both languages —
  // we mirror that and just localize the displayed label.
  const natureOptions = [
    { v: 'דיון מקדמי', he: 'דיון מקדמי', ar: 'جلسة تمهيدية' },
    { v: 'דיון הוכחות', he: 'דיון הוכחות', ar: 'جلسة إثباتات' },
    { v: 'סיכומים בעל פה', he: 'סיכומים בעל פה', ar: 'تلخيصات شفوية' },
    { v: 'פגישה עם הלקוח', he: 'פגישה עם הלקוח', ar: 'اجتماع مع الموكل' },
    { v: 'תזכורת', he: 'תזכורת', ar: 'تذكير' },
  ];

  return (
    <Modal onClose={close} className="calendar-edit-v1" hideCloseX hideBackBtn>
      {/* One dark "X" close chip at the top-left — replaces BOTH the Modal's
          default top-right × and the back arrow. Styled in globals.css to match
          the reference (navy rounded square, white glyph, inset from the edge). */}
      <button
        type="button"
        className="calendar-edit-close-x"
        aria-label={lang === 'ar' ? 'إغلاق' : 'סגור'}
        title={lang === 'ar' ? 'إغلاق' : 'סגור'}
        onClick={close}
      >
        ×
      </button>
      {/* Centered like the "new appointment" modal's title. Side padding keeps
          it clear of the close chip (so it isn't a :first-child and the generic
          centering rule misses it). */}
      <h2 style={{ margin: 0, textAlign: 'center', padding: '0 48px' }}>
        {title}
      </h2>
      <div className="calendar-detail-toolbar">
        <button type="button" className="case-edit-btn active">
          <i className="fas fa-pen" />
          <span>{t('edit')}</span>
        </button>
      </div>
      <form className="calendar-detail-form" onSubmit={onSubmit}>
        <label>
          {natureLabel}
          <select
            id="editCalendarNature"
            value={nature}
            onChange={(e) => setNature(e.target.value)}
          >
            {natureOptions.map((o) => (
              <option key={o.v} value={o.v}>
                {lang === 'ar' ? o.ar : o.he}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t('relatedCase')}
          <select
            id="editCalendarCase"
            value={caseId}
            onChange={(e) => setCaseId(e.target.value)}
          >
            {state.casesArr.map((c) => (
              <option key={c.id} value={c.id}>
                {clientName(c.clientId, state.clients, lang) || ''} —{' '}
                {caseName(c, lang) || ''} ({c.caseNumber || ''})
              </option>
            ))}
          </select>
        </label>
        {/* Date + hour + minute share the exact layout of the "new
            appointment" modal: one full-width field with a shared header and a
            1.5fr/.75fr/.75fr time-row. Styling lives under
            `.calendar-edit-time-field` in globals.css. */}
        <div className="full calendar-edit-time-field">
          <label>{dateTimeLabel}</label>
          <div className="time-row">
            <div>
              <label>{t('date')}</label>
              <input
                id="editCalendarDate"
                type="date"
                // en-IL: built-in calendar starts the week on Sunday (keeps DD/MM/YYYY).
                lang="en-IL"
                value={dateStr}
                onChange={(e) => setDateStr(e.target.value)}
                required
              />
            </div>
            <div>
              <label>{hourLabel}</label>
              <select
                id="editCalendarHour"
                value={hour}
                onChange={(e) => setHour(e.target.value)}
              >
                {HOURS.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label>{minuteLabel}</label>
              <select
                id="editCalendarMinute"
                value={minute}
                onChange={(e) => setMinute(e.target.value)}
              >
                {minuteChoices.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
        <label className="full">
          {t('description')}
          <textarea
            id="editCalendarDescription"
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        <div className="calendar-detail-actions">
          <button type="button" className="cancel" onClick={backToDetail}>
            {t('cancel')}
          </button>
          <button
            type="button"
            className="edit-action-delete-btn"
            onClick={onDeleteItem}
          >
            {lang === 'ar' ? 'حذف' : 'מחיקה'}
          </button>
          <button type="submit" className="save">
            {t('save')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
