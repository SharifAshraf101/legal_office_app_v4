'use client';

import { useAppState } from '@/hooks/useAppState';
import { useModalStack } from '@/hooks/useModalStack';
import { useT } from '@/hooks/useT';
import {
  calendarCaseLine,
  calendarCaseParts,
  calendarContactName,
  calendarLocale,
  calendarSecondaryLine,
  eventTypeLabel,
  type CalendarItem,
} from '@/lib/calendar';
import { formatDMY, localizedWeekday, OFFICE_TZ } from '@/lib/dates';
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

  const fullDate =
    localizedWeekday(entry.date, calendarLocale(lang), 'long') +
    ', ' +
    formatDMY(entry.date);
  const timeStr = entry.date.toLocaleTimeString(calendarLocale(lang), {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: OFFICE_TZ,
  });

  const parts = calendarCaseParts(
    item.caseId,
    state.casesArr,
    state.clients,
    lang,
    calendarContactName(item, lang),
  );

  // ALWAYS show the CASE DETAILS (client · case type · court · case number) as
  // the bold first line for every event, and the event nature / AI-import note
  // on the second line (per the office's request). For a hearing imported from a
  // judicial decision/protocol the second line is a clean "imported by the AI"
  // note — never the decision content — via calendarSecondaryLine.
  const caseLine = calendarCaseLine(parts, eventTypeLabel(type, lang, t));
  const secondary =
    calendarSecondaryLine(item, lang) || eventTypeLabel(type, lang, t);

  const open = () =>
    modalStack.open(<CalendarEventDetail source={entry.source} id={String(item.id || '')} />);

  // "Modern Design": date over time · mark · case line over the event's note.
  if (state.homeStyle === 'modern') {
    const main = [parts.client, parts.caseType, parts.court, parts.caseNumber].filter((p) => p && p !== '-').join(' - ');
    return (
      <div
        className="mx-item"
        role="button"
        tabIndex={0}
        data-calendar-item-id={item.id || ''}
        data-calendar-source={entry.source}
        onClick={open}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            open();
          }
        }}
      >
        <span className="mx-item-fa" aria-hidden>
          <i className="far fa-calendar" />
        </span>
        <span className="mx-when">
          <b>{fullDate}</b>
          <em>{timeStr}</em>
        </span>
        <span className="mx-mark" aria-hidden>
          <i className={'fas ' + (isTask ? 'fa-list-check' : 'fa-briefcase')} />
        </span>
        <span className="mx-line">
          <b>{main || caseLine}</b>
          <small>{secondary}</small>
        </span>
      </div>
    );
  }

  // "Classic Design": one line — date · time · mark · client - type - court · number.
  // The event's second line stays available as the row's tooltip.
  if (state.homeStyle === 'classic') {
    const main = [parts.client, parts.caseType, parts.court].filter((p) => p && p !== '-').join(' - ');
    const num = parts.caseNumber && parts.caseNumber !== '-' ? parts.caseNumber : '';
    return (
      <div
        className="cx-item"
        role="button"
        tabIndex={0}
        title={secondary}
        data-calendar-item-id={item.id || ''}
        data-calendar-source={entry.source}
        onClick={open}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            open();
          }
        }}
      >
        <span className="cx-when">{fullDate}</span>
        <span className="cx-time">{timeStr}</span>
        <span className="cx-mark" aria-hidden>
          <i className={'fas ' + (isTask ? 'fa-list-check' : 'fa-calendar-check')} />
        </span>
        <span className="cx-line">
          <b>{main || caseLine}</b>
        </span>
        <span className="cx-numcell">{num ? <bdi className="cx-num">{num}</bdi> : null}</span>
      </div>
    );
  }

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
