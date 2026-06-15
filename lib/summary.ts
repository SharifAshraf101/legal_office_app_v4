// Document-summary fetcher (client side).
//
// Calls the Cloudflare Worker's /api/file-summary endpoint, which reads the D1
// `file_summary` table — the SINGLE source of truth for document summaries
// (they are NOT duplicated onto the documents row). Used by the case-brain
// "פענוח המסמך" card and the case-documents screen.
//
// D1 keys summaries by the SAVED (renamed) file name for app uploads
// (CLT-101_CS-1001_..._DOC-004.pdf) but by the ORIGINAL name for older
// rows, so we pass both. `caseId` is an optional fallback (returns the
// newest summary for the case) — omit it for per-document lookups that
// must resolve to a specific file only.

import type { Lang } from '@/types';
import { dropboxPathForRelative, getDropboxTemporaryLink } from './dropbox';

// Same Worker config the rest of the app uses (see lib/cloudflare.ts).
const WORKER_URL = (process.env.NEXT_PUBLIC_WORKER_URL || '').replace(/\/$/, '');
const APP_TOKEN = process.env.NEXT_PUBLIC_APP_TOKEN || '';

// Persisted "already attempted on-demand generation" set, so a slow/costly
// Claude generation (summary or draft) for a given document is tried at most
// ONCE per browser — not re-fired every time the case-brain modal re-opens.
// Mirrors loadDecisionImportKeys/rememberDecisionImportKey in lib/tasks.ts.
// Keys are `summary:<DOC-id>` / `draft:<DOC-id>`.
const GEN_ATTEMPTS_LS = 'law_gen_attempts_v1';

/** Load the persisted set of documents already attempted for generation. */
export function loadGenAttempts(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = localStorage.getItem(GEN_ATTEMPTS_LS);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

/** Mark a generation key as attempted (in memory + persisted). */
export function rememberGenAttempt(set: Set<string>, key: string): void {
  set.add(key);
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(GEN_ATTEMPTS_LS, JSON.stringify([...set]));
  } catch {
    /* ignore quota / serialization errors */
  }
}

export interface SummaryOpts {
  renamed?: string;
  original?: string;
  caseId?: string;
}

/** Raw { he, ar, language } summary for a document, or null when nothing
 *  matches. `language` is the document's own language ("ar" / "he" / ""). */
export async function fetchDocumentSummaryBoth(
  opts: SummaryOpts,
): Promise<{ he: string; ar: string; language: string } | null> {
  const { renamed, original, caseId } = opts;
  if (!renamed && !original && !caseId) return null;
  const params = new URLSearchParams();
  if (renamed) params.set('file', renamed);
  if (original) params.set('orig', original);
  if (caseId) params.set('caseId', caseId);
  try {
    const res = await fetch(
      WORKER_URL + '/api/file-summary?' + params.toString(),
      {
        method: 'GET',
        headers: { Authorization: 'Bearer ' + APP_TOKEN },
      },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      he?: string;
      ar?: string;
      language?: string;
    };
    const he = (data.he || '').trim();
    const ar = (data.ar || '').trim();
    if (!he && !ar) return null;
    return { he, ar, language: (data.language || '').toLowerCase() };
  } catch {
    return null;
  }
}

/** Generate a summary for a PDF document that has none yet: obtain a temporary
 *  Dropbox link for it, hand that to /api/generate-summary (which fetches the
 *  PDF server-side, asks Claude, and stores the result in file_summary), then
 *  return the summary. Returns null when generation isn't possible — not a PDF,
 *  Dropbox not connected, or an error. Used as a fallback when no pre-existing
 *  summary is found, so summaries appear for every case, not only the ones the
 *  external pipeline processed. */
export async function generateDocumentSummary(opts: {
  /** Stored relative path, used to locate the file in Dropbox. */
  relativePath?: string;
  /** Renamed file name (CLT-…_CS-…_…_DOC-NNN.pdf) — the file_summary key. */
  fileName: string;
  clientId?: string;
  caseId?: string;
}): Promise<{ he: string; ar: string; language: string } | null> {
  const { relativePath, fileName, clientId, caseId } = opts;
  if (!relativePath || !/\.pdf$/i.test(fileName)) return null;
  let fileUrl: string | null = null;
  try {
    fileUrl = await getDropboxTemporaryLink(dropboxPathForRelative(relativePath));
  } catch {
    fileUrl = null;
  }
  if (!fileUrl) return null;
  try {
    // Trailing slash matches next.config `trailingSlash: true` (avoids a 308).
    const res = await fetch('/api/generate-summary/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileUrl, fileName, clientId, caseId }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      he?: string;
      ar?: string;
      language?: string;
    };
    const he = (data.he || '').trim();
    const ar = (data.ar || '').trim();
    if (!he && !ar) return null;
    return { he, ar, language: (data.language || '').toLowerCase() };
  } catch {
    return null;
  }
}

/** Summary string in the DOCUMENT's own language (Arabic doc → Arabic
 *  summary, Hebrew doc → Hebrew summary). Falls back to the app `lang` when
 *  the document language is unknown, then to whichever summary exists. */
export async function fetchDocumentSummary(
  opts: SummaryOpts,
  lang: Lang,
): Promise<string | null> {
  const data = await fetchDocumentSummaryBoth(opts);
  if (!data) return null;
  return pickDocumentLanguageSummary(data, lang);
}

/** Choose the summary in the document's own language. */
export function pickDocumentLanguageSummary(
  data: { he: string; ar: string; language?: string },
  appLang: Lang,
): string | null {
  const docLang = (data.language || '').toLowerCase();
  let primary: string;
  let fallback: string;
  if (docLang === 'ar') {
    primary = data.ar;
    fallback = data.he;
  } else if (docLang === 'he') {
    primary = data.he;
    fallback = data.ar;
  } else {
    // Unknown document language — fall back to the app language.
    primary = appLang === 'ar' ? data.ar : data.he;
    fallback = appLang === 'ar' ? data.he : data.ar;
  }
  return (primary || fallback || '').trim() || null;
}

/** Reply-draft text for a case's document, from the D1 `drafts` table (written
 *  by the Make pipeline). Fetches the case's drafts and prefers the one whose
 *  `document_source_id` matches the given document (the one shown in the
 *  "פענוח המסמך" box), falling back to the newest.
 *
 *  `preferLang` is the language the "פענוח המסמך" box renders in (the
 *  document's language). When given, the draft is copied VERBATIM from the
 *  matching column — `draft_ar` for an Arabic document, `draft_he` for a Hebrew
 *  one (falling back to the other column only if the requested one is empty).
 *  No transformation/translation — pure copy. Used by the "טיוטת תגובה" card. */
export async function fetchDocumentDraft(
  opts: { caseId?: string; documentId?: string; preferLang?: 'ar' | 'he' | null },
  lang: Lang,
): Promise<string | null> {
  const { caseId, documentId, preferLang } = opts;
  if (!caseId && !documentId) return null;
  const params = new URLSearchParams();
  // Filter to THIS specific document when we know it, so the card shows the
  // draft for the SAME document the "פענוח" box decodes — never another
  // document's draft. Only fall back to the case scope when no document id.
  if (documentId) params.set('documentId', documentId);
  else if (caseId) params.set('caseId', caseId);
  try {
    const res = await fetch(WORKER_URL + '/api/drafts?' + params.toString(), {
      method: 'GET',
      headers: { Authorization: 'Bearer ' + APP_TOKEN },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      drafts?: Array<{
        document_source_id?: string;
        draft_he?: string;
        draft_ar?: string;
        language?: string;
      }>;
    };
    const rows = data.drafts || [];
    if (rows.length === 0) return null;
    // The endpoint already filtered to this document (or the case when no
    // document id), so the first row is the right one — no cross-document
    // guessing.
    const row = rows[0];
    const he = (row.draft_he || '').trim();
    const ar = (row.draft_ar || '').trim();
    // Match the "פענוח" box language exactly: copy the matching column as-is.
    if (preferLang === 'ar') return ar || he || null;
    if (preferLang === 'he') return he || ar || null;
    // Document language unknown — fall back to the draft row's own language.
    return pickDocumentLanguageSummary(
      { he, ar, language: (row.language || '').toLowerCase() },
      lang,
    );
  } catch {
    return null;
  }
}

/** Generate a reply draft for a PDF document that has none yet: obtain a
 *  temporary Dropbox link and hand it to /api/generate-draft (which fetches the
 *  PDF server-side and forwards it to the Worker's /api/draft → Claude → saves
 *  it in `drafts`). Returns true when a draft was produced. Used by the
 *  case-brain to fill the "טיוטת תגובה" card for the last document on demand. */
export async function generateDocumentDraft(opts: {
  relativePath?: string;
  fileName: string;
  clientId?: string;
  caseId?: string;
  documentId?: string;
}): Promise<boolean> {
  const { relativePath, fileName, clientId, caseId, documentId } = opts;
  if (!relativePath || !/\.pdf$/i.test(fileName)) return false;
  let fileUrl: string | null = null;
  try {
    fileUrl = await getDropboxTemporaryLink(dropboxPathForRelative(relativePath));
  } catch {
    fileUrl = null;
  }
  if (!fileUrl) return false;
  try {
    const res = await fetch('/api/generate-draft/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileUrl, fileName, clientId, caseId, documentId }),
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { has_draft?: boolean };
    return !!data.has_draft;
  } catch {
    return false;
  }
}

export interface DecisionInfo {
  taskDescription: string;
  taskDueDate: string;
  hearingDate: string;
}

/** Task + hearing derived from a ruling document, from the Cloudflare D1
 *  decisions/tasks/hearings tables. Matched by the document's renamed name,
 *  falling back to the client's latest decision. */
export async function fetchDecisionInfo(opts: {
  renamed?: string;
  clientId?: string;
}): Promise<DecisionInfo | null> {
  const { renamed, clientId } = opts;
  if (!renamed && !clientId) return null;
  const params = new URLSearchParams();
  if (renamed) params.set('file', renamed);
  if (clientId) params.set('clientId', clientId);
  try {
    const res = await fetch('/api/decision/?' + params.toString(), {
      method: 'GET',
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Partial<DecisionInfo>;
    const info: DecisionInfo = {
      taskDescription: (data.taskDescription || '').trim(),
      taskDueDate: (data.taskDueDate || '').trim(),
      hearingDate: (data.hearingDate || '').trim(),
    };
    return info.taskDescription || info.taskDueDate || info.hearingDate
      ? info
      : null;
  } catch {
    return null;
  }
}
