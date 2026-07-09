'use client';

import { useAppState } from '@/hooks/useAppState';
import { useModalStack } from '@/hooks/useModalStack';
import { useT } from '@/hooks/useT';
import {
  calendarCaseLine,
  calendarCaseParts,
  calendarLocale,
  calendarSecondaryLine,
  eventTypeLabel,
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

  const parts = calendarCaseParts(item.caseId, state.casesArr, state.clients, lang);

  // ALWAYS show the CASE DETAILS (client · case type · court · case number) as
  // the bold first line for every event, and the event nature / AI-import note
  // on the second line (per the office's request). For a hearing imported from a
  // judicial decision/protocol the second line is a clean "imported by the AI"
  // note — never the decision content — via calendarSecondaryLine.
  const caseLine = calendarCaseLine(parts, eventTypeLabel(type, lang, t));
  const secondary =
    calendarSecondaryLine(item, lang) || eventTypeLabel(type, lang, t);

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
          {caseLine}
        </div>
        <div className="calendar-agenda-details">
          <span>{secondary}</span>
        </div>
      </div>
    </div>
  );
}
