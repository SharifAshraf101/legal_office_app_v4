'use client';

import { useEffect, useState } from 'react';
import { LanguageSelector } from './LanguageSelector';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { MobileNav } from './MobileNav';
import { ScreenRouter } from './ScreenRouter';
import { DropboxConnectModal } from './DropboxConnectModal';
import { AppStateProvider, useAppState } from '@/hooks/useAppState';
import { useThemeAndFont } from '@/hooks/useThemeAndFont';
import { useAutoSync } from '@/hooks/useAutoSync';
import { ModalStackProvider, useModalStack } from '@/hooks/useModalStack';
import {
  handleDropboxAuthCallback,
  hasDropboxFolder,
  isDropboxConfigured,
} from '@/lib/dropbox';

/**
 * Top-level shell. Mirrors the original HTML structure:
 *
 *   #languageSelector  (full-screen overlay until a language is picked)
 *   #mainApp
 *     .app-shell
 *       aside.sidebar     (desktop nav)
 *       main.main
 *         header.topbar
 *         section.content (ScreenRouter switches by currentTab)
 *       nav.mobile-nav    (visible ≤1050px)
 *
 * Children are wrapped in:
 *   - AppStateProvider  (hooks/useAppState)
 *   - ModalStackProvider (hooks/useModalStack — replaces source's modal())
 */
export function AppShell() {
  return (
    <AppStateProvider>
      <ModalStackProvider>
        <ShellInner />
      </ModalStackProvider>
    </AppStateProvider>
  );
}

function ShellInner() {
  useThemeAndFont();
  useAutoSync();

  const { state, dispatch } = useAppState();
  const modalStack = useModalStack();

  // On first paint after a Dropbox auth redirect, the URL has `?code=...`.
  // Exchange it for tokens, then if no folder has been picked yet, open the
  // connect modal so the user can complete step 2 (folder selection).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const justAuthed = await handleDropboxAuthCallback();
      if (cancelled) return;
      // Open the connect modal when:
      //   - we just finished the OAuth code exchange (continues to folder picker), OR
      //   - tokens exist but no folder has been chosen yet
      if (justAuthed || (isDropboxConfigured() && !hasDropboxFolder())) {
        modalStack.open(<DropboxConnectModal />);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The language screen ALWAYS shows on every open and waits for an explicit
  // choice — we never auto-skip it based on a previously stored language. The
  // user must click Hebrew or Arabic, and the app then runs in that language.
  const [langChosen, setLangChosen] = useState(false);

  if (!langChosen) {
    return (
      <LanguageSelector
        onChoose={(lang) => {
          dispatch({ type: 'SET_LANG', lang });
          if (typeof localStorage !== 'undefined') {
            try { localStorage.setItem('law_lang', lang); } catch {}
          }
          setLangChosen(true);
        }}
      />
    );
  }

  // After the choice, hold for hydration to complete before the main shell
  // (it loads almost immediately, since the user reads the screen first).
  if (!state.hydrated) return null;

  return (
    <div id="mainApp">
      <div className="app-shell">
        <Sidebar />
        <main className="main">
          <Topbar />
          <section
            className={'content' + (state.currentTab === 'home' ? ' home-content' : '')}
            id="content"
          >
            <ScreenRouter />
          </section>
        </main>
        <MobileNav />
      </div>
    </div>
  );
}
