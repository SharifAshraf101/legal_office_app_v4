// Shared document-filing path + filename builder used by BOTH storage
// backends (Dropbox upload on mobile, File System Access on desktop) so a
// document lands in an identical, predictable tree no matter how it is saved.
//
// Filing scheme (per the firm's request):
//
//   Clients/
//     clt-101/                        ← one folder per client, code only (lowercase)
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

function caseTitle(caseObj: Case, lang: Lang): string {
  return lang === 'ar'
    ? caseObj.titleAr || caseObj.title || ''
    : caseObj.title || caseObj.titleAr || '';
}

/** Client folder name — the client code ONLY, in lowercase English letters
 *  (e.g. "clt-101"), with no client name, per the firm's request. */
export function clientFolderName(client: Client, _lang?: Lang): string {
  const id = String(client.id || '').trim();
  return safeSegment(id, 'client').toLowerCase();
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

/** Renamed file, e.g. "CLT-101_CS-1001_contract_DOC-001.pdf".
 *
 *  Layout:  <clientId>_<caseId>_<original name>_<docId>.<ext>
 *
 *  A missing client / case id is skipped. The unique document id, when
 *  given, is inserted BEFORE the extension (not after) so the file still
 *  opens correctly — guaranteeing every saved file is unique even if two
 *  documents share the same original name in the same case folder. */
export function filingFileName(
  client: Client | null | undefined,
  caseObj: Case | null | undefined,
  originalName: string,
  docId?: string | null,
): string {
  const prefix: string[] = [];
  if (client?.id) prefix.push(safeSegment(client.id));
  if (caseObj?.id) prefix.push(safeSegment(caseObj.id));

  // Split the sanitized name into stem + extension so the docId lands
  // before the dot (".pdf" stays a real extension).
  const safeName = safeSegment(originalName);
  const dot = safeName.lastIndexOf('.');
  const stem = dot > 0 ? safeName.slice(0, dot) : safeName;
  const ext = dot > 0 ? safeName.slice(dot) : '';

  const base = [...prefix, stem].join('_');
  const tail = docId ? safeSegment(docId) : '';
  return tail ? `${base}_${tail}${ext}` : `${base}${ext}`;
}
