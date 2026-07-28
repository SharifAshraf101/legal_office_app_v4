// Regenerates the installable-app icon PNGs from the office logo.
// Source of truth: public/icons/app-logo.svg (the raw flower + scales mark).
// Run after editing that SVG:  node scripts/render-app-icons.mjs
// Outputs: app-icon.svg (cream, padded, maskable-safe) + the PNG set below.
import sharp from 'sharp';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ICONS = path.join(process.cwd(), 'public', 'icons');
const CREAM = '#FDFBF5';

// --- Build the padded, cream-background launcher icon from the raw mark ---
const logo = readFileSync(path.join(ICONS, 'app-logo.svg'), 'utf8');
const inner = logo
  .replace(/^[\s\S]*?<svg[^>]*>/, '')
  .replace(/<\/svg>\s*$/, '');

// The mark's content bbox is centered ~ (320, 303) in the 640 viewBox.
// Scale to 0.78 so the flower + "A SH" stay inside the Android maskable
// safe-zone circle (inner 80%), then re-center on the canvas.
const appIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" width="640" height="640">` +
  `<rect width="640" height="640" fill="${CREAM}"/>` +
  `<g transform="translate(320,320) scale(0.78) translate(-320,-303)">${inner}</g>` +
  `</svg>`;
writeFileSync(path.join(ICONS, 'app-icon.svg'), appIcon);

const buf = Buffer.from(appIcon);
const render = (size, out) =>
  sharp(buf, { density: 512 })
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toFile(path.join(ICONS, out));

await Promise.all([
  render(512, 'app-icon-512.png'),
  render(192, 'app-icon-192.png'),
  render(180, 'apple-touch-icon.png'),
  render(32, 'favicon-32.png'),
  render(16, 'favicon-16.png'),
]);

console.log('rendered:', ['app-icon-512', 'app-icon-192', 'apple-touch-icon', 'favicon-32', 'favicon-16'].join(', '));
