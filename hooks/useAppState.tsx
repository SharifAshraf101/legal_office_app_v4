'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  applyLegalOfficeData,
  fontFamilyKey,
  loadData,
  loadUserSettings,
  LS,
  lsGet,
  lsSet,
  persistCurrentDataToLocalStorage,
} from '@/lib/storage';
import {
  legalOfficeLoadFromSupabaseV88,
  legalOfficeSaveToSupabase,
} from '@/lib/cloudflare';
import { normalizeFontFamily } from '@/lib/translations';
import type {
  AppState,
  Case,
  CalendarEvent,
  Client,
  DocumentRecord,
  FontSize,
  Finance,
  Lang,
  LegalOfficeBackup,
  Task,
  Theme,
  TimelineItem,
} from '@/types';

// ---------------------------------------------------------------------------
// Initial state. Matches the source's top-level let bindings (lines 3027-3039).
// `hydrated` is false until the first useEffect on the client populates from
// localStorage; this keeps SSR output deterministic.
// ---------------------------------------------------------------------------

const initialState: AppState = {
  hydrated: false,
  clients: [],
  casesArr: [],
  eventsList: [],
  finances: [],
  timelineItems: [],
  tasksArr: [],
  documentsArr: [],
  currentLang: 'he',
  currentTheme: 'light',
  currentTab: 'home',
  portalNavNonce: 0,
  calendarView: 'list',
  calendarFocusDate: new Date().toISOString(),
  selectedFinanceCaseId: '',
  selectedPortalClientId: '',
  currentFontSize: 'normal',
  currentFontFamily: '',
  showUpcomingHome: true,
  officeName: '',
  officeAddress: '',
  // Minimalist is the default look for new installs (classic + modern
  // are opt-in via Settings → "עיצוב הבית").
  homeStyle: 'minimalist',
};

// ---------------------------------------------------------------------------
// Actions. Names chosen to map onto the source's mutations so screen code
// being ported in Stage 4 reads naturally.
// ---------------------------------------------------------------------------

export type Action =
  | { type: 'HYDRATE'; payload: Partial<AppState> }
  | { type: 'REPLACE_ALL'; payload: Partial<AppState> }
  | { type: 'SET_LANG'; lang: Lang }
  | { type: 'SET_THEME'; theme: Theme }
  | { type: 'SET_TAB'; tab: string }
  | { type: 'SET_CALENDAR_VIEW'; view: AppState['calendarView'] }
  | { type: 'SET_CALENDAR_FOCUS'; date: Date | string }
  | { type: 'SET_FINANCE_CASE'; caseId: string }
  | { type: 'SET_PORTAL_CLIENT'; clientId: string }
  | { type: 'SET_FONT_SIZE'; size: FontSize }
  | { type: 'SET_FONT_FAMILY'; family: string }
  | { type: 'SET_SHOW_UPCOMING'; show: boolean }
  | { type: 'SET_OFFICE_NAME'; name: string }
  | { type: 'SET_OFFICE_ADDRESS'; address: string }
  | { type: 'SET_HOME_STYLE'; style: 'modern' | 'classic' | 'minimalist' }
  | { type: 'SET_CLIENTS'; clients: Client[] }
  | { type: 'SET_CASES'; cases: Case[] }
  | { type: 'SET_EVENTS'; events: CalendarEvent[] }
  | { type: 'SET_TASKS'; tasks: Task[] }
  | { type: 'SET_FINANCES'; finances: Finance[] }
  | { type: 'SET_DOCUMENTS'; documents: DocumentRecord[] }
  | { type: 'SET_TIMELINE'; timeline: TimelineItem[] };

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'HYDRATE':
    case 'REPLACE_ALL':
      return { ...state, ...action.payload, hydrated: true };
    case 'SET_LANG':
      return { ...state, currentLang: action.lang };
    case 'SET_THEME':
      return { ...state, currentTheme: action.theme };
    case 'SET_TAB':
      // Bump the portal nonce every time the portal tab is selected — including
      // a re-click while already on it — so ScreenRouter remounts PortalScreen
      // and the communication centre resets to its main screen.
      return {
        ...state,
        currentTab: action.tab,
        portalNavNonce:
          action.tab === 'portal'
            ? state.portalNavNonce + 1
            : state.portalNavNonce,
      };
    case 'SET_CALENDAR_VIEW':
      return { ...state, calendarView: action.view };
    case 'SET_CALENDAR_FOCUS': {
      const iso =
        typeof action.date === 'string' ? action.date : action.date.toISOString();
      return { ...state, calendarFocusDate: iso };
    }
    case 'SET_FINANCE_CASE':
      return { ...state, selectedFinanceCaseId: action.caseId };
    case 'SET_PORTAL_CLIENT':
      return { ...state, selectedPortalClientId: action.clientId };
    case 'SET_FONT_SIZE':
      return { ...state, currentFontSize: action.size };
    case 'SET_FONT_FAMILY':
      return { ...state, currentFontFamily: action.family };
    case 'SET_SHOW_UPCOMING':
      return { ...state, showUpcomingHome: action.show };
    case 'SET_OFFICE_NAME':
      return { ...state, officeName: action.name };
    case 'SET_OFFICE_ADDRESS':
      return { ...state, officeAddress: action.address };
    case 'SET_HOME_STYLE':
      return { ...state, homeStyle: action.style };
    case 'SET_CLIENTS':
      return { ...state, clients: action.clients };
    case 'SET_CASES':
      return { ...state, casesArr: action.cases };
    case 'SET_EVENTS':
      return { ...state, eventsList: action.events };
    case 'SET_TASKS':
      return { ...state, tasksArr: action.tasks };
    case 'SET_FINANCES':
      return { ...state, finances: action.finances };
    case 'SET_DOCUMENTS':
      return { ...state, documentsArr: action.documents };
    case 'SET_TIMELINE':
      return { ...state, timelineItems: action.timeline };
    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

interface AppStateContextValue {
  state: AppState;
  dispatch: React.Dispatch<Action>;
  /** Replace all domain data from a backup JSON, mirroring applyLegalOfficeData. */
  loadBackup: (data: Partial<LegalOfficeBackup>) => void;
  /** Trigger the v88 Supabase boot loader manually (e.g. user pressed "refresh"). */
  reloadFromSupabase: () => Promise<boolean>;
}

const AppStateContext = createContext<AppStateContextValue | null>(null);

// Only these action types represent user-initiated edits to the savable
// domain data (clients, cases, events, tasks, finances, documents,
// timeline). Auto-save fires only when the dirty flag is set by one of
// these actions — REPLACE_ALL/HYDRATE and settings actions (lang/theme/
// font/etc.) MUST NOT mark the state dirty, or the auto-save would push
// the just-pulled Supabase data back over a concurrent edit from another
// device.
const SAVABLE_ACTION_TYPES = new Set<Action['type']>([
  'SET_CLIENTS',
  'SET_CASES',
  'SET_EVENTS',
  'SET_TASKS',
  'SET_FINANCES',
  'SET_DOCUMENTS',
  'SET_TIMELINE',
]);

// Backend table keys the app owns and can delete from — the same keys the save
// payload uses. Order/naming must match lib/cloudflare.ts's save body and the
// Worker's DELETABLE_TABLES whitelist.
const DELETION_TABLES = [
  'clients',
  'cases',
  'tasks',
  'calendar_events',
  'documents',
  'payments',
  'timeline_items',
] as const;

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [state, rawDispatch] = useReducer(reducer, initialState);
  // Always-current snapshot of state. Read by the dispatch wrapper (to diff
  // deletions against the PREVIOUS committed state) and by the visibility/poll
  // flush. Kept in sync by an effect further below.
  const stateRef = useRef(state);
  // dirtyRef tracks whether the in-memory state holds un-pushed user
  // edits. Only flipped to true by wrappedDispatch (consumer-facing
  // dispatches); REPLACE_ALL/HYDRATE go through rawDispatch and leave
  // it false. Auto-save flushes dirty=true, then resets to false.
  const dirtyRef = useRef(false);

  // Un-synced deletions: source_ids the user removed locally, per backend
  // table, that the next save must delete server-side (an upsert alone can't
  // remove rows). Kept in a ref so recording one never triggers a render, and
  // mirrored to localStorage so a reload before the sync still propagates them.
  const pendingDeletionsRef = useRef<Record<string, Set<string>>>(
    Object.fromEntries(
      DELETION_TABLES.map((t) => [t, new Set<string>()] as [string, Set<string>]),
    ),
  );
  const persistDeletions = useCallback(() => {
    const out: Record<string, string[]> = {};
    let any = false;
    for (const t of DELETION_TABLES) {
      const arr = [...pendingDeletionsRef.current[t]];
      if (arr.length) {
        out[t] = arr;
        any = true;
      }
    }
    lsSet(LS.PENDING_DELETIONS, any ? JSON.stringify(out) : '');
  }, []);
  const snapshotDeletions = useCallback((): Record<string, string[]> => {
    const out: Record<string, string[]> = {};
    for (const t of DELETION_TABLES) {
      const arr = [...pendingDeletionsRef.current[t]];
      if (arr.length) out[t] = arr;
    }
    return out;
  }, []);
  // Remove only the ids that were in the snapshot handed to a save, so a
  // deletion recorded WHILE that save was in flight survives for the next one.
  const clearDeletions = useCallback(
    (snapshot: Record<string, string[]>) => {
      for (const t of DELETION_TABLES) {
        const ids = snapshot[t];
        if (!ids) continue;
        const set = pendingDeletionsRef.current[t];
        ids.forEach((id) => set.delete(id));
      }
      persistDeletions();
    },
    [persistDeletions],
  );
  // Diff a savable array-replace action against the previous state to learn
  // which source_ids were removed (→ mark for deletion) or re-added (→ unmark).
  const recordDeletions = useCallback(
    (action: Action, prev: AppState) => {
      let table = '';
      let prevArr: Array<{ id?: string }> = [];
      let nextArr: Array<{ id?: string }> = [];
      switch (action.type) {
        case 'SET_CLIENTS':   table = 'clients';         prevArr = prev.clients;       nextArr = action.clients;   break;
        case 'SET_CASES':     table = 'cases';           prevArr = prev.casesArr;      nextArr = action.cases;     break;
        case 'SET_EVENTS':    table = 'calendar_events'; prevArr = prev.eventsList;    nextArr = action.events;    break;
        case 'SET_TASKS':     table = 'tasks';           prevArr = prev.tasksArr;      nextArr = action.tasks;     break;
        case 'SET_FINANCES':  table = 'payments';        prevArr = prev.finances;      nextArr = action.finances;  break;
        case 'SET_DOCUMENTS': table = 'documents';       prevArr = prev.documentsArr;  nextArr = action.documents; break;
        case 'SET_TIMELINE':  table = 'timeline_items';  prevArr = prev.timelineItems; nextArr = action.timeline;  break;
        default:
          return;
      }
      const set = pendingDeletionsRef.current[table];
      if (!set) return;
      const nextIds = new Set(nextArr.map((x) => String(x?.id || '')).filter(Boolean));
      let changed = false;
      for (const x of prevArr) {
        const id = String(x?.id || '');
        if (id && !nextIds.has(id) && !set.has(id)) {
          set.add(id);
          changed = true;
        }
      }
      for (const id of nextIds) {
        if (set.has(id)) {
          set.delete(id);
          changed = true;
        }
      }
      if (changed) persistDeletions();
    },
    [persistDeletions],
  );

  const dispatch = useCallback(
    (action: Action) => {
      if (SAVABLE_ACTION_TYPES.has(action.type)) {
        dirtyRef.current = true;
        // Persist the dirty state so a reload BEFORE the debounced save fires
        // (e.g. add a payment, then refresh) knows to flush the local copy to
        // the backend before pulling — otherwise the boot pull would wipe the
        // edit.
        lsSet(LS.PENDING_SYNC, '1');
        // Learn which rows (if any) this array-replace removed, so the save can
        // delete them server-side instead of leaving orphans in D1.
        recordDeletions(action, stateRef.current);
      }
      rawDispatch(action);
    },
    [recordDeletions],
  );
  // Gates Supabase auto-save until the v88 loader has settled — without this
  // a stale localStorage cache would upsert OVER newer Supabase rows during
  // the few-hundred-ms boot window before REPLACE_ALL fires.
  const [supaSaveReady, setSupaSaveReady] = useState(false);

  // -----------------------------------------------------------------------
  // Hydration: on first client-side mount, populate from localStorage. If
  // Supabase has rows newer than the cached data, the v88 loader overrides.
  // -----------------------------------------------------------------------
  useEffect(() => {
    const settings = loadUserSettings();
    const data = loadData();

    // Restore any un-synced deletions from a previous session so the boot flush
    // (and later saves) still remove those rows from the backend.
    try {
      const rawDels = lsGet(LS.PENDING_DELETIONS);
      if (rawDels) {
        const parsed = JSON.parse(rawDels) as Record<string, string[]>;
        for (const t of DELETION_TABLES) {
          const ids = parsed[t];
          if (Array.isArray(ids)) {
            ids.forEach((id) => pendingDeletionsRef.current[t].add(String(id)));
          }
        }
      }
    } catch {
      /* ignore a malformed deletions cache */
    }

    // Normalize the font family for the loaded language, matching the source's
    // `normalizeFontFamily()` call in loadUserSettings (line 5228).
    const family = normalizeFontFamily(settings.currentLang, settings.currentFontFamily);

    dispatch({
      type: 'HYDRATE',
      payload: {
        clients: data.clients,
        casesArr: data.casesArr,
        eventsList: data.eventsList,
        finances: data.finances,
        timelineItems: data.timelineItems,
        documentsArr: data.documentsArr,
        tasksArr: data.tasksArr,
        currentLang: settings.currentLang,
        currentTheme: settings.currentTheme,
        currentFontSize: settings.currentFontSize,
        currentFontFamily: family,
        showUpcomingHome: settings.showUpcomingHome,
        officeName: settings.officeName,
        officeAddress: settings.officeAddress,
        homeStyle: settings.homeStyle,
      },
    });

    // Supabase boot. If the previous session left un-pushed edits (PENDING_SYNC
    // — e.g. a payment was added and the page refreshed before the 1.5s
    // auto-save fired), FLUSH the hydrated local copy to the backend BEFORE
    // pulling. Otherwise the boot pull would REPLACE_ALL over an edit that never
    // reached the backend, wiping it from state and then from localStorage on
    // the next persist — the exact "payment vanishes after saving" bug. This
    // mirrors the flush-before-pull the visibility/focus refresh already does.
    void (async () => {
      if (lsGet(LS.PENDING_SYNC) === '1') {
        const dels = snapshotDeletions();
        const ok = await legalOfficeSaveToSupabase({
          clients: data.clients,
          casesArr: data.casesArr,
          eventsList: data.eventsList,
          finances: data.finances,
          timelineItems: data.timelineItems,
          documentsArr: data.documentsArr,
          tasksArr: data.tasksArr,
          deletions: dels,
        });
        // On failure keep the flag (and the deletions) so the next reload
        // retries the flush.
        if (ok) {
          lsSet(LS.PENDING_SYNC, '0');
          clearDeletions(dels);
        }
      }
      const result = await legalOfficeLoadFromSupabaseV88();
      // Don't clobber an edit made DURING the boot window (dirtyRef set) — the
      // pending auto-save will push it once supaSaveReady flips true below.
      if (result.loaded && result.state && !dirtyRef.current) {
        dispatch({ type: 'REPLACE_ALL', payload: result.state });
      }
      setSupaSaveReady(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // -----------------------------------------------------------------------
  // Re-pull from Supabase whenever the tab becomes visible / window
  // regains focus / page is restored from bfcache, plus a periodic
  // poll while visible. Without this, edits made on another device
  // only show up after a hard page refresh.
  //
  // Mobile coverage matters here:
  //   - iOS Safari + Android Chrome restore pages from bfcache without
  //     firing `visibilitychange` or `focus` — only `pageshow`.
  //   - Phones may keep the tab open and visible for long stretches
  //     without any focus toggle, so a 30s polling loop guarantees
  //     freshness even with zero user interaction.
  //
  // CRITICAL: we FLUSH local state to Supabase BEFORE pulling. Otherwise
  // a refresh racing the 1500ms auto-save debounce would pull stale
  // rows, REPLACE_ALL would wipe an un-pushed edit, and the rescheduled
  // auto-save would push the now-overwritten data back — losing the
  // edit on both ends. Any new refresh trigger must use this same path.
  //
  // Cooldown prevents rapid bounces (focus+visibility+pageshow firing
  // back-to-back) from hammering the endpoint.
  // -----------------------------------------------------------------------
  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  const lastRefreshAt = useRef(0);
  useEffect(() => {
    if (!state.hydrated) return;
    if (typeof document === 'undefined') return;

    const COOLDOWN_MS = 3000;
    const POLL_INTERVAL_MS = 30000;

    const refresh = async () => {
      if (document.hidden) return;
      const now = Date.now();
      if (now - lastRefreshAt.current < COOLDOWN_MS) return;
      lastRefreshAt.current = now;

      // Flush latest local state to Supabase first so an un-pushed edit
      // isn't clobbered by the pull that follows. Skip when nothing is
      // dirty — otherwise this refresh would echo the previously-pulled
      // data back to Supabase, overwriting any cross-device write that
      // happened in the meantime.
      if (supaSaveReady && dirtyRef.current) {
        const s = stateRef.current;
        const dels = snapshotDeletions();
        try {
          const ok = await legalOfficeSaveToSupabase({
            clients: s.clients,
            casesArr: s.casesArr,
            eventsList: s.eventsList,
            finances: s.finances,
            timelineItems: s.timelineItems,
            documentsArr: s.documentsArr,
            tasksArr: s.tasksArr,
            deletions: dels,
          });
          if (ok) {
            dirtyRef.current = false;
            lsSet(LS.PENDING_SYNC, '0');
            clearDeletions(dels);
          }
        } catch (e) {
          console.warn('[useAppState] flush before pull failed', e);
        }
      }

      const result = await legalOfficeLoadFromSupabaseV88({ force: true });
      if (result.loaded && result.state) {
        dispatch({ type: 'REPLACE_ALL', payload: result.state });
      }
    };

    const onVisibility = () => void refresh();
    const onFocus = () => void refresh();
    // pageshow fires on initial load AND on bfcache restore (mobile).
    // Only refresh on the bfcache case (event.persisted === true) so
    // we don't double-fire alongside the boot loader on a fresh load.
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) void refresh();
    };

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', onFocus);
    window.addEventListener('pageshow', onPageShow);

    const pollId = window.setInterval(() => void refresh(), POLL_INTERVAL_MS);

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('pageshow', onPageShow);
      window.clearInterval(pollId);
    };
  }, [state.hydrated, supaSaveReady]);

  // -----------------------------------------------------------------------
  // Auto-persist: any change to the domain arrays writes to localStorage.
  // This replaces the dozens of saveData() calls scattered through the source.
  // We guard with `hydrated` so the first server→client transition doesn't
  // wipe localStorage with the empty initial state.
  // -----------------------------------------------------------------------
  const lastPersist = useRef(0);
  useEffect(() => {
    if (!state.hydrated) return;
    // Debounce to avoid hammering localStorage during rapid updates.
    const id = window.setTimeout(() => {
      persistCurrentDataToLocalStorage({
        clients: state.clients,
        casesArr: state.casesArr,
        eventsList: state.eventsList,
        finances: state.finances,
        timelineItems: state.timelineItems,
        documentsArr: state.documentsArr,
        tasksArr: state.tasksArr,
      });
      lastPersist.current = Date.now();
    }, 60);
    return () => window.clearTimeout(id);
  }, [
    state.hydrated,
    state.clients,
    state.casesArr,
    state.eventsList,
    state.finances,
    state.timelineItems,
    state.documentsArr,
    state.tasksArr,
  ]);

  // -----------------------------------------------------------------------
  // Supabase auto-save. Mirrors the localStorage effect but with a longer
  // debounce (live-typing in a form shouldn't hit the REST endpoint per
  // keystroke). Gated on supaSaveReady so the v88 loader's REPLACE_ALL has a
  // chance to land first.
  //
  // CRITICAL: gated on dirtyRef so a REPLACE_ALL from a poll/visibility
  // pull does NOT trigger a save. Without this, every successful pull
  // would echo the just-pulled rows back to Supabase 1.5s later — and
  // if another device wrote between the pull and the echo, that write
  // would be overwritten by stale data. Only user-initiated edits
  // (which mark dirtyRef via the wrapped `dispatch`) trigger a push.
  // -----------------------------------------------------------------------
  useEffect(() => {
    if (!state.hydrated || !supaSaveReady) return;
    if (!dirtyRef.current) return;
    const id = window.setTimeout(() => {
      const dels = snapshotDeletions();
      void legalOfficeSaveToSupabase({
        clients: state.clients,
        casesArr: state.casesArr,
        eventsList: state.eventsList,
        finances: state.finances,
        timelineItems: state.timelineItems,
        documentsArr: state.documentsArr,
        tasksArr: state.tasksArr,
        deletions: dels,
      }).then((ok) => {
        dirtyRef.current = false;
        // Only clear the persisted un-synced marker (and the deletions handed to
        // this save) when the backend confirmed it; on failure they stay set so
        // the next reload flushes first.
        if (ok) {
          lsSet(LS.PENDING_SYNC, '0');
          clearDeletions(dels);
        }
      });
    }, 1500);
    return () => window.clearTimeout(id);
  }, [
    supaSaveReady,
    state.hydrated,
    state.clients,
    state.casesArr,
    state.eventsList,
    state.finances,
    state.timelineItems,
    state.documentsArr,
    state.tasksArr,
  ]);

  // -----------------------------------------------------------------------
  // Mirror non-array settings back to their respective localStorage keys.
  // -----------------------------------------------------------------------
  useEffect(() => {
    if (!state.hydrated) return;
    lsSet(LS.LANG, state.currentLang);
  }, [state.hydrated, state.currentLang]);
  useEffect(() => {
    if (!state.hydrated) return;
    lsSet(LS.THEME, state.currentTheme);
  }, [state.hydrated, state.currentTheme]);
  useEffect(() => {
    if (!state.hydrated) return;
    lsSet(LS.FONT_SIZE, state.currentFontSize);
  }, [state.hydrated, state.currentFontSize]);
  useEffect(() => {
    if (!state.hydrated) return;
    lsSet(fontFamilyKey(state.currentLang), state.currentFontFamily);
  }, [state.hydrated, state.currentLang, state.currentFontFamily]);
  useEffect(() => {
    if (!state.hydrated) return;
    lsSet(LS.SHOW_UPCOMING, state.showUpcomingHome ? '1' : '0');
  }, [state.hydrated, state.showUpcomingHome]);
  useEffect(() => {
    if (!state.hydrated) return;
    lsSet(LS.OFFICE_NAME, state.officeName);
  }, [state.hydrated, state.officeName]);
  useEffect(() => {
    if (!state.hydrated) return;
    lsSet(LS.OFFICE_ADDRESS, state.officeAddress);
  }, [state.hydrated, state.officeAddress]);
  useEffect(() => {
    if (!state.hydrated) return;
    lsSet(LS.HOME_STYLE, state.homeStyle);
    // Mirror the home style onto <body> so CSS can target the sidebar
    // (and any other element outside the HomeDashboard) via
    // `body[data-home-style="..."]` selectors. The HomeDashboard's
    // own className keeps working alongside this for backward compat.
    if (typeof document !== 'undefined') {
      document.body.dataset.homeStyle = state.homeStyle;
    }
  }, [state.hydrated, state.homeStyle]);

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  const loadBackup = useCallback((data: Partial<LegalOfficeBackup>) => {
    const applied = applyLegalOfficeData(data);
    dispatch({ type: 'REPLACE_ALL', payload: applied.state });
  }, []);

  const reloadFromSupabase = useCallback(async () => {
    const result = await legalOfficeLoadFromSupabaseV88({ force: true });
    if (result.loaded && result.state) {
      dispatch({ type: 'REPLACE_ALL', payload: result.state });
      return true;
    }
    return false;
  }, []);

  const value = useMemo<AppStateContextValue>(
    () => ({ state, dispatch, loadBackup, reloadFromSupabase }),
    [state, loadBackup, reloadFromSupabase],
  );

  return (
    <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>
  );
}

export function useAppState(): AppStateContextValue {
  const ctx = useContext(AppStateContext);
  if (!ctx) {
    throw new Error('useAppState must be used inside <AppStateProvider>');
  }
  return ctx;
}
