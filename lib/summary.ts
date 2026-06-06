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

/** Raw { he, ar } summary for a document, or null when nothing matches. */
export async function fetchDocumentSummaryBoth(
  opts: SummaryOpts,
): Promise<{ he: string; ar: string } | null> {
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
    const data = (await res.json()) as { he?: string; ar?: string };
    const he = (data.he || '').trim();
    const ar = (data.ar || '').trim();
    if (!he && !ar) return null;
    return { he, ar };
  } catch {
    return null;
  }
}

/** The active-language summary string (falls back to the other language). */
export async function fetchDocumentSummary(
  opts: SummaryOpts,
  lang: Lang,
): Promise<string | null> {
  const data = await fetchDocumentSummaryBoth(opts);
  if (!data) return null;
  const primary = lang === 'ar' ? data.ar : data.he;
  const fallback = lang === 'ar' ? data.he : data.ar;
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
