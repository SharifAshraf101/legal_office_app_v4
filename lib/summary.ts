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
  if (caseId) params.set('caseId', caseId);
  if (!caseId && documentId) params.set('documentId', documentId);
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
    const match = documentId
      ? rows.find(
          (r) =>
            String(r.document_source_id || '').toUpperCase() ===
            String(documentId).toUpperCase(),
        )
      : undefined;
    const row = match || rows[0];
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
