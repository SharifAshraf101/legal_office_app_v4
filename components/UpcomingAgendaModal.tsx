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
import { formatDMYTime, localizedWeekday } from '@/lib/dates';
import { Modal } from './Modal';

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
  const { state } = useAppState();
  const { t, lang } = useT();
  const modalStack = useModalStack();

  const close = () => modalStack.close(modalStack.topId() ?? 0);

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
  return (
    <Modal
      onClose={close}
      className="upcoming-agenda-modal"
      hideCloseX
      hideBackBtn={true}
    >
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
            const dateText =
              localizedWeekday(entry.date, calendarLocale(lang), 'long') +
              ', ' +
              formatDMYTime(entry.date);
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
              <div
                key={i}
                className={
                  'agenda-modal-row' +
                  (conflict ? ' conflict-blink' : '') +
                  (sameClient ? ' conflict-same-client' : '')
                }
              >
                <div className="agenda-modal-time">{dateText}</div>
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
                </div>
              </div>
            );
          })
        )}
      </div>
    </Modal>
  );
}
