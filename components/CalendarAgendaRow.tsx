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
  type CalendarItem,
} from '@/lib/calendar';
import { CalendarEventDetail } from './CalendarEventDetail';

/**
 * Single agenda row used by the day, list, and (effectively) week views.
 * Port of calendarAgendaRows row body (source line 4097).
 */
export function CalendarAgendaRow({ entry }: { entry: CalendarItem }) {
  const { state } = useAppState();
  const { t, lang } = useT();
  const modalStack = useModalStack();

  const item = entry.item;
  const type = item.type || 'hearingMeeting';
  const isTask = type === 'task';

  const fullDate = entry.date.toLocaleDateString(calendarLocale(lang), {
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
  const timeStr = entry.date.toLocaleTimeString(calendarLocale(lang), {
    hour: '2-digit',
    minute: '2-digit',
  });

  const title = calendarItemTitle(item, lang) || eventTypeLabel(type, lang, t);
  const parts = calendarCaseParts(item.caseId, state.casesArr, state.clients, lang);

  // For AI-imported hearings the "title" is really the import note. Show the
  // CASE DETAILS as the bold first line and the note as the second line
  // (per the office's request), instead of the note as the title.
  const isImport = isHearingImportNote(title);
  const caseLine =
    [parts.client, parts.caseType, parts.court, parts.caseNumber]
      .filter((p) => p && p !== '-')
      .join(' · ') || eventTypeLabel(type, lang, t);

  return (
    <div
      className="calendar-agenda-row"
      data-calendar-item-id={item.id || ''}
      data-calendar-source={entry.source}
      onClick={() =>
        modalStack.open(
          <CalendarEventDetail source={entry.source} id={String(item.id || '')} />,
        )
      }
      style={{ cursor: 'pointer' }}
    >
      <div className="calendar-agenda-time">
        {fullDate}
        <br />
        <span className="agenda-time-red">{timeStr}</span>
      </div>
      <div>
        <div className="calendar-agenda-title-main">
          <span
            className={
              'calendar-list-icon-wrap ' +
              (isTask ? 'calendar-list-task-icon' : 'calendar-list-calendar-icon')
            }
          >
            <i className={'fas ' + (isTask ? 'fa-list-check' : 'fa-calendar-check')} />
          </span>
          {isImport ? caseLine : title}
        </div>
        <div className="calendar-agenda-details">
          {isImport ? (
            <span>{title}</span>
          ) : (
            <>
              <span>{parts.client}</span>
              <span>{parts.caseType}</span>
              <span>{parts.court}</span>
              <span>{parts.caseNumber}</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
