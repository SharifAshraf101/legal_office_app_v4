'use client';

// "Connect to Google Calendar" — shows the office's private calendar link and
// how to add it in Google Calendar. One-way: the system -> Google.

import { useEffect, useState, type CSSProperties } from 'react';
import { useModalStack } from '@/hooks/useModalStack';
import { useT } from '@/hooks/useT';
import { getCalendarFeed, googleSubscribeUrl, resetCalendarFeed, type CalendarFeed } from '@/lib/calendarFeed';
import { Modal } from './Modal';

const ink = '#1f2a44';
const line = '#d9dee8';
const gold = '#b8892d';

const btn: CSSProperties = {
  minHeight: 44,
  padding: '0 16px',
  borderRadius: 12,
  border: '1px solid ' + line,
  background: '#fff',
  color: ink,
  fontFamily: 'inherit',
  fontSize: 15,
  fontWeight: 600,
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  textDecoration: 'none',
};

export function GoogleCalendarModal() {
  const { lang } = useT();
  const modalStack = useModalStack();
  const ar = lang === 'ar';
  const close = () => modalStack.close(modalStack.topId() ?? 0);

  const [feed, setFeed] = useState<CalendarFeed | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  const L = {
    head: ar ? 'ربط التقويم مع تقويم Google' : 'חיבור היומן ליומן גוגל',
    intro: ar
      ? 'كل المواعيد والتذكيرات في النظام ستظهر في تقويم Google كتقويم منفصل باسم "יומן המשרד" — وعلى الهاتف أيضاً.'
      : 'כל המועדים והתזכורות שבמערכת יופיעו ביומן גוגל שלך כיומן נפרד בשם "יומן המשרד" — גם בטלפון.',
    add: ar ? 'إضافة إلى تقويم Google' : 'הוסף ליומן גוגל',
    manual: ar ? 'أو يدوياً:' : 'או ידנית:',
    steps: ar
      ? ['انسخ الرابط أدناه.', 'افتح calendar.google.com على الحاسوب.', 'في الجهة الجانبية: "تقاويم أخرى" ← + ← "من عنوان URL".', 'ألصق الرابط واضغط "إضافة تقويم".']
      : ['העתק את הקישור שלמטה.', 'פתח את calendar.google.com במחשב.', 'בצד: "יומנים אחרים" ← + ← "מכתובת URL".', 'הדבק את הקישור ולחץ "הוספת יומן".'],
    copy: ar ? 'نسخ الرابط' : 'העתק קישור',
    copied: ar ? 'تم النسخ' : 'הועתק',
    notes: ar
      ? [
          'الاتجاه واحد: من النظام إلى Google. ما تكتبه في Google لا يعود إلى النظام.',
          'Google يحدّث هذا التقويم كل بضع ساعات، لذا الموعد الجديد لا يظهر فوراً.',
          'الرابط سرّي: من يملكه يرى أسماء الموكلين وتفاصيل الجلسات. لا ترسله لأحد.',
        ]
      : [
          'החיבור חד-כיווני: מהמערכת לגוגל. מה שתכתוב בגוגל לא חוזר למערכת.',
          'גוגל מרענן יומן כזה כל כמה שעות, ולכן מועד חדש לא מופיע מיד.',
          'הקישור סודי: מי שמחזיק בו רואה שמות לקוחות ופרטי דיונים. אל תשלח אותו לאיש.',
        ],
    never: ar ? 'لم يقرأ Google الرابط بعد.' : 'גוגל עדיין לא קרא את הקישור.',
    last: ar ? 'آخر قراءة للرابط:' : 'הקישור נקרא לאחרונה:',
    reset: ar ? 'استبدال الرابط' : 'החלף קישור',
    resetAsk: ar
      ? 'سيتوقف الرابط الحالي عن العمل، ويجب إضافة الرابط الجديد في Google من جديد. متابعة؟'
      : 'הקישור הנוכחי יפסיק לעבוד, ויהיה צריך להוסיף את הקישור החדש בגוגל מחדש. להמשיך?',
    loading: ar ? 'جارٍ التحميل…' : 'טוען…',
    error: ar ? 'تعذّر تحميل الرابط. حاول مجدداً.' : 'טעינת הקישור נכשלה. נסה שוב.',
    close: ar ? 'إغلاق' : 'סגור',
  };

  useEffect(() => {
    let alive = true;
    getCalendarFeed().then((f) => {
      if (!alive) return;
      setFeed(f);
      setState(f ? 'ready' : 'error');
    });
    return () => {
      alive = false;
    };
  }, []);

  const copy = async () => {
    if (!feed) return;
    try {
      await navigator.clipboard.writeText(feed.url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt(L.copy, feed.url);
    }
  };

  const reset = async () => {
    if (busy || !window.confirm(L.resetAsk)) return;
    setBusy(true);
    const f = await resetCalendarFeed();
    setBusy(false);
    if (f) setFeed(f);
    else setState('error');
  };

  const lastRead = feed?.lastReadAt
    ? new Intl.DateTimeFormat(ar ? 'ar-u-nu-latn' : 'he-IL', {
        dateStyle: 'short',
        timeStyle: 'short',
        timeZone: 'Asia/Jerusalem',
      }).format(new Date(feed.lastReadAt))
    : '';

  return (
    <Modal onClose={close} className="gcal-modal">
      <div dir="rtl" style={{ color: ink, display: 'grid', gap: 14, maxWidth: 560, padding: '4px 2px' }}>
        <h3 style={{ margin: 0, fontSize: 20, display: 'flex', alignItems: 'center', gap: 10 }}>
          <i className="fab fa-google" style={{ color: gold }} aria-hidden /> {L.head}
        </h3>
        <p style={{ margin: 0, lineHeight: 1.6 }}>{L.intro}</p>

        {state === 'loading' && <p style={{ margin: 0 }}>{L.loading}</p>}
        {state === 'error' && <p style={{ margin: 0, color: '#b3261e' }}>{L.error}</p>}

        {state === 'ready' && feed && (
          <>
            <a
              href={googleSubscribeUrl(feed.url)}
              target="_blank"
              rel="noopener noreferrer"
              style={{ ...btn, background: ink, color: '#fff', borderColor: ink }}
            >
              <i className="far fa-calendar-plus" aria-hidden /> {L.add}
            </a>

            <div style={{ display: 'grid', gap: 8 }}>
              <b>{L.manual}</b>
              <ol style={{ margin: 0, paddingInlineStart: 22, lineHeight: 1.7 }}>
                {L.steps.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ol>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <input
                  readOnly
                  dir="ltr"
                  value={feed.url}
                  onFocus={(e) => e.currentTarget.select()}
                  style={{
                    flex: '1 1 220px',
                    minWidth: 0,
                    minHeight: 44,
                    borderRadius: 12,
                    border: '1px solid ' + line,
                    padding: '0 12px',
                    fontSize: 13,
                    color: ink,
                    background: '#f6f7fa',
                  }}
                />
                <button type="button" style={btn} onClick={copy}>
                  <i className="far fa-copy" aria-hidden /> {copied ? L.copied : L.copy}
                </button>
              </div>
            </div>

            <ul style={{ margin: 0, paddingInlineStart: 20, lineHeight: 1.7, fontSize: 14, color: '#4a5570' }}>
              {L.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>

            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 10,
                flexWrap: 'wrap',
                borderTop: '1px solid ' + line,
                paddingTop: 12,
                fontSize: 14,
              }}
            >
              <span>{lastRead ? `${L.last} ${lastRead}` : L.never}</span>
              <button type="button" style={{ ...btn, minHeight: 38, fontSize: 14 }} onClick={reset} disabled={busy}>
                <i className="fas fa-rotate" aria-hidden /> {L.reset}
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
