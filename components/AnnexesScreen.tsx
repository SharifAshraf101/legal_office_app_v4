'use client';

import { useT } from '@/hooks/useT';

/**
 * "ניהול נספחים" — the annexes program, shown inside the office system.
 *
 * The program is a separate project (LegalAppendDocs) whose browser build is
 * copied to public/annexes by scripts/sync-annexes.mjs. It runs entirely in
 * the browser: the documents the user adds are kept in the browser's own
 * storage and are never sent to a server, so it works for every office and
 * on any computer without extra setup.
 *
 * It lives in a frame so that its own styling and this app's styling cannot
 * affect each other.
 */
export function AnnexesScreen() {
  const { lang } = useT();
  return (
    <section className="annexes-screen">
      <iframe
        className="annexes-frame"
        src={`/annexes/index.html?lang=${lang}`}
        title={lang === 'ar' ? 'ادارة الملاحقات' : 'ניהול נספחים'}
      />
    </section>
  );
}
