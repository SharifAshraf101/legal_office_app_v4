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
            src="/office-logo.png"
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
            <span className="quick-label">{qaLabel}</span>
          </button>
        )}
      </div>
    </header>
  );
}
