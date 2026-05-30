'use client';

import { useMemo, useState } from 'react';
import { useAppState } from '@/hooks/useAppState';
import { useModalStack } from '@/hooks/useModalStack';
import { useT } from '@/hooks/useT';
import { CalendarEventDetail } from './CalendarEventDetail';
import {
  calendarAllItems,
  calendarCaseParts,
  calendarDateValue,
  calendarItemTitle,
  calendarLocale,
  calendarRangeTitle,
  calendarText,
  eventTypeLabel,
  sameCalendarDay,
  shiftCalendar,
  weekdayNames,
  type CalendarView,
} from '@/lib/calendar';
import { caseSearchText } from '@/lib/cases';
import { CalendarAgendaRow } from './CalendarAgendaRow';
import { MainScreenBackButton } from './MainScreenBackButton';

/**
 * Calendar screen. Port of renderCalendar (source line 4106) with all four
 * view modes (day / week / month / list) and the toolbar (view tabs + date
 * prev/next/today + date input + range title).
 *
 * Click handlers on event cells are stubbed for Stage 4b-4 (showCalendarDetail).
 */
export function CalendarScreen() {
  const { state, dispatch } = useAppState();
  const { t, lang } = useT();
  const [listQuery, setListQuery] = useState('');

  const view = state.calendarView;
  const focus = useMemo(() => {
    const d = new Date(state.calendarFocusDate);
    return isNaN(d.getTime()) ? new Date() : d;
  }, [state.calendarFocusDate]);

  const items = useMemo(
    () => calendarAllItems(state.eventsList, state.timelineItems),
    [state.eventsList, state.timelineItems],
  );

  const listSearchPlaceholder =
    lang === 'ar'
      ? 'بحث بحسب اسم الموكل، رقم الهوية، الهاتف، نوع الدعوى، المحكمة أو رقم الملف في المحكمة'
      : 'חיפוש לפי שם לקוח, תעודת זהות, טלפון, סוג תביעה, בית משפט או מספר תיק בבית המשפט';

  const setView = (v: CalendarView) => dispatch({ type: 'SET_CALENDAR_VIEW', view: v });
  const setDateStr = (value: string) => {
    if (!value) return;
    const d = new Date(value + 'T12:00:00');
    if (!isNaN(d.getTime())) dispatch({ type: 'SET_CALENDAR_FOCUS', date: d });
  };
  const shift = (delta: number) =>
    dispatch({ type: 'SET_CALENDAR_FOCUS', date: shiftCalendar(focus, view, delta) });
  const goToday = () => dispatch({ type: 'SET_CALENDAR_FOCUS', date: new Date() });

  const prevLabel = lang === 'ar' ? 'السابق' : 'הקודם';
  const nextLabel = lang === 'ar' ? 'التالي' : 'הבא';
  const todayLabel = lang === 'ar' ? 'اليوم' : 'היום';
  const listTitle =
    lang === 'ar'
      ? 'مواعيد، جلسات، اجتماعات، تذكيرات ومهام'
      : 'מועדים דיונים, פגישות, תזכורת ומשימות';

  return (
    <section className="panel">
      <MainScreenBackButton />
      <div className="panel-body">
        {view === 'list' && (
          <>
            <h2 className="calendar-list-title">{listTitle}</h2>
            <div className="calendar-list-search-wrap">
              <input
                type="search"
                className="calendar-list-search-input"
                autoComplete="off"
                placeholder={listSearchPlaceholder}
                value={listQuery}
                onChange={(e) => setListQuery(e.target.value)}
              />
            </div>
          </>
        )}
        <div className="calendar-toolbar">
          <div className="calendar-view-tabs">
            {(['day', 'week', 'month', 'list'] as CalendarView[]).map((v) => (
              <button
                key={v}
                type="button"
                className={'calendar-view-btn' + (view === v ? ' active' : '')}
                data-calendar-view={v}
                onClick={() => setView(v)}
              >
                {calendarText(v, lang)}
              </button>
            ))}
          </div>
          {view !== 'list' && (
            <div className="calendar-controls">
              <button
                type="button"
                className="calendar-nav-btn"
                data-calendar-prev
                aria-label={prevLabel}
                onClick={() => shift(-1)}
              >
                <i className="fas fa-chevron-right" />
              </button>
              <input
                type="date"
                className="calendar-date-input"
                value={calendarDateValue(focus)}
                onChange={(e) => setDateStr(e.target.value)}
              />
              <button
                type="button"
                className="calendar-nav-btn"
                data-calendar-next
                aria-label={nextLabel}
                onClick={() => shift(1)}
              >
                <i className="fas fa-chevron-left" />
              </button>
              <button
                type="button"
                className="calendar-view-btn"
                data-calendar-today
                onClick={goToday}
              >
                {todayLabel}
              </button>
            </div>
          )}
          {view !== 'month' && (
            <div className="calendar-range-title">{calendarRangeTitle(focus, view, lang)}</div>
          )}
        </div>

        {/* Scroll body: takes the remaining flex height in panel-body
         *  and owns vertical scroll. The list-title + search-wrap +
         *  view-tabs toolbar above stay visually pinned because the
         *  panel itself never scrolls. */}
        <div className="calendar-scroll-body">
          {view === 'day' && <DayView focus={focus} items={items} />}
          {view === 'week' && <WeekView focus={focus} items={items} />}
          {view === 'month' && <MonthView focus={focus} items={items} />}
          {view === 'list' && <ListView items={items} query={listQuery} />}
        </div>
      </div>
    </section>
  );
}

function DayView({ focus, items }: { focus: Date; items: ReturnType<typeof calendarAllItems> }) {
  const { lang } = useT();
  const day = items.filter((x) => sameCalendarDay(x.date, focus));
  return (
    <div className="calendar-day-panel">
      {day.length === 0 ? (
        <div className="calendar-empty">{calendarText('noItems', lang)}</div>
      ) : (
        <div className="calendar-agenda-list">
          {day.map((entry, i) => (
            <CalendarAgendaRow key={i} entry={entry} />
          ))}
        </div>
      )}
    </div>
  );
}

function WeekView({ focus, items }: { focus: Date; items: ReturnType<typeof calendarAllItems> }) {
  const { state } = useAppState();
  const { t, lang } = useT();
  const modalStack = useModalStack();
  const start = new Date(focus);
  start.setDate(focus.getDate() - focus.getDay());
  start.setHours(0, 0, 0, 0);
  const names = weekdayNames(lang, true);

  return (
    <div style={{ overflow: 'auto' }}>
      <div className="calendar-week-grid">
        {Array.from({ length: 7 }, (_, i) => {
          const d = new Date(start);
          d.setDate(start.getDate() + i);
          const dayItems = items.filter((x) => sameCalendarDay(x.date, d));
          return (
            <div key={i} className="calendar-week-day">
              <h3>
                {names[i]}
                <span className="calendar-week-date">
                  {d.toLocaleDateString(calendarLocale(lang), {
                    day: '2-digit',
                    month: '2-digit',
                  })}
                </span>
              </h3>
              {dayItems.length === 0 ? (
                <div className="sub">{calendarText('noItems', lang)}</div>
              ) : (
                dayItems.map((entry, k) => {
                  const parts = calendarCaseParts(
                    entry.item.caseId,
                    state.casesArr,
                    state.clients,
                    lang,
                  );
                  const title =
                    calendarItemTitle(entry.item, lang) ||
                    eventTypeLabel(String(entry.item.type ?? 'hearingMeeting'), lang, t);
                  return (
                    <div
                      key={k}
                      className="cal-event"
                      data-calendar-item-id={entry.item.id || ''}
                      data-calendar-source={entry.source}
                      style={{ cursor: 'pointer' }}
                      onClick={() =>
                        modalStack.open(
                          <CalendarEventDetail
                            source={entry.source}
                            id={String(entry.item.id || '')}
                          />,
                        )
                      }
                    >
                      <div className="calendar-week-event-title">
                        {entry.date.toLocaleTimeString(calendarLocale(lang), {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}{' '}
                        · {title}
                      </div>
                      <div className="calendar-week-event-details">
                        {parts.client} · {parts.caseType} · {parts.court} · {parts.caseNumber}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MonthView({ focus, items }: { focus: Date; items: ReturnType<typeof calendarAllItems> }) {
  const { state } = useAppState();
  const { t, lang } = useT();
  const modalStack = useModalStack();
  const year = focus.getFullYear();
  const month = focus.getMonth();
  const totalDays = new Date(year, month + 1, 0).getDate();
  const firstWeekday = new Date(year, month, 1).getDay();
  const names = weekdayNames(lang, false);

  return (
    <div style={{ overflow: 'auto' }}>
      <div className="calendar-grid">
        {names.map((n) => (
          <div key={n} className="cal-head">
            {n}
          </div>
        ))}
        {Array.from({ length: firstWeekday }, (_, i) => (
          <div key={'pad-' + i} className="cal-cell" />
        ))}
        {Array.from({ length: totalDays }, (_, i) => {
          const day = i + 1;
          const cell = new Date(year, month, day);
          const evs = items.filter((x) => sameCalendarDay(x.date, cell));
          return (
            <div key={day} className="cal-cell">
              <b>{day}</b>
              {evs.slice(0, 3).map((entry, k) => {
                const parts = calendarCaseParts(
                  entry.item.caseId,
                  state.casesArr,
                  state.clients,
                  lang,
                );
                const title =
                  calendarItemTitle(entry.item, lang) ||
                  eventTypeLabel(String(entry.item.type ?? 'hearingMeeting'), lang, t);
                return (
                  <div
                    key={k}
                    className="cal-event"
                    data-calendar-item-id={entry.item.id || ''}
                    data-calendar-source={entry.source}
                    style={{ cursor: 'pointer' }}
                    onClick={() =>
                      modalStack.open(
                        <CalendarEventDetail
                          source={entry.source}
                          id={String(entry.item.id || '')}
                        />,
                      )
                    }
                  >
                    <span className="cal-event-title">{title}</span>
                    <span className="cal-event-details">
                      {parts.client} · {parts.caseType} · {parts.court} · {parts.caseNumber}
                    </span>
                  </div>
                );
              })}
              {evs.length > 3 && <div className="cal-event">+{evs.length - 3}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ListView({
  items,
  query,
}: {
  items: ReturnType<typeof calendarAllItems>;
  query: string;
}) {
  const { lang } = useT();
  const { state } = useAppState();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((entry) => {
      const c = state.casesArr.find((x) => x.id === entry.item.caseId);
      if (!c) return false;
      return caseSearchText(c, state.clients).toLowerCase().includes(q);
    });
  }, [items, query, state.casesArr, state.clients]);

  return (
    <div className="calendar-list-panel">
      {filtered.length === 0 ? (
        <div className="calendar-empty">{calendarText('noItems', lang)}</div>
      ) : (
        <div className="calendar-agenda-list">
          {filtered.map((entry, i) => (
            <CalendarAgendaRow key={i} entry={entry} />
          ))}
        </div>
      )}
    </div>
  );
}
