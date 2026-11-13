'use client';

import { useMemo, useState } from 'react';
import { useAppState } from '@/hooks/useAppState';
import { useModalStack } from '@/hooks/useModalStack';
import { useT } from '@/hooks/useT';
import { caseName, caseSearchText, clientName } from '@/lib/cases';
import { CaseDetail } from './CaseDetail';
import { CaseContextMenu } from './CaseContextMenu';
import { hasFineMouse } from './ClientContextMenu';
import { MainScreenBackButton } from './MainScreenBackButton';

/**
 * Port of renderCases (source line 3898) + caseRows (line 3780) +
 * filterCasesScreen (line 4599).
 *
 * Source markup:
 *   <section class="panel cases-screen-panel">
 *     <div class="panel-body cases-panel-body">
 *       <div class="case-search-wrap"> label + input + meta </div>
 *       <div id="casesTableWrap" class="cases-scroll-list">
 *         <table class="table"> ... </table>
 *       </div>
 *     </div>
 *   </section>
 */
export function CasesScreen() {
  const { state } = useAppState();
  const { t, lang } = useT();
  const modalStack = useModalStack();
  const [query, setQuery] = useState('');

  const placeholder =
    lang === 'ar'
      ? 'بحث بحسب اسم الموكل، رقم الهوية، الهاتف، نوع الدعوى، المحكمة أو رقم الملف في المحكمة'
      : 'חיפוש לפי שם לקוח, תעודת זהות, טלפון, סוג תביעה, בית משפט או מספר תיק בבית המשפט';
  const hint =
    lang === 'ar'
      ? 'يمكن البحث أيضاً حسب التفاصيل غير الظاهرة في الجدول.'
      : 'ניתן לחפש גם לפי פרטים שאינם מוצגים בטבלה.';
  const searchLabel = lang === 'ar' ? 'بحث في قضايا الموكلين' : 'חיפוש בתיקי הלקוחות';

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = q
      ? state.casesArr.filter((c) =>
          caseSearchText(c, state.clients).toLowerCase().includes(q),
        )
      : state.casesArr;
    // Sort alphabetically by client name (locale-aware for Hebrew + Arabic).
    return [...matches].sort((a, b) => {
      const nameA = clientName(a.clientId, state.clients, lang) || '';
      const nameB = clientName(b.clientId, state.clients, lang) || '';
      return nameA.localeCompare(nameB, lang === 'ar' ? 'ar' : 'he', {
        sensitivity: 'base',
      });
    });
  }, [state.casesArr, state.clients, query, lang]);

  const openCase = (id: string) => {
    modalStack.open(<CaseDetail caseId={id} />);
  };

  // Right-click on a case (desktop mouse): edit, entries, details, latest items.
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);

  // "Classic Design" (Settings → home style = classic): the same search, sort,
  // rows, click and right-click handlers, in the dark navy + gold look (the
  // clients screen's "kx-" styles, with six columns).
  // "Modern Design" reuses this layout in a light shell (.kx-modern): five
  // columns, the court case number under the title.
  if (state.homeStyle === 'classic' || state.homeStyle === 'modern') {
    const modern = state.homeStyle === 'modern';
    const ar = lang === 'ar';
    const L = {
      h: ar ? 'الملفات' : 'תיקים',
      sub: modern
        ? ar
          ? 'عرض وإدارة ملفات القضايا ومتابعة حالتها وتفاصيلها'
          : 'הצגה וניהול של תיקי הלקוחות ומעקב אחר מצבם ופרטיהם'
        : ar
          ? 'إدارة ومتابعة ملفات القضايا والدعاوى'
          : 'ניהול ומעקב אחר תיקי הלקוחות וההליכים',
      ph: ar
        ? 'البحث حسب رقم الملف، اسم الموكل، نوع القضية، المحكمة أو أي معلومة...'
        : 'חיפוש לפי מספר תיק, שם לקוח, סוג תביעה, בית משפט או כל פרט אחר...',
      num: ar ? 'رقم الملف' : 'מספר תיק',
      subject: ar ? 'موضوع الملف / القضية' : 'נושא התיק / התביעה',
      courtNo: ar ? 'رقم الملف في المحكمة' : 'מספר תיק בבית המשפט',
      body: ar ? 'الجهة' : 'ערכאה',
      empty: ar ? 'لا توجد ملفات مطابقة للبحث' : 'אין תיקים התואמים לחיפוש',
    };
    return (
      <section className={'kx-root kx-cases' + (modern ? ' kx-modern' : '')}>
        <MainScreenBackButton />
        <div className="kx-art" aria-hidden>
          <img src={modern ? '/classic/modern-cases-art.png' : '/classic/cases-art-2.jpg'} alt="" />
        </div>
        <header className="kx-hero">
          <span className="kx-hero-fa" aria-hidden>
            <i className="far fa-folder-open" />
          </span>
          <div className="kx-hero-text">
            <h2 className="kx-h">{L.h}</h2>
            {!modern && <span className="kx-rule" aria-hidden />}
            <p className="kx-sub">{L.sub}</p>
          </div>
        </header>
        <label className="kx-search">
          <i className="fas fa-magnifying-glass" aria-hidden />
          <input
            id="casesSearchInput"
            type="search"
            autoComplete="off"
            aria-label={searchLabel}
            placeholder={L.ph}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        {!modern && (() => {
          // Office-wide figures (Classic): the same status rule as the rows.
          const all = state.casesArr;
          const st = (c: (typeof all)[number]) => (c.status === 'active' ? 'active' : c.status === 'pending' ? 'pending' : 'inactive');
          const figs = [
            { k: 'total', fa: 'fa-folder', label: ar ? 'إجمالي الملفات' : 'סה"כ תיקים', v: all.length },
            { k: 'closed', fa: 'fa-folder-open', label: ar ? 'ملفات مغلقة' : 'תיקים סגורים', v: all.filter((c) => st(c) === 'inactive').length },
            { k: 'open', fa: 'fa-gavel', label: ar ? 'ملفات نشطة' : 'תיקים פעילים', v: all.filter((c) => st(c) === 'active').length },
            { k: 'on', fa: 'fa-building-columns', label: ar ? 'لها رقم في المحكمة' : 'עם מספר בבית משפט', v: all.filter((c) => String(c.caseNumber || '').trim()).length },
            { k: 'off', fa: 'fa-hourglass-half', label: ar ? 'ملفات معلّقة' : 'תיקים ממתינים', v: all.filter((c) => st(c) === 'pending').length },
          ];
          return (
            <div className="kx-stats">
              {figs.map((f) => (
                <div key={f.k} className={'kx-stat kx-t-' + f.k}>
                  <i className={'fas ' + f.fa} aria-hidden />
                  <span className="kx-stat-text">
                    <span className="kx-stat-lbl">{f.label}</span>
                    <b>{f.v}</b>
                  </span>
                </div>
              ))}
            </div>
          );
        })()}
        <div className="kx-frame">
          <div className="kx-cols" aria-hidden>
            <span>{L.num}</span>
            <span>{L.subject}</span>
            <span>{t('clientName')}</span>
            {!modern && <span>{L.courtNo}</span>}
            <span>{L.body}</span>
            <span>{t('status')}</span>
          </div>
          <div className="kx-list" id="casesTableWrap">
            {filtered.length === 0 && <div className="kx-none">{L.empty}</div>}
            {filtered.map((c) => {
              const court = ar ? c.courtAr || c.court : c.court;
              const statusKey = c.status === 'active' ? 'active' : c.status === 'pending' ? 'pending' : 'inactive';
              return (
                <div
                  key={c.id}
                  className="kx-line"
                  role="button"
                  tabIndex={0}
                  data-id={c.id}
                  onClick={() => openCase(c.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      openCase(c.id);
                    }
                  }}
                  onContextMenu={(e) => {
                    if (!hasFineMouse()) return;
                    e.preventDefault();
                    setMenu({ id: c.id, x: e.clientX, y: e.clientY });
                  }}
                >
                  <span className="kx-c kx-c-num" dir="ltr">{c.id}</span>
                  <span className="kx-c kx-c-name">
                    <b>{caseName(c, lang) || '—'}</b>
                    {modern && <small><bdi>{c.caseNumber || '—'}</bdi></small>}
                  </span>
                  <span className="kx-c kx-c-who">{clientName(c.clientId, state.clients, lang) || '—'}</span>
                  {!modern && (
                    <span className="kx-c kx-c-court-no">
                      <bdi>{c.caseNumber || '—'}</bdi>
                    </span>
                  )}
                  <span className="kx-c kx-c-body">{court || '—'}</span>
                  <span className="kx-c kx-c-n">
                    <span className={'kx-n ' + (statusKey === 'active' ? 'kx-n-on' : statusKey === 'pending' ? 'kx-n-wait' : 'kx-n-off')}>{t(statusKey)}</span>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
        {menu && (
          <CaseContextMenu caseId={menu.id} x={menu.x} y={menu.y} onClose={() => setMenu(null)} />
        )}
      </section>
    );
  }

  return (
    <section className="panel cases-screen-panel cases-v2-fluid">
      <MainScreenBackButton />
      <div className="panel-body cases-panel-body">
        <div className="case-search-wrap">
          <label>{searchLabel}</label>
          <input
            id="casesSearchInput"
            className="case-search-input"
            type="search"
            autoComplete="off"
            placeholder={placeholder}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="case-search-meta" id="casesSearchMeta">
            {hint}
          </div>
        </div>
        <div id="casesTableWrap" className="cases-scroll-list">
          <table className="table">
            <thead>
              <tr>
                <th>{lang === 'ar' ? 'الرقم المميز' : 'מספר ייחודי'}</th>
                <th>{t('caseType')}</th>
                <th>{t('clientName')}</th>
                <th>{t('court')}</th>
                <th>{t('status')}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => {
                const court = lang === 'ar' ? c.courtAr || c.court : c.court;
                const statusKey =
                  c.status === 'active'
                    ? 'active'
                    : c.status === 'pending'
                      ? 'pending'
                      : 'inactive';
                const clientLabel = clientName(c.clientId, state.clients, lang);
                return (
                  <tr
                    key={c.id}
                    className="case-row"
                    data-id={c.id}
                    onClick={() => openCase(c.id)}
                    onContextMenu={(e) => {
                      // A phone's long-press keeps its usual behaviour.
                      if (!hasFineMouse()) return;
                      e.preventDefault();
                      setMenu({ id: c.id, x: e.clientX, y: e.clientY });
                    }}
                  >
                    <td
                      data-col="number"
                      data-label={lang === 'ar' ? 'الرقم المميز' : 'מספר ייחודי'}
                    >
                      <span className="case-code" dir="ltr">
                        {c.id}
                      </span>
                    </td>
                    <td data-col="case">
                      <div className="row-title">{caseName(c, lang)}</div>
                      <div className="sub">
                        {t('caseNumber')}: {c.caseNumber}
                      </div>
                    </td>
                    <td data-col="client" data-label={t('clientName')}>{clientLabel}</td>
                    <td data-col="court" data-label={t('court')}>{court}</td>
                    <td data-col="status" data-label={t('status')}>
                      <span className={'status ' + statusKey}>{t(statusKey)}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      {menu && (
        <CaseContextMenu caseId={menu.id} x={menu.x} y={menu.y} onClose={() => setMenu(null)} />
      )}
    </section>
  );
}
