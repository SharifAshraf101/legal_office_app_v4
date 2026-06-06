// Document-summary fetcher.
//
// Fetches a per-document summary from a Cloudflare endpoint, keyed by file
// name, for the case-brain "פענוח המסמך" card. Configure the endpoint base
// URL via the env var NEXT_PUBLIC_CLOUDFLARE_SUMMARY_URL.
//
// Request:  GET {base}?file=<encodeURIComponent(fileName)>
// Response: JSON { "he": "...", "ar": "..." }
//
// The active-language field is returned (falling back to the other language
// if one is missing). Returns null when the env var is unset, the file name
// is empty, or the request fails — callers should fall back to their own
// placeholder text in that case, so nothing breaks when Cloudflare is not
// configured.

import type { Lang } from '@/types';

export async function fetchDocumentSummary(
  fileName: string | undefined,
  lang: Lang,
): Promise<string | null> {
  const base = (process.env.NEXT_PUBLIC_CLOUDFLARE_SUMMARY_URL || '').trim();
  if (!base || !fileName) return null;
  const sep = base.includes('?') ? '&' : '?';
  const url = `${base}${sep}file=${encodeURIComponent(fileName)}`;
  try {
    const res = await fetch(url, { method: 'GET' });
    if (!res.ok) return null;
    const data = (await res.json()) as { he?: string; ar?: string };
    const primary = lang === 'ar' ? data.ar : data.he;
    const fallback = lang === 'ar' ? data.he : data.ar;
    return (primary || fallback || '').trim() || null;
  } catch {
    return null;
  }
}
