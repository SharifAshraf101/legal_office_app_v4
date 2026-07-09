'use client';

import { useAppState } from '@/hooks/useAppState';
import { useModalStack } from '@/hooks/useModalStack';
import { useT } from '@/hooks/useT';
import {
  calendarCaseParts,
  calendarItemTitle,
  calendarLocale,
  eventTypeLabel,
  isHearingImportNote,
} from '@/lib/calendar';
import { Modal } from './Modal';
import { CaseDetail } from './CaseDetail';
import { CalendarEventEdit } from './CalendarEventEdit';
import type { CalendarEvent, TimelineItem } from '@/types';

/**
 * Port of showCalendarDetail (source line 4361).
 *
 * Triggered by clicking an event row in the calendar or upcoming-agenda
 * views. Shows the canonical detail-grid plus two toolbar buttons:
 *   - "case details" → opens the linked CaseDetail
 *   - "edit" → opens CalendarEventEdit for this event/task
 */
export interface CalendarEventDetailProps {
  source: 'event' | 'task';
  id: string;
}

export function CalendarEventDetail({ source, id }: CalendarEventDetailProps) {
  const { state } = useAppState();
  const { t, lang } = useT();
  const modalStack = useModalStack();

  const item: CalendarEvent | TimelineItem | undefined =
    source === 'task'
      ? state.timelineItems.find((x) => String(x.id) === String(id))
      : state.eventsList.find((x) => String(x.id) === String(id));
  if (!item) return null;

  const close = () => modalStack.close(modalStack.topId() ?? 0);
  const openCase = () => {
    close();
    if (item.caseId) modalStack.open(<CaseDetail caseId={item.caseId} />);
  };
  const openEdit = () => {
    close();
    modalStack.open(<CalendarEventEdit source={source} id={id} />);
  };

  // calendarItemTitle handles the generic-title fallback to a nature string.
  const titleText = calendarItemTitle(item, lang) || eventTypeLabel(String(item.type ?? ''), lang, t);
  // For AI-imported hearings the "title" is really the import note. Show the
  // event nature (e.g. "מועד דיון") as מהות המועד, and the note in its own row.
  const isImport = isHearingImportNote(titleText);
  const rawTitle =
    lang === 'ar' ? item.titleAr || item.title : item.title || item.titleAr;
  const natureText = isImport
    ? rawTitle || eventTypeLabel(String(item.type ?? ''), lang, t)
    : titleText;
  const importNote = isImport ? titleText : '';
  const parts = calendarCaseParts(item.caseId, state.casesArr, state.clients, lang);
  const rawDate =
    source === 'task'
      ? (item as TimelineItem & { dueDateTime?: string; dueDate?: string }).dueDateTime ||
        (item as TimelineItem & { dueDate?: string }).dueDate ||
        (item as TimelineItem).date
      : (item as CalendarEvent).dateTime ||
        (item as CalendarEvent & { date?: string }).date;
  const d = rawDate ? new Date(rawDate) : new Date();
  const dateText = d.toLocaleString(calendarLocale(lang), {
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  const title = lang === 'ar' ? 'تفاصيل الموعد' : 'פרטי יומן';
  const natureLabel = lang === 'ar' ? 'ماهية الموعد' : 'מהות המועד';
  const noteLabel = lang === 'ar' ? 'ملاحظة' : 'הערה';

  return (
    <Modal onClose={close} className="calendar-detail-v1" hideBackBtn={true}>
      <button
        type="button"
        className="calendar-detail-back-btn"
        aria-label={lang === 'ar' ? 'رجوع' : 'חזרה'}
        title={lang === 'ar' ? 'رجوع' : 'חזרה'}
        onClick={close}
      >
        <i className="fas fa-arrow-left" />
        <span>{lang === 'ar' ? 'رجوع' : 'חזרה'}</span>
      </button>
      <h2 className="calendar-detail-title-centered">{title}</h2>
      <div className="calendar-detail-toolbar">
        <button type="button" className="case-edit-btn" onClick={openCase}>
          <i className="fas fa-folder-open" />
          <span>{t('caseDetails')}</span>
        </button>
        <button type="button" className="case-edit-btn" onClick={openEdit}>
          <i className="fas fa-pen" />
          <span>{t('edit')}</span>
        </button>
      </div>
      <div className="detail-grid">
        <DetailRow label={natureLabel} value={natureText} />
        <DetailRow label={t('clientName')} value={parts.client} />
        <DetailRow label={t('caseType')} value={parts.caseType} />
        <DetailRow label={t('court')} value={parts.court} />
        <DetailRow label={t('caseNumber')} value={parts.caseNumber} />
        <DetailRow label={t('date')} value={dateText} />
        {importNote && <DetailRow label={noteLabel} value={importNote} />}
      </div>
    </Modal>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="detail-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
