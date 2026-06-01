// Shared document-filing path + filename builder used by BOTH storage
// backends (Dropbox upload on mobile, File System Access on desktop) so a
// document lands in an identical, predictable tree no matter how it is saved.
//
// Filing scheme (per the firm's request):
//
//   Clients/
//     CLT-101 - <client name>/        ← one folder per client, unique number
//       CS-1001 - <case title>/       ← one folder per case, unique number
//         CLT-101_CS-1001_<file>      ← file is renamed to carry both numbers
//
// Nesting the case folder inside the client folder keeps every lawsuit grouped
// under its client, and prefixing the filename with both unique numbers means
// each file is self-identifying even when downloaded or shared out of context.

import type { Case, Client, Lang } from '@/types';

/** Folder name that holds all client folders (matches the legacy root). */
export const FILING_ROOT = 'Clients';

/** Strip characters Dropbox / Windows / macOS reject in a path segment or
 *  filename, collapse runs of whitespace, and cap the length. Never returns
 *  an empty string — falls back to `fallback`. */
export function safeSegment(name: string, fallback = 'file'): string {
  const clean = String(name ?? '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  return clean || fallback;
}

function clientName(client: Client, lang: Lang): string {
  return lang === 'ar'
    ? client.nameAr || client.name || ''
    : client.name || client.nameAr || '';
}

function caseTitle(caseObj: Case, lang: Lang): string {
  return lang === 'ar'
    ? caseObj.titleAr || caseObj.title || ''
    : caseObj.title || caseObj.titleAr || '';
}

/** Client folder name, e.g. "CLT-101 - Israel Israeli" (name part optional). */
export function clientFolderName(client: Client, lang: Lang): string {
  const id = String(client.id || '').trim();
  const name = clientName(client, lang).trim();
  return safeSegment(name ? `${id} - ${name}` : id, 'client');
}

/** Case folder name, e.g. "CS-1001 - Eviction claim" (title part optional). */
export function caseFolderName(caseObj: Case, lang: Lang): string {
  const id = String(caseObj.id || '').trim();
  const title = caseTitle(caseObj, lang).trim();
  return safeSegment(title ? `${id} - ${title}` : id, 'case');
}

/** Path segments UNDER the `Clients` root, nesting the case inside the client.
 *  Falls back to `['misc']` when neither client nor case is known. */
export function filingFolderSegments(
  client: Client | null | undefined,
  caseObj: Case | null | undefined,
  lang: Lang,
): string[] {
  const segments: string[] = [];
  if (client) segments.push(clientFolderName(client, lang));
  if (caseObj) segments.push(caseFolderName(caseObj, lang));
  if (segments.length === 0) segments.push('misc');
  return segments;
}

/** Renamed file, e.g. "CLT-101_CS-1001_contract.pdf". A missing client or
 *  case id is simply skipped, so the original name is always preserved at
 *  the tail (extension intact). */
export function filingFileName(
  client: Client | null | undefined,
  caseObj: Case | null | undefined,
  originalName: string,
): string {
  const parts: string[] = [];
  if (client?.id) parts.push(safeSegment(client.id));
  if (caseObj?.id) parts.push(safeSegment(caseObj.id));
  parts.push(safeSegment(originalName));
  return parts.join('_');
}
