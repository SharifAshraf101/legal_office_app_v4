'use client';

import { useEffect, useState } from 'react';
import { hasAdminToken } from '@/lib/officeToken';

/**
 * Full-screen language picker shown on first load.
 *
 * Markup matches the source HTML exactly:
 *   <div class="language-selector" id="languageSelector">
 *     <div class="language-panel">
 *       <div class="brand-mark"><i class="fas fa-gavel"></i></div>
 *       <h1>أشرف شريف</h1>
 *       <p>Legal Office Management</p>
 *       <div class="language-actions">
 *         <button class="language-card" id="btnHebrew">עברית</button>
 *         <button class="language-card" id="btnArabic">العربية</button>
 *       </div>
 *     </div>
 *   </div>
 *
 * Stage 2: just calls onChoose to swap to the main shell.
 * Stage 3: will also write law_lang to localStorage and update the
 * <html lang> attribute via a useEffect in AppShell.
 */
export function LanguageSelector({ onChoose }: { onChoose: (lang: 'he' | 'ar') => void }) {
  // Only the operator's own browser has ever stored the admin token, so the
  // admin link is shown ONLY there — every other office sees nothing.
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => {
    setIsAdmin(hasAdminToken());
  }, []);
  return (
    <div className="language-selector" id="languageSelector">
      <div className="language-panel">
        <div className="brand-mark brand-mark--logo">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/office-logo.svg"
            alt="أشرف شريف"
            className="brand-mark-logo"
          />
        </div>
        <h1>أشرف شريف</h1>
        <p>Legal Office Management</p>
        <div className="language-actions">
          <button
            type="button"
            className="language-card"
            id="btnHebrew"
            onClick={() => onChoose('he')}
          >
            עברית
          </button>
          <button
            type="button"
            className="language-card"
            id="btnArabic"
            onClick={() => onChoose('ar')}
          >
            العربية
          </button>
        </div>
        {/* Discreet operator entry to the standalone /admin console. Shown on
            every app open (this screen always appears first) BUT only on the
            operator's own device — gated on the stored admin token, so other
            offices never see it. */}
        {isAdmin && (
          <a
            href="/admin"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              marginTop: 24,
              color: '#8a8f98',
              fontSize: 12.5,
              fontWeight: 700,
              textDecoration: 'none',
              opacity: 0.85,
            }}
          >
            <i className="fas fa-user-shield" />
            ניהול מערכת
          </a>
        )}
      </div>
    </div>
  );
}
