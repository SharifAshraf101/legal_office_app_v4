'use client';

import { useMemo, useState } from 'react';
import { useAppState } from '@/hooks/useAppState';
import { useModalStack } from '@/hooks/useModalStack';
import { useT } from '@/hooks/useT';
import { caseName } from '@/lib/cases';
import { clientDisplayName } from '@/lib/clients';
import { ClientDetail } from './ClientDetail';
import { CaseDetail } from './CaseDetail';
import { CalendarEventDetail } from './CalendarEventDetail';
import { MainScreenBackButton } from './MainScreenBackButton';

/**
 * Port of the global-search aggregator (source line 5487+, `gs*` helpers and
 * `gsResultsHtml` at line 5524). The original renders cross-table sections
 * for clients, cases, documents, tasks, and events when the user types into
 * the search bar. We keep the same flat-sections layout with per-section
 * row counts.
 *
 * Click handlers open the corresponding detail modal, matching the source
 * row click behavior.
 */
export function GlobalSearchScreen() {
  const { state } = useAppState();
  const { lang } = useT();
  const modalStack = useModalStack();
  const [query, setQuery] = useState('');

  const q = query.trim().toLowerCase();

  const clientMatches = useMemo(() => {
    if (!q) return [];
    return state.clients.filter((c) =>
      [c.name, c.nameAr, c.idNumber, c.phone, c.email]
        .filter(Boolean)
        .join(' · ')
        .toLowerCase()
        .includes(q),
    );
  }, [state.clients, q]);

  const caseMatches = useMemo(() => {
    if (!q) return [];
    return state.casesArr.filter((c) => {
      const client = state.clients.find((x) => x.id === c.clientId);
      return [
        client?.name,
        client?.nameAr,
        c.caseNumber,
        c.title,
        c.titleAr,
        c.court,
        c.courtAr,
      ]
        .filter(Boolean)
        .join(' · ')
        .toLowerCase()
        .includes(q);
    });
  }, [state.casesArr, state.clients, q]);

  const taskMatches = useMemo(() => {
    if (!q) return [];
    return state.tasksArr.filter((t) =>
      [t.title, t.notes, t.dueDate, t.status, t.priority]
        .filter(Boolean)
        .join(' · ')
        .toLowerCase()
        .includes(q),
    );
  }, [state.tasksArr, q]);

  const eventMatches = useMemo(() => {
    if (!q) return [];
    return state.eventsList.filter((e) =>
      [e.title, e.titleAr, e.description, e.descriptionAr, e.dateTime]
        .filter(Boolean)
        .join(' · ')
        .toLowerCase()
        .includes(q),
    );
  }, [state.eventsList, q]);

  const docMatches = useMemo(() => {
    if (!q) return [];
    return state.documentsArr.filter((d) =>
      [d.title, d.fileName, d.relativePath]
        .filter(Boolean)
        .join(' · ')
        .toLowerCase()
        .includes(q),
    );
  }, [state.documentsArr, q]);

  const total =
    clientMatches.length +
    caseMatches.length +
    taskMatches.length +
    eventMatches.length +
    docMatches.length;

  const placeholder =
    lang === 'ar'
      ? 'بحث شامل في الموكلين، القضايا، المهام، الأحداث والمستندات'
      : 'חיפוש כולל בלקוחות, תיקים, משימות, אירועים ומסמכים';
  const hint =
    lang === 'ar'
      ? `يعرض ${total} نتيجة من جميع الفئات.`
      : `מוצגות ${total} תוצאות מכל הקטגוריות.`;
  const emptyHint =
    lang === 'ar'
      ? 'اكتب كلمة بحث لعرض النتائج.'
      : 'הקלד מילת חיפוש כדי להציג תוצאות.';
  const clientsLabel = lang === 'ar' ? 'الموكلون' : 'לקוחות';
  const casesLabel = lang === 'ar' ? 'القضايا' : 'תיקים';
  const tasksHead = lang === 'ar' ? 'المهام' : 'משימות';
  const eventsHead = lang === 'ar' ? 'الأحداث' : 'אירועים';
  const docsHead = lang === 'ar' ? 'المستندات' : 'מסמכים';

  return (
    <section className="panel global-search-panel">
      <MainScreenBackButton />
      <div className="panel-body">
        <div className="case-search-wrap">
          <label>{lang === 'ar' ? 'بحث' : 'חיפוש'}</label>
          <input
            type="search"
            className="case-search-input"
            placeholder={placeholder}
            autoComplete="off"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="case-search-meta">{q ? hint : emptyHint}</div>
        </div>

        {/* Sibling of case-search-wrap; takes the remaining flex
         *  height in panel-body and owns vertical scroll. The back
         *  button (absolute on panel) + the search-wrap above stay
         *  visually pinned because the panel itself never scrolls. */}
        <div className="global-search-scroll-body">
        {q && total === 0 && (
          <div className="case-empty">
            {lang === 'ar' ? 'لا توجد نتائج مطابقة.' : 'לא נמצאו תוצאות.'}
          </div>
        )}

        {clientMatches.length > 0 && (
          <Section title={`${clientsLabel} (${clientMatches.length})`} icon="fa-users">
            {clientMatches.map((c) => (
              <div
                key={c.id}
                className="list-item"
                style={{ cursor: 'pointer' }}
                onClick={() => modalStack.open(<ClientDetail clientId={c.id} />)}
              >
                <div className="item-main">
                  {/* Client photo if uploaded; otherwise the initial. The
                   * .avatar styling is overridden in globals.css for the
                   * search-results context so the surrounding circle is
                   * a light cream tint (not the dark navy --primary-2
                   * inherited from non-home content tokens), and when an
                   * <img> is inside it fills the circle edge-to-edge so
                   * the photo is fully visible. */}
                  <div className="avatar">
                    {c.photoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={c.photoUrl}
                        alt={clientDisplayName(c, lang)}
                        className="avatar-photo"
                      />
                    ) : (
                      clientDisplayName(c, lang).slice(0, 1)
                    )}
                  </div>
                  <div>
                    <div className="row-title">{clientDisplayName(c, lang)}</div>
                    <div className="sub">
                      {c.phone || '-'} · {c.idNumber || '-'}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </Section>
        )}

        {caseMatches.length > 0 && (
          <Section title={`${casesLabel} (${caseMatches.length})`} icon="fa-folder-open">
            {caseMatches.map((c) => {
              const client = state.clients.find((x) => x.id === c.clientId);
              return (
                <div
                  key={c.id}
                  className="list-item"
                  style={{ cursor: 'pointer' }}
                  onClick={() => modalStack.open(<CaseDetail caseId={c.id} />)}
                >
                  <div className="item-main">
                    <div className="avatar">
                      <i className="fas fa-folder-open" />
                    </div>
                    <div>
                      <div className="row-title">{caseName(c, lang) || '-'}</div>
                      <div className="sub">
                        {c.caseNumber || '-'} ·{' '}
                        {client ? clientDisplayName(client, lang) : '-'}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </Section>
        )}

        {taskMatches.length > 0 && (
          <Section title={`${tasksHead} (${taskMatches.length})`} icon="fa-list-check">
            {taskMatches.map((t) => (
              <div key={t.id} className="list-item">
                <div className="item-main">
                  <div className="avatar">
                    <i className="fas fa-list-check" />
                  </div>
                  <div>
                    <div className="row-title">{t.title || '-'}</div>
                    <div className="sub">
                      {t.dueDate || ''} · {t.status} · {t.priority}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </Section>
        )}

        {eventMatches.length > 0 && (
          <Section title={`${eventsHead} (${eventMatches.length})`} icon="fa-calendar-days">
            {eventMatches.map((e) => (
              <div
                key={e.id}
                className="list-item"
                style={{ cursor: 'pointer' }}
                onClick={() =>
                  modalStack.open(<CalendarEventDetail source="event" id={e.id} />)
                }
              >
                <div className="item-main">
                  <div className="avatar">
                    <i className="fas fa-calendar-check" />
                  </div>
                  <div>
                    <div className="row-title">
                      {lang === 'ar' ? e.titleAr || e.title : e.title || e.titleAr}
                    </div>
                    <div className="sub">{e.dateTime}</div>
                  </div>
                </div>
              </div>
            ))}
          </Section>
        )}

        {docMatches.length > 0 && (
          <Section title={`${docsHead} (${docMatches.length})`} icon="fa-file-lines">
            {docMatches.map((d) => (
              <div key={d.id} className="list-item">
                <div className="item-main">
                  <div className="avatar">
                    <i className="fas fa-file-lines" />
                  </div>
                  <div>
                    <div className="row-title">{d.title || d.fileName || '-'}</div>
                    <div className="sub">{d.relativePath || ''}</div>
                  </div>
                </div>
              </div>
            ))}
          </Section>
        )}
        </div>
        {/* /global-search-scroll-body */}
      </div>
    </section>
  );
}

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ marginTop: 18 }}>
      <h3 style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '12px 0' }}>
        <i className={'fas ' + icon} />
        {title}
      </h3>
      <div className="list">{children}</div>
    </div>
  );
}
