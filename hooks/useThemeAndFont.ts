'use client';

import { useEffect } from 'react';
import { useAppState } from './useAppState';
import { selectedFontCss } from '@/lib/translations';

/**
 * Reactive theme + font binding. Replaces the imperative DOM patches from
 * source scripts v202, v203, v204, v182, v183 (theme + font-size + font-family
 * toggles) with one effect driven by reducer state.
 *
 * It:
 *  - toggles `<body class="dark">` when currentTheme === 'dark'
 *  - sets the `<html lang>` attribute when currentLang changes
 *  - sets a CSS variable `--app-font-family` that the source CSS already reads
 *    (line 61 of the source: `font-family: var(--app-font-family, Inter, ...)`).
 *  - applies a `data-font-size` attribute on `<body>` for CSS to size from
 */
export function useThemeAndFont(): void {
  const { state } = useAppState();

  // Body class for theme. We set BOTH `dark` and `light` explicit
  // classes (not just `dark`) so the CSS prefers-color-scheme block
  // in globals.css knows when the user has made an explicit choice
  // vs when it should fall back to the OS preference.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.body.classList.toggle('dark', state.currentTheme === 'dark');
    document.body.classList.toggle('light', state.currentTheme === 'light');
  }, [state.currentTheme]);

  // <html lang>
  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.lang = state.currentLang;
  }, [state.currentLang]);

  // Font family — sets the same CSS var the source already consumes.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const css = selectedFontCss(state.currentLang, state.currentFontFamily);
    document.documentElement.style.setProperty('--app-font-family', css);
  }, [state.currentLang, state.currentFontFamily]);

  // Font size — exposed as a data attribute so CSS can scope by it.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.body.setAttribute('data-font-size', state.currentFontSize);
  }, [state.currentFontSize]);
}
