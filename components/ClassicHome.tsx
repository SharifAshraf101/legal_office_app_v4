'use client';

import { useMemo, useRef } from 'react';
import { useFitToScreen } from '@/hooks/useFitToScreen';
import { useAppState } from '@/hooks/useAppState';
import { useModalStack } from '@/hooks/useModalStack';
import { financeCaseBalance } from '@/lib/finance';
import { UpcomingAgendaModal } from './UpcomingAgendaModal';

/**
 * Home page — "Classic Design" (Settings → home style = classic).
 *
 * Only the LOOK changes: every control does exactly what its counterpart on
 * the other home styles does (same SET_TAB targets, the same upcoming-agenda
 * modal — here behind today's date card), the icons are the existing ones,
 * and every figure is read from the app state the other screens use. The
 * sidebar and the top bar are untouched (rendered by AppShell).
 *
 * Layout: greeting · financial analysis | today (upcoming) | daily briefing ·
 * six figures · the four main cards in one row. Dark navy + gold, glowing
 * glass cards, the office's design artwork at the sides (public/classic).
 *
 * Class names use the "ch-" prefix and avoid the substrings the app-wide
 * stylesheet targets ("-row", "-card", "title", "icon", "btn", …).
 */

type HomeCard = { id: string; icon: string; title: string };

const TXT = {
  he: {
    subtitle: 'ברוכים הבאים למערכת ניהול משרד עורכי הדין',
    briefing: 'תדריך יומי',
    briefingSub: 'הדיונים, המועדים והמשימות של היום ומה שדורש תשומת לב',
    analytics: 'ניתוח פיננסי ותפעולי',
    analyticsSub: 'כספים שנגבו, חובות, תיקים פתוחים וסגורים ודוחות ביצוע',
    upcoming: 'אירועים קרובים',
    upcomingTitle: 'המועדים הקרובים',
    upcomingSub: 'הדיונים והמועדים הבאים',
    activeCases: 'תיקים פעילים',
    clients: 'לקוחות',
    openFiles: 'תיקים פתוחים',
    closedFiles: 'תיקים סגורים',
    collected: 'כספים שנגבו',
    debt: 'חובות (לגבייה)',
    desc: {
      contacts: 'ניהול פרטי הלקוחות ותיקיהם',
      cases: 'ניהול תיקים, דיונים והחלטות',
      calendar: 'מועדים, דיונים ותזכורות',
      portal: 'תקשורת מאובטחת ומעקב אחר מצב התיק',
      tasks: 'משימות פתוחות ומועדיהן',
    } as Record<string, string>,
  },
  ar: {
    subtitle: 'مرحباً بك في نظام إدارة مكتب المحاماة',
    briefing: 'التقرير اليومي',
    briefingSub: 'أبرز التحديثات، الجلسات، المهام وما يتطلب اهتمامك اليوم',
    analytics: 'تحليل مالي وتشغيلي',
    analyticsSub: 'الأموال المقبوضة، الديون، الملفات المفتوحة والمغلقة وتقارير الأداء',
    upcoming: 'مواعيد قريبة',
    upcomingTitle: 'المواعيد القريبة',
    upcomingSub: 'الجلسات والمواعيد القادمة',
    activeCases: 'القضايا النشطة',
    clients: 'الموكلون',
    openFiles: 'الملفات المفتوحة',
    closedFiles: 'الملفات المغلقة',
    collected: 'الأموال المقبوضة',
    debt: 'الديون (مستحقات)',
    desc: {
      contacts: 'إدارة بيانات الموكلين وملفاتهم',
      cases: 'إدارة القضايا والجلسات والقرارات',
      calendar: 'المواعيد، الجلسات والتنبيهات',
      portal: 'تواصل آمن ومتابعة حالة القضية',
      tasks: 'المهام المفتوحة ومواعيدها',
    } as Record<string, string>,
  },
};

/** The design's order, right to left: calendar · clients · cases · portal. */
const ORDER = ['calendar', 'contacts', 'cases', 'portal', 'tasks'];

export function ClassicHome({
  cards,
  greeting,
  unseenWa,
  lang,
  variant = 'classic',
}: {
  cards: HomeCard[];
  greeting: string;
  unseenWa: number;
  lang: 'he' | 'ar';
  /** 'classic' — dark navy and gold; 'modern' — the same page, light. */
  variant?: 'classic' | 'modern';
}) {
  const { state, dispatch } = useAppState();
  const modalStack = useModalStack();
  const T = TXT[lang === 'ar' ? 'ar' : 'he'];
  const go = (tab: string) => dispatch({ type: 'SET_TAB', tab });
  const openUpcoming = () => modalStack.open(<UpcomingAgendaModal />);

  // The same sources the other screens read.
  const figures = useMemo(() => {
    const status = (s: unknown) => String(s || 'active').toLowerCase();
    const activeCases = state.casesArr.filter((c) => status(c.status) === 'active').length;
    const openFiles = state.casesArr.filter((c) => ['active', 'pending'].includes(status(c.status))).length;
    const closedFiles = state.casesArr.length - openFiles;
    const collected = state.finances.filter((f) => f.paid !== false).reduce((s, f) => s + (Number(f.amount) || 0), 0);
    const debt = state.casesArr.reduce((s, c) => s + financeCaseBalance(c, state.finances), 0);
    return { activeCases, clients: state.clients.length, openFiles, closedFiles, collected, debt };
  }, [state.casesArr, state.finances, state.clients]);

  const loc = lang === 'ar' ? 'ar-u-nu-latn' : 'he-IL';
  const money = (n: number) => '₪ ' + new Intl.NumberFormat(loc, { maximumFractionDigits: 0 }).format(Math.round(n));
  const now = new Date();
  const weekday = new Intl.DateTimeFormat(loc, { weekday: 'long', timeZone: 'Asia/Jerusalem' }).format(now);
  const dateLine = new Intl.DateTimeFormat(loc, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Jerusalem' }).format(now);

  const stats = [
    { k: 'active', label: T.activeCases, v: String(figures.activeCases), fa: 'fa-gavel', tone: 'red', act: () => go('cases') },
    { k: 'clients', label: T.clients, v: String(figures.clients), fa: 'fa-users', tone: 'green', act: () => go('contacts') },
    { k: 'open', label: T.openFiles, v: String(figures.openFiles), fa: 'fa-folder-open', tone: 'blue', act: () => go('cases') },
    { k: 'closed', label: T.closedFiles, v: String(figures.closedFiles), fa: 'fa-square-check', tone: 'violet', act: () => go('cases') },
    { k: 'collected', label: T.collected, v: money(figures.collected), fa: 'fa-coins', tone: 'mint', act: () => go('analytics') },
    { k: 'debt', label: T.debt, v: money(figures.debt), fa: 'fa-database', tone: 'peach', act: () => go('analytics') },
  ];

  const ordered = [...cards].sort((a, b) => ORDER.indexOf(a.id) - ORDER.indexOf(b.id));

  // Phone: the whole page fits between the top bar and the bottom navigation,
  // with no scrolling — scaled down as far as the screen needs.
  const rootRef = useRef<HTMLDivElement>(null);
  useFitToScreen(rootRef, `${lang}|${variant}|${unseenWa}|${cards.length}|${state.showUpcomingHome}|${greeting}`);

  // Classic on a desktop (≥900px): the dashboard layout from the office's
  // design — greeting · date + upcoming · six figures in one glass bar · six
  // glowing cards (clients, cases, briefing / calendar, tasks, analytics).
  // On a phone the same parts stack (CSS) and useFitToScreen keeps it to one
  // screen. Same handlers throughout.
  if (variant === 'classic') {
    const ar = lang === 'ar';
    const D = {
      upcoming: ar ? 'المواعيد القريبة' : 'המועדים הקרובים',
      portal: ar ? 'بوابة التواصل' : 'שער התקשורת',
      clients: cards.find((c) => c.id === 'contacts')?.title || (ar ? 'الموكلون' : 'לקוחות'),
      clientsSub: ar ? 'إدارة بيانات الموكلين والتواصل' : 'ניהול פרטי לקוחות ותקשורת',
      cases: cards.find((c) => c.id === 'cases')?.title || (ar ? 'الملفات' : 'תיקים'),
      casesSub: ar ? 'إدارة الملفات والجلسات والقرارات' : 'ניהול תיקים, דיונים והחלטות',
      briefSub: ar ? 'الملفات والمهام والتنبيهات التي تتطلب اهتمامك اليوم' : 'תיקים, משימות והתרעות של היום שדורשים תשומת לב',
      calendar: cards.find((c) => c.id === 'calendar')?.title || (ar ? 'التقويم' : 'יומן'),
      calendarSub: ar ? 'المواعيد والجلسات والمهام' : 'מועדים, דיונים ומשימות',
      tasks: ar ? 'المهام' : 'משימות',
      tasksSub: ar ? 'المهام المفتوحة ومتابعة التنفيذ' : 'משימות פתוחות ומעקב ביצוע',
      analSub: ar ? 'الأموال المقبوضة، الديون، التقارير ومؤشرات الأداء' : 'כספים שנגבו, חובות, דוחות ומדדי ביצוע',
    };
    const tiles = [
      { k: 'clients', tone: 'cd-blue', fa: 'fas fa-users', name: D.clients, sub: D.clientsSub, go: () => go('contacts') },
      { k: 'cases', tone: 'cd-violet', fa: 'fas fa-folder-open', name: D.cases, sub: D.casesSub, go: () => go('cases') },
      { k: 'brief', tone: 'cd-gold', fa: 'fas fa-clipboard-list', name: T.briefing, en: 'Daily Briefing', sub: D.briefSub, go: () => go('briefing') },
      { k: 'calendar', tone: 'cd-amber', fa: 'far fa-calendar-days', name: D.calendar, sub: D.calendarSub, go: () => go('calendar') },
      { k: 'tasks', tone: 'cd-green', fa: 'far fa-circle-check', name: D.tasks, sub: D.tasksSub, go: () => go('tasks') },
      { k: 'anal', tone: 'cd-teal', fa: 'fas fa-chart-column', name: T.analytics, sub: D.analSub, go: () => go('analytics') },
    ];
    const portalCard = cards.find((c) => c.id === 'portal');
    // The portal card takes the tasks card's place (tasks stay in the
    // sidebar / bottom navigation). Without WhatsApp there is no portal card,
    // so tasks keep the place on the phone too.
    if (portalCard) {
      tiles.push({ k: 'portal', tone: 'cd-wa', fa: 'fas fa-comments', name: portalCard.title, sub: T.desc.portal, go: () => go('portal') });
    }
    return (
      <div ref={rootRef} className="cd-root" data-home-design="classic">
        <div className="cd-art" aria-hidden>
          <img src="/classic/v4-left.jpg" alt="" />
        </div>
        <span className="cd-arc" aria-hidden />
        <header className="cd-hero">
          <h1>{greeting}</h1>
          <span className="cd-rule" aria-hidden />
          <p>{T.subtitle}</p>
        </header>
        <div className="cd-chips">
          <button type="button" className="cd-chip" onClick={() => go('calendar')} aria-label={`${weekday} ${dateLine}`}>
            <i className="far fa-calendar-check" aria-hidden />
            <span>
              {weekday} · {dateLine}
            </span>
          </button>
          {state.showUpcomingHome && (
            <button type="button" className="cd-chip cd-chip-gold" onClick={openUpcoming}>
              <i className="far fa-clock" aria-hidden />
              <span>{D.upcoming}</span>
            </button>
          )}
          {portalCard && unseenWa > 0 && (
            <button type="button" className="cd-chip cd-chip-wa" onClick={() => go('portal')}>
              <i className="fas fa-bell" aria-hidden />
              <span>
                {D.portal} <b>{unseenWa}</b>
              </span>
            </button>
          )}
        </div>
        <div className="cd-strip">
          {stats.map((st) => (
            <button key={st.k} type="button" className={'cd-fig cd-f-' + (st.k === 'active' ? 'act' : st.k)} onClick={st.act}>
              <span className="cd-fig-top">
                <span className="cd-fig-lbl">{st.label}</span>
                <span className="cd-fig-sym">
                  <i className={'fas ' + st.fa} aria-hidden />
                </span>
              </span>
              <b>{st.v}</b>
            </button>
          ))}
        </div>
        <div className="cd-grid">
          {tiles.map((t) => (
            <button key={t.k} type="button" data-k={t.k} data-wa={portalCard ? '1' : '0'} className={'cd-tile ' + t.tone} onClick={t.go}>
              <span className="cd-tile-text">
                <b className="cd-tile-name">
                  {t.name}
                  {t.k === 'portal' && unseenWa > 0 && (
                    <span className="ch-bell" aria-label={String(unseenWa)}>
                      <i className="fas fa-bell" />
                      <b>{unseenWa}</b>
                    </span>
                  )}
                </b>
                {t.en && <em className="cd-tile-en">{t.en}</em>}
                <span className="cd-tile-sub">{t.sub}</span>
                <span className="cd-go" aria-hidden>
                  <i className="fas fa-arrow-right" />
                </span>
              </span>
              <span className="cd-tile-sym" aria-hidden>
                <i className={t.fa} />
              </span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div ref={rootRef} className={'ch-root' + (variant === 'modern' ? ' ch-modern' : '')} data-home-design={variant}>
      {/* The design's artwork at the sides */}
      <div className="ch-art-side" aria-hidden>
        <img src={variant === 'modern' ? '/classic/modern-scales.png' : '/classic/v3-left.png'} alt="" />
      </div>
      {variant !== 'modern' && (
        <div className="ch-art-lib" aria-hidden>
          <img src="/classic/v3-library.png" alt="" />
        </div>
      )}

      {/* Greeting */}
      <header className="ch-hero">
        <h1>{greeting}</h1>
        <span className="ch-rule" aria-hidden />
        <p>{T.subtitle}</p>
      </header>

      {/* Daily briefing · today (upcoming events) · financial analysis */}
      <div className="ch-features">
        <button type="button" className="ch-feature ch-feature-b" onClick={() => go('briefing')}>
          <span className="ch-feature-img">
            <img src="/briefing-icon.png" alt="" />
          </span>
          <b>{T.briefing}</b>
          <em>Daily Briefing</em>
          <small>{T.briefingSub}</small>
          <span className="ch-go" aria-hidden>
            <i className="fas fa-angles-left" />
          </span>
        </button>

        <div className="ch-mid">
          {/* Today's date — opens the calendar */}
          <button
            type="button"
            className="ch-today"
            onClick={() => go('calendar')}
            aria-label={`${weekday} ${dateLine}`}
          >
            <i className="far fa-calendar-check" aria-hidden />
            <b>{weekday}</b>
            <span className="ch-today-date">{dateLine}</span>
          </button>
          {/* Upcoming events — the same modal as the other home styles */}
          {state.showUpcomingHome && (
            <button type="button" className="ch-today ch-upnext" onClick={openUpcoming} aria-label={T.upcoming}>
              <i className="far fa-calendar-days" aria-hidden />
              <b>{T.upcomingTitle}</b>
              <small>{T.upcomingSub}</small>
            </button>
          )}
        </div>

        <button type="button" className="ch-feature ch-feature-a" onClick={() => go('analytics')}>
          <span className="ch-feature-img ch-feature-img-round">
            <img src="/analytics-icon.jpg" alt="" />
          </span>
          <b>{T.analytics}</b>
          <small>{T.analyticsSub}</small>
          <span className="ch-go" aria-hidden>
            <i className="fas fa-angles-left" />
          </span>
        </button>
      </div>

      {/* Six figures */}
      <div className="ch-stats">
        {stats.map((s) => (
          <button key={s.k} type="button" className={'ch-stat ch-tone-' + s.tone} onClick={s.act}>
            <span className="ch-stat-text">
              <span className="ch-stat-label">{s.label}</span>
              <b>{s.v}</b>
            </span>
            <span className="ch-stat-fa">
              <i className={'fas ' + s.fa} aria-hidden />
            </span>
          </button>
        ))}
      </div>

      {/* The four main cards */}
      <div className="ch-tiles">
        {ordered.map((card) => (
          <button
            key={card.id}
            type="button"
            className={'ch-tile ch-tile-' + card.id}
            data-go={card.id}
            onClick={() => go(card.id)}
          >
            <span className="ch-tile-fa">
              <i className={'fas ' + card.icon} aria-hidden />
            </span>
            <b className="ch-tile-name">
              {card.title}
              {card.id === 'portal' && unseenWa > 0 && (
                <span className="ch-bell" aria-label={String(unseenWa)}>
                  <i className="fas fa-bell" />
                  <b>{unseenWa}</b>
                </span>
              )}
            </b>
            <span className="ch-tile-desc">{T.desc[card.id] || ''}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
