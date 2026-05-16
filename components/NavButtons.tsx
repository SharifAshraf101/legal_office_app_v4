'use client';

import { useAppState } from '@/hooks/useAppState';
import { useMobileGuard } from '@/hooks/useMobileGuard';
import { useT } from '@/hooks/useT';

/**
 * Shared nav-button list rendered by both the desktop sidebar and the mobile
 * bottom nav. Source: `navButtons(includeSettings)` at line 3839.
 *
 * The original source mapped some tab ids to inline base64 PNG icons on
 * mobile. We preserve the *order*, the *labels*, and the *active-state class*
 * exactly; the data-URI icons are deferred to Stage 5 (they push the bundle
 * size up by ~20 KB and are visual polish, not behavior).
 */

const ICONS: Record<string, string> = {
  home: 'fa-table-columns',
  cases: 'fa-folder-open',
  contacts: 'fa-users',
  finance: 'fa-shekel-sign',
  documents: 'fa-file-lines',
  tasks: 'fa-list-check',
  calendar: 'fa-calendar-days',
  portal: 'fa-comments',
  search: 'fa-magnifying-glass',
};

// Source line 3841-3844: per-tab PNG icons used in the mobile bottom nav only.
const MOBILE_PNG_ICONS: Record<string, string> = {
  home: '/mobile-home.png',
  contacts: '/mobile-contacts.png',
  cases: '/mobile-cases.png',
  calendar: '/mobile-calendar.png',
};

// Same `order` array as source line 3845.
const ORDER = ['home', 'search', 'contacts', 'cases', 'documents', 'calendar', 'tasks', 'finance', 'portal'];

/** Hebrew/Arabic labels per tab id. */
function tabLabel(id: string, lang: 'he' | 'ar', tFn: (k: string) => string): string {
  if (id === 'search') return lang === 'ar' ? 'بحث شامل' : 'חיפוש כולל';
  if (id === 'financeDetail') return lang === 'ar' ? 'الأتعاب' : 'שכר טרחה';
  if (id === 'portal') return lang === 'ar' ? 'بوابة تواصل الموكلون' : 'שער תקשורת עם לקוחות';
  if (id === 'documents') return lang === 'ar' ? 'المستندات' : 'מסמכים';
  if (id === 'tasks') return lang === 'ar' ? 'مهام' : 'משימות';
  return tFn(id);
}

export function NavButtons({ mobile = false }: { mobile?: boolean } = {}) {
  const { state, dispatch } = useAppState();
  const { t, lang } = useT();
  const { isMobile1050 } = useMobileGuard();

  // Show PNG icons only in the mobile bottom nav (matches source line 3848).
  const usePng = mobile || isMobile1050;

  return (
    <>
      {ORDER.map((id) => {
        const active =
          state.currentTab === id ||
          (id === 'finance' && state.currentTab === 'financeDetail');
        const pngSrc = usePng ? MOBILE_PNG_ICONS[id] : null;
        return (
          <button
            key={id}
            type="button"
            className={'nav-btn' + (active ? ' active' : '')}
            data-tab={id}
            onClick={() => dispatch({ type: 'SET_TAB', tab: id })}
          >
            {pngSrc ? (
              <span
                className={
                  'mobile-home-icon-wrap' +
                  (id === 'cases'
                    ? ' mobile-cases-icon-wrap'
                    : id === 'contacts'
                      ? ' mobile-client-icon-wrap'
                      : id === 'calendar'
                        ? ' mobile-calendar-icon-wrap'
                        : '')
                }
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  className={
                    'mobile-home-icon-img' +
                    (id === 'cases'
                      ? ' mobile-cases-icon-img'
                      : id === 'contacts'
                        ? ' mobile-client-icon-img'
                        : id === 'calendar'
                          ? ' mobile-calendar-icon-img'
                          : '')
                  }
                  src={pngSrc}
                  alt={tabLabel(id, lang, t)}
                />
              </span>
            ) : (
              <i className={'fas ' + (ICONS[id] ?? 'fa-circle')} />
            )}
            <span>{tabLabel(id, lang, t)}</span>
          </button>
        );
      })}
    </>
  );
}
