'use client';

import { useCallback, useEffect, useState } from 'react';
import { LanguageSelector } from './LanguageSelector';
import { LoginScreen } from './LoginScreen';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { MobileNav } from './MobileNav';
import { ScreenRouter } from './ScreenRouter';
import { SplashFlower } from './SplashFlower';
import { DropboxConnectModal } from './DropboxConnectModal';
import { AppStateProvider, useAppState } from '@/hooks/useAppState';
import { useThemeAndFont } from '@/hooks/useThemeAndFont';
import { useAutoSync } from '@/hooks/useAutoSync';
import { useTaskDeadlineAlerts } from '@/hooks/useTaskDeadlineAlerts';
import { ModalStackProvider, useModalStack } from '@/hooks/useModalStack';
import {
  handleDropboxAuthCallback,
  hasDropboxFolder,
  isDropboxConfigured,
} from '@/lib/dropbox';
import { hasOfficeToken } from '@/lib/officeToken';

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

  const { state, dispatch, reloadFromSupabase } = useAppState();
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
  // The intro flower splash plays once, right after the language is chosen, and
  // masks the brief hydration wait. It removes itself when its animation ends.
  const [splashDone, setSplashDone] = useState(false);
  const finishSplash = useCallback(() => setSplashDone(true), []);

  // Auth gate: after a language is chosen, an office session is required.
  // Returning offices (token in localStorage) skip straight to the app; new
  // ones see the login screen. Synced from storage on mount — which happens
  // while the language screen is still up, so there's no login-screen flash.
  const [authed, setAuthed] = useState(false);
  useEffect(() => {
    setAuthed(hasOfficeToken());
  }, []);
  const onAuthed = useCallback(() => {
    setAuthed(true);
    // Pull THIS office's data with the freshly-issued session token.
    void reloadFromSupabase();
  }, [reloadFromSupabase]);

  // Professional task-deadline alert on open (and while open when a task crosses
  // the 3-day / 1-day / today / overdue mark). Gated on the app being ready so
  // it never shows over the language screen or before data hydrates.
  useTaskDeadlineAlerts(langChosen && authed && state.hydrated && splashDone);

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

  // Second gate: require a logged-in office before the app (and its data sync)
  // come up. New offices sign up here (then wait for approval); existing ones
  // sign in and land straight in the app.
  if (!authed) {
    return <LoginScreen lang={state.currentLang} onAuthed={onAuthed} />;
  }

  // After the choice, the flower splash plays on top while the app hydrates
  // (which finishes almost immediately). The main shell renders underneath once
  // hydrated, so when the splash dissolves the app is already there.
  return (
    <>
      {state.hydrated && (
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
      )}
      {!splashDone && <SplashFlower onDone={finishSplash} />}
    </>
  );
}
