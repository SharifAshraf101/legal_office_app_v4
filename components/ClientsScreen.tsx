'use client';

import { useMemo, useState } from 'react';
import { useAppState } from '@/hooks/useAppState';
import { useModalStack } from '@/hooks/useModalStack';
import { useT } from '@/hooks/useT';
import { clientCaseCounts, clientSearchText } from '@/lib/clients';
import { ClientDetail } from './ClientDetail';

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
      ? 'بحث حسب اسم الموكل، رقم الهوية أو الهاتف'
      : 'חיפוש לפי שם לקוח, תעודת זהות או מספר טלפון';
  const hint =
    lang === 'ar'
      ? 'يمكن البحث حسب التفاصيل غير الظاهرة في القائمة.'
      : 'ניתן לחפש גם לפי פרטים שאינם מוצגים ברשימה.';
  const searchLabel = lang === 'ar' ? 'بحث في الموكلون' : 'חיפוש בלקוחות';

  // Source clientList uses clients (unfiltered) by default. filterClientsScreen
  // narrows by clientSearchText match. We combine those two steps here.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return state.clients;
    return state.clients.filter((c) =>
      clientSearchText(c).toLowerCase().includes(q),
    );
  }, [state.clients, query]);

  const clientHead = lang === 'ar' ? 'اسم الموكل' : 'שם לקוח';
  const phoneHead = lang === 'ar' ? 'الهاتف' : 'טלפון';
  const activeHead = lang === 'ar' ? 'ملفات نشطة' : 'תיקים פעילים';
  const closedHead = lang === 'ar' ? 'ملفات مغلقة' : 'תיקים סגורים';
  const idLabel = lang === 'ar' ? 'رقم الهوية' : 'תעודת זהות';

  const openClient = (id: string) => {
    modalStack.open(<ClientDetail clientId={id} />);
  };

  return (
    <section className="panel clients-screen-panel clients-v2-fluid">
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
                  >
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
    </section>
  );
}
