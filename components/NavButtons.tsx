'use client';

import { useAppState } from '@/hooks/useAppState';
import { useT } from '@/hooks/useT';

/**
 * Shared nav-button list rendered by both the desktop sidebar and the mobile
 * bottom nav. Same FA6 icon set on both surfaces — the previous mobile-only
 * PNG icon path was uneven (some tabs PNG, some FA, with different sizes
 * and colors), so it's been removed. Each tab now has a distinct accent
 * color applied via `.nav-icon-<id>` CSS so the row reads as a colorful
 * but consistent modern strip.
 */

// Minimalist FA6 icons.
const ICONS: Record<string, string> = {
  home: 'fa-house',
  cases: 'fa-folder',
  contacts: 'fa-user-group',
  finance: 'fa-coins',
  documents: 'fa-file-lines',
  tasks: 'fa-circle-check',
  calendar: 'fa-calendar',
  portal: 'fa-comment-dots',
  search: 'fa-magnifying-glass',
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
  void mobile; // mobile vs desktop styling is fully handled by CSS now

  return (
    <>
      {ORDER.map((id) => {
        const active =
          state.currentTab === id ||
          (id === 'finance' && state.currentTab === 'financeDetail');
        return (
          <button
            key={id}
            type="button"
            className={'nav-btn' + (active ? ' active' : '')}
            data-tab={id}
            onClick={() => dispatch({ type: 'SET_TAB', tab: id })}
          >
            <i className={'fas ' + (ICONS[id] ?? 'fa-circle') + ' nav-icon-' + id} />
            <span>{tabLabel(id, lang, t)}</span>
          </button>
        );
      })}
    </>
  );
}
