'use client';

import { useRef } from 'react';
import { useAppState } from '@/hooks/useAppState';
import { useModalStack } from '@/hooks/useModalStack';
import { CalendarEventDetail } from './CalendarEventDetail';
import { useT } from '@/hooks/useT';
import { formatCaseDateTime, getCaseHearingForStatus } from '@/lib/cases';

/**
 * Port of lastHearingCardHtml (source line 4191). Shows either:
 *   - "next hearing" date (if case is active and a future hearing exists)
 *   - "last hearing" date (if no future hearing, or case is inactive)
 *   - "no hearing recorded" placeholder
 *
 * Same CSS classes (`case-last-hearing-card`, `lh-left`, `lh-icon`, `lh-label`,
 * `lh-title`, `lh-date`) so the v140/v220 stylesheets apply identically.
 */
export function CaseLastHearingCard({ caseId }: { caseId: string }) {
  const { state, dispatch } = useAppState();
  const { lang } = useT();
  const modalStack = useModalStack();
  const lastTap = useRef(0);

  const c = state.casesArr.find((x) => x.id === caseId);
  const active = !!c && c.status === 'active';
  const eventTypeLabel = (type: string) =>
    lang === 'ar'
      ? type === 'hearingMeeting'
        ? 'جلسة/اجتماع'
        : type
      : type === 'hearingMeeting'
        ? 'דיון'
        : type;

  const h = getCaseHearingForStatus(caseId, state.casesArr, state.eventsList, lang, eventTypeLabel);

  // The label must describe the date actually shown. getCaseHearingForStatus
  // falls back to the most recent PAST hearing when an active case has nothing
  // scheduled ahead — labelling that "מועד הדיון הבא" told the office a session
  // that already happened was still coming (exactly how a missing new hearing
  // stayed invisible). So the wording follows the date, not just the status.
  // With no hearing on file at all there is nothing to describe, so the empty
  // card keeps the status wording ("the next hearing: none recorded").
  const upcoming = h ? h.date.getTime() >= Date.now() : active;
  const label =
    lang === 'ar'
      ? upcoming
        ? 'الموعد القادم المرتبط بالقضية'
        : 'آخر موعد مرتبط بالقضية'
      : upcoming
        ? 'מועד הדיון הבא הקשור לתיק'
        : 'מועד הדיון האחרון הקשור לתיק';

  // Double click / double tap opens this hearing in the calendar: its own
  // "פרטי יומן" screen on top of the case (חזרה returns here). A date that
  // comes from the case's lastHearing field has no calendar entry, so the
  // calendar itself opens on that day instead. Two taps are timed by hand
  // because phones do not send a reliable dblclick.
  const openHearing = () => {
    if (!h) return;
    if (h.id) {
      modalStack.open(<CalendarEventDetail source="event" id={h.id} />);
      return;
    }
    dispatch({ type: 'SET_CALENDAR_FOCUS', date: h.date.toISOString() });
    dispatch({ type: 'SET_CALENDAR_VIEW', view: 'day' });
    dispatch({ type: 'SET_TAB', tab: 'calendar' });
    modalStack.closeAll();
  };
  const onTap = () => {
    const now = Date.now();
    if (now - lastTap.current < 400) {
      lastTap.current = 0;
      openHearing();
    } else {
      lastTap.current = now;
    }
  };

  if (!h) {
    return (
      <div className="case-last-hearing-card no-hearing">
        <div className="lh-left">
          <div className="lh-icon">
            <i className="fas fa-calendar-xmark" />
          </div>
          <div>
            <div className="lh-label">{label}</div>
            <div className="lh-title">
              {lang === 'ar' ? 'لا يوجد موعد مسجل' : 'לא קיים מועד רשום'}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    // The red "watch out, it's coming" treatment belongs to a hearing that is
    // still ahead — a session already held is shown plainly.
    <div
      className={'case-last-hearing-card' + (upcoming ? ' lh-next-hearing-red' : '')}
      onClick={onTap}
      title={lang === 'ar' ? 'نقر مزدوج لفتح الموعد في التقويم' : 'לחיצה כפולה לפתיחת המועד ביומן'}
      style={{ cursor: 'pointer', userSelect: 'none' }}
    >
      <div className="lh-left">
        <div className="lh-icon">
          <i className="fas fa-calendar-check" />
        </div>
        <div>
          <div className="lh-label">
            {label}:&nbsp;<span className="lh-date">{formatCaseDateTime(h.date, lang)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
