// Drawing single PDF pages onto a <canvas> with pdf.js — for the "send for
// signature" screen and the client's signing page. (The document preview
// renders every page at once; these screens show one page at a time.)
//
// pdf.js is loaded at run time from public/pdfjs, where scripts/copy-pdfjs.mjs
// puts it — the same files DocumentPreviewModal uses.

const PDFJS_LIB = '/pdfjs/pdf.min.mjs';
const PDFJS_WORKER = '/pdfjs/pdf.worker.min.mjs';
const PDFJS_CMAPS = '/pdfjs/cmaps/';
const PDFJS_STANDARD_FONTS = '/pdfjs/standard_fonts/';

type PdfJs = typeof import('pdfjs-dist');
export type PdfDoc = Awaited<ReturnType<PdfJs['getDocument']>['promise']>;

/** Open a PDF. pdf.js takes ownership of the buffer it is given, so it gets a
 *  copy and the caller's bytes stay usable (they are needed again to stamp). */
export async function openPdf(bytes: ArrayBuffer): Promise<PdfDoc> {
  const importRuntime = new Function('u', 'return import(u)') as (u: string) => Promise<PdfJs>;
  const pdfjs = await importRuntime(PDFJS_LIB);
  pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
  return pdfjs.getDocument({
    data: bytes.slice(0),
    cMapUrl: PDFJS_CMAPS,
    cMapPacked: true,
    standardFontDataUrl: PDFJS_STANDARD_FONTS,
    // Draw glyphs from the font program itself: the FontFace path breaks
    // cursive Arabic and RTL Hebrew in Word-exported PDFs.
    disableFontFace: true,
  }).promise;
}

/** Draw page `pageNo` (1-based) at `cssWidth` CSS pixels wide. The canvas is
 *  sized for a sharp picture; show it with `width:100%; height:auto`. */
export async function renderPdfPage(pdf: PdfDoc, pageNo: number, canvas: HTMLCanvasElement, cssWidth: number): Promise<void> {
  const page = await pdf.getPage(Math.min(Math.max(1, pageNo), pdf.numPages));
  const base = page.getViewport({ scale: 1 });
  const ratio = Math.min(Math.max(window.devicePixelRatio || 1, 1.5), 2);
  let scale = (Math.max(200, cssWidth) / base.width) * ratio;
  // Keep within what phones allow for one canvas.
  const area = base.width * scale * base.height * scale;
  if (area > 8_000_000) scale *= Math.sqrt(8_000_000 / area);
  const viewport = page.getViewport({ scale });
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  await page.render({ canvasContext: ctx, viewport } as Parameters<typeof page.render>[0]).promise;
}
