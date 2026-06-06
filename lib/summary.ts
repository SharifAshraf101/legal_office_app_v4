// Document-summary fetcher (client side).
//
// Calls our own /api/summary route, which queries the Cloudflare D1
// `file_summary` table server-side (keeping the D1 token off the client)
// and returns JSON { he, ar }. Used by the case-brain "פענוח המסמך" card.
//
// D1 keys summaries by the SAVED (renamed) file name for app uploads
// (CLT-101_CS-1001_..._DOC-004.pdf) but by the ORIGINAL name for older
// rows, so we pass both plus the caseId fallback.
//
// Returns the active-language summary (falling back to the other language
// if one is missing), or null when nothing is found / the request fails.

import type { Lang } from '@/types';

export async function fetchDocumentSummary(
  opts: { renamed?: string; original?: string; caseId?: string },
  lang: Lang,
): Promise<string | null> {
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
    const primary = lang === 'ar' ? data.ar : data.he;
    const fallback = lang === 'ar' ? data.he : data.ar;
    return (primary || fallback || '').trim() || null;
  } catch {
    return null;
  }
}
