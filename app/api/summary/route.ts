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

  const d1 = async (sql: string, params: unknown[]) => {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${dbId}/query`,
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ sql, params }),
      },
    );
    if (!res.ok) return null;
    const json = (await res.json()) as {
      result?: Array<{ results?: Array<Record<string, string>> }>;
    };
    return json?.result?.[0]?.results?.[0] || null;
  };

  try {
    // 1. Decisions table — for a ruling document, its `decision_summary` is
    //    the authoritative content, so it takes precedence. Matched by the
    //    document_name (the renamed saved name, then the original).
    const decRow = await d1(
      'SELECT decision_summary FROM decisions WHERE document_name = ?1 OR document_name = ?2 LIMIT 1',
      [file, orig],
    );
    const decision = (decRow?.decision_summary || '').trim();
    if (decision) {
      // Single-language ruling text — return it for both so it shows
      // regardless of the app language.
      return NextResponse.json({ he: decision, ar: decision, isDecision: true });
    }

    // 2. file_summary — match renamed name, then original, then a
    //    case-insensitive case_id PREFIX (D1 stores "cs-1001 - …" while the
    //    app passes "CS-1001"). The case_id branch is guarded by `?3 <> ''`
    //    so a per-document lookup (no caseId) matches by exact file name
    //    only and never falls back to an unrelated row. id DESC makes the
    //    case_id fallback return the newest row.
    const row = await d1(
      'SELECT summary_he, summary_ar, language FROM file_summary ' +
        "WHERE file_name = ?1 OR file_name = ?2 OR (?3 <> '' AND lower(case_id) LIKE lower(?3) || '%') " +
        'ORDER BY (file_name = ?1) DESC, (file_name = ?2) DESC, id DESC LIMIT 1',
      [file, orig, caseId],
    );
    return NextResponse.json({
      he: row?.summary_he || '',
      ar: row?.summary_ar || '',
      // The document's own language ("ar" / "he"), so the UI can show the
      // summary in the language the document is written in.
      language: (row?.language || '').toLowerCase(),
    });
  } catch {
    return NextResponse.json({ he: '', ar: '' });
  }
}
