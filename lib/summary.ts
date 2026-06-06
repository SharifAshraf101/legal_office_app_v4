// Document-summary fetcher (client side).
//
// Calls our own /api/summary route, which queries the Cloudflare D1
// `file_summary` table server-side (keeping the D1 token off the client)
// and returns JSON { he, ar }. Used by the case-brain "פענוח המסמך" card
// and the case-documents screen.
//
// D1 keys summaries by the SAVED (renamed) file name for app uploads
// (CLT-101_CS-1001_..._DOC-004.pdf) but by the ORIGINAL name for older
// rows, so we pass both. `caseId` is an optional fallback (returns the
// newest summary for the case) — omit it for per-document lookups that
// must resolve to a specific file only.

import type { Lang } from '@/types';

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
    // Trailing slash matches next.config `trailingSlash: true` (avoids a
    // 308 redirect round-trip).
    const res = await fetch('/api/summary/?' + params.toString(), {
      method: 'GET',
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
