'use client';

import { useEffect, useRef, useState } from 'react';
import { useModalStack } from '@/hooks/useModalStack';
import { useT } from '@/hooks/useT';
import { Modal } from './Modal';
import { getFilingFileBlob, openDocumentFromLegalOfficeFolder } from '@/lib/disk';
import { dropboxRawUrl } from '@/lib/dropbox';
import type { DocumentRecord } from '@/types';

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

  const normalizeBlobMime = (blob: Blob): Blob => {
    if (!blob.type && isPdf) {
      return new Blob([blob], { type: 'application/pdf' });
    }
    if (!blob.type && isImage) {
      const imageType = {
        png: 'image/png',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        gif: 'image/gif',
        webp: 'image/webp',
        svg: 'image/svg+xml',
        bmp: 'image/bmp',
      }[ext];
      if (imageType) return new Blob([blob], { type: imageType });
    }
    return blob;
  };

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
      if (!blob) { setStatus('error'); return; }

      const normalizedBlob = normalizeBlobMime(blob);

      if (isImage) {
        const u = URL.createObjectURL(normalizedBlob);
        objectUrlRef.current = u;
        setImageUrl(u);
        setStatus('image');
        return;
      }

      if (!isPdf) { setStatus('unsupported'); return; }

      try {
        const importRuntime = new Function('u', 'return import(u)') as (
          u: string,
        ) => Promise<typeof import('pdfjs-dist')>;
        const pdfjs = await importRuntime('/pdf.min.mjs');
        pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
        const data = await normalizedBlob.arrayBuffer();
        if (cancelled) return;
        const pdf = await pdfjs.getDocument({ data }).promise;
        if (cancelled) return;
        const container = pdfContainerRef.current;
        if (!container) { setStatus('error'); return; }

        container.innerHTML = '';
        const style = window.getComputedStyle(container);
        const paddingX = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
        const width = Math.max((container.clientWidth - paddingX) || 600, 320);
        const outputScale = Math.min(window.devicePixelRatio * 2 || 3, 4);

        for (let i = 1; i <= pdf.numPages; i++) {
          if (cancelled) return;
          const page = await pdf.getPage(i);
          const base = page.getViewport({ scale: 1 });
          const pageScale = width / base.width;
          const viewport = page.getViewport({ scale: pageScale * outputScale });
          const canvas = document.createElement('canvas');
          canvas.className = 'document-preview-pdf-page';
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          canvas.style.width = `${Math.floor(viewport.width / outputScale)}px`;
          canvas.style.height = `${Math.floor(viewport.height / outputScale)}px`;
          canvas.style.backgroundColor = '#fff';
          canvas.style.display = 'block';
          canvas.style.imageRendering = 'high-quality';
          const ctx = canvas.getContext('2d', { alpha: false });
          if (!ctx) continue;
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          container.appendChild(canvas);
          await page.render({ canvasContext: ctx, viewport, intent: 'print' }).promise;
          if (i === 1 && !cancelled) setStatus('pdf');
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
    error: lang === 'ar' ? 'تعذّر تحميل المستند للمعاينة.' : 'טעינת המסמך לתצוגה מקדימה נכשלה.',
    unsupported: lang === 'ar'
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
        {isPdf && status !== 'error' && status !== 'unsupported' && (
          <div ref={pdfContainerRef} className="document-preview-pdf" />
        )}
      </div>
    </Modal>
  );
}