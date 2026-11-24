import { NextRequest, NextResponse } from 'next/server';
import { isValidOfficeSession } from '@/lib/serverAuth';

export const runtime = 'nodejs';

// Legacy proxy for the WhatsApp message poll. The chat now reads straight from
// the Worker with the office's own session (so each office sees only its own
// conversations); this route stays for older clients but answers ONLY a
// logged-in office — it used to return any phone's whole conversation to
// anyone who knew the number.

const WORKER_URL =
  process.env.NEXT_PUBLIC_WORKER_URL ||
  'https://legal-office-api-v4.sharifashraf.workers.dev';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ phone: string }> },
) {
  const authorization = req.headers.get('authorization') || '';
  if (!(await isValidOfficeSession(authorization))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const { phone } = await params;
  const clean = String(phone || '').replace(/\D/g, '');
  if (!clean) return NextResponse.json({ messages: [] });
  try {
    // With the CALLER'S OWN session — never the system token. The Worker then
    // answers from the caller's office; with the system token every logged-in
    // office received the operator office's conversation.
    const res = await fetch(`${WORKER_URL}/api/whatsapp-messages/${clean}`, {
      headers: { Authorization: authorization },
    });
    const data = await res.json().catch(() => ({ messages: [] }));
    return NextResponse.json(data, { status: res.ok ? 200 : res.status });
  } catch {
    return NextResponse.json({ messages: [] }, { status: 502 });
  }
}
