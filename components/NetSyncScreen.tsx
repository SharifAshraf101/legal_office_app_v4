'use client';

import { useCallback, useEffect, useState } from 'react';
import { useT } from '@/hooks/useT';
import { formatDMYTime } from '@/lib/dates';
import { officeAuthHeader } from '@/lib/officeToken';

/**
 * "סנכרון נט" — what the browser extension (extensions/netmishpat-ext) sent
 * from Net HaMishpat and the Sharia courts' site: the documents and decisions
 * it saw (new ones first, until marked as checked), the case numbers, and the
 * latest pages sent. Read from GET /api/netmishpat/overview
 * (worker/src/netsync.ts).
 *
 * The extension works for the operator office only (one bridge token, one
 * database), so the sidebar offers this screen to that office alone.
 */

type Doc = {
  id: number;
  href: string;
  title: string | null;
  case_number: string | null;
  source: string;
  first_seen_at: string;
  reviewed: number;
  doc_date: string | null;
  doc_type: string | null;
  summary: string | null;
  case_name: string | null;
  has_file: number;
  file_size: number | null;
};
type CaseRow = {
  case_number: string;
  case_type: string | null;
  case_name: string | null;
  source: string;
  last_seen_url: string | null;
  last_seen_at: string | null;
};
type Snapshot = { id: number; source: string; url: string; title: string | null; created_at: string };
type Overview = {
  configured: boolean;
  ready: boolean;
  counts?: { cases: number; documents: number; unreviewed: number; snapshots: number; last_sync: string | null };
  documents?: Doc[];
  cases?: CaseRow[];
  snapshots?: Snapshot[];
};

const WORKER_URL = (process.env.NEXT_PUBLIC_WORKER_URL || '').replace(/\/$/, '');

const L = {
  he: {
    intro: 'נתונים שנשלחו מנט המשפט ומנט בתי הדין באמצעות תוסף הדפדפן.',
    refresh: 'רענון',
    loading: 'טוען נתונים…',
    error: 'לא ניתן לטעון את הנתונים כרגע.',
    retry: 'נסה שוב',
    lastSync: 'שליחה אחרונה',
    never: 'טרם נשלחו נתונים',
    newDocs: 'מסמכים חדשים',
    allDocs: 'מסמכים',
    cases: 'תיקים',
    pages: 'עמודים שנשלחו',
    tabNew: 'חדשים לבדיקה',
    tabDocs: 'כל המסמכים',
    tabCases: 'תיקים',
    tabPages: 'שליחות אחרונות',
    tabSetup: 'התקנת התוסף',
    markAll: 'סמן הכל כנבדק',
    mark: 'נבדק',
    unmark: 'החזר לחדשים',
    open: 'פתיחה',
    colDoc: 'מסמך',
    colCase: 'מספר תיק',
    colType: 'סוג הליך',
    colSource: 'מקור',
    colDate: 'תאריך',
    colName: 'שם התיק',
    colLast: 'נראה לאחרונה',
    colPage: 'עמוד',
    colSent: 'נשלח',
    untitled: 'מסמך ללא כותרת',
    openFile: 'פתיחת המסמך',
    noFile: 'הקובץ טרם נשמר: יש לפתוח את המסמך בנט המשפט וללחוץ שם על שמירה',
    fileError: 'לא ניתן לפתוח את המסמך כרגע.',
    emptyNew: 'אין מסמכים חדשים לבדיקה.',
    emptyDocs: 'עדיין לא נשלחו מסמכים.',
    emptyCases: 'עדיין לא נשלחו תיקים.',
    emptyPages: 'עדיין לא נשלחו עמודים.',
    court: 'נט המשפט',
    sharia: 'נט בתי הדין',
    notReady: 'טבלאות הסנכרון עדיין לא הוקמו במסד הנתונים. יש להשלים את שלב 1 בהתקנה.',
    noToken: 'טוקן הגשר (NM_BRIDGE_TOKEN) עדיין לא הוגדר ב-Worker. יש להשלים את שלב 2 בהתקנה.',
    setupTitle: 'התקנה חד-פעמית',
    s1: 'הקמת הטבלאות במסד הנתונים (מתוך תיקיית worker):',
    s2: 'הגדרת טוקן נפרד לתוסף (ערך אקראי וארוך לבחירתך):',
    s3: 'פריסת ה-Worker:',
    s4: 'ב-Chrome או ב-Edge: לפתוח את עמוד התוספים (chrome://extensions), להפעיל "מצב מפתח", ללחוץ "טעינת תוסף לא ארוז" ולבחור את התיקייה extensions/netmishpat-ext שבפרויקט.',
    s5: 'בהגדרות התוסף: להזין את כתובת ה-Worker שלהלן ואת הטוקן משלב 2.',
    s6: 'בנט המשפט, אחרי התחברות: לפתוח תיק או רשימת החלטות וללחוץ על הכפתור הצף "שלח למערכת המשרד". בנט בתי הדין השרעיים: ללחוץ על סמל התוסף ולבחור "הפעל את הגשר באתר הזה".',
    workerUrl: 'כתובת ה-Worker',
    copy: 'העתקה',
    copied: 'הועתק',
  },
  ar: {
    intro: 'بيانات أُرسلت من نت همشباط ومن موقع المحاكم الشرعية عبر إضافة المتصفح.',
    refresh: 'تحديث',
    loading: 'جارٍ تحميل البيانات…',
    error: 'تعذّر تحميل البيانات حالياً.',
    retry: 'حاول مرة أخرى',
    lastSync: 'آخر إرسال',
    never: 'لم تُرسل بيانات بعد',
    newDocs: 'مستندات جديدة',
    allDocs: 'مستندات',
    cases: 'ملفات',
    pages: 'صفحات مُرسلة',
    tabNew: 'جديدة للمراجعة',
    tabDocs: 'كل المستندات',
    tabCases: 'الملفات',
    tabPages: 'آخر الإرسالات',
    tabSetup: 'تثبيت الإضافة',
    markAll: 'تعليم الكل كمُراجَع',
    mark: 'تمت المراجعة',
    unmark: 'إعادة إلى الجديدة',
    open: 'فتح',
    colDoc: 'المستند',
    colCase: 'رقم الملف',
    colType: 'نوع الإجراء',
    colSource: 'المصدر',
    colDate: 'التاريخ',
    colName: 'اسم الملف',
    colLast: 'شوهد آخر مرة',
    colPage: 'الصفحة',
    colSent: 'أُرسل',
    untitled: 'مستند بلا عنوان',
    openFile: 'فتح المستند',
    noFile: 'لم يُحفظ الملف بعد: افتح المستند في نت همشباط واضغط هناك على حفظ',
    fileError: 'تعذّر فتح المستند حالياً.',
    emptyNew: 'لا توجد مستندات جديدة للمراجعة.',
    emptyDocs: 'لم تُرسل مستندات بعد.',
    emptyCases: 'لم تُرسل ملفات بعد.',
    emptyPages: 'لم تُرسل صفحات بعد.',
    court: 'نت همشباط',
    sharia: 'المحاكم الشرعية',
    notReady: 'جداول التزامن لم تُنشأ بعد في قاعدة البيانات. يجب إتمام الخطوة 1 في التثبيت.',
    noToken: 'رمز الجسر (NM_BRIDGE_TOKEN) لم يُعرَّف بعد في الـ Worker. يجب إتمام الخطوة 2 في التثبيت.',
    setupTitle: 'تثبيت لمرة واحدة',
    s1: 'إنشاء الجداول في قاعدة البيانات (من مجلد worker):',
    s2: 'تعريف رمز خاص بالإضافة (قيمة عشوائية وطويلة من اختيارك):',
    s3: 'نشر الـ Worker:',
    s4: 'في Chrome أو Edge: افتح صفحة الإضافات (chrome://extensions)، فعّل "وضع المطوّر"، اضغط "تحميل إضافة غير مضغوطة" واختر المجلد extensions/netmishpat-ext في المشروع.',
    s5: 'في إعدادات الإضافة: أدخل عنوان الـ Worker أدناه والرمز من الخطوة 2.',
    s6: 'في نت همشباط، بعد تسجيل الدخول: افتح ملفاً أو قائمة قرارات واضغط الزر العائم "שלח למערכת המשרד". في موقع المحاكم الشرعية: اضغط أيقونة الإضافة واختر "הפעל את הגשר באתר הזה".',
    workerUrl: 'عنوان الـ Worker',
    copy: 'نسخ',
    copied: 'تم النسخ',
  },
};

const CMD_SQL =
  'npx wrangler d1 execute legal-office-v4 --remote --config wrangler.v4.toml --file=../extensions/worker-snippet/netmishpat.sql';
const CMD_SECRET = 'npx wrangler secret put NM_BRIDGE_TOKEN --config wrangler.v4.toml';
const CMD_DEPLOY = 'npx wrangler deploy --config wrangler.v4.toml';

type Tab = 'new' | 'docs' | 'cases' | 'pages' | 'setup';

function when(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : formatDMYTime(d);
}

export function NetSyncScreen() {
  const { lang } = useT();
  const t = L[lang === 'ar' ? 'ar' : 'he'];
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState(false);
  const [tab, setTab] = useState<Tab>('new');
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setError(false);
    try {
      const res = await fetch(WORKER_URL + '/api/netmishpat/overview', {
        headers: officeAuthHeader(),
        credentials: 'include',
        cache: 'no-store',
      });
      if (!res.ok) throw new Error(String(res.status));
      const d = (await res.json()) as Overview;
      setData(d);
      // Nothing to show before the one-time setup is done: open on its steps
      if (!d.ready || !d.configured) setTab('setup');
    } catch {
      setError(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const setReviewed = async (body: { id: number; reviewed: boolean } | { all: true }) => {
    // Shown at once; the reload below brings the stored state either way
    setData((d) =>
      d && d.documents
        ? {
            ...d,
            documents: d.documents.map((doc) =>
              'all' in body
                ? { ...doc, reviewed: 1 }
                : doc.id === body.id
                  ? { ...doc, reviewed: body.reviewed ? 1 : 0 }
                  : doc,
            ),
          }
        : d,
    );
    try {
      await fetch(WORKER_URL + '/api/netmishpat/reviewed', {
        method: 'POST',
        headers: { ...officeAuthHeader(), 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });
    } finally {
      void load();
    }
  };

  // The PDF the extension sent. Opened in a new tab; the tab is opened at once
  // (inside the click) so the browser does not treat it as a pop-up.
  const openFile = async (id: number) => {
    const tab = window.open('', '_blank');
    try {
      const res = await fetch(WORKER_URL + '/api/netmishpat/file?id=' + id, {
        headers: officeAuthHeader(),
        credentials: 'include',
        cache: 'no-store',
      });
      if (!res.ok) throw new Error(String(res.status));
      const url = URL.createObjectURL(await res.blob());
      if (tab) tab.location.href = url;
      else window.location.assign(url);
      setTimeout(() => URL.revokeObjectURL(url), 5 * 60 * 1000);
    } catch {
      tab?.close();
      window.alert(t.fileError);
    }
  };

  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(WORKER_URL);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* the address is on the screen to copy by hand */
    }
  };

  const sourceName = (s: string) => (s === 'net-batei-hadin' ? t.sharia : t.court);
  const docs = data?.documents || [];
  const fresh = docs.filter((d) => !d.reviewed);
  const counts = data?.counts;

  const docTable = (rows: Doc[], empty: string) =>
    rows.length === 0 ? (
      <p className="ns-empty">{empty}</p>
    ) : (
      <div className="ns-table-wrap">
        <table className="ns-table">
          <thead>
            <tr>
              <th>{t.colDate}</th>
              <th>{t.colDoc}</th>
              <th>{t.colCase}</th>
              <th>{t.colName}</th>
              <th>{t.colSource}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => (
              <tr key={d.id} className={d.reviewed ? '' : 'ns-fresh'}>
                <td dir="ltr">{d.doc_date ? d.doc_date.split('-').reverse().join('.') : when(d.first_seen_at)}</td>
                <td>
                  {/* The court site opens a document with a script, not an
                      address, so its link cannot be followed from here. What
                      opens is the PDF the extension sent, once there is one. */}
                  {d.has_file ? (
                    <button type="button" className="ns-link" onClick={() => void openFile(d.id)} title={t.openFile}>
                      <i className="fas fa-file-pdf" aria-hidden="true" /> {d.doc_type || d.title || t.untitled}
                    </button>
                  ) : /^https?:\/\//i.test(d.href) ? (
                    <a href={d.href} target="_blank" rel="noopener noreferrer">
                      {d.doc_type || d.title || t.untitled}
                    </a>
                  ) : (
                    <span title={t.noFile}>{d.doc_type || d.title || t.untitled}</span>
                  )}
                  {d.summary && <small className="ns-sub">{d.summary}</small>}
                </td>
                <td dir="ltr">{d.case_number || ''}</td>
                <td>{d.case_name || ''}</td>
                <td>{sourceName(d.source)}</td>
                <td className="ns-actions">
                  <button
                    type="button"
                    className="ns-btn"
                    onClick={() => void setReviewed({ id: d.id, reviewed: !d.reviewed })}
                  >
                    {d.reviewed ? t.unmark : t.mark}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );

  const setup = (
    <div className="ns-setup">
      <h3>{t.setupTitle}</h3>
      <ol>
        <li>
          {t.s1}
          <code dir="ltr">{CMD_SQL}</code>
        </li>
        <li>
          {t.s2}
          <code dir="ltr">{CMD_SECRET}</code>
        </li>
        <li>
          {t.s3}
          <code dir="ltr">{CMD_DEPLOY}</code>
        </li>
        <li>{t.s4}</li>
        <li>
          {t.s5}
          <span className="ns-url">
            <span>{t.workerUrl}:</span>
            <code dir="ltr">{WORKER_URL}</code>
            <button type="button" className="ns-btn" onClick={() => void copyUrl()}>
              {copied ? t.copied : t.copy}
            </button>
          </span>
        </li>
        <li>{t.s6}</li>
      </ol>
    </div>
  );

  return (
    <section className="ns-root">
      <header className="ns-head">
        <p className="ns-intro">
          {t.intro}{' '}
          <strong>
            {t.lastSync}: {counts?.last_sync ? <span dir="ltr">{when(counts.last_sync)}</span> : t.never}
          </strong>
        </p>
        <button type="button" className="ns-btn ns-btn-primary" onClick={() => void load()}>
          <i className="fas fa-rotate" aria-hidden="true" /> {t.refresh}
        </button>
      </header>

      {error && (
        <p className="ns-warn" role="alert">
          {t.error}{' '}
          <button type="button" className="ns-btn" onClick={() => void load()}>
            {t.retry}
          </button>
        </p>
      )}
      {!data && !error && <p className="ns-empty">{t.loading}</p>}
      {/* A Worker that predates this screen answers 404: show how to set it up */}
      {!data && error && <div className="ns-panel">{setup}</div>}

      {data && (
        <>
          {!data.ready && <p className="ns-warn">{t.notReady}</p>}
          {!data.configured && <p className="ns-warn">{t.noToken}</p>}

          <div className="ns-tiles">
            <div className="ns-tile ns-tile-new">
              <b>{fresh.length ? (counts?.unreviewed ?? fresh.length) : 0}</b>
              <span>{t.newDocs}</span>
            </div>
            <div className="ns-tile">
              <b>{counts?.documents ?? 0}</b>
              <span>{t.allDocs}</span>
            </div>
            <div className="ns-tile">
              <b>{counts?.cases ?? 0}</b>
              <span>{t.cases}</span>
            </div>
            <div className="ns-tile">
              <b>{counts?.snapshots ?? 0}</b>
              <span>{t.pages}</span>
            </div>
          </div>

          <nav className="ns-tabs" role="tablist">
            {(
              [
                ['new', t.tabNew],
                ['docs', t.tabDocs],
                ['cases', t.tabCases],
                ['pages', t.tabPages],
                ['setup', t.tabSetup],
              ] as [Tab, string][]
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                className={'ns-tab' + (tab === id ? ' active' : '')}
                onClick={() => setTab(id)}
              >
                {label}
              </button>
            ))}
          </nav>

          <div className="ns-panel">
            {tab === 'new' && (
              <>
                {fresh.length > 0 && (
                  <div className="ns-panel-bar">
                    <button type="button" className="ns-btn" onClick={() => void setReviewed({ all: true })}>
                      {t.markAll}
                    </button>
                  </div>
                )}
                {docTable(fresh, t.emptyNew)}
              </>
            )}

            {tab === 'docs' && docTable(docs, t.emptyDocs)}

            {tab === 'cases' &&
              ((data.cases || []).length === 0 ? (
                <p className="ns-empty">{t.emptyCases}</p>
              ) : (
                <div className="ns-table-wrap">
                  <table className="ns-table">
                    <thead>
                      <tr>
                        <th>{t.colCase}</th>
                        <th>{t.colName}</th>
                        <th>{t.colType}</th>
                        <th>{t.colSource}</th>
                        <th>{t.colLast}</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {(data.cases || []).map((c) => (
                        <tr key={c.case_number}>
                          <td dir="ltr">{c.case_number}</td>
                          <td>{c.case_name || ''}</td>
                          <td>{c.case_type || ''}</td>
                          <td>{sourceName(c.source)}</td>
                          <td dir="ltr">{when(c.last_seen_at)}</td>
                          <td className="ns-actions">
                            {c.last_seen_url && (
                              <a className="ns-btn" href={c.last_seen_url} target="_blank" rel="noopener noreferrer">
                                {t.open}
                              </a>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}

            {tab === 'pages' &&
              ((data.snapshots || []).length === 0 ? (
                <p className="ns-empty">{t.emptyPages}</p>
              ) : (
                <div className="ns-table-wrap">
                  <table className="ns-table">
                    <thead>
                      <tr>
                        <th>{t.colPage}</th>
                        <th>{t.colSource}</th>
                        <th>{t.colSent}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(data.snapshots || []).map((s) => (
                        <tr key={s.id}>
                          <td>
                            <a href={s.url} target="_blank" rel="noopener noreferrer">
                              {s.title || s.url}
                            </a>
                          </td>
                          <td>{sourceName(s.source)}</td>
                          <td dir="ltr">{when(s.created_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}

            {tab === 'setup' && setup}
          </div>
        </>
      )}
    </section>
  );
}
