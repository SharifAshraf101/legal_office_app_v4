'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useAppState } from '@/hooks/useAppState';
import { useModalStack } from '@/hooks/useModalStack';
import { DocumentPreviewModal } from './DocumentPreviewModal';
import { useT } from '@/hooks/useT';
import { officeAuthHeader } from '@/lib/officeToken';

/**
 * Daily briefing — one page, no scroll (desktop). The day's hearings (each
 * with its case, its last three actions and a short "what to argue" written
 * from the case's brain-screen drafts), the calendar entries, and the tasks
 * due that day / overdue. Data: GET /api/briefing, POST /api/briefing-argument
 * (worker/src/briefing.ts).
 *
 * Class names avoid the substrings the app-wide stylesheet targets
 * ("-row", "-card", "-head", "title", "icon", "hearing", "late", …).
 */

type CaseRef = { caseId: string; caseNumber: string; caseTitle: string; court: string; clientName: string };
type Ev = CaseRef & { id: string; time: string; type: string; hearing: boolean; title: string; description: string };
type Act = { kind: string; docId?: string; date: string; title: string; summary: string };
/** `lang`: the case's language (its court documents) — the card is written in it. */
type Hr = CaseRef & { eventId: string; time: string; title: string; actions: Act[]; drafts: number; lang?: 'he' | 'ar' };
type Tk = CaseRef & { id: string; title: string; dueDate: string; priority: string };
type Data = { day: string; events: Ev[]; hearings: Hr[]; tasksToday: Tk[]; overdue: { count: number; items: Tk[] } };
type Arg = { state: 'loading' | 'ok' | 'error'; text?: string };

const WORKER_URL = process.env.NEXT_PUBLIC_WORKER_URL || '';

const L = {
  he: {
    title: 'תדריך יומי',
    back: 'חזרה',
    today: 'היום',
    pickDate: 'בחירת תאריך',
    prev: 'היום הקודם',
    next: 'היום הבא',
    loading: 'מכין את התדריך…',
    error: 'לא ניתן לטעון את התדריך כרגע.',
    retry: 'נסה שוב',
    hearings: 'דיונים',
    events: 'אירועים ביומן',
    tasks: 'משימות להיום',
    overdue: 'משימות באיחור',
    hearingsBox: 'דיונים בבית המשפט',
    noHearings: 'אין דיונים ביום זה',
    eventsBox: 'היומן',
    noEvents: 'אין אירועים ביומן ביום זה',
    tasksBox: 'משימות',
    noTasks: 'אין משימות שמועדן היום',
    overdueNote: (n: number) => `${n} משימות פתוחות שמועדן עבר`,
    lastActs: 'פעולות אחרונות בתיק',
    noActs: 'אין פעולות מתועדות בתיק',
    argue: 'מה ראוי לטעון',
    reading: 'קורא את טיוטות התיק…',
    argError: 'לא ניתן להכין הצעה כרגע.',
    regenerate: 'הכן מחדש',
    fromDrafts: (n: number) => (n ? `על סמך ${n} טיוטות ממסך המוח` : 'אין טיוטות במסך המוח — על סמך המסמכים'),
    client: 'לקוח',
    court: 'ערכאה',
    caseNo: 'תיק',
    reminder: 'תזכורת',
    hearing: 'דיון',
    prio: { high: 'דחוף', urgent: 'דחוף', medium: 'רגיל', normal: 'רגיל', low: 'נמוך' } as Record<string, string>,
    allDay: 'כל היום',
    disclaimer: 'ההצעה נכתבה אוטומטית מתוך חומרי התיק — יש לבדוק לפני הדיון',
    openDoc: 'לחיצה כפולה לפתיחת המסמך',
  },
  ar: {
    title: 'الإحاطة اليومية',
    back: 'رجوع',
    today: 'اليوم',
    pickDate: 'اختيار تاريخ',
    prev: 'اليوم السابق',
    next: 'اليوم التالي',
    loading: 'جارٍ إعداد الإحاطة…',
    error: 'تعذّر تحميل الإحاطة حالياً.',
    retry: 'حاول مجدداً',
    hearings: 'جلسات',
    events: 'مواعيد في التقويم',
    tasks: 'مهام اليوم',
    overdue: 'مهام متأخرة',
    hearingsBox: 'جلسات المحكمة',
    noHearings: 'لا توجد جلسات في هذا اليوم',
    eventsBox: 'التقويم',
    noEvents: 'لا توجد مواعيد في هذا اليوم',
    tasksBox: 'المهام',
    noTasks: 'لا توجد مهام موعدها اليوم',
    overdueNote: (n: number) => `${n} مهام مفتوحة فات موعدها`,
    lastActs: 'آخر الإجراءات في الملف',
    noActs: 'لا توجد إجراءات مسجّلة في الملف',
    argue: 'ما يجدر طرحه أمام المحكمة',
    reading: 'جارٍ قراءة مسودات الملف…',
    argError: 'تعذّر إعداد الاقتراح حالياً.',
    regenerate: 'إعداد من جديد',
    fromDrafts: (n: number) => (n ? `استناداً إلى ${n} مسودات من شاشة الدماغ` : 'لا توجد مسودات — استناداً إلى المستندات'),
    client: 'الموكل',
    court: 'المحكمة',
    caseNo: 'ملف',
    reminder: 'تذكير',
    hearing: 'جلسة',
    prio: { high: 'عاجل', urgent: 'عاجل', medium: 'عادي', normal: 'عادي', low: 'منخفض' } as Record<string, string>,
    allDay: 'طوال اليوم',
    disclaimer: 'الاقتراح مُعدّ آلياً من مواد الملف — يجب مراجعته قبل الجلسة',
    openDoc: 'انقر مرتين لفتح المستند',
  },
};

/** Today in Israel, "YYYY-MM-DD". */
function israelToday(): string {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date())
    .reduce<Record<string, string>>((o, x) => ((o[x.type] = x.value), o), {});
  return `${p.year}-${p.month}-${p.day}`;
}
function shiftDay(day: string, n: number): string {
  const d = new Date(day + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function dayLabel(day: string, lang: 'he' | 'ar'): { weekday: string; date: string } {
  const d = new Date(day + 'T12:00:00Z');
  const loc = lang === 'ar' ? 'ar-u-nu-latn' : 'he-IL';
  return {
    weekday: new Intl.DateTimeFormat(loc, { weekday: 'long', timeZone: 'UTC' }).format(d),
    date: new Intl.DateTimeFormat(loc, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(d),
  };
}
const shortDate = (iso: string, lang: 'he' | 'ar') =>
  iso
    ? new Intl.DateTimeFormat(lang === 'ar' ? 'ar-u-nu-latn' : 'he-IL', { day: '2-digit', month: '2-digit', year: '2-digit', timeZone: 'UTC' }).format(
        new Date(iso.slice(0, 10) + 'T12:00:00Z'),
      )
    : '';

export function BriefingScreen() {
  const { state, dispatch } = useAppState();
  const modalStack = useModalStack();
  const { lang: rawLang } = useT();
  const lang: 'he' | 'ar' = rawLang === 'ar' ? 'ar' : 'he';
  const T = L[lang];
  const today = useMemo(() => israelToday(), []);
  const [day, setDay] = useState(today);
  const dateRef = useRef<HTMLInputElement>(null);
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState(false);
  const [args, setArgs] = useState<Record<string, Arg>>({});

  // Double-click a document's name: the same as in the case card — the
  // in-app preview of its file (or a note that no file was saved).
  const openDoc = (docId: string) => {
    const doc = state.documentsArr.find((d) => String(d.id).toUpperCase() === String(docId).toUpperCase());
    if (!doc?.relativePath) {
      window.alert(lang === 'ar' ? 'لم يتم حفظ ملف لهذا المستند.' : 'לא נשמר קובץ עבור מסמך זה.');
      return;
    }
    modalStack.open(<DocumentPreviewModal doc={doc} />);
  };

  const loadArgument = async (caseId: string, d: string, refresh = false) => {
    setArgs((a) => ({ ...a, [caseId]: { state: 'loading' } }));
    try {
      const res = await fetch(WORKER_URL + '/api/briefing-argument', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...officeAuthHeader() },
        body: JSON.stringify({ caseId, day: d, lang, refresh }),
      });
      const j = (await res.json()) as { text?: string };
      if (!res.ok || !j.text) throw new Error('no text');
      setArgs((a) => ({ ...a, [caseId]: { state: 'ok', text: j.text } }));
    } catch {
      setArgs((a) => ({ ...a, [caseId]: { state: 'error' } }));
    }
  };

  const load = async (d: string) => {
    setError(false);
    setData(null);
    setArgs({});
    try {
      const res = await fetch(`${WORKER_URL}/api/briefing?day=${d}&lang=${lang}`, {
        headers: officeAuthHeader(),
        cache: 'no-store',
      });
      if (!res.ok) throw new Error(String(res.status));
      const j = (await res.json()) as Data;
      setData(j);
      const seen = new Set<string>();
      for (const h of j.hearings) {
        if (seen.has(h.caseId)) continue;
        seen.add(h.caseId);
        void loadArgument(h.caseId, d);
      }
    } catch {
      setError(true);
    }
  };
  useEffect(() => {
    void load(day);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day, lang]);

  const label = dayLabel(day, lang);
  // "Classic Design" (Settings → home style = classic): the same briefing in
  // the navy + gold look, with the office's banner on top (CSS: .bf-classic).
  const classic = state.homeStyle === 'classic';
  const rootCls = 'bf-root' + (classic ? ' bf-classic' : '');
  const banner = classic ? (
    <div className="bf-banner">
      <img src="/classic/briefing-art.jpg" alt="" className="bf-banner-art" aria-hidden />
      <div className="bf-banner-text">
        <b className="bf-banner-h">
          <i className="far fa-calendar" aria-hidden /> {T.title}
        </b>
        <span className="bf-banner-sub">
          {lang === 'ar' ? 'ملخص شامل لأهم أحداث ومهام اليوم' : 'סיכום מקיף של אירועי היום והמשימות'}
        </span>
      </div>
    </div>
  ) : null;
  const header = (
    <div className="bftop">
      <button type="button" className="bf-back" onClick={() => dispatch({ type: 'SET_TAB', tab: 'home' })}>
        <i className="fas fa-arrow-right" aria-hidden /> {T.back}
      </button>
      <h2 className="bf-h2">
        <img src="/briefing-icon.png" alt="" className="bf-logo" />
        {T.title}
      </h2>
      <div className="bf-daynav">
        <button type="button" aria-label={T.prev} onClick={() => setDay(shiftDay(day, -1))}>
          <i className="fas fa-chevron-right" aria-hidden />
        </button>
        {/* Click the day to pick any date from a calendar. */}
        <button
          type="button"
          className="bf-dayname"
          title={T.pickDate}
          aria-label={T.pickDate}
          onClick={() => {
            const el = dateRef.current;
            if (!el) return;
            try {
              el.showPicker();
            } catch {
              el.focus();
              el.click();
            }
          }}
        >
          <b>
            <i className="far fa-calendar" aria-hidden /> {label.weekday}
          </b>
          <span>{label.date}</span>
          <input
            ref={dateRef}
            type="date"
            className="bf-datepick"
            value={day}
            tabIndex={-1}
            aria-hidden
            onChange={(e) => {
              if (/^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) setDay(e.target.value);
            }}
          />
        </button>
        <button type="button" aria-label={T.next} onClick={() => setDay(shiftDay(day, 1))}>
          <i className="fas fa-chevron-left" aria-hidden />
        </button>
        {/* Always there; marked when the briefing already shows today. */}
        <button
          type="button"
          className={'bf-todaygo' + (day === today ? ' bf-is-now' : '')}
          aria-pressed={day === today}
          onClick={() => setDay(today)}
        >
          {T.today}
        </button>
      </div>
    </div>
  );

  if (!data) {
    return (
      <div className={rootCls}>
        {banner}
        {header}
        <div className="bf-state">
          {error ? (
            <>
              <p>{T.error}</p>
              <button type="button" className="bf-back" onClick={() => void load(day)}>
                {T.retry}
              </button>
            </>
          ) : (
            <p>{T.loading}</p>
          )}
        </div>
      </div>
    );
  }

  const tiles = [
    { k: 'h', label: T.hearings, n: data.hearings.length, fa: 'fa-gavel', tone: 'a' },
    { k: 'e', label: T.events, n: data.events.length, fa: 'fa-calendar-day', tone: 'b' },
    { k: 't', label: T.tasks, n: data.tasksToday.length, fa: 'fa-list-check', tone: 'c' },
    { k: 'o', label: T.overdue, n: data.overdue.count, fa: 'fa-hourglass-end', tone: data.overdue.count ? 'd' : 'c' },
  ];
  const caseLine = (c: CaseRef, t: typeof T = T) =>
    [c.clientName, c.caseNumber && `${t.caseNo} ${c.caseNumber}`, c.court].filter(Boolean).join(' · ');

  return (
    <div className={rootCls}>
      {banner}
      {header}

      <div className="bf-tiles">
        {tiles.map((x) => (
          <div key={x.k} className={'bf-tile bf-tone-' + x.tone}>
            <span className="bf-tfa">
              <i className={'fas ' + x.fa} aria-hidden />
            </span>
            <div>
              <div className="bf-tn">{x.n}</div>
              <div className="bf-tl">{x.label}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="bf-grid">
        {/* Hearings — the heart of the briefing */}
        <section className="bfbox bf-hbox" aria-label={T.hearingsBox}>
          <div className="bfbox-top">
            <h3>
              <i className="fas fa-gavel" aria-hidden /> {T.hearingsBox}
            </h3>
          </div>
          <div className="bfbox-body">
            {data.hearings.length === 0 ? (
              <div className="bf-none">
                <i className="fas fa-mug-hot" aria-hidden />
                <span>{T.noHearings}</span>
              </div>
            ) : (
              <div className={'bf-hcards bf-n' + Math.min(data.hearings.length, 3)}>
                {data.hearings.map((h) => {
                  const a = args[h.caseId];
                  // The card speaks the case's language, whatever the app's.
                  const cl: 'he' | 'ar' = h.lang === 'ar' ? 'ar' : h.lang === 'he' ? 'he' : lang;
                  const C = L[cl];
                  return (
                    <article key={h.eventId} className={'bf-hc' + (cl === 'ar' ? ' bf-in-ar' : '')} lang={cl} dir="rtl">
                      <header className="bf-hctop">
                        <span className="bf-time">{h.time || C.allDay}</span>
                        <div className="bf-hcname">
                          <b>{h.caseTitle || h.title}</b>
                          <span>{caseLine(h, C)}</span>
                        </div>
                      </header>

                      <div className="bf-sub">{C.lastActs}</div>
                      {h.actions.length ? (
                        <ol className="bf-acts">
                          {h.actions.map((x, i) => (
                            <li key={i}>
                              <span className="bf-actdate">{shortDate(x.date, cl)}</span>
                              <div>
                                {x.kind === 'document' && x.docId ? (
                                  <b
                                    className="bf-doclink"
                                    onDoubleClick={() => openDoc(x.docId as string)}
                                    title={C.openDoc}
                                  >
                                    {x.title}
                                  </b>
                                ) : (
                                  <b>{x.title}</b>
                                )}
                                {x.summary && <p>{x.summary}</p>}
                              </div>
                            </li>
                          ))}
                        </ol>
                      ) : (
                        <p className="bf-muted">{C.noActs}</p>
                      )}

                      <div className="bf-arg">
                        <div className="bf-argtop">
                          <span>
                            <i className="fas fa-scale-balanced" aria-hidden /> {C.argue}
                          </span>
                          {a?.state !== 'loading' && (
                            <button
                              type="button"
                              className="bf-regen"
                              title={C.regenerate}
                              aria-label={C.regenerate}
                              onClick={() => void loadArgument(h.caseId, day, true)}
                            >
                              <i className="fas fa-rotate-right" aria-hidden />
                            </button>
                          )}
                        </div>
                        {!a || a.state === 'loading' ? (
                          <p className="bf-muted bf-pulse">{C.reading}</p>
                        ) : a.state === 'error' ? (
                          <p className="bf-muted">{C.argError}</p>
                        ) : (
                          <div className="bf-argtext">
                            {(a.text || '').split('\n').map((l, i) => (
                              <p key={i}>{l}</p>
                            ))}
                          </div>
                        )}
                        <div className="bf-argfoot">{C.fromDrafts(h.drafts)}</div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        <div className="bf-side">
          {/* Calendar */}
          <section className="bfbox" aria-label={T.eventsBox}>
            <div className="bfbox-top">
              <h3>
                <i className="fas fa-calendar-day" aria-hidden /> {T.eventsBox}
              </h3>
            </div>
            <div className="bfbox-body">
              {data.events.length ? (
                <ul className="bf-list">
                  {data.events.map((e) => (
                    <li key={e.id}>
                      <span className="bf-time bf-time-sm">{e.time || T.allDay}</span>
                      <div>
                        <b>
                          {e.title}
                          <em className={'bf-chip ' + (e.hearing ? 'bf-chip-a' : 'bf-chip-b')}>
                            {e.hearing ? T.hearing : e.type === 'reminder' ? T.reminder : ''}
                          </em>
                        </b>
                        <span>{caseLine(e)}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="bf-muted">{T.noEvents}</p>
              )}
            </div>
          </section>

          {/* Tasks */}
          <section className="bfbox" aria-label={T.tasksBox}>
            <div className="bfbox-top">
              <h3>
                <i className="fas fa-list-check" aria-hidden /> {T.tasksBox}
              </h3>
            </div>
            <div className="bfbox-body">
              {data.tasksToday.length ? (
                <ul className="bf-list">
                  {data.tasksToday.map((t) => (
                    <li key={t.id}>
                      <span className={'bf-prio bf-prio-' + (['high', 'urgent'].includes(t.priority) ? 'h' : t.priority === 'low' ? 'l' : 'm')}>
                        {T.prio[t.priority] || T.prio.medium}
                      </span>
                      <div>
                        <b>{t.title}</b>
                        <span>{caseLine(t)}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="bf-muted">{T.noTasks}</p>
              )}
              {data.overdue.count > 0 && (
                <div className="bf-lag">
                  <i className="fas fa-triangle-exclamation" aria-hidden /> {T.overdueNote(data.overdue.count)}
                  <ul>
                    {data.overdue.items.slice(0, 3).map((t) => (
                      <li key={t.id}>
                        <span>{shortDate(t.dueDate, lang)}</span> {t.title}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
      {data.hearings.length > 0 && <p className="bf-foot">{T.disclaimer}</p>}
    </div>
  );
}
