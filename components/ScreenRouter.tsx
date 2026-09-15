'use client';

import { useAppState } from '@/hooks/useAppState';
import { useIsOperatorOffice } from '@/hooks/useIsOperatorOffice';
import { HomeDashboard } from './HomeDashboard';
import { ClientsScreen } from './ClientsScreen';
import { CasesScreen } from './CasesScreen';
import { CalendarScreen } from './CalendarScreen';
import { TasksScreen } from './TasksScreen';
import { FinanceScreen } from './FinanceScreen';
import { FinanceDetail } from './FinanceDetail';
import { DocumentsScreen } from './DocumentsScreen';
import { PortalScreen } from './PortalScreen';
import { GlobalSearchScreen } from './GlobalSearchScreen';

/**
 * Switches on `currentTab` to render the active screen. Port of
 * renderContent() at source line 5080:
 *
 *   home          -> renderHome
 *   cases         -> renderCases
 *   contacts      -> renderContacts
 *   finance       -> renderFinance
 *   financeDetail -> renderFinanceDetail
 *   documents     -> renderDocuments
 *   tasks         -> renderTasks
 *   calendar      -> renderCalendar
 *   *             -> renderPortal
 *
 * Stage 4a-1 only ships HomeDashboard. The other screens fall through to a
 * "coming in Stage 4..." placeholder so the app is usable end-to-end while
 * the rest of the screens land in subsequent sub-stages.
 */
export function ScreenRouter() {
  const { state } = useAppState();
  const isOperator = useIsOperatorOffice();

  // The portal sends from the OPERATOR's WhatsApp number and reads the
  // operator's conversations, so a tenant office must not reach it — not via
  // the nav (already hidden) and not via a stale `currentTab` restored from a
  // previous session. Fall back home.
  if (state.currentTab === 'portal' && !isOperator) {
    return <HomeDashboard />;
  }

  switch (state.currentTab) {
    case 'home':
      return <HomeDashboard />;
    case 'contacts':
      return <ClientsScreen />;
    case 'cases':
      return <CasesScreen />;
    case 'calendar':
      return <CalendarScreen />;
    case 'tasks':
      return <TasksScreen />;
    case 'finance':
      return <FinanceScreen />;
    case 'financeDetail':
      return <FinanceDetail />;
    case 'documents':
      return <DocumentsScreen />;
    case 'portal':
      // `key` remounts the communication centre whenever the portal tab is
      // (re)clicked — so the sidebar button returns to its main screen even
      // when the user is already inside a chat / bot / search sub-screen.
      return <PortalScreen key={state.portalNavNonce} />;
    case 'search':
      return <GlobalSearchScreen />;
    default:
      return <HomeDashboard />;
  }
}

function ComingSoon({ stage, name }: { stage: string; name: string }) {
  return (
    <section className="panel" style={{ padding: 28, textAlign: 'center' }}>
      <h2 style={{ margin: 0 }}>{name}</h2>
      <p style={{ color: 'var(--muted)', marginTop: 8 }}>
        Coming in Stage {stage} of the port.
      </p>
    </section>
  );
}
