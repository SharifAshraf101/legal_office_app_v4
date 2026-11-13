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

  // "Classic Design": the same search over the same data; the category
  // buttons only choose which of the existing result groups is shown.
  const [cat, setCat] = useState<'all' | 'clients' | 'cases' | 'tasks' | 'events' | 'docs'>('all');
  // "Modern Design" uses the same logic with a light shell ("sx-" classes).
  if (state.homeStyle === 'classic' || state.homeStyle === 'modern') {
    const modern = state.homeStyle === 'modern';
    const ar = lang === 'ar';
    const L = {
      h: ar ? 'البحث الشامل' : 'חיפוש כולל',
      sub: modern
        ? ar
          ? 'البحث في الموكلين والملفات والمهام والأحداث والمستندات'
          : 'חיפוש בלקוחות, בתיקים, במשימות, באירועים ובמסמכים'
        : ar
          ? 'البحث في جميع بيانات النظام'
          : 'חיפוש בכל נתוני המערכת',
      ph: modern
        ? ar
          ? 'ابحث عن: اسم موكل، رقم ملف، رقم قضية، مستند، أو أي كلمات أخرى...'
          : 'חפש: שם לקוח, מספר תיק, מספר הליך, מסמך או כל מילה אחרת...'
        : ar
        ? 'بحث شامل في: الموكلين، الملفات، المهام، الجلسات، المستندات...'
        : 'חיפוש כולל ב: לקוחות, תיקים, משימות, דיונים, מסמכים...',
      all: ar ? 'الكل' : 'הכל',
      events: modern ? (ar ? 'الأحداث والمواعيد' : 'אירועים ומועדים') : ar ? 'الجلسات' : 'דיונים',
      cases: ar ? 'الملفات' : 'תיקים',
      idleH: ar ? 'أدخل كلمة للبحث' : 'הקלד מילה לחיפוש',
      idleP: ar ? 'سيتم عرض النتائج هنا بعد إجراء البحث' : 'התוצאות יוצגו כאן לאחר החיפוש',
      none: ar ? 'لا توجد نتائج مطابقة.' : 'לא נמצאו תוצאות.',
    };
    const tabs = [
      { k: 'all' as const, fa: 'fas fa-layer-group', label: L.all, n: total },
      { k: 'clients' as const, fa: 'fas fa-users', label: clientsLabel, n: clientMatches.length },
      { k: 'cases' as const, fa: 'far fa-folder-open', label: L.cases, n: caseMatches.length },
      { k: 'tasks' as const, fa: 'fas fa-list-check', label: tasksHead, n: taskMatches.length },
      { k: 'events' as const, fa: 'far fa-calendar-days', label: L.events, n: eventMatches.length },
      { k: 'docs' as const, fa: 'far fa-file-lines', label: docsHead, n: docMatches.length },
    ];
    const show = (k: typeof cat) => cat === 'all' || cat === k;
    const shownTotal = cat === 'all' ? total : tabs.find((x) => x.k === cat)!.n;
    const Item = ({ fa, main, meta, onOpen }: { fa: React.ReactNode; main: string; meta?: string; onOpen?: () => void }) => (
      <div
        className={'gx-item' + (onOpen ? ' gx-go' : '')}
        role={onOpen ? 'button' : undefined}
        tabIndex={onOpen ? 0 : undefined}
        onClick={onOpen}
        onKeyDown={
          onOpen
            ? (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onOpen();
                }
              }
            : undefined
        }
      >
        <span className="gx-av">{fa}</span>
        <span className="gx-txt">
          <b>{main}</b>
          {meta && <small>{meta}</small>}
        </span>
      </div>
    );
    const Group = ({ k, fa, label, n, children }: { k: typeof cat; fa: string; label: string; n: number; children: React.ReactNode }) =>
      n > 0 && show(k) ? (
        <div className="gx-sec">
          <h3 className="gx-sech">
            <i className={fa} aria-hidden />
            {label} <span>({n})</span>
          </h3>
          <div className="gx-items">{children}</div>
        </div>
      ) : null;

    const searchBox = (
      <label className={modern ? 'sx-search' : 'kx-search'}>
        <i className="fas fa-magnifying-glass" aria-hidden />
        <input
          type="search"
          autoComplete="off"
          aria-label={lang === 'ar' ? 'بحث' : 'חיפוש'}
          placeholder={L.ph}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
    );
    const tabRow = (
      <div className="gx-tabs" role="tablist">
        {tabs.map((tb) => (
          <button
            key={tb.k}
            type="button"
            role="tab"
            aria-selected={cat === tb.k}
            className={'gx-tab' + (cat === tb.k ? ' gx-on' : '')}
            onClick={() => setCat(tb.k)}
          >
            <i className={tb.fa} aria-hidden />
            <span className="gx-tab-name">{tb.label}</span>
            {q && <span className="gx-tab-n">{tb.n}</span>}
          </button>
        ))}
      </div>
    );
    return (
      <section className={modern ? 'sx-root gx-root gx-modern' : 'kx-root gx-root'}>
        <MainScreenBackButton />
        <div className={modern ? 'sx-art' : 'kx-art'} aria-hidden>
          <img src={modern ? '/classic/modern-search-art.png' : '/classic/search-art-2.jpg'} alt="" />
        </div>
        <header className={modern ? 'sx-hero' : 'kx-hero'}>
          <span className={modern ? 'sx-hero-fa' : 'kx-hero-fa'} aria-hidden>
            <i className="fas fa-magnifying-glass" />
          </span>
          <div className={modern ? 'sx-hero-text' : 'kx-hero-text'}>
            <h2 className={modern ? 'sx-h' : 'kx-h'}>{L.h}</h2>
            {!modern && <span className="kx-rule" aria-hidden />}
            <p className={modern ? 'sx-sub' : 'kx-sub'}>{L.sub}</p>
          </div>
        </header>
        {modern ? (
          <div className="sx-card">
            {searchBox}
            {tabRow}
          </div>
        ) : (
          <>
            {searchBox}
            {tabRow}
          </>
        )}
        {modern && !q && (
          <div className="sx-mark" aria-hidden>
            <i className="fas fa-scale-balanced" />
          </div>
        )}
        <div className={modern ? 'sx-frame gx-frame' + (q ? '' : ' sx-hide') : 'kx-frame gx-frame'}>
          {!q ? (
            <div className="gx-idle">
              <span className="gx-idle-fa" aria-hidden>
                <i className="fas fa-magnifying-glass" />
              </span>
              <b>{L.idleH}</b>
              <p>{L.idleP}</p>
            </div>
          ) : shownTotal === 0 ? (
            <div className="gx-idle">
              <b>{L.none}</b>
            </div>
          ) : (
            <div className="kx-list gx-results">
              <Group k="clients" fa="fas fa-users" label={clientsLabel} n={clientMatches.length}>
                {clientMatches.map((c) => (
                  <Item
                    key={c.id}
                    fa={
                      c.photoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={c.photoUrl} alt="" />
                      ) : (
                        clientDisplayName(c, lang).slice(0, 1)
                      )
                    }
                    main={clientDisplayName(c, lang)}
                    meta={`${c.phone || '-'} · ${c.idNumber || '-'}`}
                    onOpen={() => modalStack.open(<ClientDetail clientId={c.id} />)}
                  />
                ))}
              </Group>
              <Group k="cases" fa="far fa-folder-open" label={L.cases} n={caseMatches.length}>
                {caseMatches.map((c) => {
                  const client = state.clients.find((x) => x.id === c.clientId);
                  return (
                    <Item
                      key={c.id}
                      fa={<i className="fas fa-folder-open" />}
                      main={caseName(c, lang) || '-'}
                      meta={`${c.caseNumber || '-'} · ${client ? clientDisplayName(client, lang) : '-'}`}
                      onOpen={() => modalStack.open(<CaseDetail caseId={c.id} />)}
                    />
                  );
                })}
              </Group>
              <Group k="tasks" fa="fas fa-list-check" label={tasksHead} n={taskMatches.length}>
                {taskMatches.map((t) => (
                  <Item
                    key={t.id}
                    fa={<i className="fas fa-list-check" />}
                    main={t.title || '-'}
                    meta={`${t.dueDate || ''} · ${t.status} · ${t.priority}`}
                  />
                ))}
              </Group>
              <Group k="events" fa="far fa-calendar-days" label={L.events} n={eventMatches.length}>
                {eventMatches.map((e) => (
                  <Item
                    key={e.id}
                    fa={<i className="fas fa-calendar-check" />}
                    main={(ar ? e.titleAr || e.title : e.title || e.titleAr) || '-'}
                    meta={e.dateTime}
                    onOpen={() => modalStack.open(<CalendarEventDetail source="event" id={e.id} />)}
                  />
                ))}
              </Group>
              <Group k="docs" fa="far fa-file-lines" label={docsHead} n={docMatches.length}>
                {docMatches.map((d) => (
                  <Item
                    key={d.id}
                    fa={<i className="fas fa-file-lines" />}
                    main={d.title || d.fileName || '-'}
                    meta={d.relativePath || ''}
                  />
                ))}
              </Group>
            </div>
          )}
        </div>
      </section>
    );
  }

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
