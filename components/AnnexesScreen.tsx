'use client';

import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { useAppState } from '@/hooks/useAppState';
import { useModalStack } from '@/hooks/useModalStack';
import { useT } from '@/hooks/useT';
import { convertToPdfViaWorker } from '@/lib/cloudflare';
import {
  endAnnexPick,
  getAnnexPickState,
  startAnnexPick,
  subscribeAnnexDeliveries,
  subscribeAnnexPick,
  takeAnnexDeliveries,
  type AnnexPickState,
} from '@/lib/annexPick';

const SERVER_STATE: AnnexPickState = { target: null, loading: false };

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
 * affect each other. ScreenRouter keeps this component mounted after the first
 * visit and only hides it (`active` false) on other screens, so the work in
 * progress stays exactly as it was when the user comes back.
 *
 * The frame and this app talk through window messages (same origin only):
 *   frame → app   { type: 'annexes:pick-from-case', target }   "הוספה מתיקי לקוח"
 *   app → frame   { type: 'annexes:add-files', target, files } the chosen document
 *   frame → app   { type: 'annexes:convert', id, file }        a Word document to turn into PDF
 *   app → frame   { type: 'annexes:convert-result', id, … }    the PDF, or why not
 */
export function AnnexesScreen({ active }: { active: boolean }) {
  const { lang } = useT();
  const { dispatch } = useAppState();
  const modalStack = useModalStack();
  const frame = useRef<HTMLIFrameElement>(null);
  const pick = useSyncExternalStore(subscribeAnnexPick, getAnnexPickState, () => SERVER_STATE);

  // The language the frame was first opened with. Changing `src` later would
  // reload the frame and lose the work in progress, so a language switch is
  // sent to the running frame instead (below).
  const src = useRef(`/annexes/index.html?lang=${lang}`);

  // The office system's language is the annexes program's language. On load
  // it comes with the address (above); a later switch is sent as a message.
  useEffect(() => {
    frame.current?.contentWindow?.postMessage(
      { type: 'annexes:set-lang', lang },
      window.location.origin,
    );
  }, [lang]);

  // frame → app: the user pressed "הוספה מתיקי לקוח"
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.source !== frame.current?.contentWindow) return;
      const data = event.data as { type?: string; target?: string; id?: string; file?: unknown } | null;

      // The frame has no way to convert Office documents; the Worker does it
      if (data?.type === 'annexes:convert' && data.id && data.file instanceof File) {
        const { id, file } = data;
        const reply = (body: Record<string, unknown>) =>
          frame.current?.contentWindow?.postMessage(
            { type: 'annexes:convert-result', id, ...body },
            window.location.origin,
          );
        void convertToPdfViaWorker(file).then((result) =>
          result.ok ? reply({ ok: true, pdf: result.pdf }) : reply({ ok: false, reason: result.reason }),
        );
        return;
      }

      if (data?.type !== 'annexes:pick-from-case') return;
      startAnnexPick(data.target === 'main' ? 'main' : 'annex');
      dispatch({ type: 'SET_TAB', tab: 'contacts' });
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [dispatch]);

  // app → frame: hand over the documents that were chosen
  const deliver = useCallback(() => {
    const target = frame.current?.contentWindow;
    if (!target) return;
    for (const delivery of takeAnnexDeliveries()) {
      target.postMessage(
        { type: 'annexes:add-files', target: delivery.target, files: [delivery.file] },
        window.location.origin,
      );
    }
  }, []);

  useEffect(() => {
    deliver();
    return subscribeAnnexDeliveries(deliver);
  }, [deliver]);

  const cancelPick = () => {
    endAnnexPick();
    modalStack.closeAll();
    dispatch({ type: 'SET_TAB', tab: 'annexes' });
  };

  const ar = lang === 'ar';

  return (
    <>
      <section className="annexes-screen" hidden={!active}>
        <iframe
          ref={frame}
          className="annexes-frame"
          src={src.current}
          title={ar ? 'ادارة الملاحقات' : 'ניהול נספחים'}
        />
      </section>

      {pick.target && (
        <div className="annex-pick-banner" role="status">
          <i className={'fas ' + (pick.loading ? 'fa-spinner fa-spin' : 'fa-folder-open')} aria-hidden="true" />
          <span>
            {pick.loading
              ? ar
                ? 'جارٍ إضافة المستند إلى الملاحقات…'
                : 'מוסיף את המסמך לנספחים…'
              : ar
                ? 'اختر موكّلاً ثم ملفاً، وانقر نقراً مزدوجاً على المستند لإضافته إلى الملاحقات'
                : 'בחר לקוח ותיק, ולחץ לחיצה כפולה על מסמך כדי להוסיף אותו לנספחים'}
          </span>
          <button type="button" onClick={cancelPick} disabled={pick.loading}>
            {ar ? 'إلغاء' : 'ביטול'}
          </button>
        </div>
      )}
    </>
  );
}
