'use client';

import { useAppState } from '@/hooks/useAppState';
import { useModalStack } from '@/hooks/useModalStack';
import { useT } from '@/hooks/useT';
import {
  agendaTimeKey,
  calendarLocale,
  eventTypeLabel,
  upcomingAgendaItems,
} from '@/lib/calendar';
import { caseName, clientName } from '@/lib/cases';
import { calendarDateValue, localizedWeekday } from '@/lib/dates';
import { Fragment } from 'react';
import { rememberDismissedEventId } from '@/lib/dismissedEvents';
import {
  completeTaskEverywhere,
  removeTaskEverywhere,
  taskIdentityKey,
} from '@/lib/tasks';
import { useDeleteConfirm } from '@/hooks/useDeleteConfirm';
import type { CalendarItem } from '@/lib/calendar';
import { CalendarEventEdit } from './CalendarEventEdit';
import { Modal } from './Modal';
import { TaskModal } from './TaskModal';

/**
 * Port of showUpcomingAgendaModal (source line 4331). Triggered from the Home
 * dashboard's center "upcoming events" button.
 *
 * Highlights conflicts (two items at the exact same minute) with the
 * `conflict-blink` keyframe animation defined in globals.css (line 71).
 * Overlaps that all belong to one client blink green instead of rose via
 * `conflict-same-client`.
 */
export function UpcomingAgendaModal() {
  const { state, dispatch } = useAppState();
  const { t, lang } = useT();
  const modalStack = useModalStack();
  const confirmDelete = useDeleteConfirm();

  const close = () => modalStack.close(modalStack.topId() ?? 0);

  // ---- Task row actions ----------------------------------------------------
  // A task can be in tasksArr, in the timeline and as a "מועד דיוני" reminder,
  // under different ids — every action works on all copies (same case + core
  // title), so the task changes on every screen at once.
  const isTaskish = (type?: unknown) => type === 'task' || type === 'reminder';
  const refOf = (entry: CalendarItem) => {
    const it = entry.item as { caseId?: string; title?: string; titleAr?: string };
    const title = it.title || it.titleAr || '';
    const caseId = String(it.caseId || '');
    return {
      caseId,
      title,
      clientId: state.casesArr.find((c) => c.id === caseId)?.clientId || '',
      key: taskIdentityKey(caseId, title),
    };
  };

  /** Done: the task turns 'done' everywhere and leaves this agenda. */
  const markDone = (entry: CalendarItem) => {
    dispatch({ type: 'SET_TASKS', tasks: completeTaskEverywhere(refOf(entry), state.tasksArr) });
  };

  /** Edit in the editor that owns the row's source. */
  const editRow = (entry: CalendarItem) => {
    const id = String(entry.item.id ?? '');
    if (entry.source === 'event') {
      modalStack.open(<CalendarEventEdit source="event" id={id} />);
    } else if (state.tasksArr.some((tk) => String(tk.id) === id)) {
      modalStack.open(<TaskModal editTaskId={id} />);
    } else {
      modalStack.open(<CalendarEventEdit source="task" id={id} />);
    }
  };

  /** Delete every copy: the task record, its timeline entry and its reminder. */
  const deleteRow = async (entry: CalendarItem) => {
    const ok = await confirmDelete(
      lang === 'ar'
        ? 'حذف المهمة؟ ستُحذف من قائمة المهام ومن الملف ومن التقويم.'
        : 'למחוק את המשימה? היא תימחק מרשימת המשימות, מהתיק ומהיומן.',
    );
    if (!ok) return;
    const ref = refOf(entry);
    const sameTask = (x: { caseId?: string; title?: string; titleAr?: string }) =>
      taskIdentityKey(x.caseId, x.title || x.titleAr) === ref.key;
    const anchor =
      state.tasksArr.find(sameTask) ||
      state.timelineItems.find((ti) => ti.type === 'task' && sameTask(ti));
    if (anchor) {
      const next = removeTaskEverywhere(String(anchor.id), state.tasksArr, state.timelineItems);
      dispatch({ type: 'SET_TASKS', tasks: next.tasks });
      dispatch({ type: 'SET_TIMELINE', timeline: next.timeline });
    }
    // Reminder / task events of the same task. Tombstoned so a later import
    // can't bring them back (see lib/dismissedEvents.ts).
    const gone = state.eventsList.filter((e) => isTaskish(e.type) && sameTask(e));
    if (gone.length) {
      gone.forEach((e) => rememberDismissedEventId(String(e.id)));
      const ids = new Set(gone.map((e) => String(e.id)));
      dispatch({
        type: 'SET_EVENTS',
        events: state.eventsList.filter((e) => !ids.has(String(e.id))),
      });
    }
  };

  // ---- Day grouping (a header per day, then that day's items by time) -------
  const todayKey = calendarDateValue(new Date());
  const tomorrowKey = calendarDateValue(new Date(Date.now() + 86400000));
  const thisYear = todayKey.slice(0, 4);
  /** Small line above the date: "היום, יום שישי" / "מחר, שבת" / "יום ראשון". */
  const dayTopLine = (d: Date, key: string) => {
    const weekday = localizedWeekday(d, calendarLocale(lang), 'long');
    const rel =
      key === todayKey
        ? lang === 'ar' ? 'اليوم' : 'היום'
        : key === tomorrowKey
          ? lang === 'ar' ? 'غداً' : 'מחר'
          : '';
    return rel ? `${rel}, ${weekday}` : weekday;
  };
  /** The date itself, in the office's time zone: "8 בנובמבר" (+ year if not this year). */
  const dayDateLine = (d: Date, key: string) =>
    d.toLocaleDateString(calendarLocale(lang), {
      day: 'numeric',
      month: 'long',
      ...(key.slice(0, 4) !== thisYear ? { year: 'numeric' } : {}),
      timeZone: 'Asia/Jerusalem',
    });
  /** The row's time only — the date is in the day header. */
  const timeOf = (d: Date) =>
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Jerusalem',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(d);

  const actionLabels =
    lang === 'ar'
      ? { done: 'تم التنفيذ', edit: 'تعديل', remove: 'حذف' }
      : { done: 'בוצע', edit: 'עריכה', remove: 'מחיקה' };

  const items = upcomingAgendaItems(
    state.eventsList,
    state.timelineItems,
    state.tasksArr,
  );
  const counts: Record<string, number> = {};
  const clientsAtTime: Record<string, Set<string>> = {};
  items.forEach((x, i) => {
    const k = agendaTimeKey(x.date);
    if (!k) return;
    counts[k] = (counts[k] || 0) + 1;
    // An item with no case (or a case with no client) gets a per-row marker so
    // it never counts as "the same client" as another unattributed row.
    const clientId = state.casesArr.find((c) => c.id === x.item.caseId)?.clientId;
    (clientsAtTime[k] ||= new Set()).add(clientId ? String(clientId) : `unknown-${i}`);
  });

  const title = lang === 'ar' ? 'مواعيد ومهام قريبة' : 'מועדים ומשימות קרובים';
  const subtitle =
    lang === 'ar'
      ? 'عند وجود موعدَين في نفس الوقت ستظهر الصفوف وامضة'
      : 'כאשר שני מועדים חופפים, השורות יסומנו בהבהוב';
  const empty =
    lang === 'ar'
      ? 'لا توجد مواعيد أو مهام قريبة للعرض'
      : 'אין מועדים או משימות קרובים להצגה';

  const backLabel = lang === 'ar' ? 'رجوع' : 'חזרה';
  // "Task to do" — shown as the type label for task rows instead of a
  // hearing/appointment label.
  const taskDoLabel = lang === 'ar' ? 'مهمة للتنفيذ' : 'משימה לביצוע';

  // "Classic Design" (Settings → home style = classic): the same items, day
  // grouping, overlap marking and task actions (done / edit / delete), in the
  // dark navy + gold look of the office design.
  if (state.homeStyle === 'classic') {
    const ar = lang === 'ar';
    return (
      <Modal onClose={close} className="upcoming-agenda-modal ug-classic" hideCloseX hideBackBtn={true}>
        <div className="ug-hero">
          <img src="/classic/tasks-art-2.jpg" alt="" className="ug-art" aria-hidden />
          <button type="button" className="ug-back" aria-label={backLabel} title={backLabel} onClick={close}>
            <i className="fas fa-arrow-left" aria-hidden />
            <span>{backLabel}</span>
          </button>
          <i className="far fa-calendar ug-hero-fa" aria-hidden />
          <div className="ug-hero-text">
            <h2 className="ug-h">{title}</h2>
            <span className="ug-rule" aria-hidden />
            <p className="ug-sub">{subtitle}</p>
          </div>
        </div>
        <div className="ug-frame">
          {items.length === 0 ? (
            <div className="ug-none">{empty}</div>
          ) : (
            items.map((entry, i) => {
              const c = state.casesArr.find((x) => x.id === entry.item.caseId);
              const client = c ? clientName(c.clientId, state.clients, lang) : '-';
              const caseTitle = c ? caseName(c, lang) : '';
              const courtName = c ? (ar ? c.courtAr || c.court : c.court || c.courtAr) || '' : '';
              const titleText = ar ? entry.item.titleAr || entry.item.title : entry.item.title || entry.item.titleAr;
              const dayKey = calendarDateValue(entry.date);
              const newDay = i === 0 || calendarDateValue(items[i - 1].date) !== dayKey;
              const timeKey = agendaTimeKey(entry.date);
              const conflict = counts[timeKey] > 1;
              const sameClient = conflict && clientsAtTime[timeKey]?.size === 1;
              const isTaskOrReminder = entry.item.type === 'task' || entry.item.type === 'reminder';
              const taskContent = String(titleText || '')
                .replace(/^\s*מועד דיוני:\s*/, '')
                .replace(/^\s*موعد إجرائي:\s*/, '')
                .trim();
              const taskDoText = taskContent && taskContent !== taskDoLabel ? `${taskDoLabel}: ${taskContent}` : taskDoLabel;
              return (
                <Fragment key={i}>
                  {newDay && (
                    <div className="ug-day">
                      <i className="far fa-calendar-days" aria-hidden />
                      <b>{dayTopLine(entry.date, dayKey)}{ar ? '، ' : ', '}{dayDateLine(entry.date, dayKey)}</b>
                    </div>
                  )}
                  <div className={'ug-item' + (conflict ? ' conflict-blink ug-clash' : '') + (sameClient ? ' conflict-same-client' : '')}>
                    <span className="ug-time">
                      <i className="far fa-clock" aria-hidden />
                      <bdi>{timeOf(entry.date)}</bdi>
                    </span>
                    <i className={'fas ug-kind ' + (isTaskOrReminder ? 'fa-list-check' : 'fa-building-columns')} aria-hidden />
                    <div className="ug-txt">
                      <div className="ug-title">
                        <b>{isTaskOrReminder ? taskDoText : titleText}</b>
                        {conflict && (
                          <span className="ug-warn">
                            <i className="fas fa-triangle-exclamation" aria-hidden />
                            {ar ? 'تعارض' : 'חפיפה'}
                          </span>
                        )}
                      </div>
                      <div className="ug-meta">
                        {eventTypeLabel(String(entry.item.type ?? ''), lang, t)} · {client}
                        {caseTitle ? ' · ' + caseTitle : ''}
                        {c ? <> · <bdi>{c.caseNumber}</bdi></> : null}
                        {courtName ? ' · ' + courtName : ''}
                      </div>
                      {isTaskOrReminder && (
                        <div className="ug-acts">
                          <button type="button" className="ug-act ug-done" onClick={() => markDone(entry)}>
                            <i className="fas fa-check" aria-hidden />
                            <span>{actionLabels.done}</span>
                          </button>
                          <button type="button" className="ug-act ug-edit" onClick={() => editRow(entry)}>
                            <i className="fas fa-pen" aria-hidden />
                            <span>{actionLabels.edit}</span>
                          </button>
                          <button type="button" className="ug-act ug-del" onClick={() => void deleteRow(entry)}>
                            <i className="fas fa-trash" aria-hidden />
                            <span>{actionLabels.remove}</span>
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </Fragment>
              );
            })
          )}
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      onClose={close}
      className="upcoming-agenda-modal"
      hideCloseX
      hideBackBtn={true}
    >
      {/* Pinned header: the back button and the title stay on screen while the
          list scrolls, so going back never needs a scroll to the top. */}
      <div className="agenda-sticky-head">
      <button
        type="button"
        className="case-detail-back-btn"
        aria-label={backLabel}
        title={backLabel}
        onClick={close}
      >
        <i className="fas fa-arrow-left" />
        <span>{backLabel}</span>
      </button>
      {/* Centered title; side padding keeps it clear of the back button. */}
      <h2 style={{ margin: 0, textAlign: 'center', padding: '0 48px' }}>
        {title}
      </h2>
      </div>
      <p className="sub">{subtitle}</p>
      <div className="agenda-modal-list">
        {items.length === 0 ? (
          <div className="agenda-modal-empty">{empty}</div>
        ) : (
          items.map((entry, i) => {
            const c = state.casesArr.find((x) => x.id === entry.item.caseId);
            const client = c ? clientName(c.clientId, state.clients, lang) : '-';
            const caseTitle = c ? caseName(c, lang) : '';
            const caseNumber = c ? ` · ${c.caseNumber}` : '';
            // Court name follows the case number so the lawyer sees both the
            // file ID and where the hearing takes place at a glance.
            const courtName = c
              ? (lang === 'ar' ? c.courtAr || c.court : c.court || c.courtAr) || ''
              : '';
            const courtText = courtName ? ` · ${courtName}` : '';
            const titleText =
              lang === 'ar'
                ? entry.item.titleAr || entry.item.title
                : entry.item.title || entry.item.titleAr;
            const dayKey = calendarDateValue(entry.date);
            const newDay = i === 0 || calendarDateValue(items[i - 1].date) !== dayKey;
            const timeKey = agendaTimeKey(entry.date);
            const conflict = counts[timeKey] > 1;
            const sameClient = conflict && clientsAtTime[timeKey]?.size === 1;
            const isTask = entry.item.type === 'task';
            // Reminders and tasks are action items, not appointments — show them
            // as "משימה לביצוע" (task to do) instead of a hearing/appointment
            // title such as the AI-imported "מועד דיון".
            const isTaskOrReminder = isTask || entry.item.type === 'reminder';
            // Lead the row with "משימה לביצוע" but KEEP the item's own content.
            // Procedural-deadline reminders are titled "מועד דיוני: <content>"
            // (Arabic "موعد إجرائي: <content>") — strip just that prefix so the
            // reminder/task content survives next to the label.
            const taskContent = String(titleText || '')
              .replace(/^\s*מועד דיוני:\s*/, '')
              .replace(/^\s*موعد إجرائي:\s*/, '')
              .trim();
            const taskDoText =
              taskContent && taskContent !== taskDoLabel
                ? `${taskDoLabel}: ${taskContent}`
                : taskDoLabel;
            return (
              <Fragment key={i}>
              {newDay && (
                <div className="agenda-day-header">
                  <div className="agenda-day-top">{dayTopLine(entry.date, dayKey)}</div>
                  <div className="agenda-day-date">{dayDateLine(entry.date, dayKey)}</div>
                </div>
              )}
              <div
                className={
                  'agenda-modal-row agenda-row-timed' +
                  (conflict ? ' conflict-blink' : '') +
                  (sameClient ? ' conflict-same-client' : '')
                }
              >
                <div className="agenda-modal-time">{timeOf(entry.date)}</div>
                <div>
                  <div className="agenda-modal-title">
                    <span
                      className={
                        'upcoming-agenda-icon-wrap ' +
                        (isTaskOrReminder
                          ? 'upcoming-agenda-task-icon'
                          : 'upcoming-agenda-calendar-icon')
                      }
                    >
                      <i
                        className={
                          'fas ' +
                          (isTaskOrReminder ? 'fa-list-check' : 'fa-calendar-check')
                        }
                      />
                    </span>{' '}
                    {isTaskOrReminder ? taskDoText : titleText}
                    {conflict && (
                      <span className="agenda-conflict-badge">
                        <i className="fas fa-triangle-exclamation" />
                        {lang === 'ar' ? 'تعارض' : 'חפיפה'}
                      </span>
                    )}
                  </div>
                  <div className="agenda-modal-meta">
                    {eventTypeLabel(String(entry.item.type ?? ''), lang, t)} · {client}
                    {caseTitle ? ' · ' + caseTitle : ''}
                    {caseNumber}
                    {courtText}
                  </div>
                  {isTaskOrReminder && (
                    <div className="agenda-row-actions">
                      <button
                        type="button"
                        className="agenda-row-action agenda-row-done"
                        onClick={() => markDone(entry)}
                      >
                        <i className="fas fa-check" />
                        <span>{actionLabels.done}</span>
                      </button>
                      <button
                        type="button"
                        className="agenda-row-action agenda-row-edit"
                        onClick={() => editRow(entry)}
                      >
                        <i className="fas fa-pen" />
                        <span>{actionLabels.edit}</span>
                      </button>
                      <button
                        type="button"
                        className="agenda-row-action agenda-row-delete"
                        onClick={() => void deleteRow(entry)}
                      >
                        <i className="fas fa-trash" />
                        <span>{actionLabels.remove}</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>
              </Fragment>
            );
          })
        )}
      </div>
    </Modal>
  );
}
