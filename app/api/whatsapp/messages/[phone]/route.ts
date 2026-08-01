import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

// Server-side proxy for the client portal's WhatsApp message poll.
//
// The portal (/portal) runs in a CLIENT's browser with no office session, so
// rather than shipping the office token to the browser (where anyone could read
// it from the bundle), the portal calls this same-origin route and the token
// stays on the server. This is what lets us keep NO app-token in the client
// bundle at all.

const WORKER_URL =
  process.env.NEXT_PUBLIC_WORKER_URL ||
  'https://legal-office-api-v4.sharifashraf.workers.dev';
const APP_TOKEN = process.env.APP_TOKEN || process.env.NEXT_PUBLIC_APP_TOKEN || '';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ phone: string }> },
) {
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
