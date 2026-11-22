'use client';

// Files the documents clients have signed.
//
// When a client signs through the link (lib/signRequests.ts), the Worker holds
// only the signature image. This component — running quietly while the office's
// app is open — takes each signed request, stamps the signature onto the
// original PDF at the place the lawyer marked, saves the result as a NEW
// document of the case (the original stays as it was) and tells the lawyer.
//
// The stamping is done here, in the office's browser: the Worker's CPU
// allowance is far too small to rewrite a PDF, and doing it in the CLIENT's
// browser would mean trusting the client with the document's content.

import { useEffect, useRef, useState } from 'react';
import { useAppState } from '@/hooks/useAppState';
import { useT } from '@/hooks/useT';
import { uploadDocumentViaWorker } from '@/lib/cloudflare';
import { nextDocumentNumber } from '@/lib/documents';
import { getFilingFileBlob } from '@/lib/disk';
import { hasOfficeToken } from '@/lib/officeToken';
import {
  claimSignRequest,
  listSignedUnfiled,
  markSignRequestFiled,
  type SignRequest,
} from '@/lib/signRequests';
import type { DocumentRecord } from '@/types';

const CHECK_EVERY_MS = 120_000;

/** The original PDF with the signature drawn inside the marked box. */
async function stampSignature(original: ArrayBuffer, r: SignRequest): Promise<Uint8Array> {
  const { PDFDocument, degrees } = await import('pdf-lib');
  const pdf = await PDFDocument.load(original, { ignoreEncryption: true });
  const pages = pdf.getPages();
  const page = pages[Math.min(Math.max(1, r.page), pages.length) - 1];
  const png = await pdf.embedPng(r.signature || '');
  // The box was marked on the page as the viewer shows it (its crop box, after
  // the page's own rotation), as fractions from the top-left corner.
  const crop = page.getCropBox();
  const turn = ((page.getRotation().angle % 360) + 360) % 360;
  const sideways = turn === 90 || turn === 270;
  const viewW = sideways ? crop.height : crop.width;
  const viewH = sideways ? crop.width : crop.height;
  const boxW = r.w * viewW;
  const boxH = r.h * viewH;
  const scale = Math.min(boxW / png.width, boxH / png.height);
  const w = png.width * scale;
  const h = png.height * scale;
  // Top-left of the signature, in viewer coordinates.
  const vx = r.x * viewW + (boxW - w) / 2;
  const vy = r.y * viewH + (boxH - h) / 2;
  // Viewer coordinates → the page's own (unrotated, bottom-left origin) space.
  let x: number, y: number;
  if (turn === 90) {
    x = crop.x + vy + h;
    y = crop.y + vx;
  } else if (turn === 180) {
    x = crop.x + crop.width - vx;
    y = crop.y + vy + h;
  } else if (turn === 270) {
    x = crop.x + crop.width - vy - h;
    y = crop.y + crop.height - vx;
  } else {
    x = crop.x + vx;
    y = crop.y + crop.height - vy - h;
  }
  page.drawImage(png, { x, y, width: w, height: h, rotate: degrees(turn) });
  return pdf.save();
}

export function SignedDocsFiler() {
  const { state, dispatch } = useAppState();
  const { lang } = useT();
  const stateRef = useRef(state);
  stateRef.current = state;
  const langRef = useRef(lang);
  langRef.current = lang;
  const [notes, setNotes] = useState<Array<{ id: string; text: string }>>([]);

  useEffect(() => {
    if (!state.hydrated) return;
    let alive = true;
    let running = false;

    const fileOne = async (r: SignRequest): Promise<void> => {
      const s = stateRef.current;
      const l = langRef.current;
      const caseObj = s.casesArr.find((c) => String(c.id).toLowerCase() === String(r.case_id || '').toLowerCase()) ?? null;
      if (!caseObj || !r.signature) return;
      const client = s.clients.find((c) => c.id === caseObj.clientId) ?? null;
      const blob = await getFilingFileBlob(r.relative_path, l);
      if (!blob) return;
      const signed = await stampSignature(await blob.arrayBuffer(), r);
      const baseTitle = (r.title || r.file_name || 'מסמך').replace(/\.pdf$/i, '');
      const safe = baseTitle.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
      const file = new File([signed as BlobPart], safe + ' - חתום.pdf', { type: 'application/pdf' });
      const docId = nextDocumentNumber(stateRef.current.documentsArr);
      const up = await uploadDocumentViaWorker(file, { client, caseObj, lang: l, docId });
      if (!up.ok) return;
      const when = new Date(r.signed_at || Date.now());
      const stamp = new Intl.DateTimeFormat('he-IL', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Jerusalem' }).format(when);
      const doc: DocumentRecord = {
        id: docId,
        caseId: String(caseObj.id),
        clientId: caseObj.clientId,
        title: baseTitle + ' - חתום',
        titleAr: baseTitle + ' - موقَّع',
        description: `נחתם על ידי ${r.signer_name || 'הלקוח'} בלינק חתימה, ${stamp}`,
        descriptionAr: `وقّعه ${r.signer_name || 'الموكل'} عبر رابط التوقيع، ${stamp}`,
        fileName: file.name,
        relativePath: up.relativePath,
        date: new Date().toISOString().slice(0, 10),
        uploadedAt: new Date().toISOString(),
        type: 'application/pdf',
        size: file.size,
      };
      dispatch({ type: 'SET_DOCUMENTS', documents: [...stateRef.current.documentsArr, doc] });
      await markSignRequestFiled(r.token, docId);
      const who = r.signer_name || (l === 'ar' ? 'الموكل' : 'הלקוח');
      setNotes((n) => [
        ...n,
        {
          id: r.token,
          text:
            l === 'ar'
              ? `${who} وقّع «${baseTitle}». حُفظ المستند الموقَّع في الملف.`
              : `${who} חתם על "${baseTitle}". המסמך החתום תויק בתיק.`,
        },
      ]);
    };

    const run = async () => {
      if (running || !alive || !hasOfficeToken() || document.visibilityState !== 'visible') return;
      running = true;
      try {
        for (const r of await listSignedUnfiled()) {
          if (!alive) break;
          // Right after the app opens, the cases may not have arrived from the
          // server yet. Taking the job now would only block it for five
          // minutes — leave it and look again shortly.
          const known = stateRef.current.casesArr.some(
            (c) => String(c.id).toLowerCase() === String(r.case_id || '').toLowerCase(),
          );
          if (!known) {
            window.setTimeout(run, 15_000);
            continue;
          }
          // One device files each document (see the Worker's claim).
          if (!(await claimSignRequest(r.token))) continue;
          try {
            await fileOne(r);
          } catch (e) {
            console.warn('[sign] filing a signed document failed', e);
          }
        }
      } finally {
        running = false;
      }
    };

    void run();
    const id = window.setInterval(run, CHECK_EVERY_MS);
    const onVisible = () => void run();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.hydrated]);

  if (notes.length === 0) return null;
  return (
    <div
      dir="rtl"
      style={{ position: 'fixed', insetInlineStart: 16, bottom: 96, zIndex: 9000, display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 'min(420px, calc(100vw - 32px))' }}
    >
      {notes.map((n) => (
        <div
          key={n.id}
          role="status"
          style={{ display: 'flex', alignItems: 'flex-start', gap: 10, background: '#e9f6ee', border: '1px solid #9fd3b3', borderRadius: 14, padding: '12px 14px', boxShadow: '0 10px 30px rgba(15,36,68,.18)', fontFamily: 'Heebo, Assistant, system-ui, sans-serif' }}
        >
          <span style={{ flex: 1, fontSize: 14.5, fontWeight: 700, lineHeight: 1.5, color: '#17633a' }}>{n.text}</span>
          <button
            type="button"
            aria-label={lang === 'ar' ? 'إغلاق' : 'סגור'}
            onClick={() => setNotes((all) => all.filter((x) => x.id !== n.id))}
            style={{ flex: 'none', width: 32, height: 32, borderRadius: 10, border: '1px solid #9fd3b3', background: '#fff', color: '#17633a', fontSize: 16, fontWeight: 800, cursor: 'pointer' }}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
