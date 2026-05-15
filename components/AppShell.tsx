'use client';

import { LanguageSelector } from './LanguageSelector';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { MobileNav } from './MobileNav';
import { ScreenRouter } from './ScreenRouter';
import { AppStateProvider, useAppState } from '@/hooks/useAppState';
import { useThemeAndFont } from '@/hooks/useThemeAndFont';
import { useAutoSync } from '@/hooks/useAutoSync';
import { ModalStackProvider } from '@/hooks/useModalStack';

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

  const hasChosenLanguage =
    state.hydrated &&
    (state.currentLang === 'he' || state.currentLang === 'ar') &&
    hasStoredLang();

  if (!hasChosenLanguage) {
    return (
      <LanguageSelector
        onChoose={(lang) => {
          dispatch({ type: 'SET_LANG', lang });
          if (typeof localStorage !== 'undefined') {
            try { localStorage.setItem('law_lang', lang); } catch {}
          }
        }}
      />
    );
  }

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

function hasStoredLang(): boolean {
  if (typeof localStorage === 'undefined') return false;
  try {
    const v = localStorage.getItem('law_lang');
    return v === 'he' || v === 'ar';
  } catch {
    return false;
  }
}
