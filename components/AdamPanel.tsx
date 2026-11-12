'use client';

import { useCallback, useEffect, useState } from 'react';
import { cancelAdamJob, latestAdamJob, sendToAdam, type AdamJob, type AdamPackage } from '@/lib/adam';

/**
 * "טיוטת אדם" — the case-brain card for the Adam bridge. "שלח לאדם" stores a
 * request (document, current draft, decode, notes, case details); Adam picks
 * it up on the lawyer's computer, consults Yosef (ChatGPT) and Saeed (Gemini)
 * with identifying details removed, and returns a merged draft, a comparison
 * table and the disputed points — shown here in tabs.
 */
export function AdamPanel({
  caseId,
  documentId,
  lang,
  buildPackage,
  onOpenWord,
  className = '',
}: {
  caseId: string;
  documentId?: string;
  lang: 'he' | 'ar';
  buildPackage: (request: string) => AdamPackage;
  onOpenWord: (text: string) => void;
  className?: string;
}) {
  const ar = lang === 'ar';
  const L = {
    title: ar ? 'مسودة آدم' : 'טיוטת אדם',
    intro: ar
      ? 'يعدّ آدم مسودة بعد التشاور مع يوسف (ChatGPT) وسعيد (Gemini)، مع حذف تفاصيل الهوية قبل الإرسال.'
      : 'אדם מכין טיוטה לאחר התייעצות עם יוסף (ChatGPT) וסעיד (Gemini), ומוחק פרטים מזהים לפני השליחה.',
    ask: ar ? 'إرسال إلى آدم' : 'שלח לאדם',
    again: ar ? 'طلب جديد من آدم' : 'בקשה חדשה מאדם',
    cancel: ar ? 'إلغاء الطلب' : 'בטל בקשה',
    placeholder: ar ? 'تعليمات لآدم (اختياري)…' : 'הנחיות לאדם (לא חובה)…',
    pending: ar ? 'الطلب بانتظار آدم. شغّل آدم على الحاسوب.' : 'הבקשה ממתינה לאדם. הפעל את אדם במחשב.',
    working: ar ? 'آدم يعمل على المسودة…' : 'אדם עובד על הטיוטה…',
    error: ar ? 'تعذّر على آدم إكمال الطلب:' : 'אדם לא הצליח להשלים את הבקשה:',
    word: ar ? 'فتح في Word' : 'פתח ב-Word',
    tabs: ar
      ? { draft: 'المسودة الموحّدة', table: 'المقارنة', disputes: 'نقاط الخلاف', yosef: 'يوسف', saeed: 'سعيد' }
      : { draft: 'טיוטה משולבת', table: 'השוואה', disputes: 'מחלוקות', yosef: 'יוסף', saeed: 'סעיד' },
    cols: ar
      ? ['الادعاء', 'آدم', 'يوسف', 'سعيد', 'التقييم', 'التوصية']
      : ['הטענה', 'אדם', 'יוסף', 'סעיד', 'הערכה', 'המלצה'],
    toVerify: ar ? 'للاستكمال / للتحقق' : 'להשלמה / לאימות',
    devil: ar ? 'محامي الشيطان' : 'פרקליט השטן',
    none: ar ? 'لا يوجد.' : 'אין.',
    sending: ar ? 'جارٍ الإرسال…' : 'שולח…',
  };
  const [job, setJob] = useState<AdamJob | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [askOpen, setAskOpen] = useState(false);
  const [req, setReq] = useState('');
  const [tab, setTab] = useState<'draft' | 'table' | 'disputes' | 'yosef' | 'saeed'>('draft');

  const refresh = useCallback(async () => {
    try {
      setJob(await latestAdamJob(caseId, documentId));
    } finally {
      setLoaded(true);
    }
  }, [caseId, documentId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);
  // Poll while Adam has the request.
  useEffect(() => {
    if (!job || (job.status !== 'pending' && job.status !== 'working')) return;
    const t = setInterval(() => void refresh(), 15000);
    return () => clearInterval(t);
  }, [job, refresh]);

  const send = async () => {
    setBusy(true);
    try {
      const j = await sendToAdam(buildPackage(req.trim()));
      if (j) setJob(j);
      setAskOpen(false);
      setReq('');
    } finally {
      setBusy(false);
    }
  };
  const cancel = async () => {
    if (!job) return;
    setBusy(true);
    try {
      await cancelAdamJob(job.id);
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const r = job?.status === 'done' ? job.result : null;
  const open = job && (job.status === 'pending' || job.status === 'working');

  return (
    <section className={'adam-box ' + className} dir="rtl" lang={lang}>
      <header className="adam-top">
        <span className="adam-mark" aria-hidden>
          <i className="fas fa-user-tie" />
        </span>
        <b className="adam-h">{L.title}</b>
        {job && <span className={'adam-state adam-s-' + job.status}>{statusLabel(job.status, ar)}</span>}
      </header>

      {!loaded ? null : open ? (
        <div className="adam-wait">
          <i className={'fas ' + (job!.status === 'working' ? 'fa-spinner fa-spin' : 'fa-hourglass-half')} aria-hidden />
          <span>{job!.status === 'working' ? job!.note || L.working : L.pending}</span>
          <button type="button" className="adam-link" disabled={busy} onClick={cancel}>
            {L.cancel}
          </button>
        </div>
      ) : r ? (
        <>
          {r.summary && <p className="adam-sum">{r.summary}</p>}
          <nav className="adam-tabs" role="tablist">
            {(Object.keys(L.tabs) as (keyof typeof L.tabs)[]).map((k) => (
              <button key={k} type="button" role="tab" aria-selected={tab === k} className={'adam-tab' + (tab === k ? ' adam-on' : '')} onClick={() => setTab(k)}>
                {L.tabs[k]}
                {k === 'disputes' && r.disputes?.length ? <em>{r.disputes.length}</em> : null}
              </button>
            ))}
          </nav>
          <div className="adam-body">
            {tab === 'draft' && (
              <>
                <pre className="adam-text">{r.draft}</pre>
                {!!r.toVerify?.length && (
                  <div className="adam-verify">
                    <b>{L.toVerify}</b>
                    <ul>
                      {r.toVerify.map((x, i) => (
                        <li key={i}>{x}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {r.devilsAdvocate && (
                  <div className="adam-verify adam-devil">
                    <b>{L.devil}</b>
                    <p>{r.devilsAdvocate}</p>
                  </div>
                )}
              </>
            )}
            {tab === 'table' &&
              (r.comparison?.length ? (
                <div className="adam-scroll">
                  <table className="adam-grid">
                    <thead>
                      <tr>
                        {L.cols.map((c) => (
                          <th key={c}>{c}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {r.comparison.map((x, i) => (
                        <tr key={i}>
                          <td>{x.claim}</td>
                          <td>{x.adam || '—'}</td>
                          <td>{x.yosef || '—'}</td>
                          <td>{x.saeed || '—'}</td>
                          <td>{x.assessment || '—'}</td>
                          <td>{x.recommendation || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="adam-sum">{L.none}</p>
              ))}
            {tab === 'disputes' &&
              (r.disputes?.length ? (
                <ol className="adam-disputes">
                  {r.disputes.map((d, i) => (
                    <li key={i}>
                      <b>{d.point}</b>
                      {d.adam && <span><i>{ar ? 'آدم' : 'אדם'}:</i> {d.adam}</span>}
                      {d.yosef && <span><i>{ar ? 'يوسف' : 'יוסף'}:</i> {d.yosef}</span>}
                      {d.saeed && <span><i>{ar ? 'سعيد' : 'סעיד'}:</i> {d.saeed}</span>}
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="adam-sum">{L.none}</p>
              ))}
            {tab === 'yosef' && <pre className="adam-text">{r.yosef || L.none}</pre>}
            {tab === 'saeed' && <pre className="adam-text">{r.saeed || L.none}</pre>}
          </div>
          <div className="adam-acts">
            <button type="button" className="adam-go" onClick={() => onOpenWord(r.draft)}>
              <i className="far fa-file-word" aria-hidden /> {L.word}
            </button>
            <button type="button" className="adam-go adam-go2" onClick={() => setAskOpen((v) => !v)}>
              <i className="fas fa-rotate" aria-hidden /> {L.again}
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="adam-sum">{job?.status === 'error' ? `${L.error} ${job.note}` : L.intro}</p>
          {!askOpen && (
            <div className="adam-acts">
              <button type="button" className="adam-go" onClick={() => setAskOpen(true)}>
                <i className="fas fa-paper-plane" aria-hidden /> {L.ask}
              </button>
            </div>
          )}
        </>
      )}

      {askOpen && (
        <div className="adam-ask">
          <textarea value={req} onChange={(e) => setReq(e.target.value)} placeholder={L.placeholder} rows={3} />
          <div className="adam-acts">
            <button type="button" className="adam-go" disabled={busy} onClick={send}>
              <i className="fas fa-paper-plane" aria-hidden /> {busy ? L.sending : L.ask}
            </button>
            <button type="button" className="adam-link" onClick={() => setAskOpen(false)}>
              {ar ? 'إغلاق' : 'סגור'}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function statusLabel(s: AdamJob['status'], ar: boolean): string {
  const he = { pending: 'ממתין', working: 'בעבודה', done: 'מוכן', error: 'שגיאה', cancelled: 'בוטל' };
  const a = { pending: 'بالانتظار', working: 'قيد العمل', done: 'جاهز', error: 'خطأ', cancelled: 'ملغى' };
  return (ar ? a : he)[s];
}
