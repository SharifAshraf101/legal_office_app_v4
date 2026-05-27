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
import { Modal } from './Modal';

/**
 * Port of showUpcomingAgendaModal (source line 4331). Triggered from the Home
 * dashboard's center "upcoming events" button.
 *
 * Highlights conflicts (two items at the exact same minute) with the
 * `conflict-blink` keyframe animation defined in globals.css (line 71).
 */
export function UpcomingAgendaModal() {
  const { state } = useAppState();
  const { t, lang } = useT();
  const modalStack = useModalStack();

  const close = () => modalStack.close(modalStack.topId() ?? 0);

  const items = upcomingAgendaItems(state.eventsList, state.timelineItems);
  const counts: Record<string, number> = {};
  items.forEach((x) => {
    const k = agendaTimeKey(x.date);
    if (k) counts[k] = (counts[k] || 0) + 1;
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
  return (
    <Modal onClose={close} className="upcoming-agenda-modal" hideBackBtn={true}>
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
      <h2>{title}</h2>
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
            const dateText = entry.date.toLocaleString(calendarLocale(lang), {
              weekday: 'long',
              day: '2-digit',
              month: '2-digit',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            });
            const conflict = counts[agendaTimeKey(entry.date)] > 1;
            const isTask = entry.item.type === 'task';
            return (
              <div
                key={i}
                className={'agenda-modal-row' + (conflict ? ' conflict-blink' : '')}
              >
                <div className="agenda-modal-time">{dateText}</div>
                <div>
                  <div className="agenda-modal-title">
                    <span
                      className={
                        'upcoming-agenda-icon-wrap ' +
                        (isTask ? 'upcoming-agenda-task-icon' : 'upcoming-agenda-calendar-icon')
                      }
                    >
                      <i className={'fas ' + (isTask ? 'fa-list-check' : 'fa-calendar-check')} />
                    </span>{' '}
                    {titleText}
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
