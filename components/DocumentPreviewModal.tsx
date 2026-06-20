'use client';

import { useEffect, useRef, useState } from 'react';
import { useModalStack } from '@/hooks/useModalStack';
import { useT } from '@/hooks/useT';
import { Modal } from './Modal';
import { getFilingFileBlob, openDocumentFromLegalOfficeFolder } from '@/lib/disk';
import { dropboxRawUrl } from '@/lib/dropbox';
import type { DocumentRecord } from '@/types';

/**
 * In-app document PREVIEW (no download). Renders the file ON SCREEN:
 *   - PDF    → rendered page-by-page to <canvas> with PDF.js. This works on
 *              MOBILE too, where browsers can't show a PDF inline in an
 *              <iframe>. Fully client-side — the file never leaves the browser
 *              (the pdf.js worker is self-hosted at /pdf.worker.min.mjs).
 *   - images → <img>
 *   - other  → message + a button that opens it externally (Office viewer etc.)
 *
 * The bytes come from the local synced copy first, then Dropbox
 * (see getFilingFileBlob); mobile share-URL docs are fetched from the raw link.
 */
type Status = 'loading' | 'pdf' | 'image' | 'unsupported' | 'error';

export function DocumentPreviewModal({ doc }: { doc: DocumentRecord }) {
  const modalStack = useModalStack();
  const { lang } = useT();
  const close = () => modalStack.close(modalStack.topId() ?? 0);

  const [status, setStatus] = useState<Status>('loading');
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const pdfContainerRef = useRef<HTMLDivElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);

  const fileName =
    doc.fileName ||
    (doc.relativePath || '').split('/').pop()?.split('?')[0] ||
    doc.title ||
    'document';
  const ext = fileName.slice(fileName.lastIndexOf('.') + 1).toLowerCase();
  const isPdf = ext === 'pdf';
  const isImage = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'].includes(ext);

  useEffect(() => {
    let cancelled = false;
    const rp = doc.relativePath || '';

    const loadBlob = async (): Promise<Blob | null> => {
      if (!rp) return null;
      if (rp.startsWith('http://') || rp.startsWith('https://')) {
        try {
          const res = await fetch(dropboxRawUrl(rp));
          if (res.ok) return await res.blob();
        } catch {
          /* CORS/network — fall through to null */
        }
        return null;
      }
      return getFilingFileBlob(rp, lang === 'ar' ? 'ar' : 'he');
    };

    (async () => {
      const blob = await loadBlob();
      if (cancelled) return;
      if (!blob) {
        setStatus('error');
        return;
      }

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

      // PDF → render to canvas with PDF.js (works on mobile).
      try {
        // Load PDF.js as a static ESM module from /public at RUNTIME — not
        // through the bundler. Importing 'pdfjs-dist' via the bundler made
        // Turbopack dev throw "An unexpected Turbopack error" (and a 40s+
        // compile). `new Function` hides the import from the bundler; the file
        // is self-hosted so nothing leaves the browser.
        // eslint-disable-next-line no-new-func, @typescript-eslint/no-implied-eval
        const importRuntime = new Function('u', 'return import(u)') as (
          u: string,
        ) => Promise<typeof import('pdfjs-dist')>;
        const pdfjs = await importRuntime('/pdf.min.mjs');
        // Self-hosted worker — no CDN, no data leaves the browser.
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
        const width = container.clientWidth || 600;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        for (let i = 1; i <= pdf.numPages; i++) {
          if (cancelled) return;
          const page = await pdf.getPage(i);
          const base = page.getViewport({ scale: 1 });
          const scale = (width / base.width) * dpr;
          const viewport = page.getViewport({ scale });
          const canvas = document.createElement('canvas');
          canvas.className = 'document-preview-pdf-page';
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          canvas.style.width = '100%';
          canvas.style.height = 'auto';
          const ctx = canvas.getContext('2d');
          if (!ctx) continue;
          container.appendChild(canvas);
          await page.render({ canvasContext: ctx, viewport }).promise;
          if (i === 1 && !cancelled) setStatus('pdf'); // hide loading after page 1
        }
        if (!cancelled) setStatus('pdf');
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
      <div className="document-preview-body">
        {status === 'loading' && (
          <div className="document-preview-msg">{T.loading}</div>
        )}
        {status === 'error' && (
          <div className="document-preview-msg">{T.error}</div>
        )}
        {status === 'unsupported' && (
          <div className="document-preview-msg">
            <p>{T.unsupported}</p>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() =>
                void openDocumentFromLegalOfficeFolder(
                  doc.relativePath || '',
                  lang === 'ar' ? 'ar' : 'he',
                )
              }
            >
              {T.openExternal}
            </button>
          </div>
        )}
        {status === 'image' && imageUrl && (
          <img className="document-preview-img" src={imageUrl} alt={fileName} />
        )}
        {/* PDF canvas container — kept mounted (except on error/unsupported/
         *  image) so the ref exists while PDF.js renders into it. */}
        {isPdf && status !== 'error' && status !== 'unsupported' && (
          <div ref={pdfContainerRef} className="document-preview-pdf" />
        )}
      </div>
    </Modal>
  );
}
