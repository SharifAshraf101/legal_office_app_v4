'use client';

import { useEffect } from 'react';

/**
 * Intro splash shown once, right after the language is picked and before the
 * main shell. A small four-petal flower grows and blooms open, then the whole
 * overlay dissolves to reveal the app underneath. Purely decorative — it calls
 * `onDone` after the animation so AppShell can drop it (and, while it plays, it
 * masks the brief hydration wait).
 *
 * Styling + keyframes live in globals.css (`.splash-flower*`) and use the app's
 * theme tokens (var(--primary) / --surface / --bg / --accent) so it matches
 * light and dark. Total run ~2.2s; the timer is the single source of truth for
 * when the app takes over (the CSS timeline is tuned to finish just before it).
 */
export function SplashFlower({ onDone }: { onDone: () => void }) {
  // Hand control to the app when the animation finishes. `onDone` must be stable
  // (AppShell wraps it in useCallback) so this timer isn't reset on re-render.
  useEffect(() => {
    const t = setTimeout(onDone, 2200);
    return () => clearTimeout(t);
  }, [onDone]);

  return (
    <div className="splash-flower" role="presentation" aria-hidden="true">
      <div className="splash-flower__glow" />
      <div className="splash-flower__flower">
        <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
          {/* Each petal is a rounded-rectangle "card" whose gradient matches one
              of the four home-screen cards (cyan / purple / gold / teal), vivid
              toward the centre and darkening at the tip like the real cards. */}
          <defs>
            <linearGradient id="sfCard1" x1="0.5" y1="1" x2="0.5" y2="0">
              <stop offset="0" stopColor="#9de7ff" />
              <stop offset="0.58" stopColor="#6fd0ef" />
              <stop offset="1" stopColor="#4f5965" />
            </linearGradient>
            <linearGradient id="sfCard2" x1="0" y1="0.5" x2="1" y2="0.5">
              <stop offset="0" stopColor="#c7b4ff" />
              <stop offset="0.58" stopColor="#a78bfa" />
              <stop offset="1" stopColor="#64606f" />
            </linearGradient>
            <linearGradient id="sfCard3" x1="0.5" y1="0" x2="0.5" y2="1">
              <stop offset="0" stopColor="#ffd37c" />
              <stop offset="0.58" stopColor="#f5bd4d" />
              <stop offset="1" stopColor="#4f5965" />
            </linearGradient>
            <linearGradient id="sfCard4" x1="1" y1="0.5" x2="0" y2="0.5">
              <stop offset="0" stopColor="#83e3d7" />
              <stop offset="0.58" stopColor="#5ed0c4" />
              <stop offset="1" stopColor="#4f5965" />
            </linearGradient>
          </defs>
          {/* top → right → bottom → left, bloom in sequence; brand tile last. */}
          <rect className="splash-petal splash-petal--1" x="36" y="7" width="28" height="41" rx="8" fill="url(#sfCard1)" />
          <rect className="splash-petal splash-petal--2" x="52" y="36" width="41" height="28" rx="8" fill="url(#sfCard2)" />
          <rect className="splash-petal splash-petal--3" x="36" y="52" width="28" height="41" rx="8" fill="url(#sfCard3)" />
          <rect className="splash-petal splash-petal--4" x="7" y="36" width="41" height="28" rx="8" fill="url(#sfCard4)" />
          <rect className="splash-flower__center" x="37" y="37" width="26" height="26" rx="7" />
        </svg>
      </div>
    </div>
  );
}
