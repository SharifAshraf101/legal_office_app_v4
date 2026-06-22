import { NextRequest, NextResponse } from 'next/server';

const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || 'sharif_law_office_2026';
const WORKER_URL = 'https://legal-office-api.sharifashraf.workers.dev';
const APP_TOKEN = '12a52ef1036713e388ecf0ff7e64929dc45c147a4cb20967';

export async function GET(req: NextRequest) {
  const searchParams = new URL(req.url).searchParams;
  const mode = searchParams.get('hub.mode');
  const token = searchParams.get('hub.verify_token');
  const challenge = searchParams.get('hub.challenge');

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    return new NextResponse(challenge, { status: 200 });
  }
  return new NextResponse('Forbidden', { status: 403 });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const message = body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

  console.log('Webhook received:', JSON.stringify(body).slice(0, 200));

  if (message) {
    const from = message.from;
    const timestamp = parseInt(message.timestamp) * 1000;

    let messageType = 'text';
    let messageText = '';
    let mediaId: string | null = null;
    let mediaMimeType: string | null = null;
    let fileName: string | null = null;

    if (message.text) {
      messageType = 'text';
      messageText = message.text.body || '';
    } else if (message.audio) {
      messageType = 'audio';
      mediaId = message.audio.id;
      mediaMimeType = message.audio.mime_type || 'audio/ogg';
      messageText = '[הודעה קולית]';
    } else if (message.image) {
      messageType = 'image';
      mediaId = message.image.id;
      mediaMimeType = message.image.mime_type || 'image/jpeg';
      messageText = '[תמונה]';
    } else if (message.document) {
      messageType = 'document';
      mediaId = message.document.id;
      mediaMimeType = message.document.mime_type || 'application/pdf';
      fileName = message.document.filename || 'document';
      messageText = `[מסמך: ${fileName}]`;
    } else if (message.video) {
      messageType = 'video';
      mediaId = message.video.id;
      mediaMimeType = message.video.mime_type || 'video/mp4';
      messageText = '[וידאו]';
    }

    console.log('Message from:', from, 'type:', messageType);

    try {
      const res = await fetch(`${WORKER_URL}/api/whatsapp-messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${APP_TOKEN}`,
        },
        body: JSON.stringify({
          client_phone: from,
          direction: 'incoming',
          message_text: messageText,
          timestamp,
          message_type: messageType,
          media_id: mediaId,
          media_mime_type: mediaMimeType,
          file_name: fileName,
        }),
      });
      const data = await res.json();
      console.log('Worker response:', res.status, JSON.stringify(data));
    } catch (e) {
      console.error('Worker fetch failed:', e);
    }
  }

  return NextResponse.json({ status: 'ok' });
}