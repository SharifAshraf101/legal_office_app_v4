// Dropbox API client used on mobile / any browser without File System
// Access support. The user connects ONCE via OAuth (PKCE flow with a
// refresh token), picks a Dropbox folder to save into, and after that
// every document save runs silently against the saved tokens.
//
// ===== SETUP =====
// 1. Create a Dropbox app at https://www.dropbox.com/developers/apps
//    - Scoped access
//    - Either "App folder" (recommended — isolates files) or
//      "Full Dropbox" (lets the user pick any folder, even ones outside
//      the app's own directory)
// 2. Permissions: files.content.write, files.content.read,
//    sharing.write, sharing.read, files.metadata.read
// 3. On the app settings page → "OAuth 2" → add a redirect URI that
//    exactly matches the deployed app's origin + pathname, e.g.
//      http://localhost:3000/
//      https://your-app.example.com/
// 4. Copy the App key and expose it as the Next.js env variable
//    `NEXT_PUBLIC_DROPBOX_APP_KEY` (in .env.local or your hosting env).

import type { Case, Client, Lang } from '@/types';
import { FILING_ROOT, filingFolderSegments, filingFileName } from './filing';

const TOKEN_KEY = 'legal_office_dropbox_tokens';
const VERIFIER_KEY = 'legal_office_dropbox_pkce_verifier';
const FOLDER_KEY = 'legal_office_dropbox_folder';
const APP_KEY_KEY = 'legal_office_dropbox_app_key';
const REDIRECT_URI_KEY = 'legal_office_dropbox_redirect_uri';
const DROPBOX_SCOPES = [
  'files.content.write',
  'files.content.read',
  'files.metadata.read',
  'sharing.write',
  'sharing.read',
] as const;

interface DropboxTokens {
  access_token: string;
  refresh_token?: string;
  /** Unix ms timestamp when the access_token expires. */
  expires_at: number;
}

/** Pulls the Dropbox app key from env, with localStorage fallback. */
export function getDropboxAppKey(): string {
  const envKey = (process.env.NEXT_PUBLIC_DROPBOX_APP_KEY || '').trim();
  if (envKey) return envKey;
  if (typeof window === 'undefined') return '';
  return (localStorage.getItem(APP_KEY_KEY) || '').trim();
}

/** Persist a Dropbox app key at runtime (browser localStorage fallback). */
export function setDropboxAppKey(appKey: string): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(APP_KEY_KEY, (appKey || '').trim());
}

/** Persist a Dropbox redirect URI override at runtime. */
export function setDropboxRedirectUri(redirectUri: string): void {
  if (typeof window === 'undefined') return;
  const clean = (redirectUri || '').trim();
  if (!clean) {
    localStorage.removeItem(REDIRECT_URI_KEY);
    return;
  }
  localStorage.setItem(REDIRECT_URI_KEY, normalizeDropboxRedirectUri(clean));
}

function normalizeDropboxRedirectUri(uri: string): string {
  const raw = (uri || '').trim();
  if (!raw) return '';
  try {
    const u = new URL(raw);
    // For root-path localhost redirects, Dropbox apps are often configured
    // without a trailing slash. Keep the canonical origin-only form.
    if (u.pathname === '/' && !u.search && !u.hash) return u.origin;
    return `${u.origin}${u.pathname}${u.search}${u.hash}`;
  } catch {
    return raw;
  }
}

function loadTokens(): DropboxTokens | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(TOKEN_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as DropboxTokens;
  } catch {
    return null;
  }
}

function saveTokens(t: DropboxTokens): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(TOKEN_KEY, JSON.stringify(t));
}

export function clearDropboxConnection(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(VERIFIER_KEY);
  localStorage.removeItem(FOLDER_KEY);
}

/** True when a refresh-token (or a still-valid access token) is on file. */
export function isDropboxConfigured(): boolean {
  const t = loadTokens();
  if (!t) return false;
  // Either the access token is still fresh OR we have a refresh token.
  return Date.now() < t.expires_at || !!t.refresh_token;
}

/** True when a target folder has been picked by the user. */
export function hasDropboxFolder(): boolean {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem(FOLDER_KEY) !== null;
}

export function getDropboxFolderPath(): string {
  if (typeof window === 'undefined') return '';
  return localStorage.getItem(FOLDER_KEY) || '';
}

export function setDropboxFolderPath(path: string): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(FOLDER_KEY, path);
}

// ---- PKCE helpers ---------------------------------------------------------

function base64url(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

async function generateVerifier(): Promise<string> {
  const bytes = new Uint8Array(64);
  crypto.getRandomValues(bytes);
  return base64url(bytes.buffer);
}

async function deriveChallenge(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return base64url(hash);
}

export function getDropboxRedirectUri(): string {
  if (typeof window === 'undefined') return '';
  const override = (localStorage.getItem(REDIRECT_URI_KEY) || '').trim();
  if (override) return normalizeDropboxRedirectUri(override);
  return normalizeDropboxRedirectUri(window.location.origin + window.location.pathname);
}

/** Kick off the Dropbox OAuth flow. Generates a verifier+challenge, saves
 *  the verifier to localStorage, then redirects the browser to Dropbox.
 *  After authorization Dropbox redirects back to the same URL with `?code=`,
 *  which `handleDropboxAuthCallback()` exchanges for tokens. */
export async function startDropboxAuth(): Promise<void> {
  const appKey = getDropboxAppKey();
  if (!appKey) {
    throw new Error('NEXT_PUBLIC_DROPBOX_APP_KEY is not set');
  }
  const verifier = await generateVerifier();
  const challenge = await deriveChallenge(verifier);
  localStorage.setItem(VERIFIER_KEY, verifier);
  const url = new URL('https://www.dropbox.com/oauth2/authorize');
  url.searchParams.set('client_id', appKey);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('redirect_uri', getDropboxRedirectUri());
  // Explicit scopes are required for scoped Dropbox apps. Without this,
  // tokens may be issued without files.content.write and uploads will fail.
  url.searchParams.set('scope', DROPBOX_SCOPES.join(' '));
  // `offline` → Dropbox returns a refresh_token, so future loads can mint
  // new access tokens without bouncing the user back through the consent.
  url.searchParams.set('token_access_type', 'offline');
  // Force a fresh consent screen so newly-enabled scopes in App Console
  // are actually attached to the issued token. Without this, Dropbox may
  // silently return the user with a token that still reflects the OLD
  // granted scopes (the auto-skip-consent path).
  url.searchParams.set('force_reapprove', 'true');
  window.location.href = url.toString();
}

/** When the user returns from Dropbox the URL contains `?code=...`. This
 *  function reads it, exchanges it for tokens, cleans the URL, and stores
 *  the access + refresh tokens. Returns true if a successful exchange
 *  happened (used by AppShell to e.g. re-open the connect modal). */
export async function handleDropboxAuthCallback(): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  if (!code) return false;
  const verifier = localStorage.getItem(VERIFIER_KEY);
  const appKey = getDropboxAppKey();
  if (!verifier || !appKey) return false;

  const body = new URLSearchParams();
  body.set('code', code);
  body.set('grant_type', 'authorization_code');
  body.set('client_id', appKey);
  body.set('code_verifier', verifier);
  body.set('redirect_uri', getDropboxRedirectUri());

  try {
    const res = await fetch('https://api.dropboxapi.com/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    if (!res.ok) {
      console.warn(
        '[Dropbox auth] token exchange failed',
        res.status,
        await res.text().catch(() => ''),
      );
      return false;
    }
    const json = (await res.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
    };
    saveTokens({
      access_token: json.access_token,
      refresh_token: json.refresh_token,
      expires_at: Date.now() + (json.expires_in - 60) * 1000,
    });
    localStorage.removeItem(VERIFIER_KEY);
    // Strip the ?code= (and any state) from the URL so a refresh doesn't
    // try to re-exchange.
    params.delete('code');
    params.delete('state');
    const search = params.toString();
    const cleanUrl =
      window.location.pathname + (search ? '?' + search : '') + window.location.hash;
    window.history.replaceState({}, '', cleanUrl);
    return true;
  } catch (e) {
    console.warn('[Dropbox auth] exchange error', e);
    return false;
  }
}

async function refreshAccessToken(refresh_token: string): Promise<string | null> {
  const appKey = getDropboxAppKey();
  if (!appKey) return null;
  const body = new URLSearchParams();
  body.set('grant_type', 'refresh_token');
  body.set('refresh_token', refresh_token);
  body.set('client_id', appKey);
  try {
    const res = await fetch('https://api.dropboxapi.com/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { access_token: string; expires_in: number };
    saveTokens({
      access_token: json.access_token,
      refresh_token,
      expires_at: Date.now() + (json.expires_in - 60) * 1000,
    });
    return json.access_token;
  } catch {
    return null;
  }
}

async function getValidAccessToken(): Promise<string | null> {
  const t = loadTokens();
  if (!t) return null;
  if (Date.now() < t.expires_at) return t.access_token;
  if (!t.refresh_token) return null;
  return refreshAccessToken(t.refresh_token);
}

// ---- Folder browser -------------------------------------------------------

export interface DropboxFolderEntry {
  name: string;
  /** Dropbox-internal absolute path, e.g. "/My Cases" */
  path: string;
}

/** List the immediate sub-folders of the given path. Pass "" for the root
 *  of the user's Dropbox (or the app folder root, for app-folder apps). */
export async function listDropboxFolders(
  parentPath: string = '',
): Promise<DropboxFolderEntry[]> {
  const token = await getValidAccessToken();
  if (!token) return [];
  try {
    const res = await fetch('https://api.dropboxapi.com/2/files/list_folder', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ path: parentPath, recursive: false }),
    });
    if (!res.ok) {
      console.warn(
        '[Dropbox folders] list failed',
        res.status,
        await res.text().catch(() => ''),
      );
      return [];
    }
    const json = (await res.json()) as {
      entries: Array<{ '.tag': string; name: string; path_display: string }>;
    };
    return json.entries
      .filter((e) => e['.tag'] === 'folder')
      .map((e) => ({ name: e.name, path: e.path_display }));
  } catch (e) {
    console.warn('[Dropbox folders] error', e);
    return [];
  }
}

// ---- Upload + share -------------------------------------------------------

function safeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_').slice(0, 200) || 'file';
}

function toDropboxApiArgHeader(value: unknown): string {
  // The browser enforces Latin-1 for header values. Escape non-ASCII chars
  // so Hebrew/Arabic filenames can still be sent safely in Dropbox-API-Arg.
  return JSON.stringify(value).replace(/[\u007f-\uffff]/g, (ch) =>
    `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
}

export type DropboxUploadResult =
  | { ok: true; path: string; url: string }
  | { ok: false; error: string };

export async function uploadFileToDropbox(
  file: File,
  hint: {
    caseId?: string;
    clientId?: string;
    /** Resolved client + case used to build the nested folder tree and the
     *  numbered filename. When provided, takes precedence over caseId/clientId. */
    client?: Client | null;
    caseObj?: Case | null;
    lang?: Lang;
    /** Unique running document id (e.g. "DOC-001") appended before the
     *  extension to guarantee a collision-free filename. */
    docId?: string;
  } = {},
): Promise<DropboxUploadResult> {
  const token = await getValidAccessToken();
  if (!token) {
    return {
      ok: false,
      error: 'Dropbox token missing/expired. Please reconnect Dropbox.',
    };
  }

  const base = getDropboxFolderPath(); // already starts with "/" or ""
  // Normalize: ensure leading "/" and no trailing slashes
  let baseNorm = base.replace(/\/+$/, '');
  // Guard against a doubled "Clients/Clients": if the user picked the
  // app's "Clients" folder itself as the target during connect, strip the
  // trailing segment so we don't append a second one below. Picking the
  // root (base "") and picking "/Clients" now both yield a single Clients.
  baseNorm = baseNorm.replace(new RegExp('/' + FILING_ROOT + '$', 'i'), '');

  // Preferred scheme — nest case inside client and number the file:
  //   <folder>/Clients/CLT-101 - Name/CS-1001 - Title/CLT-101_CS-1001_file
  // Falls back to the legacy flat layout when no client/case object is passed
  // (e.g. the connect-modal diagnostic upload).
  let segments: string[];
  let filename: string;
  if (hint.client || hint.caseObj) {
    segments = filingFolderSegments(hint.client, hint.caseObj, hint.lang ?? 'he');
    filename = filingFileName(hint.client, hint.caseObj, file.name, hint.docId);
  } else {
    const subdir = hint.caseId || hint.clientId || 'misc';
    segments = [safeFilename(subdir)];
    filename = `${Date.now()}-${safeFilename(file.name)}`;
  }
  const path = `${baseNorm || ''}/${FILING_ROOT}/${segments.join('/')}/${filename}`;

  let finalPath: string;
  try {
    const res = await fetch('https://content.dropboxapi.com/2/files/upload', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/octet-stream',
        'Dropbox-API-Arg': toDropboxApiArgHeader({
          path,
          mode: 'add',
          autorename: true,
          mute: true,
        }),
      },
      body: file,
    });
    if (!res.ok) {
      const bodyText = await res.text().catch(() => '');
      console.warn(
        '[Dropbox upload] failed',
        res.status,
        bodyText,
      );
      const scopeError =
        /required[_ ]scope|missing_scope|not permitted to access this endpoint|insufficient_scope|files\.content\.write/i.test(bodyText);
      if (scopeError) {
        // Token doesn't carry the new scope. Drop it so the next reconnect
        // is forced to mint a fresh one rather than reusing the bad token.
        if (typeof window !== 'undefined') {
          localStorage.removeItem(TOKEN_KEY);
        }
        return {
          ok: false,
          error:
            'Dropbox app is missing required upload permission (files.content.write). Enable it in App Console > Permissions, then reconnect Dropbox to issue a new token.',
        };
      }
      return {
        ok: false,
        error: `Dropbox upload failed (${res.status}): ${bodyText || 'unknown error'}`,
      };
    }
    const json = (await res.json()) as { path_lower?: string; path_display?: string };
    finalPath = json.path_lower || json.path_display || path;
  } catch (e) {
    console.warn('[Dropbox upload] error', e);
    return {
      ok: false,
      error: `Dropbox upload error: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  let url = '';
  try {
    const res = await fetch(
      'https://api.dropboxapi.com/2/sharing/create_shared_link_with_settings',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          path: finalPath,
          settings: {
            requested_visibility: 'public',
            audience: 'public',
            access: 'viewer',
          },
        }),
      },
    );
    if (res.ok) {
      const json = (await res.json()) as { url?: string };
      url = json.url || '';
    } else if (res.status === 409) {
      const listRes = await fetch(
        'https://api.dropboxapi.com/2/sharing/list_shared_links',
        {
          method: 'POST',
          headers: {
            Authorization: 'Bearer ' + token,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ path: finalPath, direct_only: true }),
        },
      );
      if (listRes.ok) {
        const json = (await listRes.json()) as { links?: { url?: string }[] };
        url = json.links?.[0]?.url || '';
      }
    }
  } catch (e) {
    console.warn('[Dropbox share] error', e);
  }

  return { ok: true, path: finalPath, url };
}

/** Turn a Dropbox SHARE link (…?dl=0 or …?dl=1) into a RAW content URL the
 *  browser renders INLINE — PDFs/images display in the tab instead of being
 *  downloaded or shown on Dropbox's preview page. Sets `raw=1` and drops `dl`.
 *  Non-Dropbox URLs are returned unchanged. */
export function dropboxRawUrl(shareUrl: string): string {
  try {
    const u = new URL(shareUrl);
    if (!/(^|\.)dropbox\.com$/i.test(u.hostname) &&
        !/(^|\.)dropboxusercontent\.com$/i.test(u.hostname)) {
      return shareUrl;
    }
    u.searchParams.delete('dl');
    u.searchParams.set('raw', '1');
    return u.toString();
  } catch {
    return shareUrl;
  }
}

/** Convert a stored local filing path (e.g. "Clients/clt-108/CS-1009 - X/f.pdf"
 *  or a legacy "/clients/.../f.pdf") into the Dropbox API path inside the
 *  connected app folder, so a device with no local disk access (mobile) can
 *  fetch the same file from the cloud. Mirrors the path scheme used on upload. */
export function dropboxPathForRelative(relativePath: string): string {
  const rp = (relativePath || '').replace(/^\/+/, ''); // drop any leading slash
  let base = getDropboxFolderPath().replace(/\/+$/, '');
  // Same double-"Clients" guard the uploader uses.
  base = base.replace(new RegExp('/' + FILING_ROOT + '$', 'i'), '');
  return `${base}/${rp}`.replace(/\/{2,}/g, '/');
}

/** Download a file's raw bytes from Dropbox as a Blob (via the content API the
 *  uploader already uses, so CORS is allowed). Used to PREVIEW a document
 *  inline — a blob: URL renders in the browser instead of downloading, unlike
 *  the temporary link which Dropbox serves as an attachment. Returns null when
 *  Dropbox isn't connected or the path isn't found. */
export async function downloadDropboxFileBlob(path: string): Promise<Blob | null> {
  const token = await getValidAccessToken();
  if (!token) return null;
  try {
    const res = await fetch('https://content.dropboxapi.com/2/files/download', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + token,
        'Dropbox-API-Arg': toDropboxApiArgHeader({ path }),
      },
    });
    if (!res.ok) {
      console.warn(
        '[Dropbox download] failed',
        res.status,
        await res.text().catch(() => ''),
      );
      return null;
    }
    return await res.blob();
  } catch (e) {
    console.warn('[Dropbox download] error', e);
    return null;
  }
}

/** Get a short-lived direct link to a file in Dropbox (used to open/download a
 *  document on mobile, where the file isn't on the local disk). Returns null
 *  when Dropbox isn't connected or the path isn't found. */
export async function getDropboxTemporaryLink(
  path: string,
): Promise<string | null> {
  const token = await getValidAccessToken();
  if (!token) return null;
  try {
    const res = await fetch(
      'https://api.dropboxapi.com/2/files/get_temporary_link',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ path }),
      },
    );
    if (!res.ok) {
      console.warn(
        '[Dropbox temp link] failed',
        res.status,
        await res.text().catch(() => ''),
      );
      return null;
    }
    const json = (await res.json()) as { link?: string };
    return json.link || null;
  } catch (e) {
    console.warn('[Dropbox temp link] error', e);
    return null;
  }
}

/** True when running in a browser that supports the File System Access API
 *  (desktop Chrome/Edge/Brave). Used to branch desktop vs mobile flows. */
export function isFileSystemAccessAvailable(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}
