import { NextRequest, NextResponse } from 'next/server';
import { phonesMatch } from '@/lib/clients';

const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || 'sharif_law_office_2026';
const WORKER_URL = 'https://legal-office-api.sharifashraf.workers.dev';
const APP_TOKEN = '12a52ef1036713e388ecf0ff7e64929dc45c147a4cb20967';

// A new WhatsApp conversation "starts" once the line has been quiet for this
// long. The first incoming message after such a lull is what re-routes a
// known client into their bot (per the office's re-engagement flow).
const SESSION_GAP_MS = 30 * 60 * 1000;

const OFFICE_PHONE = '02-6288479';

// Minimal shape of the client rows returned by the worker's /api/load.
interface ClientRow {
  phone?: string;
  full_name?: string;
  full_name_ar?: string;
}

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

// Latest message timestamp (ms, any direction) already stored for this phone,
// or null when we've never spoken. Used to measure the conversation gap.
async function lastConversationTs(phone: string): Promise<number | null> {
  try {
    const res = await fetch(
      `${WORKER_URL}/api/whatsapp-messages/${encodeURIComponent(phone)}`,
      { headers: { Authorization: `Bearer ${APP_TOKEN}` } },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { messages?: Array<{ timestamp?: number }> };
    const msgs = Array.isArray(data?.messages) ? data.messages : [];
    let max = 0;
    for (const m of msgs) {
      const t = Number(m?.timestamp) || 0;
      if (t > max) max = t;
    }
    return max || null;
  } catch (e) {
    console.error('lastConversationTs failed:', e);
    return null;
  }
}

// All client rows for the configured office, used to resolve a sender's
// phone number to a known client.
async function loadClients(): Promise<ClientRow[]> {
  try {
    const res = await fetch(`${WORKER_URL}/api/load`, {
      headers: { Authorization: `Bearer ${APP_TOKEN}` },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { clients?: ClientRow[] };
    return Array.isArray(data?.clients) ? data.clients : [];
  } catch (e) {
    console.error('loadClients failed:', e);
    return [];
  }
}

// Send a text reply through our own send route so the outgoing message is
// pushed to Meta AND logged to D1 the same way lawyer-sent messages are.
async function sendText(origin: string, to: string, message: string): Promise<void> {
  try {
    await fetch(`${origin}/api/whatsapp/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to, message }),
    });
  } catch (e) {
    console.error('sendText failed:', e);
  }
}

// When a known client re-opens the conversation after a lull, hand them a
// deep link into their own scoped bot; an unknown number gets a polite
// "contact the office" note. Best-effort — never throws into the webhook.
async function routeToBot(req: NextRequest, from: string): Promise<void> {
  const origin = process.env.APP_BASE_URL || new URL(req.url).origin;

  const clients = await loadClients();
  const matches = clients.filter((c) => phonesMatch(c.phone, from));
  const matched = matches.length === 1 ? matches[0] : null;

  if (matched) {
    const name = (matched.full_name || matched.full_name_ar || '').trim();
    const link = `${origin}/portal?phone=${encodeURIComponent(from)}&lang=he`;
    const message =
      `שלום${name ? ' ' + name : ''}, ` +
      `כדי לקבל מידע על התיק שלך — סטטוס, דיונים, תשלומים ומסמכים — ` +
      `היכנס/י לבוט הלקוחות:\n${link}\n\n` +
      `مرحباً، للاطلاع على معلومات ملفك (الحالة، الجلسات، المدفوعات والمستندات) ` +
      `ادخل إلى بوت الموكلين عبر الرابط أعلاه.`;
    await sendText(origin, from, message);
    return;
  }

  // Unknown sender — default "not recognized" reply.
  const message =
    `שלום, מספר הטלפון אינו מזוהה כלקוח במערכת. ` +
    `לפניות נא ליצור קשר עם המשרד: ${OFFICE_PHONE}.\n\n` +
    `مرحباً، رقم هاتفك غير مسجّل كموكل لدينا. للتواصل مع المكتب: ${OFFICE_PHONE}.`;
  await sendText(origin, from, message);
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

    // Measure the gap BEFORE storing this message, so a fresh insert doesn't
    // reset its own clock. A null result (never spoken) also counts as a new
    // session.
    const lastTs = await lastConversationTs(from);
    const isNewSession = lastTs == null || timestamp - lastTs >= SESSION_GAP_MS;

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

    // First message after a 30-min lull → route the sender to their bot.
    // The reply we send is itself logged as outgoing, so it updates the
    // conversation clock and prevents re-routing on every subsequent message.
    if (isNewSession) {
      await routeToBot(req, from);
    }
  }

  return NextResponse.json({ status: 'ok' });
}
