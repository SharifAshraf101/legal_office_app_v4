'use client';

import { useAppState } from '@/hooks/useAppState';
import { useT } from '@/hooks/useT';
import { useModalStack } from '@/hooks/useModalStack';
import { NewClientModal } from './NewClientModal';
import { NewCaseModal } from './NewCaseModal';
import { TaskModal } from './TaskModal';
import { AddPaymentModal } from './AddPaymentModal';
import { NewCalendarAppointmentModal } from './NewCalendarAppointmentModal';
import { NewEventModal } from './NewEventModal';
import { SettingsDrawer } from './SettingsDrawer';

/**
 * Topbar. Port of the renderShell() topbar block + the source's contextual
 * quick-action click handler (line 5192).
 *
 * Structure:
 *   .topbar (with `.home-topbar` class toggled when currentTab === 'home',
 *            source line 3890)
 *     .page-title { h1 + p }
 *     .mobile-office-identity (mobile-only, shows office name/address —
 *            from the Step 89 CSS block right after the body markup,
 *            line 2963)
 *     .actions
 *       optional .home-only-settings-wrap on home tab
 *       quick-action button (label/icon contextual on current tab)
 *
 * The quick-action button's wiring depends on which "new X" modal we open.
 * Those modals land in subsequent Stage 4 sub-stages; for Stage 4a-1 the
 * button is rendered but its handler is a no-op TODO.
 */

/**
 * Quick-action mapping. The icon mirrors the sidebar/mobile-nav icon for the
 * current tab (so a lawyer in "Cases" sees a folder + "+" overlay; in
 * "Contacts" sees a user-group + "+") and inherits the same per-tab color
 * via the .nav-icon-<key> class (see globals.css). The "+" badge is drawn
 * separately as a small overlay so the base icon stays clean.
 */
function quickActionForTab(
  tab: string,
): { label: string; iconClass: string; navColorKey: string } | null {
  switch (tab) {
    case 'home':
      // Home: "new event". Show the calendar icon + "+" badge.
      // Color uses the emerald "home" tone to distinguish the
      // home-page quick-create from the calendar tab's quick-create
      // (which keeps its own indigo).
      return { label: 'newEvent', iconClass: 'fa-calendar', navColorKey: 'home' };
    case 'finance':
    case 'portal':
      // Communication-with-client / finance summary have no quick-create.
      return null;
    case 'cases':
      return { label: 'newCase', iconClass: 'fa-folder', navColorKey: 'cases' };
    case 'contacts':
      return { label: 'newClient', iconClass: 'fa-user-group', navColorKey: 'contacts' };
    case 'calendar':
      return { label: 'newAppointment', iconClass: 'fa-calendar', navColorKey: 'calendar' };
    case 'documents':
      return { label: 'newDocument', iconClass: 'fa-file-lines', navColorKey: 'documents' };
    case 'tasks':
      return { label: 'newTask', iconClass: 'fa-circle-check', navColorKey: 'tasks' };
    case 'financeDetail':
      return { label: 'newPayment', iconClass: 'fa-coins', navColorKey: 'finance' };
    default:
      return null;
  }
}

function pageTitle(tab: string, t: (k: string) => string, lang: 'he' | 'ar'): string {
  if (tab === 'search') return lang === 'ar' ? 'بحث شامل' : 'חיפוש כולל';
  if (tab === 'financeDetail') return lang === 'ar' ? 'الأتعاب' : 'שכר טרחה';
  if (tab === 'portal') return lang === 'ar' ? 'بوابة تواصل الموكلون' : 'שער תקשורת עם לקוחות';
  if (tab === 'documents') return lang === 'ar' ? 'المستندات' : 'מסמכים';
  if (tab === 'tasks') return lang === 'ar' ? 'مهام' : 'משימות';
  return t(tab);
}

export function Topbar() {
  const { state } = useAppState();
  const { t, settingsText, lang } = useT();
  const modalStack = useModalStack();

  const isHome = state.currentTab === 'home';
  const qa = quickActionForTab(state.currentTab);
  // On home we don't show a page-title subtitle — the greeting moves to
  // the HomeDashboard so it can sit centered between the top two cards.
  const subtitle = isHome ? '' : t('subtitle');
  const brandName = state.officeName || t('firmName');
  const defaultAddress = settingsText('הסורג 2, ירושלים', 'السورج 2، القدس');
  const brandAddress = state.officeAddress || defaultAddress;

  // Quick-action label localized inline since some labels aren't in `tr`.
  const qaLabel = qa
    ? qa.label === 'newCase'
      ? t('newCase')
      : qa.label === 'newClient'
        ? t('newClient')
        : qa.label === 'newEvent'
          ? t('newEvent')
          : qa.label === 'newAppointment'
            ? settingsText('הוספת מועד חדש', 'إضافة موعد جديد')
            : qa.label === 'newDocument'
              ? settingsText('מסמך חדש', 'مستند جديد')
              : qa.label === 'newTask'
                ? settingsText('משימה חדשה', 'مهمة جديدة')
                : qa.label === 'newPayment'
                  ? settingsText('תשלום חדש', 'دفعة جديدة')
                  : t('newEvent')
    : '';

  const onQuickAction = () => {
    // Source line 5192 dispatches to a different "new X" modal per tab.
    switch (state.currentTab) {
      case 'contacts':
        modalStack.open(<NewClientModal />);
        return;
      case 'cases':
        modalStack.open(<NewCaseModal />);
        return;
      case 'tasks':
        modalStack.open(<TaskModal />);
        return;
      case 'financeDetail':
        modalStack.open(<AddPaymentModal />);
        return;
      case 'calendar':
        modalStack.open(<NewCalendarAppointmentModal />);
        return;
      case 'documents':
        // Source line 5007: showNewDocumentModal opens NewEventModal with the
        // event-type select pre-set to 'document'. We replicate by passing
        // preselectedType — and use a "מסמך חדש" title that matches the
        // documents screen context.
        modalStack.open(
          <NewEventModal
            preselectedType="document"
            titleOverride={settingsText('מסמך חדש', 'مستند جديد')}
          />,
        );
        return;
      // Fallback (e.g. home tab if it ever had a quick-action) → generic new event
      default:
        modalStack.open(<NewEventModal />);
    }
  };

  return (
    <header className={'topbar' + (isHome ? ' home-topbar' : '')} id="topbar">
      {isHome ? (
        // Home topbar: office logo + name + address replace the page title.
        // The greeting that used to sit here ("יום טוב, אשרף") now lives
        // inside the HomeDashboard so it can be centered between the
        // top-row cards.
        <div className="home-brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/office-logo.svg"
            alt={brandName}
            className="home-brand-logo"
          />
          <div className="home-brand-text">
            <b className="home-brand-name">{brandName}</b>
            <span className="home-brand-address">{brandAddress}</span>
          </div>
        </div>
      ) : (
        <>
          <div className="page-title">
            <h1>{pageTitle(state.currentTab, t, lang)}</h1>
            <p>{subtitle}</p>
          </div>

          {/* Mobile office identity — ALWAYS renders with fallback values
           * so the mobile-non-home topbar can show office name (row 1)
           * + address (row 2) like the home topbar, even when the user
           * hasn't entered office details in Settings yet. Previously
           * the JSX gated the whole block on `officeName || officeAddress`
           * being truthy, which left mobile users with empty defaults
           * seeing no office identity at all. */}
          <div className="mobile-office-identity">
            <span className="mobile-office-name">
              {state.officeName || t('firmName')}
            </span>
            <span className="mobile-office-address">
              {state.officeAddress ||
                settingsText('הסורג 2, ירושלים', 'السورج 2، القدس')}
            </span>
          </div>
        </>
      )}

      <div className="actions">
        {isHome && (
          <div className="home-only-settings-wrap">
            <button
              type="button"
              className="mini-btn home-settings-only-btn"
              id="homeSettingsOnlyBtn"
              aria-haspopup="dialog"
              onClick={() => modalStack.open(<SettingsDrawer />)}
            >
              <i className="fas fa-gear" />
              {/* Inline SVG gear — visible only on mobile dark mode via CSS.
                 Provides a guaranteed black gear that doesn't depend on FA
                 font loading or background-image cascade fights. */}
              <svg
                className="topbar-mobile-dark-icon topbar-mobile-dark-icon-gear"
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 512 512"
                aria-hidden="true"
              >
                <path
                  fill="#000000"
                  d="M495.9 166.6c3.2 8.7 .5 18.4-6.4 24.6l-43.3 39.4c1.1 8.3 1.7 16.8 1.7 25.4s-.6 17.1-1.7 25.4l43.3 39.4c6.9 6.2 9.6 15.9 6.4 24.6c-4.4 11.9-9.7 23.3-15.8 34.3l-4.7 8.1c-6.6 11-14 21.4-22.1 31.2c-5.9 7.2-15.7 9.6-24.5 6.8l-55.7-17.7c-13.4 10.3-28.2 18.9-44 25.4l-12.5 57.1c-2 9.1-9 16.3-18.2 17.8c-13.8 2.3-28 3.5-42.5 3.5s-28.7-1.2-42.5-3.5c-9.2-1.5-16.2-8.7-18.2-17.8l-12.5-57.1c-15.8-6.5-30.6-15.1-44-25.4L83.1 425.9c-8.8 2.8-18.6 .3-24.5-6.8c-8.1-9.8-15.5-20.2-22.1-31.2l-4.7-8.1c-6.1-11-11.4-22.4-15.8-34.3c-3.2-8.7-.5-18.4 6.4-24.6l43.3-39.4C64.6 273.1 64 264.6 64 256s.6-17.1 1.7-25.4L22.4 191.2c-6.9-6.2-9.6-15.9-6.4-24.6c4.4-11.9 9.7-23.3 15.8-34.3l4.7-8.1c6.6-11 14-21.4 22.1-31.2c5.9-7.2 15.7-9.6 24.5-6.8l55.7 17.7c13.4-10.3 28.2-18.9 44-25.4l12.5-57.1c2-9.1 9-16.3 18.2-17.8C227.3 1.2 241.5 0 256 0s28.7 1.2 42.5 3.5c9.2 1.5 16.2 8.7 18.2 17.8l12.5 57.1c15.8 6.5 30.6 15.1 44 25.4l55.7-17.7c8.8-2.8 18.6-.3 24.5 6.8c8.1 9.8 15.5 20.2 22.1 31.2l4.7 8.1c6.1 11 11.4 22.4 15.8 34.3zM256 336a80 80 0 1 0 0-160 80 80 0 1 0 0 160z"
                />
              </svg>
              <span> {t('settings')}</span>
            </button>
          </div>
        )}

        {qa && (
          <button
            type="button"
            id="quickAction"
            className="btn btn-primary"
            onClick={onQuickAction}
          >
            <span className="qa-icon-stack">
              <i
                className={'fas ' + qa.iconClass + ' nav-icon-' + qa.navColorKey + ' qa-base-icon'}
              />
              <span aria-hidden="true" className="qa-plus-badge">
                +
              </span>
            </span>
            {/* Inline SVG green calendar — ONLY on home tab (newEvent
               quick-action). Other tabs' quick-actions (newCase, newClient,
               newAppointment, etc.) keep using the FA icon, so the green
               calendar doesn't paint over their existing icons. */}
            {isHome && (
              <svg
                className="topbar-mobile-dark-icon topbar-mobile-dark-icon-calendar"
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 448 512"
                aria-hidden="true"
              >
                <path
                  fill="#10B981"
                  d="M152 24c0-13.3-10.7-24-24-24s-24 10.7-24 24V64H64C28.7 64 0 92.7 0 128v16 48V448c0 35.3 28.7 64 64 64H384c35.3 0 64-28.7 64-64V192 144 128c0-35.3-28.7-64-64-64H344V24c0-13.3-10.7-24-24-24s-24 10.7-24 24V64H152V24zM48 192H400V448c0 8.8-7.2 16-16 16H64c-8.8 0-16-7.2-16-16V192z"
                />
              </svg>
            )}
            <span className="quick-label">{qaLabel}</span>
          </button>
        )}
      </div>
    </header>
  );
}
