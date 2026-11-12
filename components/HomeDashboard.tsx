'use client';

import { useEffect, useState } from 'react';
import { useAppState } from '@/hooks/useAppState';
import { useWhatsAppEnabled } from '@/hooks/useIsOperatorOffice';
import { useT } from '@/hooks/useT';
import { useModalStack } from '@/hooks/useModalStack';
import { getTimeGreeting } from '@/lib/greeting';
import { officeAuthHeader } from '@/lib/officeToken';
import { UpcomingAgendaModal } from './UpcomingAgendaModal';
import { ClassicHome } from './ClassicHome';
import { MinimalHome } from './MinimalHome';

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

// The portal runs on the OPERATOR's WhatsApp number, so a tenant office must
// not see it. `.home-card-grid` is a fixed four-area grid, so the card is
// SWAPPED (for tasks — the other daily driver) rather than dropped, which
// would leave a hole in the layout.
const TENANT_HOME_CARDS = HOME_CARDS.map((c) =>
  c.id === 'portal' ? { id: 'tasks', icon: 'fa-circle-check', titleKey: 'tasks' } : c,
);

function portalLabel(lang: 'he' | 'ar'): string {
  return lang === 'ar' ? 'بوابة تواصل الموكلون' : 'שער תקשורת עם לקוחות';
}

function tasksLabel(lang: 'he' | 'ar'): string {
  return lang === 'ar' ? 'مهام' : 'משימות';
}

/** Incoming WhatsApp messages the office neither answered nor opened (the
 *  chat screen marks a client's messages read). Polled while home is shown. */
function useUnseenWhatsApp(enabled: boolean): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch((process.env.NEXT_PUBLIC_WORKER_URL || '') + '/api/whatsapp-summary', {
          headers: officeAuthHeader(),
          cache: 'no-store',
        });
        if (!res.ok) return;
        const data = (await res.json()) as { phones?: Array<{ unseen?: number | null }> };
        const n = (data.phones || []).reduce((sum, r) => sum + (Number(r.unseen) || 0), 0);
        if (alive) setCount(n);
      } catch {
        /* keep the last count */
      }
    };
    void load();
    const id = window.setInterval(load, 20000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [enabled]);
  return enabled ? count : 0;
}

export function HomeDashboard() {
  const { state, dispatch } = useAppState();
  const { t, lang } = useT();
  const modalStack = useModalStack();
  const waEnabled = useWhatsAppEnabled();
  const cards = waEnabled ? HOME_CARDS : TENANT_HOME_CARDS;
  const unseenWa = useUnseenWhatsApp(waEnabled);

  const brandName = state.officeName || t('firmName');
  const greetingText = getTimeGreeting(lang, brandName);

  // "Minimalist" (Settings): the editorial home from the office's design.
  if (state.homeStyle === 'minimalist') {
    return (
      <MinimalHome
        cards={cards.map((c) => ({
          id: c.id,
          icon: c.icon,
          title: c.id === 'portal' ? portalLabel(lang) : c.id === 'tasks' ? tasksLabel(lang) : t(c.titleKey),
        }))}
        greeting={greetingText}
        unseenWa={unseenWa}
        lang={lang === 'ar' ? 'ar' : 'he'}
      />
    );
  }

  // "Classic Design" / "Modern Design" (Settings): the same controls and
  // data, laid out anew — dark navy and gold, or the same page light.
  if (state.homeStyle === 'classic' || state.homeStyle === 'modern') {
    return (
      <ClassicHome
        cards={cards.map((c) => ({
          id: c.id,
          icon: c.icon,
          title: c.id === 'portal' ? portalLabel(lang) : c.id === 'tasks' ? tasksLabel(lang) : t(c.titleKey),
        }))}
        greeting={greetingText}
        unseenWa={unseenWa}
        lang={lang === 'ar' ? 'ar' : 'he'}
        variant={state.homeStyle === 'modern' ? 'modern' : 'classic'}
      />
    );
  }

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
      {/* Analytics — a round button in the free space beside the cards. */}
      <button
        type="button"
        className="home-analytics-btn"
        onClick={() => dispatch({ type: 'SET_TAB', tab: 'analytics' })}
        aria-label={lang === 'ar' ? 'التحليلات' : 'אנליטיקה'}
        title={lang === 'ar' ? 'التحليلات' : 'אנליטיקה'}
      >
        <img src="/analytics-icon.jpg" alt="" />
      </button>
      {/* Daily briefing — the mirror of the analytics button, on the other side. */}
      <button
        type="button"
        className="home-briefing-btn"
        onClick={() => dispatch({ type: 'SET_TAB', tab: 'briefing' })}
        aria-label={lang === 'ar' ? 'الإحاطة اليومية' : 'תדריך יומי'}
        title={lang === 'ar' ? 'الإحاطة اليومية' : 'תדריך יומי'}
      >
        <img src="/briefing-icon.png" alt="" />
      </button>
      {/* The 4 cards + the floating badge are ALL direct children
       *  of `.home-grid` — a single CSS Grid with explicit
       *  template-areas. The badge spans the entire 4-card
       *  rectangle (grid-area: cards) and self-centers within
       *  that area. This places it at the exact geometric center
       *  of the four cards in any direction or viewport. */}
      <div className="home-card-grid home-only-grid">
        {cards.map((card, idx) => {
          const title =
            card.id === 'portal'
              ? portalLabel(lang)
              : card.id === 'tasks'
                ? tasksLabel(lang)
                : t(card.titleKey);
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
              <h2>
                {title}
                {card.id === 'portal' && unseenWa > 0 && (
                  <span
                    className="home-wa-bell"
                    aria-label={
                      lang === 'ar'
                        ? `${unseenWa} رسائل لم يُرد عليها`
                        : `${unseenWa} הודעות שטרם נענו`
                    }
                  >
                    <i className="fas fa-bell" />
                    <b>{unseenWa}</b>
                  </span>
                )}
              </h2>
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
