'use client';

import { useEffect, useRef, useState } from 'react';
import { useModalStack } from '@/hooks/useModalStack';
import { useT } from '@/hooks/useT';
import { Modal } from './Modal';
import { getFilingFileBlob, openDocumentFromLegalOfficeFolder } from '@/lib/disk';
import { dropboxRawUrl, isDropboxConfigured } from '@/lib/dropbox';
import { isOfficeDevice } from '@/lib/device';
import { DropboxConnectModal } from './DropboxConnectModal';
import type { DocumentRecord } from '@/types';

type Status =
  | 'loading'
  | 'pdf'
  | 'image'
  | 'unsupported'
  | 'error'
  | 'need-dropbox';

const IMAGE_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
};

// Keep in sync with `.document-preview-pdf-page` max-width in globals.css — the
// page bitmap is rendered at this LOGICAL width and the CSS caps the display at
// the same value, so the two never disagree (no aspect-ratio clamp).
const CSS_MAX_PAGE_WIDTH = 900;
// Canvas guards, safe across Chrome / Firefox / iOS Safari. Exceeding them makes
// the browser silently produce a blank/black canvas.
const MAX_CANVAS_DIM = 8192;
const MAX_CANVAS_AREA = 16_000_000;

export function DocumentPreviewModal({ doc }: { doc: DocumentRecord }) {
  const modalStack = useModalStack();
  const { lang } = useT();
  const close = () => modalStack.close(modalStack.topId() ?? 0);

  const [status, setStatus] = useState<Status>('loading');
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [blobReady, setBlobReady] = useState(false);
  const pdfContainerRef = useRef<HTMLDivElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  // The loaded file bytes, retained so "download" saves them directly (no
  // re-fetch — works even after the network drops).
  const blobRef = useRef<Blob | null>(null);

  const fileName =
    doc.fileName ||
    (doc.relativePath || '').split('/').pop()?.split('?')[0] ||
    doc.title ||
    'document';
  const ext = fileName.slice(fileName.lastIndexOf('.') + 1).toLowerCase();
  const isPdf = ext === 'pdf';
  const isImage = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'].includes(ext);

  // Force the extension-derived MIME whenever it disagrees (the Dropbox content
  // API hands back `application/octet-stream`, which breaks <img> for SVG and
  // hides HTML error bodies). Only re-typing an EMPTY mime is not enough.
  const normalizeBlobMime = (blob: Blob): Blob => {
    const desired = isPdf ? 'application/pdf' : isImage ? IMAGE_MIME[ext] : '';
    if (desired && blob.type !== desired) return new Blob([blob], { type: desired });
    return blob;
  };

  // Reject non-file bodies (a Dropbox HTML preview / login / error page returned
  // with HTTP 200) so we never feed an HTML page to pdf.js or <img> as the doc.
  const validateBytes = async (blob: Blob): Promise<boolean> => {
    try {
      const head = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
      let ascii = '';
      for (let i = 0; i < head.length; i++) ascii += String.fromCharCode(head[i]);
      if (isPdf) return ascii.startsWith('%PDF');
      const low = ascii.toLowerCase().trimStart();
      // SVG is XML/HTML-ish, so only reject HTML for the non-SVG types.
      if (ext !== 'svg' && (low.startsWith('<!doctype') || low.startsWith('<html'))) {
        return false;
      }
      return true;
    } catch {
      return true; // can't inspect → don't block
    }
  };

  const openExternal = () => {
    const rp = doc.relativePath || '';
    if (!rp) return;
    // A Dropbox share URL opens directly in a new tab; a filing/Dropbox path
    // goes through the cloud-first opener (which resolves a temporary link).
    if (rp.startsWith('http://') || rp.startsWith('https://')) {
      window.open(rp, '_blank', 'noopener,noreferrer');
      return;
    }
    void openDocumentFromLegalOfficeFolder(rp, lang === 'ar' ? 'ar' : 'he');
  };

  const onDownload = () => {
    const b = blobRef.current;
    if (!b) return;
    const url = URL.createObjectURL(b);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  useEffect(() => {
    let cancelled = false;
    const rp = doc.relativePath || '';

    const loadBlob = async (): Promise<Blob | null> => {
      if (!rp) return null;
      if (rp.startsWith('http://') || rp.startsWith('https://')) {
        try {
          const res = await fetch(dropboxRawUrl(rp));
          const ct = (res.headers.get('content-type') || '').toLowerCase();
          // Don't trust res.ok alone — a share link can 200 with an HTML page.
          if (res.ok && !((isPdf || isImage) && ct.includes('text/html'))) {
            return await res.blob();
          }
        } catch {
          /* CORS/network — fall through to the authenticated content API */
        }
        try {
          return await getFilingFileBlob(rp, lang === 'ar' ? 'ar' : 'he');
        } catch {
          return null;
        }
      }
      return getFilingFileBlob(rp, lang === 'ar' ? 'ar' : 'he');
    };

    (async () => {
      const raw = await loadBlob();
      if (cancelled) return;
      if (!raw) {
        // The cloud fetch (content API) needs a Dropbox OAuth connection on THIS
        // device. A remote phone/laptop that never connected Dropbox — or an
        // office computer flipped to remote that only ever used a local synced
        // folder — has no token, so the download can't run. Surface that
        // explicitly (with a connect button) instead of a generic failure.
        if (rp && !isDropboxConfigured()) setStatus('need-dropbox');
        else setStatus('error');
        return;
      }
      const blob = normalizeBlobMime(raw);
      if (!(await validateBytes(blob))) {
        if (!cancelled) setStatus('error');
        return;
      }
      if (cancelled) return;
      blobRef.current = blob;
      setBlobReady(true);

      if (isImage) {
        const u = URL.createObjectURL(blob);
        objectUrlRef.current = u;
        setImageUrl(u);
        setStatus('image');
        return;
      }

      if (!isPdf) {
        setStatus('unsupported');
        return;
      }

      try {
        const importRuntime = new Function('u', 'return import(u)') as (
          u: string,
        ) => Promise<typeof import('pdfjs-dist')>;
        const pdfjs = await importRuntime('/pdf.min.mjs');
        pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
        const data = await blob.arrayBuffer();
        if (cancelled) return;
        const pdf = await pdfjs.getDocument({ data }).promise;
        if (cancelled) return;
        const container = pdfContainerRef.current;
        if (!container) {
          setStatus('error');
          return;
        }
        container.innerHTML = '';
        // Flip to 'pdf' now so the loading message stops sharing the flex row —
        // the page container then measures/anchors at full width while we render.
        setStatus('pdf');

        // Supersample for crisp text: floor at 1.5× (keeps sharpness on
        // 100%-scaled desktops) and cap at 2× so long PDFs don't allocate huge
        // canvas backing stores (which makes the browser blank later pages).
        const outputScale = Math.min(
          Math.max(window.devicePixelRatio || 1, 1.5),
          2,
        );

        for (let i = 1; i <= pdf.numPages; i++) {
          if (cancelled) return;
          const page = await pdf.getPage(i);
          const base = page.getViewport({ scale: 1 });
          // Render at a FIXED logical width (== the CSS cap); the CSS
          // (width:100%; max-width; height:auto) then displays it undistorted.
          let scale = (CSS_MAX_PAGE_WIDTH / base.width) * outputScale;
          const vw = base.width * scale;
          const vh = base.height * scale;
          // Clamp so the canvas can never exceed the browser's size/area limits.
          const cap = Math.min(
            MAX_CANVAS_DIM / Math.max(vw, vh),
            Math.sqrt(MAX_CANVAS_AREA / (vw * vh)),
          );
          if (cap < 1) scale *= cap;
          const viewport = page.getViewport({ scale });
          const canvas = document.createElement('canvas');
          canvas.className = 'document-preview-pdf-page';
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          // Drive the DISPLAY size with SELF-CONTAINED inline styles (width:100%,
          // capped at the CSS max, height:auto) so the aspect ratio is exact
          // regardless of the external stylesheet's state — inline `height:auto`
          // + the intrinsic bitmap ratio can never be stretched by a stale/
          // overriding CSS rule. This is what keeps the page from being distorted.
          canvas.style.display = 'block';
          canvas.style.width = '100%';
          canvas.style.maxWidth = CSS_MAX_PAGE_WIDTH + 'px';
          canvas.style.height = 'auto';
          canvas.style.margin = '0 auto';
          canvas.style.backgroundColor = '#fff';
          const ctx = canvas.getContext('2d', { alpha: false });
          if (!ctx) continue;
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          // Pre-fill white so a failed/aborted page is blank, not solid black.
          ctx.fillStyle = '#fff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          container.appendChild(canvas);
          try {
            await page.render({ canvasContext: ctx, viewport }).promise;
          } catch (err) {
            console.warn('[DocumentPreviewModal] page render failed', i, err);
            canvas.remove();
          }
        }
      } catch (e) {
        console.warn('[DocumentPreviewModal] pdf render failed', e);
        if (!cancelled) setStatus('error');
      }
    })();

    return () => {
      cancelled = true;
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.id]);

  const T = {
    loading: lang === 'ar' ? 'جارٍ تحميل المعاينة…' : 'טוען תצוגה מקדימה…',
    error:
      lang === 'ar'
        ? 'تعذّر تحميل المستند للمعاينة.'
        : 'טעינת המסמך לתצוגה מקדימה נכשלה.',
    unsupported:
      lang === 'ar'
        ? 'لا يمكن معاينة هذا النوع من الملفات داخل التطبيق.'
        : 'לא ניתן להציג תצוגה מקדימה לסוג קובץ זה בתוך האפליקציה.',
    openExternal: lang === 'ar' ? 'فتح المستند' : 'פתח את המסמך',
    download: lang === 'ar' ? 'تنزيل' : 'הורדה',
    needDropbox: isOfficeDevice()
      ? lang === 'ar'
        ? 'لعرض/تنزيل المستندات من السحابة يجب ربط Dropbox على هذا الجهاز.'
        : 'כדי להציג/להוריד מסמכים מהענן יש לחבר את Dropbox במכשיר זה.'
      : lang === 'ar'
        ? 'هذا جهاز محمول/بعيد: لعرض المستند يجب تنزيله من Dropbox السحابي — لكنّ Dropbox غير مربوط على هذا الجهاز. اربطه ثم أعد المحاولة.'
        : 'זהו מכשיר נייד/מרוחק: כדי להציג את המסמך יש להורידו מ-Dropbox קלאוד — אך Dropbox אינו מחובר במכשיר זה. חבר אותו ונסה שוב.',
    connectDropbox: lang === 'ar' ? 'ربط Dropbox' : 'חיבור Dropbox',
  };

  const connectDropbox = () => {
    close();
    modalStack.open(<DropboxConnectModal />);
  };

  return (
    <Modal
      onClose={close}
      className="document-preview-modal"
      boxClassName="document-preview-box"
    >
      <h3 className="document-preview-title" dir="auto">
        {fileName}
      </h3>
      <div className="document-preview-toolbar">
        <button
          type="button"
          className="btn btn-primary document-preview-download-btn"
          onClick={onDownload}
          disabled={!blobReady}
        >
          <i className="fas fa-download" aria-hidden="true" /> {T.download}
        </button>
        {doc.relativePath && (
          <button type="button" className="btn" onClick={openExternal}>
            <i className="fas fa-arrow-up-right-from-square" aria-hidden="true" />{' '}
            {T.openExternal}
          </button>
        )}
      </div>
      <div className="document-preview-body">
        {status === 'loading' && (
          <div className="document-preview-msg">{T.loading}</div>
        )}
        {status === 'error' && (
          <div className="document-preview-msg">
            <p>{T.error}</p>
            {doc.relativePath && (
              <button type="button" className="btn btn-primary" onClick={openExternal}>
                {T.openExternal}
              </button>
            )}
          </div>
        )}
        {status === 'unsupported' && (
          <div className="document-preview-msg">
            <p>{T.unsupported}</p>
            <button type="button" className="btn btn-primary" onClick={openExternal}>
              {T.openExternal}
            </button>
          </div>
        )}
        {status === 'need-dropbox' && (
          <div className="document-preview-msg">
            <p>{T.needDropbox}</p>
            <button type="button" className="btn btn-primary" onClick={connectDropbox}>
              <i className="fab fa-dropbox" aria-hidden="true" style={{ marginInlineEnd: 6 }} />
              {T.connectDropbox}
            </button>
          </div>
        )}
        {status === 'image' && imageUrl && (
          <img className="document-preview-img" src={imageUrl} alt={fileName} />
        )}
        {isPdf &&
          status !== 'error' &&
          status !== 'unsupported' &&
          status !== 'need-dropbox' && (
            <div ref={pdfContainerRef} className="document-preview-pdf" />
          )}
      </div>
    </Modal>
  );
}
