#!/usr/bin/env node
/**
 * Brings the annexes program ("ניהול נספחים") into this app.
 *
 * The annexes program is its own project (LegalAppendDocs). Its browser build
 * is a static site that needs no server: the work is done inside the browser
 * and the files stay in the browser's own storage. This script builds that
 * site and copies it to public/annexes, where the "ניהול נספחים" screen
 * (components/AnnexesScreen.tsx) shows it. Run it after any change in the
 * annexes project, then deploy this app as usual:
 *
 *   node scripts/sync-annexes.mjs                 (project next to the Desktop)
 *   node scripts/sync-annexes.mjs <path-to-LegalAppendDocs>
 *   node scripts/sync-annexes.mjs --no-build      (copy the existing build)
 */
import { spawnSync } from 'node:child_process';
import { existsSync, promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const TARGET = path.resolve(here, '..', 'public', 'annexes');

const args = process.argv.slice(2);
const build = !args.includes('--no-build');
const source = path.resolve(
  args.find((a) => !a.startsWith('--')) ??
    process.env.ANNEXES_PROJECT ??
    path.join(os.homedir(), 'OneDrive', 'Desktop', 'LegalAppendDocs'),
);

if (!existsSync(path.join(source, 'scripts', 'export-web.mjs'))) {
  console.error(`Annexes project not found at: ${source}`);
  process.exit(1);
}

if (build) {
  const built = spawnSync(process.execPath, [path.join(source, 'scripts', 'export-web.mjs')], {
    cwd: source,
    stdio: 'inherit',
    // This app serves the site under /annexes
    env: { ...process.env, ANNEX_BASE_PATH: '/annexes' },
  });
  if (built.status !== 0) process.exit(built.status ?? 1);
}

const out = path.join(source, 'out-web');
if (!existsSync(path.join(out, 'index.html'))) {
  console.error(`No build found at: ${out}`);
  process.exit(1);
}

await fs.rm(TARGET, { recursive: true, force: true });
await fs.cp(out, TARGET, { recursive: true });
console.log(`Copied the annexes program to ${TARGET}`);
