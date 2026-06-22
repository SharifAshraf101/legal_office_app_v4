import { NextRequest, NextResponse } from 'next/server';

const WORKER_URL = process.env.NEXT_PUBLIC_WORKER_URL || 'https://legal-office-api.sharifashraf.workers.dev';
const APP_TOKEN = process.env.NEXT_PUBLIC_APP_TOKEN || '';

export async function POST(req: NextRequest) {
  const { to, message } = await req.json();

  // 1 — Send via Meta
  const response = await fetch(
    `https://graph.facebook.com/v19.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: to,
        type: 'text',
        text: { body: message },
      }),
    }
  );

  const data = await response.json();

  // 2 — Save outgoing message to D1
  if (response.ok) {
    await fetch(`${WORKER_URL}/api/whatsapp-messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${APP_TOKEN}`,
      },
      body: JSON.stringify({
        client_phone: to,
        direction: 'outgoing',
        message_text: message,
        timestamp: Date.now(),
        message_type: 'text',
        media_id: null,
        media_mime_type: null,
        file_name: null,
      }),
    });
  }

  return NextResponse.json(data);
}