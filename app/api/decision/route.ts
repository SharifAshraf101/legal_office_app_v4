import { NextResponse } from 'next/server';

/**
 * Decision-derived task + hearing lookup.
 *
 * When a ruling document is analysed, Cloudflare D1 records the decision
 * (decisions), the task it imposes (tasks: task_description, due_date) and
 * the hearing it sets (hearings: hearing_date), all linked by decision_id /
 * client_id. This route returns that task + hearing for the decision that
 * matches a document (by its renamed document_name) or, failing that, the
 * latest decision for the client.
 *
 * GET /api/decision?file=<renamed doc name>&clientId=<CLT-xxx>
 * → { taskDescription, taskDueDate, hearingDate }
 *
 * Uses the same server-side D1 token as /api/summary.
 */
export const runtime = 'nodejs';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const file = (searchParams.get('file') || '').trim();
  const clientId = (searchParams.get('clientId') || '').trim();
  if (!file && !clientId) return NextResponse.json({});

  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  const dbId = process.env.CLOUDFLARE_D1_DATABASE_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!account || !dbId || !token) {
    return NextResponse.json({ error: 'not_configured' });
  }

  const sql =
    'SELECT t.task_description AS taskDescription, t.due_date AS taskDueDate, ' +
    'h.hearing_date AS hearingDate ' +
    'FROM decisions d ' +
    'LEFT JOIN tasks t ON t.decision_id = d.id ' +
    'LEFT JOIN hearings h ON h.decision_id = d.id ' +
    "WHERE d.document_name = ?1 OR (?2 <> '' AND d.client_id = ?2) " +
    'ORDER BY (d.document_name = ?1) DESC, d.created_at DESC LIMIT 1';

  try {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${dbId}/query`,
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ sql, params: [file, clientId] }),
      },
    );
    if (!res.ok) return NextResponse.json({});
    const json = (await res.json()) as {
      result?: Array<{
        results?: Array<{
          taskDescription?: string;
          taskDueDate?: string;
          hearingDate?: string;
        }>;
      }>;
    };
    const row = json?.result?.[0]?.results?.[0] || {};
    return NextResponse.json({
      taskDescription: (row.taskDescription || '').trim(),
      taskDueDate: (row.taskDueDate || '').trim(),
      hearingDate: (row.hearingDate || '').trim(),
    });
  } catch {
    return NextResponse.json({});
  }
}
