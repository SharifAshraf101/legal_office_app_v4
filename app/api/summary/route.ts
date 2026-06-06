import { NextResponse } from 'next/server';

/**
 * Document-summary lookup.
 *
 * The summaries live in a Cloudflare D1 database (legal-docs-db), table
 * `file_summary`, with per-language columns `summary_he` / `summary_ar`,
 * keyed by `file_name` (and `case_id` / `client_id`). D1 can't be queried
 * from the browser, so this server route hits the D1 HTTP API with a token
 * that stays server-side (same pattern as /api/bot).
 *
 * GET /api/summary?file=<fileName>&caseId=<CS-xxxx>
 * → { he: <summary_he>, ar: <summary_ar> }
 *
 * Matches by file_name first, then case_id (case-insensitive — D1 stores
 * e.g. "cs-1001" while the app uses "CS-1001"). Returns empty strings when
 * not configured / not found, so the UI falls back to its placeholder.
 *
 * Required server env vars:
 *   CLOUDFLARE_ACCOUNT_ID
 *   CLOUDFLARE_D1_DATABASE_ID
 *   CLOUDFLARE_API_TOKEN   (D1 read permission)
 */
export const runtime = 'nodejs';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  // `file`  = the renamed saved file name (e.g. CLT-101_CS-1001_..._DOC-004.pdf)
  // `orig`  = the original file name (for rows keyed by the un-renamed name)
  const file = (searchParams.get('file') || '').trim();
  const orig = (searchParams.get('orig') || '').trim();
  const caseId = (searchParams.get('caseId') || '').trim();
  if (!file && !orig && !caseId) return NextResponse.json({ he: '', ar: '' });

  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  const dbId = process.env.CLOUDFLARE_D1_DATABASE_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!account || !dbId || !token) {
    return NextResponse.json({ he: '', ar: '', error: 'not_configured' });
  }

  // Match the renamed saved name first, then the original name, then fall
  // back to a case-insensitive case_id PREFIX match (D1 stores case_id as
  // e.g. "cs-1001 - מזונות ילדים" while the app passes "CS-1001"). The
  // fallback returns the NEWEST row for the case (id DESC) so the box
  // reflects the latest filed document.
  const sql =
    'SELECT summary_he, summary_ar FROM file_summary ' +
    "WHERE file_name = ?1 OR file_name = ?2 OR lower(case_id) LIKE lower(?3) || '%' " +
    'ORDER BY (file_name = ?1) DESC, (file_name = ?2) DESC, id DESC LIMIT 1';

  try {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${dbId}/query`,
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ sql, params: [file, orig, caseId] }),
      },
    );
    if (!res.ok) {
      return NextResponse.json({ he: '', ar: '' });
    }
    const json = (await res.json()) as {
      result?: Array<{ results?: Array<{ summary_he?: string; summary_ar?: string }> }>;
    };
    const row = json?.result?.[0]?.results?.[0];
    return NextResponse.json({
      he: row?.summary_he || '',
      ar: row?.summary_ar || '',
    });
  } catch {
    return NextResponse.json({ he: '', ar: '' });
  }
}
