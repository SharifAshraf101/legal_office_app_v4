import { NextResponse } from 'next/server';
import { forwardAuth, workerBase } from '@/lib/serverAuth';

/**
 * Decision-derived task + hearing lookup.
 *
 * A ruling document imposes a task (description + due date) and often sets a
 * hearing. This route returns them for the document that matches `file`, or
 * failing that the latest decision of `caseId` — falling back to the client's
 * latest decision ONLY when no case was named. Passing `caseId` matters: a
 * client has several open cases, and the caller files whatever comes back onto
 * the case it asked about, so a client-wide answer put one case's hearing date
 * on another case of the same client.
 *
 * MULTI-TENANT: the lookup runs on the Worker's `GET /api/decision`, against
 * whichever office database the CALLER's session resolves to. This route holds
 * no database id and no operator token — it only forwards the caller's own
 * `Authorization` header. (It used to query a hard-coded D1 id, so every office
 * read the operator's decisions.)
 *
 * GET /api/decision?file=<renamed doc name>&clientId=<CLT-xxx>&caseId=<CS-xxxx>
 *   headers: Authorization: Bearer <office session token>
 * → { taskDescription, taskDueDate, hearingDate }
 *
 * Env: NEXT_PUBLIC_WORKER_URL.
 */
export const runtime = 'nodejs';

const EMPTY = { taskDescription: '', taskDueDate: '', hearingDate: '' };

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const file = (searchParams.get('file') || '').trim();
  const clientId = (searchParams.get('clientId') || '').trim();
  const caseId = (searchParams.get('caseId') || '').trim();
  if (!file && !clientId && !caseId) return NextResponse.json(EMPTY);

  const auth = forwardAuth(req);
  if (!auth) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const workerUrl = workerBase();
  if (!workerUrl) {
    return NextResponse.json({ error: 'worker_unconfigured' }, { status: 500 });
  }

  const params = new URLSearchParams();
  if (file) params.set('file', file);
  if (clientId) params.set('clientId', clientId);
  if (caseId) params.set('caseId', caseId);

  try {
    const res = await fetch(`${workerUrl}/api/decision?${params.toString()}`, {
      headers: { Authorization: auth },
      cache: 'no-store',
    });
    if (res.status === 401) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    if (!res.ok) return NextResponse.json(EMPTY);
    const data = (await res.json().catch(() => ({}))) as Partial<typeof EMPTY>;
    return NextResponse.json({
      taskDescription: (data.taskDescription || '').trim(),
      taskDueDate: (data.taskDueDate || '').trim(),
      hearingDate: (data.hearingDate || '').trim(),
    });
  } catch {
    return NextResponse.json(EMPTY);
  }
}
