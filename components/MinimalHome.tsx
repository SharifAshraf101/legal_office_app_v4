'use client';

import { useMemo, useRef } from 'react';
import { useAppState } from '@/hooks/useAppState';
import { useModalStack } from '@/hooks/useModalStack';
import { useFitToScreen } from '@/hooks/useFitToScreen';
import { UpcomingAgendaModal } from './UpcomingAgendaModal';

/**
 * Home page — "Minimalist Design" (Settings → home style = minimalist).
 *
 * An editorial page from the office's design: kicker, large greeting, two
 * live figures, today's date in a gold numeral; a row of three text links
 * (daily briefing · upcoming events · financial analysis) and the four main
 * cards as a numbered 2×2 grid of hairline cells. Every control does what
 * its counterpart on the other home styles does (same SET_TAB targets, the
 * same upcoming-agenda modal). "mn-" prefix — clear of the app-wide
 * [class*=…] rules.
 */

type HomeCard = { id: string; icon: string; title: string };

const TXT = {
  he: {
    kicker: 'משרד עורכי דין · דף הבית',
    active: 'תיקים פעילים',
    clients: 'לקוחות',
    briefing: 'תדריך יומי',
    upcoming: 'אירועים קרובים',
    analytics: 'ניתוח פיננסי',
    desc: {
      contacts: 'פרטי הלקוחות, אנשי הקשר ותיקיהם',
      cases: 'תיקים, דיונים, החלטות ומסמכים',
      calendar: 'מועדים, דיונים ותזכורות',
      portal: 'תקשורת מאובטחת עם הלקוחות',
      tasks: 'משימות פתוחות ומועדיהן',
    } as Record<string, string>,
  },
  ar: {
    kicker: 'مكتب محاماة · الصفحة الرئيسية',
    active: 'قضايا نشطة',
    clients: 'موكلون',
    briefing: 'التقرير اليومي',
    upcoming: 'مواعيد قريبة',
    analytics: 'تحليل مالي',
    desc: {
      contacts: 'بيانات الموكلين وجهات الاتصال وملفاتهم',
      cases: 'الملفات والجلسات والقرارات والمستندات',
      calendar: 'المواعيد والجلسات والتنبيهات',
      portal: 'تواصل آمن مع الموكلين',
      tasks: 'المهام المفتوحة ومواعيدها',
    } as Record<string, string>,
  },
};

/** Design order: clients · cases / calendar · client gateway (or tasks). */
const ORDER = ['contacts', 'cases', 'calendar', 'portal', 'tasks'];
const FA: Record<string, string> = {
  contacts: 'fas fa-users',
  cases: 'fas fa-folder-open',
  calendar: 'fas fa-calendar-days',
  portal: 'fas fa-link',
  tasks: 'fas fa-list-check',
};

export function MinimalHome({
  cards,
  greeting,
  unseenWa,
  lang,
}: {
  cards: HomeCard[];
  greeting: string;
  unseenWa: number;
  lang: 'he' | 'ar';
}) {
  const { state, dispatch } = useAppState();
  const modalStack = useModalStack();
  const T = TXT[lang === 'ar' ? 'ar' : 'he'];
  const go = (tab: string) => dispatch({ type: 'SET_TAB', tab });

  const figures = useMemo(() => {
    const status = (s: unknown) => String(s || 'active').toLowerCase();
    return {
      active: state.casesArr.filter((c) => status(c.status) === 'active').length,
      clients: state.clients.length,
    };
  }, [state.casesArr, state.clients]);

  const loc = lang === 'ar' ? 'ar-u-nu-latn' : 'he-IL';
  const now = new Date();
  const fmt = (o: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(loc, { ...o, timeZone: 'Asia/Jerusalem' }).format(now);
  const day = fmt({ day: 'numeric' });
  const weekday = fmt({ weekday: 'long' });
  const monthYear = fmt({ month: 'long', year: 'numeric' });

  const tiles = [...cards].sort((a, b) => ORDER.indexOf(a.id) - ORDER.indexOf(b.id)).slice(0, 4);

  const rootRef = useRef<HTMLDivElement>(null);
  useFitToScreen(rootRef, `${lang}|${unseenWa}|${cards.length}|${state.showUpcomingHome}|${greeting}`);

  return (
    <div ref={rootRef} className="mn-root" data-home-design="minimalist">
      <header className="mn-top">
        <div className="mn-hi">
          <span className="mn-kick">{T.kicker}</span>
          <h1>{greeting}</h1>
          <p className="mn-meta">
            <button type="button" onClick={() => go('cases')}>
              <b>{figures.active}</b> {T.active}
            </button>
            <span className="mn-dot" aria-hidden>•</span>
            <button type="button" onClick={() => go('contacts')}>
              <b>{figures.clients}</b> {T.clients}
            </button>
          </p>
        </div>
        <button type="button" className="mn-date" onClick={() => go('calendar')} aria-label={`${weekday} ${day} ${monthYear}`}>
          <span className="mn-dd">{day}</span>
          <span className="mn-day">
            <b>{weekday}</b>
            <small>{monthYear}</small>
          </span>
        </button>
      </header>

      <nav className="mn-links">
        <button type="button" className="mn-link" onClick={() => go('briefing')}>
          <i className="far fa-newspaper" aria-hidden />
          <span>{T.briefing}</span>
          <i className="fas fa-arrow-left mn-arrow" aria-hidden />
        </button>
        {state.showUpcomingHome && (
          <button type="button" className="mn-link" onClick={() => modalStack.open(<UpcomingAgendaModal />)}>
            <i className="far fa-clock" aria-hidden />
            <span>{T.upcoming}</span>
            <i className="fas fa-arrow-left mn-arrow" aria-hidden />
          </button>
        )}
        <button type="button" className="mn-link" onClick={() => go('analytics')}>
          <i className="fas fa-chart-line" aria-hidden />
          <span>{T.analytics}</span>
          <i className="fas fa-arrow-left mn-arrow" aria-hidden />
        </button>
      </nav>

      <div className="mn-grid">
        {tiles.map((c, i) => (
          <button key={c.id} type="button" className="mn-box" data-go={c.id} onClick={() => go(c.id)}>
            <span className="mn-num">{String(i + 1).padStart(2, '0')}</span>
            <span className="mn-sym" aria-hidden>
              <i className={FA[c.id] || 'fas ' + c.icon} />
            </span>
            <b className="mn-name">
              {c.title}
              {c.id === 'portal' && unseenWa > 0 && (
                <span className="ch-bell" aria-label={String(unseenWa)}>
                  <i className="fas fa-bell" />
                  <b>{unseenWa}</b>
                </span>
              )}
            </b>
            <span className="mn-sub">{T.desc[c.id] || ''}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
