'use client';

// "שלח לחתימה" — the lawyer marks where the client signs on a PDF of the case
// and gets a link to send. See lib/signRequests.ts for the whole flow.

import { useEffect, useRef, useState, type CSSProperties, type MouseEvent } from 'react';
import { useAppState } from '@/hooks/useAppState';
import { useModalStack } from '@/hooks/useModalStack';
import { useT } from '@/hooks/useT';
import { useWhatsAppEnabled } from '@/hooks/useIsOperatorOffice';
import { clientDisplayName, normalizePhoneForLinks, whatsappAppUrl } from '@/lib/clients';
import { getFilingFileBlob } from '@/lib/disk';
import { officeAuthHeader } from '@/lib/officeToken';
import { openPdf, renderPdfPage, type PdfDoc } from '@/lib/pdfPages';
import {
  cancelSignRequest,
  createSignRequest,
  listCaseSignRequests,
  signLink,
  type SignRequest,
} from '@/lib/signRequests';
import { Modal } from './Modal';
import type { DocumentRecord } from '@/types';

// The signature box, as a share of the page: wide enough for a signature and
// low enough to sit on a signature line.
const BOX_W = 0.3;
const BOX_H = 0.075;

const navy = '#0f2444';
const ink = '#16223b';
const muted = '#5b6475';
const line = '#d9e2ef';

const btn: CSSProperties = {
  minHeight: 44,
  padding: '0 16px',
  borderRadius: 12,
  border: '1px solid ' + line,
  background: '#fff',
  color: ink,
  fontFamily: 'inherit',
  fontSize: 15,
  fontWeight: 700,
  cursor: 'pointer',
};
const primaryBtn: CSSProperties = { ...btn, border: 0, background: navy, color: '#fff', fontWeight: 800, minHeight: 50 };
const field: CSSProperties = {
  height: 44,
  borderRadius: 12,
  border: '1px solid ' + line,
  padding: '0 12px',
  fontFamily: 'inherit',
  fontSize: 15,
  color: ink,
  background: '#fff',
  width: '100%',
  boxSizing: 'border-box',
};

export function SignRequestModal({ doc, caseId }: { doc: DocumentRecord; caseId: string }) {
  const { state } = useAppState();
  const { lang } = useT();
  const modalStack = useModalStack();
  const waEnabled = useWhatsAppEnabled();
  const ar = lang === 'ar';
  const close = () => modalStack.close(modalStack.topId() ?? 0);

  const caseObj = state.casesArr.find((c) => String(c.id) === String(caseId));
  const client = state.clients.find((c) => c.id === (doc.clientId || caseObj?.clientId));
  const title = doc.title || doc.fileName || '';

  const L = {
    head: ar ? 'إرسال مستند لتوقيع الموكل' : 'שליחת מסמך לחתימת הלקוח',
    loading: ar ? 'جارٍ تحميل المستند…' : 'טוען את המסמך…',
    loadFail: ar ? 'تعذّر تحميل المستند.' : 'טעינת המסמך נכשלה.',
    pick: ar ? 'اضغط على المكان الذي يوقّع فيه الموكل' : 'לחץ על המקום במסמך שבו הלקוח צריך לחתום',
    here: ar ? 'هنا يوقّع الموكل' : 'כאן חותם הלקוח',
    prev: ar ? 'الصفحة السابقة' : 'עמוד קודם',
    next: ar ? 'الصفحة التالية' : 'עמוד הבא',
    page: (a: number, b: number) => (ar ? `صفحة ${a} من ${b}` : `עמוד ${a} מתוך ${b}`),
    step1: ar ? '1 · حدِّد مكان التوقيع' : '1 · סמן את מקום החתימה',
    step1Hint: ar ? 'اضغط على المستند في المكان الذي يوقّع فيه الموكل.' : 'לחץ על המסמך במקום שבו הלקוח צריך לחתום — למשל מעל הקו שליד שמו.',
    marked: ar ? 'تم تحديد مكان التوقيع' : 'מקום החתימה סומן',
    markedHint: ar ? 'يمكن الضغط في مكان آخر لتحريك الإطار.' : 'אפשר ללחוץ במקום אחר כדי להזיז את המסגרת.',
    step2: ar ? '2 · إلى مَن يُرسَل' : '2 · למי נשלח',
    name: ar ? 'اسم الموقِّع' : 'שם החותם',
    phone: ar ? 'هاتف الواتساب' : 'טלפון בוואטסאפ',
    days: ar ? 'صلاحية الرابط' : 'תוקף הלינק',
    daysOpt: (n: number) => (ar ? (n === 1 ? '24 ساعة' : `${n} أيام`) : n === 1 ? '24 שעות' : `${n} ימים`),
    create: ar ? 'إنشاء رابط التوقيع' : 'צור לינק לחתימה',
    creating: ar ? 'جارٍ الإنشاء…' : 'יוצר…',
    needMark: ar ? 'حدِّد أولاً مكان التوقيع' : 'קודם סמן את מקום החתימה',
    clear: ar ? 'مسح التحديد' : 'נקה סימון',
    createFail: ar ? 'تعذّر إنشاء الرابط. حاول مجدداً.' : 'יצירת הלינק נכשלה. נסה שוב.',
    ready: ar ? 'الرابط جاهز' : 'הלינק מוכן',
    readyHint: ar ? 'أرسله إلى الموكل. بعد توقيعه سيُحفظ المستند الموقَّع في الملف تلقائياً.' : 'שלח אותו ללקוח. אחרי שיחתום, המסמך החתום יתויק בתיק אוטומטית.',
    sendOffice: ar ? 'إرسال من واتساب المكتب' : 'שלח מהוואטסאפ של המשרד',
    sending: ar ? 'جارٍ الإرسال…' : 'שולח…',
    sent: ar ? 'أُرسل إلى الموكل' : 'נשלח ללקוח',
    sendFail: ar ? 'لم تصل الرسالة (ربما مرّ أكثر من 24 ساعة على آخر رسالة من الموكل). استعمل أحد الخيارين الآخرين.' : 'ההודעה לא נשלחה (ייתכן שעברו יותר מ-24 שעות מההודעה האחרונה של הלקוח). השתמש באחת משתי האפשרויות האחרות.',
    openWa: ar ? 'فتح واتساب مع الرسالة' : 'פתח וואטסאפ עם ההודעה',
    copy: ar ? 'نسخ الرابط' : 'העתק לינק',
    copied: ar ? 'تم النسخ' : 'הועתק',
    done: ar ? 'إغلاق' : 'סגור',
    earlier: ar ? 'طلبات توقيع سابقة لهذا المستند' : 'בקשות חתימה קודמות למסמך זה',
    st: (s: SignRequest) =>
      s.status === 'filed'
        ? ar ? 'وُقِّع وحُفظ في الملف' : 'נחתם ותויק'
        : s.status === 'signed'
          ? ar ? 'وُقِّع' : 'נחתם'
          : s.status === 'cancelled'
            ? ar ? 'أُلغي' : 'בוטל'
            : s.expires_at < new Date().toISOString()
              ? ar ? 'انتهت الصلاحية' : 'פג תוקף'
              : s.opened_at
                ? ar ? 'فُتح، بانتظار التوقيع' : 'נפתח, ממתין לחתימה'
                : ar ? 'بانتظار التوقيع' : 'ממתין לחתימה',
    cancel: ar ? 'إلغاء' : 'בטל',
    msg: (name: string, office: string, link: string) =>
      ar
        ? `مرحباً ${name}، مرفق مستند لتوقيعك من ${office || 'مكتب المحاماة'}: «${title}». للقراءة والتوقيع اضغط على الرابط:\n${link}`
        : `שלום ${name}, מצורף מסמך לחתימתך מ${office || 'משרד עורכי הדין'}: "${title}". לקריאה ולחתימה לחץ על הלינק:\n${link}`,
  };

  // ---- the document -------------------------------------------------------
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const pdfRef = useRef<PdfDoc | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [pages, setPages] = useState(0);
  const [page, setPage] = useState(1);
  const [box, setBox] = useState<{ page: number; x: number; y: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const blob = doc.relativePath ? await getFilingFileBlob(doc.relativePath, lang) : null;
      if (cancelled) return;
      if (!blob) return setStatus('error');
      try {
        const pdf = await openPdf(await blob.arrayBuffer());
        if (cancelled) return;
        pdfRef.current = pdf;
        setPages(pdf.numPages);
        // A signature is nearly always on the last page.
        setPage(pdf.numPages);
        setStatus('ready');
      } catch {
        if (!cancelled) setStatus('error');
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.relativePath]);

  useEffect(() => {
    const pdf = pdfRef.current;
    const canvas = canvasRef.current;
    if (status !== 'ready' || !pdf || !canvas) return;
    void renderPdfPage(pdf, page, canvas, wrapRef.current?.clientWidth || 600).catch(() => setStatus('error'));
  }, [status, page]);

  const place = (e: MouseEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const clamp = (v: number, hi: number) => Math.max(0, Math.min(hi, v));
    setBox({
      page,
      x: clamp((e.clientX - r.left) / r.width - BOX_W / 2, 1 - BOX_W),
      y: clamp((e.clientY - r.top) / r.height - BOX_H / 2, 1 - BOX_H),
    });
  };

  // ---- the recipient ------------------------------------------------------
  const [name, setName] = useState(client ? clientDisplayName(client, lang) : '');
  const [phone, setPhone] = useState(client?.phone || '');
  const [days, setDays] = useState(7);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [link, setLink] = useState('');
  const [sendState, setSendState] = useState<'' | 'sending' | 'sent' | 'failed'>('');
  const [copied, setCopied] = useState(false);

  // Earlier requests for this document.
  const [earlier, setEarlier] = useState<SignRequest[]>([]);
  const loadEarlier = () =>
    listCaseSignRequests(caseId).then((rows) =>
      setEarlier(rows.filter((r) => String(r.doc_id || '') === String(doc.id))),
    );
  useEffect(() => {
    void loadEarlier();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseId, doc.id]);

  const create = async () => {
    if (!box || busy) return;
    setBusy(true);
    setError('');
    const made = await createSignRequest({
      docId: String(doc.id),
      caseId,
      clientId: String(client?.id || doc.clientId || ''),
      relativePath: doc.relativePath || '',
      fileName: doc.fileName || '',
      title,
      signerName: name.trim(),
      phone: normalizePhoneForLinks(phone),
      officeName: state.officeName || '',
      lang,
      days,
      box: { page: box.page, x: box.x, y: box.y, w: BOX_W, h: BOX_H },
    });
    setBusy(false);
    if (!made) return setError(L.createFail);
    setLink(signLink(made.token));
    void loadEarlier();
  };

  const message = L.msg(name.trim(), state.officeName || '', link);
  const sendFromOffice = async () => {
    const to = normalizePhoneForLinks(phone);
    if (!to || sendState === 'sending') return;
    setSendState('sending');
    try {
      const res = await fetch('/api/whatsapp/send/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...officeAuthHeader() },
        body: JSON.stringify({ to, message }),
      });
      const data = (await res.json().catch(() => null)) as { messages?: unknown } | null;
      setSendState(res.ok && data && data.messages ? 'sent' : 'failed');
    } catch {
      setSendState('failed');
    }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      window.prompt(L.copy, link);
    }
  };

  const card: CSSProperties = { background: '#fff', border: '1px solid #e6dcc6', borderRadius: 16, padding: 16, display: 'flex', flexDirection: 'column', gap: 10 };
  const label: CSSProperties = { fontSize: 13, color: muted };

  return (
    <Modal onClose={close} className="sign-req-modal">
      <div dir="rtl" style={{ display: 'flex', flexDirection: 'column', gap: 14, color: ink, fontFamily: 'Heebo, Assistant, system-ui, sans-serif', minHeight: 0 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, paddingInline: 52 }}>
          <b style={{ fontSize: 19, fontWeight: 800 }}>{L.head}</b>
          <span style={{ fontSize: 13.5, color: muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</span>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, alignItems: 'flex-start' }}>
          {/* The document */}
          <div style={{ flex: '999 1 420px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
              <b style={{ fontSize: 15 }}>{L.pick}</b>
              {pages > 1 && (
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <button type="button" style={btn} disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>{L.prev}</button>
                  <span style={{ fontSize: 13.5, color: muted, whiteSpace: 'nowrap' }}>{L.page(page, pages)}</span>
                  <button type="button" style={btn} disabled={page >= pages} onClick={() => setPage((p) => Math.min(pages, p + 1))}>{L.next}</button>
                </span>
              )}
            </div>
            <div ref={wrapRef} style={{ background: '#eef1f6', border: '1px solid #e6dcc6', borderRadius: 14, padding: 8, minHeight: 240 }}>
              {status !== 'ready' && (
                <div style={{ padding: 40, textAlign: 'center', color: muted, fontSize: 15 }}>{status === 'loading' ? L.loading : L.loadFail}</div>
              )}
              <button
                type="button"
                onClick={place}
                aria-label={L.pick}
                style={{ display: status === 'ready' ? 'block' : 'none', position: 'relative', width: '100%', padding: 0, border: 0, background: 'none', cursor: 'crosshair', lineHeight: 0 }}
              >
                <canvas ref={canvasRef} style={{ width: '100%', height: 'auto', display: 'block', borderRadius: 8, background: '#fff' }} />
                {box && box.page === page && (
                  <span
                    style={{
                      position: 'absolute',
                      left: box.x * 100 + '%',
                      top: box.y * 100 + '%',
                      width: BOX_W * 100 + '%',
                      height: BOX_H * 100 + '%',
                      boxSizing: 'border-box',
                      border: '2px dashed #a86f0c',
                      borderRadius: 8,
                      background: 'rgba(253,243,220,.9)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 'clamp(10px, 1.6vw, 14px)',
                      fontWeight: 800,
                      color: '#7a4f05',
                      lineHeight: 1.2,
                      pointerEvents: 'none',
                    }}
                  >
                    {L.here}
                  </span>
                )}
              </button>
            </div>
          </div>

          {/* The side panel */}
          <div style={{ flex: '1 1 280px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {!link ? (
              <>
                <div style={{ ...card, background: box ? '#e9f6ee' : '#fdf3dc', borderColor: box ? '#9fd3b3' : '#e8c877' }}>
                  <b style={{ fontSize: 15.5, color: box ? '#17633a' : '#6b4504' }}>{box ? L.marked + (pages > 1 ? ' · ' + L.page(box.page, pages) : '') : L.step1}</b>
                  <span style={{ fontSize: 13.5, lineHeight: 1.6, color: box ? '#2c5a40' : '#4a3204' }}>{box ? L.markedHint : L.step1Hint}</span>
                </div>
                <div style={card}>
                  <b style={{ fontSize: 15.5 }}>{L.step2}</b>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    <span style={label}>{L.name}</span>
                    <input style={field} value={name} onChange={(e) => setName(e.target.value)} />
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    <span style={label}>{L.phone}</span>
                    <input style={{ ...field, textAlign: 'right' }} dir="ltr" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    <span style={label}>{L.days}</span>
                    <select style={field} value={days} onChange={(e) => setDays(Number(e.target.value))}>
                      {[7, 3, 1, 14].map((n) => (
                        <option key={n} value={n}>{L.daysOpt(n)}</option>
                      ))}
                    </select>
                  </label>
                </div>
                {error && <div role="alert" style={{ color: '#b3261e', fontSize: 14, fontWeight: 700 }}>{error}</div>}
                <button type="button" style={{ ...primaryBtn, ...(box && !busy ? {} : { background: '#eef1f6', color: '#4b5565', border: '1px solid #c9cfda', cursor: 'default' }) }} disabled={!box || busy} onClick={create}>
                  {busy ? L.creating : box ? L.create : L.needMark}
                </button>
                {box && <button type="button" style={btn} onClick={() => setBox(null)}>{L.clear}</button>}
              </>
            ) : (
              <>
                <div style={{ ...card, background: '#e9f6ee', borderColor: '#9fd3b3' }}>
                  <b style={{ fontSize: 16, color: '#17633a' }}>{L.ready}</b>
                  <span style={{ fontSize: 13.5, lineHeight: 1.6, color: '#2c5a40' }}>{L.readyHint}</span>
                  <bdi dir="ltr" style={{ fontSize: 12.5, wordBreak: 'break-all', background: '#fff', borderRadius: 10, padding: '8px 10px', color: ink }}>{link}</bdi>
                </div>
                {waEnabled && (
                  <button type="button" style={primaryBtn} disabled={sendState === 'sending' || sendState === 'sent'} onClick={sendFromOffice}>
                    {sendState === 'sending' ? L.sending : sendState === 'sent' ? L.sent : L.sendOffice}
                  </button>
                )}
                {sendState === 'failed' && <div role="alert" style={{ color: '#b3261e', fontSize: 13.5, lineHeight: 1.5 }}>{L.sendFail}</div>}
                <a href={whatsappAppUrl(phone, message)} style={{ ...btn, display: 'flex', alignItems: 'center', justifyContent: 'center', textDecoration: 'none' }}>{L.openWa}</a>
                <button type="button" style={btn} onClick={copy}>{copied ? L.copied : L.copy}</button>
                <button type="button" style={btn} onClick={close}>{L.done}</button>
              </>
            )}

            {earlier.length > 0 && (
              <div style={card}>
                <b style={{ fontSize: 14.5 }}>{L.earlier}</b>
                {earlier.map((r) => (
                  <div key={r.token} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, fontSize: 13.5 }}>
                    <span style={{ minWidth: 0 }}>
                      <b>{L.st(r)}</b>
                      <span style={{ color: muted }}> · {r.created_at.slice(0, 10).split('-').reverse().join('.')}</span>
                    </span>
                    {r.status === 'pending' && (
                      <button
                        type="button"
                        style={{ ...btn, minHeight: 36, fontSize: 13.5, padding: '0 12px' }}
                        onClick={async () => {
                          await cancelSignRequest(r.token);
                          void loadEarlier();
                        }}
                      >
                        {L.cancel}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}
