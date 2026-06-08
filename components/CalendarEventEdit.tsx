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
import { calendarDateValue } from '@/lib/dates';
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
};

const HOURS = Array.from({ length: 24 }, (_, h) => pad(h));
const MINUTES = Array.from({ length: 60 }, (_, m) => pad(m));

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
  if (!item) return null;

  const initialRaw =
    source === 'task'
      ? (item as TimelineItem & { dueDateTime?: string; dueDate?: string }).dueDateTime ||
        (item as TimelineItem & { dueDate?: string }).dueDate ||
        (item as TimelineItem).date
      : (item as CalendarEvent).dateTime || (item as CalendarEvent & { date?: string }).date;
  const initialDate = initialRaw ? new Date(initialRaw) : new Date();

  const [dateStr, setDateStr] = useState(calendarDateValue(initialDate));
  const [hour, setHour] = useState(pad(initialDate.getHours()));
  const [minute, setMinute] = useState(pad(initialDate.getMinutes()));
  const [nature, setNature] = useState(calendarItemTitle(item, lang) || 'דיון מקדמי');
  const [caseId, setCaseId] = useState(item.caseId || '');
  const [description, setDescription] = useState(
    lang === 'ar'
      ? item.descriptionAr || item.description || ''
      : item.description || item.descriptionAr || '',
  );

  const close = () => modalStack.close(modalStack.topId() ?? 0);
  const backToDetail = () => {
    close();
    modalStack.open(<CalendarEventDetail source={source} id={id} />);
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const composed = new Date(`${dateStr}T${hour}:${minute}:00`);
    if (!dateStr || isNaN(composed.getTime())) {
      window.alert(lang === 'ar' ? 'أدخل تاريخاً صحيحاً' : 'יש להזין תאריך תקין');
      return;
    }
    const desc = description.trim() || nature;
    const natureAr = NATURE_AR_MAP[nature] || nature;
    const iso = composed.toISOString();

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
        const updated: CalendarEvent = {
          ...x,
          caseId,
          dateTime: iso,
          title: nature,
          titleAr: natureAr,
          description: desc,
          descriptionAr: natureAr,
          type: nature === 'פגישה עם הלקוח' ? 'meeting' : 'hearingMeeting',
        };
        return updated;
      });
      dispatch({ type: 'SET_EVENTS', events: next });
    }

    dispatch({ type: 'SET_CALENDAR_FOCUS', date: composed });
    backToDetail();
  };

  const title = lang === 'ar' ? 'تفاصيل الموعد' : 'פרטי יומן';
  const natureLabel = lang === 'ar' ? 'ماهية الموعد' : 'מהות המועד';
  const hourLabel = lang === 'ar' ? 'الساعة' : 'שעה';
  const minuteLabel = lang === 'ar' ? 'الدقائق' : 'דקות';

  // Source's nature options use Hebrew canonical values for both languages —
  // we mirror that and just localize the displayed label.
  const natureOptions = [
    { v: 'דיון מקדמי', he: 'דיון מקדמי', ar: 'جلسة تمهيدية' },
    { v: 'דיון הוכחות', he: 'דיון הוכחות', ar: 'جلسة إثباتات' },
    { v: 'סיכומים בעל פה', he: 'סיכומים בעל פה', ar: 'تلخيصات شفوية' },
    { v: 'פגישה עם הלקוח', he: 'פגישה עם הלקוח', ar: 'اجتماع مع الموكل' },
  ];

  return (
    <Modal onClose={close}>
      <h2>{title}</h2>
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
        <label>
          {t('date')}
          <input
            id="editCalendarDate"
            type="date"
            value={dateStr}
            onChange={(e) => setDateStr(e.target.value)}
            required
          />
        </label>
        <label>
          {hourLabel}
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
        </label>
        <label>
          {minuteLabel}
          <select
            id="editCalendarMinute"
            value={minute}
            onChange={(e) => setMinute(e.target.value)}
          >
            {MINUTES.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
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
