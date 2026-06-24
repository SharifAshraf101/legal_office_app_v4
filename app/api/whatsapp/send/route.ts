import { NextRequest, NextResponse } from 'next/server';
import { dropboxPathForRelative, getDropboxTemporaryLink } from '@/lib/dropbox';

const WORKER_URL = process.env.NEXT_PUBLIC_WORKER_URL || 'https://legal-office-api.sharifashraf.workers.dev';
const APP_TOKEN = process.env.NEXT_PUBLIC_APP_TOKEN || '';

async function resolveDocumentUrl(document?: { name?: string; url?: string; relativePath?: string }) {
  if (!document) return undefined;

  if (typeof document.url === 'string' && document.url.trim()) {
    return document.url.trim();
  }

  const relativePath = document.relativePath?.trim();
  if (!relativePath) return undefined;

  if (/^https?:\/\//i.test(relativePath) || /^data:/i.test(relativePath)) {
    return relativePath;
  }

  const path = dropboxPathForRelative(relativePath);
  const tempLink = await getDropboxTemporaryLink(path);
  return tempLink || undefined;
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { to, message, document } = body as {
    to: string;
    message?: string;
    document?: { name?: string; url?: string; relativePath?: string };
  };

  if (!to) {
    return NextResponse.json({ error: 'Missing recipient phone number' }, { status: 400 });
  }

  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!phoneNumberId || !accessToken) {
    return NextResponse.json(
      { error: 'WhatsApp credentials are not configured' },
      { status: 500 },
    );
  }

  const resolvedDocumentUrl = await resolveDocumentUrl(document);
  const isDocument = Boolean(resolvedDocumentUrl);
  const finalPayload = isDocument
    ? {
        messaging_product: 'whatsapp',
        to,
        type: 'document',
        document: {
          link: resolvedDocumentUrl,
          filename: document?.name || 'document',
          caption: message || undefined,
        },
      }
    : {
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body: message || '' },
      };

  console.log('[WhatsApp send]', { isDocument, finalPayload });

  // 1 — Send via Meta
  let response: Response;
  try {
    response = await fetch(
      `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(finalPayload),
      },
    );
  } catch (error) {
    console.error('[WhatsApp send] network error', error);
    return NextResponse.json({ error: 'Failed to reach WhatsApp API' }, { status: 502 });
  }

  const text = await response.text();
  let data: any = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  // 2 — Save outgoing message to D1
  if (!response.ok) {
    console.error('[WhatsApp send] Meta responded with error', data);
    return NextResponse.json({ error: 'WhatsApp send failed', details: data }, { status: response.status });
  }

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
        message_text: message || (document ? `📎 ${document.name || 'document'}` : ''),
        timestamp: Date.now(),
        message_type: isDocument ? 'document' : 'text',
        media_url: resolvedDocumentUrl || document?.url || null,
        media_id: null,
        media_mime_type: null,
        file_name: document?.name || null,
      }),
    });
  }

  return NextResponse.json(data);
}