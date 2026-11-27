'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { useAppState } from './useAppState';
import { useModalStack } from './useModalStack';
import {
  endAnnexPick,
  getAnnexPickState,
  queueAnnexDelivery,
  setAnnexPickLoading,
  subscribeAnnexPick,
  type AnnexPickState,
} from '@/lib/annexPick';
import { fetchFilingDocumentFile } from '@/lib/disk';

const SERVER_STATE: AnnexPickState = { target: null, loading: false };

/**
 * For screens that list a case's documents. While the annexes screen is
 * waiting for a document (`picking`), a double-click on a document should call
 * `pick(doc)` instead of opening the preview: the file is fetched, handed to
 * the annexes screen, every open window is closed and the annexes screen is
 * shown again. See lib/annexPick.ts.
 */
export function useAnnexPick() {
  const { state: app, dispatch } = useAppState();
  const modalStack = useModalStack();
  const pickState = useSyncExternalStore(subscribeAnnexPick, getAnnexPickState, () => SERVER_STATE);
  const lang = app.currentLang;

  const pick = useCallback(
    async (doc: { relativePath?: string | null; fileName?: string | null; title?: string | null }) => {
      const current = getAnnexPickState();
      if (!current.target || current.loading) return;

      if (!doc.relativePath) {
        window.alert(
          lang === 'ar' ? 'لم يتم حفظ ملف لهذا المستند.' : 'לא נשמר קובץ עבור מסמך זה.',
        );
        return;
      }

      setAnnexPickLoading(true);
      const file = await fetchFilingDocumentFile(doc, lang);
      // The user may have cancelled while the file was on its way
      const target = getAnnexPickState().target;
      if (!target) return;

      if (!file) {
        setAnnexPickLoading(false);
        window.alert(
          lang === 'ar'
            ? 'تعذّر تحميل ملف المستند. حاول مرة أخرى.'
            : 'לא ניתן היה לטעון את קובץ המסמך. נסה שוב.',
        );
        return;
      }

      queueAnnexDelivery({ target, file });
      endAnnexPick();
      modalStack.closeAll();
      dispatch({ type: 'SET_TAB', tab: 'annexes' });
    },
    [dispatch, lang, modalStack],
  );

  return { picking: pickState.target !== null, loading: pickState.loading, pick };
}
