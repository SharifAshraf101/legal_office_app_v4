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
const APP_TOKEN = process.env.APP_TOKEN || process.env.NEXT_PUBLIC_APP_TOKEN || '';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ phone: string }> },
) {
  if (!(await isValidOfficeSession(req.headers.get('authorization') || ''))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const { phone } = await params;
  const clean = String(phone || '').replace(/\D/g, '');
  if (!clean) return NextResponse.json({ messages: [] });
  try {
    const res = await fetch(`${WORKER_URL}/api/whatsapp-messages/${clean}`, {
      headers: { Authorization: `Bearer ${APP_TOKEN}` },
    });
    const data = await res.json().catch(() => ({ messages: [] }));
    return NextResponse.json(data, { status: res.ok ? 200 : res.status });
  } catch {
    return NextResponse.json({ messages: [] }, { status: 502 });
  }
}
