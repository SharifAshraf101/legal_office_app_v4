'use client';

import { useEffect, useRef } from 'react';
import { useAppState } from './useAppState';
import { planHearingImports } from '@/lib/hearings';
import { loadDecisionImportKeys, rememberDecisionImportKey } from '@/lib/tasks';
import { loadDismissedEventIds } from '@/lib/dismissedEvents';

/**
 * Keeps the calendar in step with the documents, for EVERY case.
 *
 * A hearing normally reaches the calendar from the make.com pipeline. When that
 * doesn't happen — the scenario errored, it doesn't handle that document type,
 * or the document was filed after it ran — the app used to stay silent: the case
 * kept showing its previous hearing and the new date existed nowhere. This sweep
 * closes that hole. It reads the hearing off each document's own AI summary (see
 * lib/hearings.ts for the extraction rules) and files whatever the calendar is
 * missing, on the document's OWN case.
 *
 * It runs over the whole dataset rather than per open case, so a hearing that
 * lands while nobody is looking at that case still shows up in the calendar and
 * on the home agenda.
 *
 * Safety:
 *   - only ADDs a hearing when nothing already covers that (case, day);
 *   - persists an import key per filed hearing, so one the user deletes is never
 *     re-created (same key namespace as the case-detail decision importer);
 *   - gated on `enabled`, which the shell only turns on once the office session's
 *     data has been pulled — otherwise the sweep would mark the state dirty and
 *     the boot pull would be skipped in favour of a stale local copy.
 */
export function useHearingSweep(enabled: boolean): void {
  const { state, dispatch } = useAppState();
  // The persisted key set is read once and then kept in sync in memory, so two
  // sweeps in the same session can't both file the same hearing.
  const keysRef = useRef<Set<string> | null>(null);

  useEffect(() => {
    if (!enabled) return;
    if (typeof window === 'undefined') return;
    if (!keysRef.current) keysRef.current = loadDecisionImportKeys();
    const keys = keysRef.current;

    // Debounced: a boot pull replaces every array at once, and the user may be
    // mid-edit. One pass after things settle is enough.
    const timer = window.setTimeout(() => {
      const plan = planHearingImports({
        documents: state.documentsArr,
        events: state.eventsList,
        cases: state.casesArr,
        importKeys: keys,
        dismissedIds: loadDismissedEventIds(),
      });
      if (!plan.add.length && !plan.retime.length) return;

      // Remember BEFORE dispatching: if the save later fails, the worst case is
      // a hearing that isn't re-filed automatically — never one filed twice.
      for (const r of plan.retime) rememberDecisionImportKey(keys, r.key);
      for (const a of plan.add) rememberDecisionImportKey(keys, a.key);

      // Retimes first (they rewrite the current array), then the additions —
      // ADD_EVENTS composes with the reducer's live state, so it appends to the
      // corrected list instead of overwriting it.
      if (plan.retime.length) {
        const byId = new Map(plan.retime.map((r) => [r.id, r.dateTime]));
        dispatch({
          type: 'SET_EVENTS',
          events: state.eventsList.map((e) => {
            const dateTime = byId.get(String(e.id));
            return dateTime ? { ...e, dateTime } : e;
          }),
        });
      }
      if (plan.add.length) {
        dispatch({ type: 'ADD_EVENTS', events: plan.add.map((a) => a.event) });
      }
    }, 1500);

    return () => window.clearTimeout(timer);
  }, [enabled, state.documentsArr, state.eventsList, state.casesArr, dispatch]);
}
