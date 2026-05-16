'use client';

import { useAppState } from '@/hooks/useAppState';
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
  const { state } = useAppState();
  const { lang } = useT();

  const c = state.casesArr.find((x) => x.id === caseId);
  const active = !!c && c.status === 'active';
  const label =
    lang === 'ar'
      ? active
        ? 'الموعد القادم المرتبط بالقضية'
        : 'آخر موعد مرتبط بالقضية'
      : active
        ? 'מועד הדיון הבא הקשור לתיק'
        : 'מועד הדיון האחרון הקשור לתיק';
  const eventTypeLabel = (type: string) =>
    lang === 'ar'
      ? type === 'hearingMeeting'
        ? 'جلسة/اجتماع'
        : type
      : type === 'hearingMeeting'
        ? 'דיון'
        : type;

  const h = getCaseHearingForStatus(caseId, state.casesArr, state.eventsList, lang, eventTypeLabel);

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
    <div className={'case-last-hearing-card' + (active ? ' lh-next-hearing-red' : '')}>
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
