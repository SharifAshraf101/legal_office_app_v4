'use client';

import { useAppState } from '@/hooks/useAppState';
import { useT } from '@/hooks/useT';
import { useModalStack } from '@/hooks/useModalStack';
import { getTimeGreeting } from '@/lib/greeting';
import { UpcomingAgendaModal } from './UpcomingAgendaModal';

/**
 * Home dashboard. Port of renderHome() at source line 3897:
 *
 *   <div class="home-grid-wrap">
 *     <div class="home-card-grid home-only-grid">
 *       4× .home-card buttons: Cases / Contacts / Calendar / Portal
 *     </div>
 *     {showUpcomingHome && <button class="upcoming-center-btn upcoming-center-icon-btn"/>}
 *   </div>
 *
 * Clicking a card dispatches SET_TAB. Clicking the center "upcoming" button
 * opens the upcoming-agenda modal (lands in Stage 4b alongside Calendar).
 */

const HOME_CARDS: { id: string; icon: string; titleKey: string; titleAr?: string }[] = [
  // Order swapped per user request: clients first, then cases.
  { id: 'contacts', icon: 'fa-users', titleKey: 'contacts' },
  { id: 'cases', icon: 'fa-folder-open', titleKey: 'cases' },
  { id: 'calendar', icon: 'fa-calendar-days', titleKey: 'calendar' },
  // The 4th card in the source is "portal" with fa-link.
  { id: 'portal', icon: 'fa-link', titleKey: 'portal' },
];

function portalLabel(lang: 'he' | 'ar'): string {
  return lang === 'ar' ? 'بوابة تواصل الموكلون' : 'שער תקשורת עם לקוחות';
}

export function HomeDashboard() {
  const { state, dispatch } = useAppState();
  const { t, lang } = useT();
  const modalStack = useModalStack();

  const brandName = state.officeName || t('firmName');
  const greetingText = getTimeGreeting(lang, brandName);

  return (
    <div
      className={
        // For minimalist, layer the classic class as well so the
        // grid keeps the classic symmetric-square LAYOUT while the
        // minimalist CSS (transparent cards + colored border + brand
        // text/icon color) handles the APPEARANCE on top.
        'home-grid-wrap home-v2-fluid home-style-' +
        state.homeStyle +
        (state.homeStyle === 'minimalist' ? ' home-style-classic' : '')
      }
      data-home-style={state.homeStyle}
    >
      <div className="home-greeting">{greetingText}</div>
      {/* The 4 cards + the floating badge are ALL direct children
       *  of `.home-grid` — a single CSS Grid with explicit
       *  template-areas. The badge spans the entire 4-card
       *  rectangle (grid-area: cards) and self-centers within
       *  that area. This places it at the exact geometric center
       *  of the four cards in any direction or viewport. */}
      <div className="home-card-grid home-only-grid">
        {HOME_CARDS.map((card, idx) => {
          const title = card.id === 'portal' ? portalLabel(lang) : t(card.titleKey);
          return (
            <button
              key={card.id}
              type="button"
              className={'home-card home-card-' + (idx + 1)}
              data-go={card.id}
              onClick={() => dispatch({ type: 'SET_TAB', tab: card.id })}
            >
              <div className="card-icon">
                <i className={'fas ' + card.icon} />
              </div>
              <h2>{title}</h2>
            </button>
          );
        })}

        {state.showUpcomingHome && (
          <button
            type="button"
            id="upcomingAgendaBtn"
            className="upcoming-center-btn upcoming-center-icon-btn"
            aria-label={lang === 'ar' ? 'مواعيد قريبة' : 'אירועים קרובים'}
            onClick={() => modalStack.open(<UpcomingAgendaModal />)}
          >
            <span className="upcoming-mini-card">
              <span className="upcoming-mini-icon">
                <i className="far fa-clock" />
              </span>
              <span className="upcoming-mini-label">
                {lang === 'ar' ? 'مواعيد قريبة' : 'אירועים קרובים'}
              </span>
            </span>
          </button>
        )}
      </div>
    </div>
  );
}
