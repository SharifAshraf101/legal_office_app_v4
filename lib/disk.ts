// File System Access + IndexedDB handle store. Port of:
//   - openLegalOfficeHandleDB (source line 3225)
//   - saveLegalOfficeDirectoryHandle / loadSavedLegalOfficeDirectoryHandle (3236, 3247)
//   - verifyLegalOfficeDirectoryPermission (3287)
//
// The actual per-document read/write is intentionally left for Stage 4 where
// it's wired up alongside the Documents screen and the auto-sync interval.

import type { AppState, Case, Client, Lang } from '@/types';
import { FILING_ROOT, filingFolderSegments, filingFileName } from './filing';
import {
  dropboxPathForRelative,
  downloadDropboxFileBlob,
  getDropboxTemporaryLink,
  isFileSystemAccessAvailable,
} from './dropbox';
import { isOfficeDevice } from './device';

export const LEGAL_OFFICE_DATA_FILE = 'legal-office-data.json';
export const LEGAL_OFFICE_DOCUMENTS_FOLDER = 'Clients';
const LEGAL_OFFICE_IDB_NAME = 'legalOfficeLocalDiskDB';
const LEGAL_OFFICE_IDB_STORE = 'directoryHandles';
const LEGAL_OFFICE_IDB_KEY = 'legalOfficeDataDirectory';

const isBrowser = typeof window !== 'undefined';

export type DirectoryHandle = FileSystemDirectoryHandle;

type FileSystemHandlePermissionDescriptor = {
  mode?: 'read' | 'readwrite';
};

function openHandleDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(LEGAL_OFFICE_IDB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(LEGAL_OFFICE_IDB_STORE)) {
        db.createObjectStore(LEGAL_OFFICE_IDB_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
  });
}

export async function saveLegalOfficeDirectoryHandle(
  handle: DirectoryHandle,
): Promise<void> {
  if (!isBrowser || !handle) return;
  const db = await openHandleDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(LEGAL_OFFICE_IDB_STORE, 'readwrite');
    tx.objectStore(LEGAL_OFFICE_IDB_STORE).put(handle, LEGAL_OFFICE_IDB_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write failed'));
  });
  db.close();
}

export async function loadSavedLegalOfficeDirectoryHandle(): Promise<DirectoryHandle | null> {
  if (!isBrowser || !window.indexedDB) return null;
  const db = await openHandleDB();
  const handle = await new Promise<DirectoryHandle | null>((resolve, reject) => {
    const tx = db.transaction(LEGAL_OFFICE_IDB_STORE, 'readonly');
    const request = tx.objectStore(LEGAL_OFFICE_IDB_STORE).get(LEGAL_OFFICE_IDB_KEY);
    request.onsuccess = () => resolve((request.result as DirectoryHandle | undefined) ?? null);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB read failed'));
  });
  db.close();
  return handle;
}

/** Source line 3287. Returns whether we have (or just acquired) readwrite
 *  permission on the saved directory handle. */
export async function verifyLegalOfficeDirectoryPermission(
  handle: DirectoryHandle | null,
): Promise<boolean> {
  if (!handle || typeof (handle as unknown as { queryPermission?: unknown }).queryPermission !== 'function') {
    return false;
  }
  const options = { mode: 'readwrite' } as FileSystemHandlePermissionDescriptor;
  type PermissionHandle = DirectoryHandle & {
    queryPermission: (o: FileSystemHandlePermissionDescriptor) => Promise<PermissionState>;
    requestPermission: (o: FileSystemHandlePermissionDescriptor) => Promise<PermissionState>;
  };
  const h = handle as PermissionHandle;
  try {
    if ((await h.queryPermission(options)) === 'granted') return true;
    if ((await h.requestPermission(options)) === 'granted') return true;
  } catch {
    /* permission may throw outside user gesture */
  }
  return false;
}

/** Source line 3222. Throws a translated error when the browser lacks support. */
export function assertFileSystemAccess(lang: 'he' | 'ar'): void {
  if (!isBrowser || !('showDirectoryPicker' in window)) {
    throw new Error(
      lang === 'ar'
        ? 'المتصفح لا يدعم اختيار مجلد. استخدم Chrome أو Edge.'
        : 'הדפדפן אינו תומך בבחירת תיקייה. השתמש ב-Chrome או Edge.',
    );
  }
}

/** Open the directory picker and persist the chosen handle. */
export async function pickAndSaveDirectory(
  lang: 'he' | 'ar',
): Promise<DirectoryHandle> {
  assertFileSystemAccess(lang);
  const handle = await (window as unknown as {
    showDirectoryPicker: (o?: { mode?: 'read' | 'readwrite' }) => Promise<DirectoryHandle>;
  }).showDirectoryPicker({ mode: 'readwrite' });
  await saveLegalOfficeDirectoryHandle(handle);
  return handle;
}

/** Source line 3260. Clears the saved IDB handle. The caller is responsible for
 *  resetting the in-memory state. */
export async function resetLegalOfficeDataFolder(): Promise<void> {
  if (!isBrowser || !window.indexedDB) return;
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(LEGAL_OFFICE_IDB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
}

// ---------------------------------------------------------------------------
// scheduleLegalOfficeDiskAutoSave — source line 3172. Debounces writes by
// 650ms so a burst of state changes only triggers one disk write. The actual
// file write lands in Stage 4 once the screens that mutate state are ported.
// ---------------------------------------------------------------------------

let saveTimer: ReturnType<typeof setTimeout> | null = null;

export function scheduleLegalOfficeDiskAutoSave(
  handle: DirectoryHandle | null,
  payload: () => AppState,
  writeFn: (state: AppState, handle: DirectoryHandle) => Promise<void>,
): void {
  if (!handle) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    void writeFn(payload(), handle);
  }, 650);
}

// ===========================================================================
// Per-document save/open to the local Dropbox folder via File System Access.
// The picker is invoked at most ONCE — after the user grants a folder the
// handle persists in IndexedDB and every subsequent document save reuses it
// silently. No "sync" button needed; the Dropbox desktop app handles upload
// to the cloud automatically.
// ===========================================================================

/** Get the saved Dropbox folder handle (re-verifying permission) or, if no
 *  handle exists yet / permission was revoked, prompt the picker exactly
 *  once. Must be called from inside a user gesture (click). */
export async function ensureLegalOfficeFolder(
  lang: 'he' | 'ar',
): Promise<DirectoryHandle | null> {
  // 1. Already saved?
  let handle = await loadSavedLegalOfficeDirectoryHandle();
  if (handle) {
    const ok = await verifyLegalOfficeDirectoryPermission(handle);
    if (ok) return handle;
  }
  // 2. No handle or permission lapsed — prompt the picker (one-time).
  try {
    handle = await pickAndSaveDirectory(lang);
    return handle;
  } catch (e) {
    console.warn('[LegalOffice disk] folder pick failed', e);
    return null;
  }
}

/** Sanitize a filename so it can be written cross-platform. */
function safeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_').slice(0, 200) || 'file';
}

/** Resolve a sub-directory chain inside the picked folder, creating each
 *  level if it doesn't exist. Returns the deepest directory handle. */
async function ensureSubdir(
  root: DirectoryHandle,
  parts: string[],
): Promise<FileSystemDirectoryHandle> {
  let dir: FileSystemDirectoryHandle = root;
  for (const part of parts) {
    const safe = safeFilename(part);
    if (!safe) continue;
    dir = await dir.getDirectoryHandle(safe, { create: true });
  }
  return dir;
}

/** Return a filename that doesn't already exist in `dir`, appending " (n)"
 *  before the extension when needed, so two different uploads that resolve to
 *  the same numbered name don't silently overwrite each other. */
async function uniqueFileName(
  dir: FileSystemDirectoryHandle,
  name: string,
): Promise<string> {
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  let candidate = name;
  for (let n = 1; n < 1000; n++) {
    try {
      await dir.getFileHandle(candidate, { create: false });
    } catch {
      return candidate; // not found → free to use
    }
    candidate = `${stem} (${n})${ext}`;
  }
  return candidate;
}

/** How many path levels to prepend before the per-client/-case segments.
 *  If the user pointed the directory picker straight AT the filing-root folder
 *  itself (i.e. they picked the existing "Clients" folder), writing another
 *  "Clients" inside it would produce `Clients/Clients/…`. So in that case we
 *  write directly inside the picked folder; otherwise we create/enter a
 *  "Clients" subfolder under it. */
function filingRootParts(root: DirectoryHandle): string[] {
  return (root.name || '').toLowerCase() === FILING_ROOT.toLowerCase()
    ? [] // the picked folder already IS "Clients"
    : [FILING_ROOT];
}

/** Save a document into the picked folder under the firm's filing scheme:
 *  `Clients/CLT-101 - Name/CS-1001 - Title/CLT-101_CS-1001_<file>`. Falls back
 *  to the legacy flat layout when no client/case object is supplied. Returns
 *  the relative path inside the picked folder, or null on failure. */
export async function saveDocumentToLegalOfficeFolder(
  file: File,
  options: {
    caseId?: string;
    clientId?: string;
    client?: Client | null;
    caseObj?: Case | null;
    lang: Lang;
    /** Unique running document id (e.g. "DOC-001") appended before the
     *  extension to guarantee a collision-free filename. */
    docId?: string;
  },
): Promise<{ relativePath: string } | null> {
  // The actual write into a given folder. Factored out so we can retry it with
  // a freshly-picked folder when the saved handle turns out to be stale.
  const writeInto = async (
    root: DirectoryHandle,
  ): Promise<{ relativePath: string }> => {
    let segments: string[];
    let filename: string;
    if (options.client || options.caseObj) {
      segments = filingFolderSegments(options.client, options.caseObj, options.lang);
      filename = filingFileName(options.client, options.caseObj, file.name, options.docId);
    } else {
      segments = [safeFilename(options.caseId || options.clientId || 'misc')];
      filename = `${Date.now()}-${safeFilename(file.name)}`;
    }

    const dir = await ensureSubdir(root, [...filingRootParts(root), ...segments]);
    const finalName = await uniqueFileName(dir, filename);
    const fileHandle = await dir.getFileHandle(finalName, { create: true });
    const writable = await (
      fileHandle as FileSystemFileHandle & {
        createWritable: () => Promise<FileSystemWritableFileStream>;
      }
    ).createWritable();
    await writable.write(file);
    await writable.close();
    return {
      relativePath: `${FILING_ROOT}/${segments.join('/')}/${finalName}`,
    };
  };

  // 1. Try with the saved/ensured folder handle.
  const root = await ensureLegalOfficeFolder(options.lang);
  if (!root) return null;
  try {
    return await writeInto(root);
  } catch (e) {
    // The saved handle is stale — the folder was moved, renamed or deleted (a
    // common case after the user "changes the path" on disk), or the write was
    // otherwise refused. Fall through to recovery.
    console.warn('[LegalOffice disk] save failed on saved folder, re-picking', e);
  }

  // 2. Recovery: forget the stale handle so it can't be reused, then prompt the
  //    folder picker again so the user can point the app at the NEW location,
  //    and retry the write once. If the picker is cancelled or the retry fails,
  //    give up (the caller shows "not saved") — but the stale handle is already
  //    cleared, so the next save attempt will prompt the picker straight away.
  try {
    await resetLegalOfficeDataFolder();
    const fresh = await pickAndSaveDirectory(options.lang);
    return await writeInto(fresh);
  } catch (e) {
    console.warn('[LegalOffice disk] save failed after re-pick', e);
    return null;
  }
}

/** Open a previously-saved document, choosing the best strategy per file type
 *  and device so it OPENS (never silently downloads when avoidable):
 *
 *   - PDF / images (browser can render these): DESKTOP opens the local copy
 *     inline in a new tab; MOBILE (or a local miss) opens the synced Dropbox
 *     copy via a short-lived link.
 *   - Office files (.docx/.xlsx/.pptx — browsers CANNOT render these inline):
 *     open through the Microsoft Office Online viewer pointed at the Dropbox
 *     copy, so it previews in a tab instead of downloading.
 *   - Last resort (no Dropbox connection and a non-viewable type): download the
 *     local copy so the OS app can open it.
 *
 *  Returns false only when nothing could be opened (caller shows a message). */
export async function openDocumentFromLegalOfficeFolder(
  relativePath: string,
  lang: 'he' | 'ar',
): Promise<boolean> {
  const fileName = relativePath.split('/').filter(Boolean).pop() || '';
  const inlineViewable = isInlineViewable(fileName);

  // 1. Open via the synced Dropbox copy FIRST. A temporary link opens reliably
  //    in a new tab — PDFs/images render inline, Office docs go through the
  //    Office Online viewer. This is the same path that already works for
  //    .docx, and it sidesteps two local-file pitfalls: a blob: URL that the
  //    browser downloads instead of displaying, and Unicode/normalization
  //    mismatches between the stored path and the on-disk filename (e.g. files
  //    registered by the external pipeline).
  try {
    const link = await getDropboxTemporaryLink(
      dropboxPathForRelative(relativePath),
    );
    if (link) {
      const target = inlineViewable
        ? link
        : 'https://view.officeapps.live.com/op/view.aspx?src=' +
          encodeURIComponent(link);
      window.open(target, '_blank', 'noopener,noreferrer');
      return true;
    }
  } catch (e) {
    console.warn('[LegalOffice disk] dropbox open failed', e);
  }

  // 2. Fallback to the local copy (no Dropbox connection, or the file hasn't
  //    synced to the cloud yet) — ONLY on the office computer. A remote
  //    phone/laptop never reads the local disk.
  if (isOfficeDevice() && isFileSystemAccessAvailable()) {
    const localFile = await readLocalFilingFile(relativePath, lang);
    if (localFile) {
      if (inlineViewable && openBlobInNewTab(localFile)) return true;
      downloadBlob(localFile, fileName);
      return true;
    }
  }
  return false;
}

/** Fetch a filing document's raw bytes as a Blob for INLINE preview (rendered
 *  via a blob: URL, never downloaded). Tries the local synced copy first (no
 *  network, no CORS), then falls back to pulling it from Dropbox. Returns null
 *  when neither source has the file. */
export async function getFilingFileBlob(
  relativePath: string,
  lang: 'he' | 'ar',
): Promise<Blob | null> {
  // 1. Cloud copy via the Dropbox content API (the primary store; matches the
  //    Dropbox-first precedence of openDocumentFromLegalOfficeFolder). Returns
  //    the bytes — CORS is allowed on the content endpoint.
  try {
    const blob = await downloadDropboxFileBlob(
      dropboxPathForRelative(relativePath),
    );
    if (blob) return blob;
  } catch (e) {
    console.warn('[LegalOffice disk] dropbox blob fetch failed', e);
  }
  // 2. Local synced copy — ONLY on the office computer (a remote phone/laptop
  //    must never touch the local disk; it relies on the cloud copy above). We
  //    never call the folder picker here: this runs inside a render effect (no
  //    user gesture), so a picker would just throw. Use the saved handle or skip.
  if (isOfficeDevice() && isFileSystemAccessAvailable()) {
    try {
      const handle = await loadSavedLegalOfficeDirectoryHandle();
      if (handle && (await verifyLegalOfficeDirectoryPermission(handle))) {
        const localFile = await readLocalFilingFile(relativePath, lang);
        if (localFile) return localFile;
      }
    } catch (e) {
      console.warn('[LegalOffice disk] local blob read failed', e);
    }
  }
  return null;
}

/** Read a saved filing file from the local picked folder, handling the
 *  duplicate-"Clients" cases. Returns null if not found / no folder. */
async function readLocalFilingFile(
  relativePath: string,
  lang: 'he' | 'ar',
): Promise<File | null> {
  try {
    const root = await ensureLegalOfficeFolder(lang);
    if (!root) return null;
    const parts = relativePath.split('/').filter(Boolean);
    if (parts.length < 2) return null;
    // When the picked folder already IS "Clients", drop the duplicate
    // "Clients/" prefix; fall back to the raw parts for legacy files written
    // into Clients/Clients before the double-nesting fix.
    const stripped =
      filingRootParts(root).length === 0 &&
      parts[0] &&
      parts[0].toLowerCase() === FILING_ROOT.toLowerCase()
        ? parts.slice(1)
        : parts;
    return (
      (await readFileAtParts(root, stripped)) ??
      (stripped !== parts ? await readFileAtParts(root, parts) : null)
    );
  } catch (e) {
    console.warn('[LegalOffice disk] local read failed', e);
    return null;
  }
}

/** Types a browser renders inline in a tab. Everything else (Office docs, etc.)
 *  is opened through an online viewer or downloaded. */
export function isInlineViewable(name: string): boolean {
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
  return [
    'pdf',
    'png',
    'jpg',
    'jpeg',
    'gif',
    'webp',
    'svg',
    'bmp',
    'txt',
    'html',
    'htm',
  ].includes(ext);
}

/** Download a File via a temporary object URL (used as the final fallback). */
function downloadBlob(file: File, name: string): void {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = name || 'document';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Open a File in a new browser tab so PDFs/images render INLINE instead of
 *  downloading. Two things matter:
 *   1. A File from the File System Access API frequently has an EMPTY mime
 *      type, and a blob: URL with no type makes the browser download it. We
 *      re-wrap the bytes with a type inferred from the extension.
 *   2. The tab must be opened with `window.open` — a programmatic
 *      `<a target="_blank">` click on a blob: URL is treated as a DOWNLOAD by
 *      Chrome (the UUID-named downloads users saw), whereas window.open renders
 *      viewable types inline.
 *  Returns false if a popup blocker prevented the tab from opening, so the
 *  caller can fall back to the Dropbox copy. */
function openBlobInNewTab(file: File): boolean {
  const mime = file.type || mimeFromName(file.name);
  const blob = mime && mime !== file.type ? file.slice(0, file.size, mime) : file;
  const url = URL.createObjectURL(blob);
  const w = window.open(url, '_blank');
  // Revoke later so the new tab has time to load it.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return !!w;
}

/** Best-effort mime type from a filename extension. */
export function mimeFromName(name: string): string {
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
  switch (ext) {
    case 'pdf':
      return 'application/pdf';
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    case 'txt':
      return 'text/plain';
    case 'html':
    case 'htm':
      return 'text/html';
    default:
      return '';
  }
}

/** Walk `parts` (dirs… + filename) from `root` and return the File, or null
 *  if any segment is missing. */
async function readFileAtParts(
  root: DirectoryHandle,
  parts: string[],
): Promise<File | null> {
  try {
    const dirParts = parts.slice(0, -1);
    const fileName = parts[parts.length - 1];
    let dir: FileSystemDirectoryHandle = root;
    for (const part of dirParts) {
      dir = await dir.getDirectoryHandle(part, { create: false });
    }
    const fileHandle = await dir.getFileHandle(fileName, { create: false });
    return await fileHandle.getFile();
  } catch {
    return null;
  }
}
