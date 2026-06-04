// File System Access + IndexedDB handle store. Port of:
//   - openLegalOfficeHandleDB (source line 3225)
//   - saveLegalOfficeDirectoryHandle / loadSavedLegalOfficeDirectoryHandle (3236, 3247)
//   - verifyLegalOfficeDirectoryPermission (3287)
//
// The actual per-document read/write is intentionally left for Stage 4 where
// it's wired up alongside the Documents screen and the auto-sync interval.

import type { AppState, Case, Client, Lang } from '@/types';
import { FILING_ROOT, filingFolderSegments, filingFileName } from './filing';

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
  try {
    const root = await ensureLegalOfficeFolder(options.lang);
    if (!root) return null;

    let segments: string[];
    let filename: string;
    if (options.client || options.caseObj) {
      segments = filingFolderSegments(options.client, options.caseObj, options.lang);
      filename = filingFileName(options.client, options.caseObj, file.name, options.docId);
    } else {
      segments = [safeFilename(options.caseId || options.clientId || 'misc')];
      filename = `${Date.now()}-${safeFilename(file.name)}`;
    }

    const dir = await ensureSubdir(root, [FILING_ROOT, ...segments]);
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
  } catch (e) {
    console.warn('[LegalOffice disk] save failed', e);
    return null;
  }
}

/** Open a previously-saved document by reading its file from the picked
 *  folder and creating an Object URL. The URL is opened in a new tab. */
export async function openDocumentFromLegalOfficeFolder(
  relativePath: string,
  lang: 'he' | 'ar',
): Promise<boolean> {
  try {
    const root = await ensureLegalOfficeFolder(lang);
    if (!root) return false;
    const parts = relativePath.split('/').filter(Boolean);
    if (parts.length < 2) return false;
    // All but the last part are directories.
    const dirParts = parts.slice(0, -1);
    const fileName = parts[parts.length - 1];
    let dir: FileSystemDirectoryHandle = root;
    for (const part of dirParts) {
      dir = await dir.getDirectoryHandle(part, { create: false });
    }
    const fileHandle = await dir.getFileHandle(fileName, { create: false });
    const file = await fileHandle.getFile();
    const url = URL.createObjectURL(file);
    const w = window.open(url, '_blank', 'noopener,noreferrer');
    // Revoke after a short delay so the new tab has time to read it.
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
    return !!w;
  } catch (e) {
    console.warn('[LegalOffice disk] open failed', e);
    return false;
  }
}
