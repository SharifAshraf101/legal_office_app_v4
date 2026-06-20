// localStorage layer. Preserves every key name and side-effect of the
// source's saveData / loadData / collectLegalOfficeData / applyLegalOfficeData
// (lines 3083-3171) so existing browser profiles continue to work after the
// migration without a one-time data-wipe.

import type {
  AppState,
  BotHistoryEntry,
  Client,
  Case,
  CalendarEvent,
  DocumentRecord,
  Finance,
  Lang,
  LegalOfficeBackup,
  OfficeSettings,
  Task,
  Theme,
  TimelineItem,
  FontSize,
} from '@/types';
import {
  DATA_VERSION,
  defaultCases,
  defaultClients,
  defaultEvents,
  defaultFinances,
  defaultTimeline,
} from './seedData';
import { clone } from './utils';

// All localStorage keys used by the app. Catalogued in Stage 1 §2.
export const LS = {
  // App settings
  LANG: 'law_lang',
  THEME: 'law_theme',
  FONT_SIZE: 'law_font_size',
  FONT_FAMILY_HE: 'law_font_family_he',
  FONT_FAMILY_AR: 'law_font_family_ar',
  SHOW_UPCOMING: 'law_show_upcoming',
  OFFICE_NAME: 'law_office_name',
  OFFICE_ADDRESS: 'law_office_address',
  HOME_STYLE: 'law_home_style',

  // Domain data
  CLIENTS: 'law_clients',
  CASES: 'law_cases',
  EVENTS: 'law_events',
  FINANCES: 'law_finances',
  TIMELINE: 'law_timeline',
  DOCUMENTS: 'law_documents',
  TASKS: 'law_tasks',
  DATA_VERSION: 'law_data_version',
  PORTAL_BOT_HISTORY: 'law_portal_bot_history',
  PORTAL_BOT_DOWNLOADS: 'law_portal_bot_downloads',
  LAST_TASK_DROPBOX_PATH: 'law_last_task_dropbox_path_v1',

  // Supabase sync bookkeeping
  SUPA_LOADED_V88: 'legal_office_supabase_loaded_once_v88',
  SUPA_LOADED_V95: 'legal_office_supabase_loaded_once_v95',
  SUPA_LOAD_ERROR_V88: 'legal_office_supabase_load_error_v88',
  SUPA_LAST_SAVED_AT: 'legal_office_supabase_last_saved_at',
  SUPA_LAST_SAVED_REASON: 'legal_office_supabase_last_saved_reason',
  SUPA_LAST_RESULT: 'legal_office_supabase_last_result',
  SUPA_LAST_ERROR: 'legal_office_supabase_last_error',
  SUPA_LIVE_MERGE_V90: 'legal_office_last_live_merge_v90',
  SUPA_LIVE_MERGE_V91: 'legal_office_last_live_merge_v91',
  SUPA_LIVE_MERGE_ERROR_V90: 'legal_office_last_live_merge_error_v90',
  SUPA_LIVE_MERGE_ERROR_V91: 'legal_office_last_live_merge_error_v91',
  SUPA_LAST_FULL_LIVE_V95: 'legal_office_last_full_live_v95',
  SUPA_FULL_LIVE_ERROR_V95: 'legal_office_full_live_error_v95',
  SUPA_FRESH_RELOAD_V89: 'legal_office_last_fresh_reload_v89',
  SUPA_FRESH_RELOAD_ERROR_V89: 'legal_office_last_fresh_reload_error_v89',

  // Factory reset flag (one-shot, never read by app logic)
  RESET_V7: 'LEGAL_OFFICE_RESET_V7',
} as const;

const isBrowser = typeof window !== 'undefined' && typeof localStorage !== 'undefined';

/** Try to parse a JSON array from localStorage. Source `safeLoad`, line 3084. */
export function safeLoad<T>(key: string, def: T[]): T[] {
  if (!isBrowser) return clone(def);
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return clone(def);
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? (arr as T[]) : clone(def);
  } catch {
    return clone(def);
  }
}

/** Read a primitive localStorage value safely. */
export function lsGet(key: string): string | null {
  if (!isBrowser) return null;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Write a primitive localStorage value safely. */
export function lsSet(key: string, value: string): void {
  if (!isBrowser) return;
  try {
    localStorage.setItem(key, value);
  } catch {
    /* quota / private mode */
  }
}

export function lsRemove(key: string): void {
  if (!isBrowser) return;
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

/** Per-language font key. Source pattern: `'law_font_family_' + currentLang`. */
export function fontFamilyKey(lang: Lang): string {
  return lang === 'ar' ? LS.FONT_FAMILY_AR : LS.FONT_FAMILY_HE;
}

// ---------------------------------------------------------------------------
// loadData — populates the in-memory state from localStorage. If the stored
// DATA_VERSION doesn't match, the caller should clear everything (the source's
// resetDemoData on line 3085). Source loadData: line 3087.
// ---------------------------------------------------------------------------

export interface LoadedData {
  clients: Client[];
  casesArr: Case[];
  eventsList: CalendarEvent[];
  finances: Finance[];
  timelineItems: TimelineItem[];
  documentsArr: DocumentRecord[];
  tasksArr: Task[];
  needsReset: boolean;
}

export function loadData(): LoadedData {
  const storedVersion = lsGet(LS.DATA_VERSION);
  if (storedVersion !== DATA_VERSION) {
    return {
      clients: clone(defaultClients),
      casesArr: clone(defaultCases),
      eventsList: clone(defaultEvents),
      finances: clone(defaultFinances),
      timelineItems: clone(defaultTimeline),
      documentsArr: [],
      tasksArr: [],
      needsReset: true,
    };
  }
  return {
    clients: safeLoad(LS.CLIENTS, defaultClients),
    casesArr: safeLoad(LS.CASES, defaultCases),
    eventsList: safeLoad(LS.EVENTS, defaultEvents),
    finances: safeLoad(LS.FINANCES, defaultFinances),
    timelineItems: safeLoad(LS.TIMELINE, defaultTimeline),
    documentsArr: safeLoad(LS.DOCUMENTS, []),
    tasksArr: safeLoad(LS.TASKS, []),
    needsReset: false,
  };
}

// ---------------------------------------------------------------------------
// loadUserSettings — source line 5219. Pulls settings out of localStorage and
// returns them as a plain object the reducer can merge in.
// ---------------------------------------------------------------------------

export interface LoadedSettings {
  currentLang: Lang;
  currentTheme: Theme;
  currentFontSize: FontSize;
  currentFontFamily: string;
  showUpcomingHome: boolean;
  officeName: string;
  officeAddress: string;
  homeStyle: 'modern' | 'classic' | 'minimalist';
}

export function loadUserSettings(): LoadedSettings {
  let currentLang: Lang = 'he';
  const savedLang = lsGet(LS.LANG);
  if (savedLang === 'he' || savedLang === 'ar') currentLang = savedLang;

  let currentTheme: Theme = 'light';
  const savedTheme = lsGet(LS.THEME);
  if (savedTheme === 'light' || savedTheme === 'dark' || savedTheme === 'professional')
    currentTheme = savedTheme;

  let currentFontSize: FontSize = 'normal';
  const savedFont = lsGet(LS.FONT_SIZE);
  if (savedFont === 'small' || savedFont === 'normal' || savedFont === 'large') {
    currentFontSize = savedFont;
  }

  const currentFontFamily = lsGet(fontFamilyKey(currentLang)) ?? '';

  let showUpcomingHome = true;
  const savedUpcoming = lsGet(LS.SHOW_UPCOMING);
  if (savedUpcoming === '0') showUpcomingHome = false;
  if (savedUpcoming === '1') showUpcomingHome = true;

  // Default to "minimalist" for new installs. Classic + modern are
  // opt-in via Settings → "עיצוב הבית".
  let homeStyle: 'modern' | 'classic' | 'minimalist' = 'minimalist';
  const savedHomeStyle = lsGet(LS.HOME_STYLE);
  if (savedHomeStyle === 'classic') homeStyle = 'classic';
  if (savedHomeStyle === 'modern') homeStyle = 'modern';
  if (savedHomeStyle === 'minimalist') homeStyle = 'minimalist';

  return {
    currentLang,
    currentTheme,
    currentFontSize,
    currentFontFamily,
    showUpcomingHome,
    officeName: lsGet(LS.OFFICE_NAME) ?? '',
    officeAddress: lsGet(LS.OFFICE_ADDRESS) ?? '',
    homeStyle,
  };
}

// ---------------------------------------------------------------------------
// persistCurrentDataToLocalStorage — source line 3157. Writes all seven data
// arrays. We do NOT trigger Supabase autosave from here; that hook is wired
// up at the AppState level so it fires once per state change instead of once
// per array write.
// ---------------------------------------------------------------------------

export function persistCurrentDataToLocalStorage(state: {
  clients: Client[];
  casesArr: Case[];
  eventsList: CalendarEvent[];
  finances: Finance[];
  timelineItems: TimelineItem[];
  documentsArr: DocumentRecord[];
  tasksArr: Task[];
}): void {
  if (!isBrowser) return;
  lsSet(LS.CLIENTS, JSON.stringify(state.clients));
  lsSet(LS.CASES, JSON.stringify(state.casesArr));
  lsSet(LS.EVENTS, JSON.stringify(state.eventsList));
  lsSet(LS.FINANCES, JSON.stringify(state.finances));
  lsSet(LS.TIMELINE, JSON.stringify(state.timelineItems));
  lsSet(LS.DOCUMENTS, JSON.stringify(state.documentsArr ?? []));
  lsSet(LS.TASKS, JSON.stringify(state.tasksArr ?? []));
  lsSet(LS.DATA_VERSION, DATA_VERSION);
}

// ---------------------------------------------------------------------------
// collectLegalOfficeData — source line 3088. Used by backup export and by the
// Supabase live-save batches.
// ---------------------------------------------------------------------------

export function collectLegalOfficeData(state: AppState): LegalOfficeBackup {
  let botHistory: BotHistoryEntry[] = [];
  try {
    botHistory = JSON.parse(lsGet(LS.PORTAL_BOT_HISTORY) ?? '[]') ?? [];
  } catch {
    botHistory = [];
  }
  return {
    version: 1,
    appDataVersion: DATA_VERSION,
    savedAt: new Date().toISOString(),
    clients: clone(state.clients ?? []),
    cases: clone(state.casesArr ?? []),
    events: clone(state.eventsList ?? []),
    payments: clone(state.finances ?? []),
    finances: clone(state.finances ?? []),
    documents: clone(state.documentsArr ?? []),
    tasks: clone(state.tasksArr ?? []),
    timeline: clone(state.timelineItems ?? []),
    botHistory: clone(botHistory),
    settings: {
      lang: (lsGet(LS.LANG) as Lang) || state.currentLang,
      theme: (lsGet(LS.THEME) as Theme) || state.currentTheme,
      fontSize: (lsGet(LS.FONT_SIZE) as FontSize) || state.currentFontSize,
      fontFamilyHe: lsGet(LS.FONT_FAMILY_HE) ?? '',
      fontFamilyAr: lsGet(LS.FONT_FAMILY_AR) ?? '',
      showUpcoming: (lsGet(LS.SHOW_UPCOMING) as '0' | '1') || '1',
      officeName: lsGet(LS.OFFICE_NAME) || state.officeName || '',
      officeAddress: lsGet(LS.OFFICE_ADDRESS) || state.officeAddress || '',
    },
  };
}

// ---------------------------------------------------------------------------
// applyLegalOfficeData — source line 3133. Replaces all in-memory state from
// a backup JSON object. The original wrote settings back to localStorage as
// a side effect; we keep that exactly to preserve behavior. Returns a partial
// AppState the reducer can REPLACE_ALL with.
// ---------------------------------------------------------------------------

export interface ApplyResult {
  state: Pick<
    AppState,
    | 'clients'
    | 'casesArr'
    | 'eventsList'
    | 'finances'
    | 'timelineItems'
    | 'documentsArr'
    | 'tasksArr'
  > &
    Partial<
      Pick<
        AppState,
        | 'currentLang'
        | 'currentTheme'
        | 'currentFontSize'
        | 'currentFontFamily'
        | 'showUpcomingHome'
        | 'officeName'
        | 'officeAddress'
      >
    >;
}

export function applyLegalOfficeData(data: Partial<LegalOfficeBackup> & {
  casesArr?: Case[];
  eventsList?: CalendarEvent[];
  timelineItems?: TimelineItem[];
}): ApplyResult {
  if (!data || typeof data !== 'object') throw new Error('Invalid data file');

  const out: ApplyResult['state'] = {
    clients: Array.isArray(data.clients) ? data.clients : clone(defaultClients),
    casesArr: Array.isArray(data.cases)
      ? data.cases
      : Array.isArray(data.casesArr)
        ? data.casesArr
        : clone(defaultCases),
    eventsList: Array.isArray(data.events)
      ? data.events
      : Array.isArray(data.eventsList)
        ? data.eventsList
        : clone(defaultEvents),
    finances: Array.isArray(data.payments)
      ? data.payments
      : Array.isArray(data.finances)
        ? data.finances
        : clone(defaultFinances),
    timelineItems: Array.isArray(data.timeline)
      ? data.timeline
      : Array.isArray(data.timelineItems)
        ? data.timelineItems
        : clone(defaultTimeline),
    documentsArr: Array.isArray(data.documents) ? data.documents : [],
    tasksArr: Array.isArray(data.tasks) ? data.tasks : [],
  };

  if (Array.isArray(data.botHistory)) {
    lsSet(LS.PORTAL_BOT_HISTORY, JSON.stringify(data.botHistory));
  }

  const s: OfficeSettings | undefined = data.settings;
  if (s && typeof s === 'object') {
    if (s.lang === 'he' || s.lang === 'ar') {
      out.currentLang = s.lang;
      lsSet(LS.LANG, s.lang);
    }
    if (s.theme === 'light' || s.theme === 'dark' || s.theme === 'professional') {
      out.currentTheme = s.theme;
      lsSet(LS.THEME, s.theme);
    }
    if (s.fontSize === 'small' || s.fontSize === 'normal' || s.fontSize === 'large') {
      out.currentFontSize = s.fontSize;
      lsSet(LS.FONT_SIZE, s.fontSize);
    }
    if (s.fontFamilyHe) lsSet(LS.FONT_FAMILY_HE, s.fontFamilyHe);
    if (s.fontFamilyAr) lsSet(LS.FONT_FAMILY_AR, s.fontFamilyAr);
    if (s.showUpcoming === '0' || s.showUpcoming === '1') {
      out.showUpcomingHome = s.showUpcoming === '1';
      lsSet(LS.SHOW_UPCOMING, s.showUpcoming);
    }
    if (typeof s.officeName === 'string') {
      out.officeName = s.officeName;
      lsSet(LS.OFFICE_NAME, s.officeName);
    }
    if (typeof s.officeAddress === 'string') {
      out.officeAddress = s.officeAddress;
      lsSet(LS.OFFICE_ADDRESS, s.officeAddress);
    }
  }

  return { state: out };
}

// ---------------------------------------------------------------------------
// Backup file export — source line 3183. Mirrors the original's filename
// stamp and JSON formatting.
// ---------------------------------------------------------------------------

export function exportLegalOfficeBackupFile(state: AppState): void {
  if (!isBrowser) return;
  try {
    persistCurrentDataToLocalStorage(state);
    const data = collectLegalOfficeData(state);
    const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: 'application/json;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'legal-office-backup-' + stamp + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (err) {
    console.error(err);
  }
}

/** Companion to exportLegalOfficeBackupFile — source line 3202. Returns the
 *  parsed payload so the caller can dispatch REPLACE_ALL. */
export async function importLegalOfficeBackupFile(
  file: File,
): Promise<Partial<LegalOfficeBackup>> {
  const text = await file.text();
  return JSON.parse(text || '{}');
}
