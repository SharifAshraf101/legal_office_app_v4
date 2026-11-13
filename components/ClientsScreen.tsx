'use client';

import { useMemo, useState } from 'react';
import { useAppState } from '@/hooks/useAppState';
import { useModalStack } from '@/hooks/useModalStack';
import { useT } from '@/hooks/useT';
import { clientCaseCounts, clientSearchText } from '@/lib/clients';
import { ClientDetail } from './ClientDetail';
import { ClientContextMenu, hasFineMouse } from './ClientContextMenu';
import { MainScreenBackButton } from './MainScreenBackButton';

/**
 * Port of renderContacts (line 3899) + filterClientsScreen (line 4612) +
 * the row click handler that opens showClient (line 4224).
 *
 * Source markup:
 *   <section class="panel clients-screen-panel">
 *     <div class="panel-body clients-panel-body">
 *       <div class="case-search-wrap"> label + input + meta </div>
 *       <div class="clients-scroll-list" id="clientsListWrap">
 *         <table class="table clients-table"> ... </table>
 *       </div>
 *     </div>
 *   </section>
 *
 * The source uses an `<input>` whose value lives in the DOM and is read by
 * filterClientsScreen() on each keystroke. We keep the search as React state
 * for natural reactivity; the visible behavior is identical.
 */
export function ClientsScreen() {
  const { state } = useAppState();
  const { lang } = useT();
  const modalStack = useModalStack();
  const [query, setQuery] = useState('');

  const placeholder =
    lang === 'ar'
      ? 'بحث بحسب اسم الموكل، رقم الهوية أو الهاتف'
      : 'חיפוש לפי שם לקוח, תעודת זהות או מספר טלפון';
  const hint =
    lang === 'ar'
      ? 'يمكن البحث حسب التفاصيل غير الظاهرة في القائمة.'
      : 'ניתן לחפש גם לפי פרטים שאינם מוצגים ברשימה.';
  const searchLabel = lang === 'ar' ? 'بحث عن الموكلين' : 'חיפוש בלקוחות';

  // Source clientList uses clients (unfiltered) by default. filterClientsScreen
  // narrows by clientSearchText match. We combine those two steps here.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return state.clients;
    return state.clients.filter((c) =>
      clientSearchText(c).toLowerCase().includes(q),
    );
  }, [state.clients, query]);

  const numberHead = lang === 'ar' ? 'رقم الموكل' : 'מספר לקוח';
  const clientHead = lang === 'ar' ? 'اسم الموكل' : 'שם לקוח';
  const phoneHead = lang === 'ar' ? 'الهاتف' : 'טלפון';
  const activeHead = lang === 'ar' ? 'ملفات نشطة' : 'תיקים פעילים';
  const closedHead = lang === 'ar' ? 'ملفات مغلقة' : 'תיקים סגורים';
  const idLabel = lang === 'ar' ? 'رقم الهوية' : 'תעודת זהות';

  const openClient = (id: string) => {
    modalStack.open(<ClientDetail clientId={id} />);
  };

  // Right-click on a client (desktop mouse): edit details, balance, open cases.
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);

  // Office-wide figures for the Classic header — the same counting rule as
  // each row's counts (clientCaseCounts: 'active' vs 'inactive'/'closed').
  const totals = useMemo(() => {
    let open = 0;
    let closed = 0;
    for (const c of state.casesArr) {
      if (c.status === 'active') open++;
      else if (c.status === 'inactive' || c.status === 'closed') closed++;
    }
    const activeIds = new Set(state.casesArr.filter((c) => c.status === 'active').map((c) => c.clientId));
    const activeClients = state.clients.filter((c) => activeIds.has(c.id)).length;
    return { total: state.clients.length, open, closed, activeClients, inactiveClients: state.clients.length - activeClients };
  }, [state.casesArr, state.clients]);

  const onRowMenu = (e: React.MouseEvent, id: string) => {
    // A phone's long-press keeps its usual behaviour.
    if (!hasFineMouse()) return;
    e.preventDefault();
    setMenu({ id, x: e.clientX, y: e.clientY });
  };

  // "Classic Design" (Settings → home style = classic): the same search, rows,
  // click and right-click handlers, laid out in the dark navy + gold look.
  // "Modern Design" reuses this layout in a light shell (.kx-modern), without the figure tiles.
  if (state.homeStyle === 'classic' || state.homeStyle === 'modern') {
    const modern = state.homeStyle === 'modern';
    const ar = lang === 'ar';
    const L = {
      h: ar ? 'الموكلون' : 'לקוחות',
      sub: modern
        ? ar
          ? 'عرض وإدارة بيانات الموكلين وعلاقتهم بالملفات والقضايا'
          : 'הצגה וניהול של פרטי הלקוחות והקשר שלהם לתיקים'
        : ar
          ? 'إدارة بيانات الموكلين وملفاتهم وحالة التعاقد'
          : 'ניהול פרטי הלקוחות, תיקים ומצב ההתקשרות',
      ph: ar
        ? 'البحث حسب اسم الموكل، رقم الهوية، رقم الهاتف أو أي معلومة...'
        : 'חיפוש לפי שם לקוח, תעודת זהות, מספר טלפון או כל פרט אחר...',
      id: ar ? 'ت. هوية' : 'ת.ז.',
      empty: ar ? 'لا يوجد موكلون مطابقون للبحث' : 'אין לקוחות התואמים לחיפוש',
    };
    const stats = [
      { k: 'total', fa: 'fa-users', label: ar ? 'إجمالي الموكلين' : 'סה"כ לקוחות', v: totals.total },
      { k: 'closed', fa: 'fa-folder-open', label: ar ? 'ملفات مغلقة' : 'תיקים סגורים', v: totals.closed },
      { k: 'open', fa: 'fa-phone', label: ar ? 'ملفات مفتوحة' : 'תיקים פתוחים', v: totals.open },
      { k: 'on', fa: 'fa-users', label: ar ? 'موكلون نشطون' : 'לקוחות פעילים', v: totals.activeClients },
      { k: 'off', fa: 'fa-user-xmark', label: ar ? 'موكلون غير نشطين' : 'לקוחות לא פעילים', v: totals.inactiveClients },
    ];
    return (
      <section className={modern ? 'kx-root kx-modern' : 'kx-root'}>
        <MainScreenBackButton />
        <div className="kx-art" aria-hidden>
          <img src={modern ? '/classic/modern-clients-art.png' : '/classic/clients-art-2.jpg'} alt="" />
        </div>
        <header className="kx-hero">
          <span className="kx-hero-fa" aria-hidden>
            <i className="fas fa-users" />
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
            id="clientsSearchInput"
            type="search"
            autoComplete="off"
            aria-label={searchLabel}
            placeholder={L.ph}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        {!modern && <div className="kx-stats">
          {stats.map((s) => (
            <div key={s.k} className={'kx-stat kx-t-' + s.k}>
              <i className={'fas ' + s.fa} aria-hidden />
              <span className="kx-stat-text">
                <span className="kx-stat-lbl">{s.label}</span>
                <b>{s.v}</b>
              </span>
            </div>
          ))}
        </div>}
        <div className="kx-frame">
          <div className="kx-cols" aria-hidden>
            <span>{numberHead}</span>
            <span>{clientHead}</span>
            <span>{phoneHead}</span>
            <span>{activeHead}</span>
            <span>{closedHead}</span>
          </div>
          <div className="kx-list" id="clientsListWrap">
            {filtered.length === 0 && <div className="kx-none">{L.empty}</div>}
            {filtered.map((c) => {
              const displayName = ar ? c.nameAr || c.name : c.name;
              const counts = clientCaseCounts(c.id, state.casesArr);
              return (
                <div
                  key={c.id}
                  className="kx-line"
                  role="button"
                  tabIndex={0}
                  data-id={c.id}
                  onClick={() => openClient(c.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      openClient(c.id);
                    }
                  }}
                  onContextMenu={(e) => onRowMenu(e, c.id)}
                >
                  <span className="kx-c kx-c-num" dir="ltr">{c.id}</span>
                  <span className="kx-c kx-c-name">
                    <b>{displayName}</b>
                    <small>
                      {L.id}: <bdi>{c.idNumber || '-'}</bdi>
                    </small>
                  </span>
                  <span className="kx-c kx-c-tel">
                    <i className="fas fa-phone" aria-hidden />
                    <bdi dir="ltr">{c.phone || '-'}</bdi>
                  </span>
                  <span className="kx-c kx-c-n" data-label={activeHead}>
                    <span className="kx-n kx-n-on">{counts.active}</span>
                  </span>
                  <span className="kx-c kx-c-n" data-label={closedHead}>
                    <span className="kx-n kx-n-off">{counts.closed}</span>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
        {menu && (
          <ClientContextMenu clientId={menu.id} x={menu.x} y={menu.y} onClose={() => setMenu(null)} />
        )}
      </section>
    );
  }

  return (
    <section className="panel clients-screen-panel clients-v2-fluid">
      <MainScreenBackButton />
      <div className="panel-body clients-panel-body">
        <div className="case-search-wrap">
          <label>{searchLabel}</label>
          <input
            id="clientsSearchInput"
            className="case-search-input"
            type="search"
            autoComplete="off"
            placeholder={placeholder}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="case-search-meta" id="clientsSearchMeta">
            {hint}
          </div>
        </div>

        <div className="clients-scroll-list" id="clientsListWrap">
          <table className="table clients-table">
            <thead>
              <tr>
                <th>{numberHead}</th>
                <th>{clientHead}</th>
                <th>{phoneHead}</th>
                <th>{activeHead}</th>
                <th>{closedHead}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => {
                const displayName = lang === 'ar' ? c.nameAr || c.name : c.name;
                const counts = clientCaseCounts(c.id, state.casesArr);
                return (
                  <tr
                    key={c.id}
                    className="client-row"
                    data-id={c.id}
                    onClick={() => openClient(c.id)}
                    onContextMenu={(e) => {
                      // A phone's long-press keeps its usual behaviour.
                      if (!hasFineMouse()) return;
                      e.preventDefault();
                      setMenu({ id: c.id, x: e.clientX, y: e.clientY });
                    }}
                  >
                    <td data-col="number" data-label={numberHead}>
                      <span className="client-code" dir="ltr">
                        {c.id}
                      </span>
                    </td>
                    <td data-col="client">
                      <div className="row-title">{displayName}</div>
                      <div className="sub">
                        {idLabel}: {c.idNumber || '-'}
                      </div>
                    </td>
                    <td data-col="phone" data-label={phoneHead}>{c.phone || '-'}</td>
                    <td data-col="active" data-label={activeHead}>
                      <span className="status active">{counts.active}</span>
                    </td>
                    <td data-col="closed" data-label={closedHead}>
                      <span className="status inactive">{counts.closed}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      {menu && (
        <ClientContextMenu
          clientId={menu.id}
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
        />
      )}
    </section>
  );
}
