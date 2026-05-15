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

function quickActionForTab(tab: string): { label: string; iconClass: string } | null {
  // Source line 5192 maps each tab to a different "create" modal.
  switch (tab) {
    case 'home':
      // Home gets the generic "new event" quick-action, rendered next to the
      // gear button in the topbar actions group.
      return { label: 'newEvent', iconClass: 'fa-calendar-plus' };
    case 'finance':
    case 'portal':
      // Communication-with-client screen has no quick-create action.
      return null;
    case 'cases':
      return { label: 'newCase', iconClass: 'fa-plus' };
    case 'contacts':
      return { label: 'newClient', iconClass: 'fa-user-plus' };
    case 'calendar':
      return { label: 'newEvent', iconClass: 'fa-calendar-plus' };
    case 'documents':
      return { label: 'newDocument', iconClass: 'fa-file-circle-plus' };
    case 'tasks':
      return { label: 'newTask', iconClass: 'fa-square-plus' };
    case 'financeDetail':
      return { label: 'newPayment', iconClass: 'fa-plus' };
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
          : qa.label === 'newDocument'
            ? settingsText('+ מסמך חדש', '+ مستند جديد')
            : qa.label === 'newTask'
              ? settingsText('+ משימה חדשה', '+ مهمة جديدة')
              : qa.label === 'newPayment'
                ? settingsText('+ תשלום חדש', '+ دفعة جديدة')
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
        // Source line 5007: showNewDocumentModal opens NewEventModal then
        // flips the event-type select to 'document'. We replicate by opening
        // NewEventModal — the user picks 'document' from the type select.
        // Stage 5 polish: pre-select 'document'.
        modalStack.open(<NewEventModal />);
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

          {/* Mobile-only office identity row (Step 89 CSS at source line 2963) */}
          {(state.officeName || state.officeAddress) && (
            <div className="mobile-office-identity">
              <span className="mobile-office-name">
                {state.officeName || t('firmName')}
              </span>
              <span className="mobile-office-address">
                {state.officeAddress ||
                  settingsText('הסורג 2, ירושלים', 'السورج 2، القدس')}
              </span>
            </div>
          )}
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
            <i className={'fas ' + qa.iconClass} />
            <span>{qaLabel}</span>
          </button>
        )}
      </div>
    </header>
  );
}
