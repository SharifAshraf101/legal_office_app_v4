'use client';

import { useEffect, useState } from 'react';
import { useAppState } from '@/hooks/useAppState';
import { useBackHandler } from '@/hooks/useBackHandler';
import { useWhatsAppEnabled } from '@/hooks/useIsOperatorOffice';
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
import { AnalyticsScreen } from './AnalyticsScreen';
import { BriefingScreen } from './BriefingScreen';
import { AnnexesScreen } from './AnnexesScreen';

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
  const { state, dispatch } = useAppState();
  // The phone's BACK on a main screen does what its back button does: Home.
  // On Home itself it does nothing — the app stays open instead of closing
  // (and restarting from scratch the next time it is opened).
  useBackHandler(true, () => {
    if (state.currentTab !== 'home') dispatch({ type: 'SET_TAB', tab: 'home' });
  });
  const waEnabled = useWhatsAppEnabled();

  // The annexes program keeps its work in progress only while its frame is
  // alive. Once the screen has been opened it therefore stays mounted — hidden
  // on other screens — so leaving it (to pick a document from a client's case,
  // or just to look something up) does not disturb what the user was building.
  const onAnnexes = state.currentTab === 'annexes';
  const [annexesOpened, setAnnexesOpened] = useState(false);
  useEffect(() => {
    if (onAnnexes) setAnnexesOpened(true);
  }, [onAnnexes]);

  return (
    <>
      {(annexesOpened || onAnnexes) && <AnnexesScreen active={onAnnexes} />}
      {!onAnnexes && <ActiveScreen tab={state.currentTab} waEnabled={waEnabled} portalNavNonce={state.portalNavNonce} />}
    </>
  );
}

function ActiveScreen({
  tab,
  waEnabled,
  portalNavNonce,
}: {
  tab: string;
  waEnabled: boolean;
  portalNavNonce: number;
}) {
  // The portal needs WhatsApp: the operator's original number, or an office
  // that connected its own (each office then reads and sends only its own).
  // Without it the tab is hidden — and a stale `currentTab` restored from a
  // previous session falls back home.
  if (tab === 'portal' && !waEnabled) {
    return <HomeDashboard />;
  }

  switch (tab) {
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
      return <PortalScreen key={portalNavNonce} />;
    case 'search':
      return <GlobalSearchScreen />;
    case 'analytics':
      return <AnalyticsScreen />;
    case 'briefing':
      return <BriefingScreen />;
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
