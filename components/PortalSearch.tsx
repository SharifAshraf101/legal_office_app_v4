'use client';

import { useMemo, useState } from 'react';
import { useAppState } from '@/hooks/useAppState';
import { useT } from '@/hooks/useT';
import { portalClientSearchText, portalLabel } from '@/lib/portal';
import { PortalLoginCard } from './PortalLoginCard';

/**
 * Port of renderPortalSearch (source line 4961) + portalClientList (4639) +
 * filterPortalClientsScreen (4652). Empty by default; type to see results.
 * Clicking a row sets `selectedPortalClientId` (drives PortalCommunication).
 */
export function PortalSearch() {
  const { state, dispatch } = useAppState();
  const { lang } = useT();
  const [query, setQuery] = useState('');

  const placeholder =
    lang === 'ar'
      ? 'بحث بحسب اسم الموكل، رقم الهوية أو رقم الهاتف'
      : 'חיפוש לפי שם לקוח, תעודת זהות או מספר טלפון';
  const emptyHint =
    lang === 'ar'
      ? 'اكتب اسم الموكل أو رقم الهوية أو رقم الهاتف لعرض النتائج.'
      : 'הקלד שם לקוח, תעודת זהות או מספר טלפון כדי להציג תוצאות.';
  const noResults =
    lang === 'ar'
      ? 'لا يوجد موكلون مطابقون للبحث'
      : 'לא נמצאו לקוחות התואמים לחיפוש';
  const activeLabel = lang === 'ar' ? 'ملفات نشطة' : 'תיקים פעילים';
  const closedLabel = lang === 'ar' ? 'ملفات مغلقة' : 'תיקים סגורים';
  const idLabel = lang === 'ar' ? 'رقم الهوية' : 'תעודת זהות';
  const phoneLabel = lang === 'ar' ? 'الهاتف' : 'טלפון';
  const searchInputLabel = lang === 'ar' ? 'بحث عن موكل' : 'חיפוש לקוח';

  const filtered = useMemo(() => {
    const raw = query.trim();
    if (!raw) return null;
    const q = raw.toLowerCase();
    const qDigits = raw.replace(/\D/g, '');
    return state.clients.filter((c) => {
      const text = portalClientSearchText(c).toLowerCase();
      const phoneDigits = String(c.phone || '').replace(/\D/g, '');
      const idDigits = String(c.idNumber || '').replace(/\D/g, '');
      return (
        text.includes(q) ||
        (qDigits && (phoneDigits.includes(qDigits) || idDigits.includes(qDigits)))
      );
    });
  }, [state.clients, query]);

  const meta = !filtered
    ? emptyHint
    : lang === 'ar'
      ? `تم العثور على ${filtered.length} من ${state.clients.length} موكلون`
      : `נמצאו ${filtered.length} מתוך ${state.clients.length} לקוחות`;

  const onPick = (id: string) => {
    dispatch({ type: 'SET_PORTAL_CLIENT', clientId: id });
  };

  return (
    <section className="panel clients-screen-panel portal-screen-panel">
      <div className="panel-head">
        <h2>{portalLabel(lang)}</h2>
      </div>
      <div className="panel-body clients-panel-body">
        <div className="case-search-wrap">
          <label>{searchInputLabel}</label>
          <input
            id="portalClientSearchInput"
            className="case-search-input"
            type="search"
            autoComplete="off"
            placeholder={placeholder}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="case-search-meta" id="portalClientSearchMeta">
            {meta}
          </div>
        </div>
        <div
          className="list clients-scroll-list portal-search-results-hidden"
          id="portalClientsListWrap"
        >
          {filtered === null ? null : filtered.length === 0 ? (
            <div className="case-empty">{noResults}</div>
          ) : (
            filtered.map((c) => {
              const name = lang === 'ar' ? c.nameAr || c.name : c.name || c.nameAr || '';
              const idNumber = c.idNumber || '';
              const phone = c.phone || '';
              const clientCases = state.casesArr.filter((x) => x.clientId === c.id);
              const activeCount = clientCases.filter((x) => x.status === 'active').length;
              const closedCount = clientCases.filter(
                (x) => x.status === 'inactive' || x.status === 'closed',
              ).length;
              return (
                <div
                  key={c.id}
                  className="list-item portal-client-row"
                  data-portal-client-id={c.id}
                  onClick={() => onPick(c.id)}
                  style={{ cursor: 'pointer' }}
                >
                  <div className="item-main">
                    <div className="avatar">{(name || '').slice(0, 1)}</div>
                    <div>
                      <div className="row-title">{name}</div>
                      <div className="sub">
                        {idLabel}: {idNumber} · {phoneLabel}: {phone}
                      </div>
                    </div>
                  </div>
                  <div className="client-case-counts">
                    <span className="client-count-badge active-count">
                      <span>{activeLabel}</span>
                      <strong>{activeCount}</strong>
                    </span>
                    <span className="client-count-badge closed-count">
                      <span>{closedLabel}</span>
                      <strong>{closedCount}</strong>
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>
        <PortalLoginCard />
      </div>
    </section>
  );
}
