// Provision the pdf.js runtime + font data into public/pdfjs so the in-app
// document preview can render PDFs (incl. RTL Hebrew/Arabic) with the browser's
// PDF engine disabled — see components/DocumentPreviewModal.tsx.
//
// Why the font data matters: a PDF that does NOT embed its fonts (common with
// Word "Save as PDF") makes pdf.js fall back to its packaged fonts. WITHOUT
// `standard_fonts/` (standardFontDataUrl) + `cmaps/` (cMapUrl) the fallback has
// no metrics/glyphs, which is what garbled the Hebrew before (glyphs dropped,
// reordered, spaced apart). Shipping both fixes that at the root.
//
// The output lives under public/pdfjs/ and is .gitignored — it's regenerated
// from node_modules on every install/build (postinstall + predev + prebuild),
// so the ~4MB of vendored binaries never enters git.
//
//   npm run copy-pdfjs

import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(__dirname, '..', 'node_modules', 'pdfjs-dist');
const DST = resolve(__dirname, '..', 'public', 'pdfjs');

if (!existsSync(SRC)) {
  // pdfjs-dist not installed (e.g. a lint-only CI step with --omit). Don't fail
  // the whole install/build over it — the preview just won't have assets until
  // a full `npm install` runs this again.
  console.warn('[copy-pdfjs] pdfjs-dist not found in node_modules — skipping.');
  process.exit(0);
}

const items = [
  ['build/pdf.min.mjs', 'pdf.min.mjs'],
  ['build/pdf.worker.min.mjs', 'pdf.worker.min.mjs'],
  ['cmaps', 'cmaps'],
  ['standard_fonts', 'standard_fonts'],
];

mkdirSync(DST, { recursive: true });
for (const [from, to] of items) {
  const src = resolve(SRC, from);
  if (!existsSync(src)) {
    console.warn(`[copy-pdfjs] missing ${from} — skipping.`);
    continue;
  }
  cpSync(src, resolve(DST, to), { recursive: true });
}
console.log(`[copy-pdfjs] pdf.js assets → ${DST}`);
