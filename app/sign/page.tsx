'use client';

// The page a CLIENT opens from the signing link the office sent. No login: the
// token in the link is the authorization (worker/src/sign.ts). The client reads
// the document, draws a signature with a finger and confirms. Standalone — it
// shares nothing with the office app's screens, so it uses inline styles only.

import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { openPdf, renderPdfPage, type PdfDoc } from '@/lib/pdfPages';
import { fetchSignFile, fetchSignMeta, submitSignature, type SignMeta } from '@/lib/signRequests';

const navy = '#0f2444';
const ink = '#16223b';
const muted = '#5b6475';

const TXT = {
  he: {
    office: 'משרד עורכי דין',
    forYou: 'מסמך לחתימתך',
    loading: 'טוען…',
    notFound: 'הלינק אינו תקין. בקש מהמשרד לינק חדש.',
    expired: 'תוקף הלינק פג. בקש מהמשרד לינק חדש.',
    cancelled: 'המשרד ביטל את בקשת החתימה.',
    signed: 'המסמך נחתם. תודה!',
    signedSub: 'החתימה התקבלה במשרד. אפשר לסגור את הדף.',
    fileFail: 'טעינת המסמך נכשלה. נסה לרענן את הדף.',
    page: (a: number, b: number) => `עמוד ${a} מתוך ${b}`,
    prev: 'הקודם',
    next: 'הבא',
    signPage: 'לעמוד החתימה',
    here: 'כאן תופיע חתימתך',
    signHere: 'חתום כאן באצבע',
    clear: 'נקה',
    consent: 'קראתי את המסמך ואני מאשר שהחתימה היא שלי',
    submit: 'אישור ושליחת החתימה',
    sending: 'שולח…',
    needSign: 'חתום במסגרת וסמן את האישור כדי להמשיך',
    sendFail: 'שליחת החתימה נכשלה. בדוק את החיבור ונסה שוב.',
  },
  ar: {
    office: 'مكتب المحاماة',
    forYou: 'مستند لتوقيعك',
    loading: 'جارٍ التحميل…',
    notFound: 'الرابط غير صالح. اطلب من المكتب رابطاً جديداً.',
    expired: 'انتهت صلاحية الرابط. اطلب من المكتب رابطاً جديداً.',
    cancelled: 'ألغى المكتب طلب التوقيع.',
    signed: 'تم توقيع المستند. شكراً!',
    signedSub: 'وصل التوقيع إلى المكتب. يمكنك إغلاق الصفحة.',
    fileFail: 'تعذّر تحميل المستند. حاول تحديث الصفحة.',
    page: (a: number, b: number) => `صفحة ${a} من ${b}`,
    prev: 'السابق',
    next: 'التالي',
    signPage: 'إلى صفحة التوقيع',
    here: 'هنا سيظهر توقيعك',
    signHere: 'وقّع هنا بإصبعك',
    clear: 'مسح',
    consent: 'قرأت المستند وأؤكد أن التوقيع توقيعي',
    submit: 'تأكيد وإرسال التوقيع',
    sending: 'جارٍ الإرسال…',
    needSign: 'وقّع داخل الإطار وضع علامة التأكيد للمتابعة',
    sendFail: 'تعذّر إرسال التوقيع. تحقق من الاتصال وحاول مجدداً.',
  },
};

const btn: CSSProperties = {
  minHeight: 44,
  padding: '0 14px',
  borderRadius: 12,
  border: '1px solid #d9e2ef',
  background: '#fff',
  color: ink,
  fontFamily: 'inherit',
  fontSize: 14.5,
  fontWeight: 700,
};

export default function SignPage() {
  const [token, setToken] = useState('');
  const [meta, setMeta] = useState<SignMeta | null>(null);
  const [view, setView] = useState<'loading' | 'notfound' | 'expired' | 'cancelled' | 'signed' | 'sign' | 'filefail'>('loading');
  const pdfRef = useRef<PdfDoc | null>(null);
  const pageCanvas = useRef<HTMLCanvasElement>(null);
  const pageWrap = useRef<HTMLDivElement>(null);
  const [pages, setPages] = useState(0);
  const [page, setPage] = useState(1);

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('t') || '';
    setToken(t);
    (async () => {
      const m = t ? await fetchSignMeta(t) : null;
      if (!m) return setView('notfound');
      setMeta(m);
      if (m.state !== 'pending') return setView(m.state);
      const bytes = await fetchSignFile(t);
      if (!bytes) return setView('filefail');
      try {
        const pdf = await openPdf(bytes);
        pdfRef.current = pdf;
        setPages(pdf.numPages);
        setPage(1);
        setView('sign');
      } catch {
        setView('filefail');
      }
    })();
  }, []);

  useEffect(() => {
    const pdf = pdfRef.current;
    const canvas = pageCanvas.current;
    if (view !== 'sign' || !pdf || !canvas) return;
    void renderPdfPage(pdf, page, canvas, pageWrap.current?.clientWidth || 340).catch(() => setView('filefail'));
  }, [view, page]);

  // ---- the signature pad --------------------------------------------------
  const pad = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [hasInk, setHasInk] = useState(false);
  const [consent, setConsent] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  // The pad's backing store follows its on-screen size (sharp strokes).
  useEffect(() => {
    const c = pad.current;
    if (view !== 'sign' || !c) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    c.width = Math.round(c.clientWidth * ratio);
    c.height = Math.round(c.clientHeight * ratio);
    const ctx = c.getContext('2d');
    if (ctx) {
      ctx.lineWidth = 2.4 * ratio;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = navy;
    }
  }, [view]);

  const at = (e: PointerEvent<HTMLCanvasElement>) => {
    const c = e.currentTarget;
    const r = c.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * c.width, y: ((e.clientY - r.top) / r.height) * c.height };
  };
  const down = (e: PointerEvent<HTMLCanvasElement>) => {
    const ctx = e.currentTarget.getContext('2d');
    if (!ctx) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    const p = at(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
  };
  const move = (e: PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const ctx = e.currentTarget.getContext('2d');
    if (!ctx) return;
    const p = at(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    setHasInk(true);
  };
  const up = () => {
    drawing.current = false;
  };
  const clear = () => {
    const c = pad.current;
    c?.getContext('2d')?.clearRect(0, 0, c.width, c.height);
    setHasInk(false);
  };

  const lang = meta?.lang === 'ar' ? 'ar' : 'he';
  const T = TXT[lang];

  const submit = async () => {
    const c = pad.current;
    if (!c || !hasInk || !consent || sending) return;
    setSending(true);
    setError('');
    // Crop to the strokes, so the signature fills its place on the document
    // however small the client drew it.
    const ctx = c.getContext('2d');
    let data = c.toDataURL('image/png');
    if (ctx) {
      const px = ctx.getImageData(0, 0, c.width, c.height).data;
      let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
      for (let y = 0; y < c.height; y++) {
        for (let x = 0; x < c.width; x++) {
          if (px[(y * c.width + x) * 4 + 3] > 8) {
            if (x < x0) x0 = x;
            if (x > x1) x1 = x;
            if (y < y0) y0 = y;
            if (y > y1) y1 = y;
          }
        }
      }
      if (x1 >= x0 && y1 >= y0) {
        const m = 6;
        const w = Math.min(c.width, x1 + m) - Math.max(0, x0 - m);
        const h = Math.min(c.height, y1 + m) - Math.max(0, y0 - m);
        const out = document.createElement('canvas');
        out.width = w;
        out.height = h;
        out.getContext('2d')?.drawImage(c, Math.max(0, x0 - m), Math.max(0, y0 - m), w, h, 0, 0, w, h);
        data = out.toDataURL('image/png');
      }
    }
    const res = await submitSignature(token, data);
    setSending(false);
    if (res === 'ok') return setView('signed');
    if (res === 'gone') {
      const m = await fetchSignMeta(token);
      return setView(m && m.state !== 'pending' ? m.state : 'expired');
    }
    setError(T.sendFail);
  };

  const shell: CSSProperties = {
    direction: 'rtl',
    position: 'fixed',
    inset: 0,
    overflowY: 'auto',
    WebkitOverflowScrolling: 'touch',
    background: '#FDFBF5',
    color: ink,
    fontFamily: 'Heebo, Assistant, system-ui, sans-serif',
  };
  const head = (
    <header style={{ background: navy, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 3 }}>
      <b style={{ fontSize: 18, fontWeight: 800, color: '#fff' }}>{meta?.office_name || T.office}</b>
      <span style={{ fontSize: 13, color: '#cdd6e4' }}>
        {T.forYou}
        {meta?.signer_name ? ' · ' + meta.signer_name : ''}
      </span>
    </header>
  );

  if (view !== 'sign') {
    const msg =
      view === 'loading' ? T.loading : view === 'signed' ? T.signed : view === 'expired' ? T.expired : view === 'cancelled' ? T.cancelled : view === 'filefail' ? T.fileFail : T.notFound;
    return (
      <div style={shell} lang={lang}>
        {head}
        <main style={{ padding: '48px 22px', textAlign: 'center', maxWidth: 520, margin: '0 auto' }}>
          <p role={view === 'loading' ? 'status' : 'alert'} style={{ fontSize: 19, fontWeight: 800, margin: 0, color: view === 'signed' ? '#17633a' : ink }}>{msg}</p>
          {view === 'signed' && <p style={{ fontSize: 15, color: muted, marginTop: 10 }}>{T.signedSub}</p>}
        </main>
      </div>
    );
  }

  const m = meta!;
  const ready = hasInk && consent && !sending;
  return (
    <div style={shell} lang={lang}>
      {head}
      <main style={{ maxWidth: 720, margin: '0 auto', padding: '14px 14px 28px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
          <b style={{ fontSize: 16, fontWeight: 800, minWidth: 0 }}>{m.title}</b>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button type="button" style={btn} disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>{T.prev}</button>
            <span style={{ fontSize: 13.5, color: muted, whiteSpace: 'nowrap' }}>{T.page(page, pages)}</span>
            <button type="button" style={btn} disabled={page >= pages} onClick={() => setPage((p) => Math.min(pages, p + 1))}>{T.next}</button>
          </span>
        </div>
        <div ref={pageWrap} style={{ position: 'relative', background: '#fff', border: '1px solid #e6dcc6', borderRadius: 14, overflow: 'hidden', lineHeight: 0 }}>
          <canvas ref={pageCanvas} style={{ width: '100%', height: 'auto', display: 'block' }} />
          {page === m.page && (
            <span
              style={{
                position: 'absolute',
                left: m.x * 100 + '%',
                top: m.y * 100 + '%',
                width: m.w * 100 + '%',
                height: m.h * 100 + '%',
                boxSizing: 'border-box',
                border: '2px dashed #a86f0c',
                borderRadius: 6,
                background: 'rgba(253,243,220,.85)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 'clamp(9px, 2.6vw, 13px)',
                fontWeight: 800,
                color: '#7a4f05',
                lineHeight: 1.2,
                textAlign: 'center',
              }}
            >
              {T.here}
            </span>
          )}
        </div>
        {page !== m.page && (
          <button type="button" style={btn} onClick={() => setPage(m.page)}>{T.signPage}</button>
        )}

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <b style={{ fontSize: 16, fontWeight: 800 }}>{T.signHere}</b>
          <button type="button" style={btn} onClick={clear}>{T.clear}</button>
        </div>
        <canvas
          ref={pad}
          role="img"
          aria-label={T.signHere}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          style={{ width: '100%', height: 180, background: '#fff', border: '2px dashed #a86f0c', borderRadius: 16, touchAction: 'none', display: 'block' }}
        />
        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 15, lineHeight: 1.5 }}>
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} style={{ width: 24, height: 24, flex: 'none', margin: 0, accentColor: navy }} />
          <span>{T.consent}</span>
        </label>
        {error && <div role="alert" style={{ color: '#b3261e', fontSize: 14.5, fontWeight: 700 }}>{error}</div>}
        <button
          type="button"
          onClick={submit}
          disabled={!ready}
          style={{
            minHeight: 56,
            borderRadius: 16,
            border: ready ? 0 : '1px solid #c9cfda',
            background: ready ? navy : '#eef1f6',
            color: ready ? '#fff' : '#4b5565',
            fontFamily: 'inherit',
            fontSize: 17.5,
            fontWeight: 800,
          }}
        >
          {sending ? T.sending : ready ? T.submit : T.needSign}
        </button>
      </main>
    </div>
  );
}
