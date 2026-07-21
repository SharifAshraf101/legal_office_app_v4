import { NextRequest, NextResponse, after } from 'next/server';
import {
  SESSION_GAP_MS,
  botInviteMessage,
  clientNameForPhone,
  isKnownClient,
  loadOfficeClients,
  resolvePortalBase,
  unknownSenderMessage,
} from '@/lib/whatsappBot';

export const runtime = 'nodejs';
// Give the background routing work (full client load + outbound send) room
// to finish after we've already acked Meta.
export const maxDuration = 30;

const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || 'sharif_law_office_2026';
// v4 stack: incoming WhatsApp messages are stored in the v4 Worker / D1. Falls
// back to the v4 defaults if the env vars aren't set on this deployment.
const WORKER_URL =
  process.env.NEXT_PUBLIC_WORKER_URL ||
  'https://legal-office-api-v4.sharifashraf.workers.dev';
const APP_TOKEN =
  process.env.NEXT_PUBLIC_APP_TOKEN ||
  'ecd403f741827b30fcd7018ebaf5bc8fdf87b974b30ce8af';

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

// Most recent stored message timestamp (ms, any direction) for this phone
// that is STRICTLY OLDER than the message we just saved — i.e. the previous
// conversation. null when there was nothing before it. Used to measure the
// 30-minute gap; runs in the background so its latency never delays the
// Meta acknowledgement.
async function priorConversationTs(
  phone: string,
  currentTs: number,
): Promise<number | null> {
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
      if (t < currentTs && t > max) max = t;
    }
    return max || null;
  } catch (e) {
    console.error('priorConversationTs failed:', e);
    return null;
  }
}

// Send a text reply through our own send route so the outgoing message is
// pushed to Meta AND logged to D1 the same way lawyer-sent messages are.
// autoInvite:false — this IS the bot invite (or the "unknown sender" reply), so
// it must not trigger another automatic invite.
async function sendText(origin: string, to: string, message: string): Promise<void> {
  try {
    await fetch(`${origin}/api/whatsapp/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to, message, autoInvite: false }),
    });
  } catch (e) {
    console.error('sendText failed:', e);
  }
}

// When a known client re-opens the conversation after a lull, hand them a
// deep link into their own scoped bot; an unknown number gets a polite
// "contact the office" note. Best-effort — never throws.
//
// `portalBase` = the public URL the CLIENT opens (must be internet-reachable).
// `selfBase`   = base for our own call to /api/whatsapp/send (must reach THIS
//                running server). These differ: behind ngrok the public base
//                is the https tunnel URL, but the self-call must hit the local
//                http loopback or TLS fails (ERR_SSL_PACKET_LENGTH_TOO_LONG).
async function routeToBot(
  portalBase: string,
  selfBase: string,
  from: string,
): Promise<void> {
  const clients = await loadOfficeClients(WORKER_URL, APP_TOKEN);

  // Any matching client record counts as "known". A phone shared by two
  // family-member clients (two matching rows) used to fall through to the
  // "unrecognised" reply — now such a client still gets the bot link.
  if (isKnownClient(clients, from)) {
    const name = clientNameForPhone(clients, from);
    await sendText(selfBase, from, botInviteMessage(name, portalBase, from));
    return;
  }

  // Unknown sender — default "not recognized" reply.
  await sendText(selfBase, from, unknownSenderMessage());
}

export async function POST(req: NextRequest) {
  // Never let a malformed body throw a 500 back at Meta — that would also
  // count as a failed delivery.
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ status: 'ok' });
  }

  const message = (body as {
    entry?: Array<{ changes?: Array<{ value?: { messages?: unknown[] } }> }>;
  })?.entry?.[0]?.changes?.[0]?.value?.messages?.[0] as
    | Record<string, any>
    | undefined;

  console.log('Webhook received:', JSON.stringify(body).slice(0, 200));

  if (!message) {
    // Status callbacks (delivered/read) and other events — nothing to store.
    return NextResponse.json({ status: 'ok' });
  }

  const from = message.from as string;
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

  // Persist the incoming message synchronously — this is the only thing Meta
  // needs us to do before we ack, and it's a single fast write.
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

  // The 30-min gap check + client lookup (a full /api/load) + sending the bot
  // link all run AFTER we ack Meta. Doing them inline previously pushed the
  // response past Meta's webhook timeout (~30s observed), so Meta treated
  // deliveries as failed and stopped sending — incoming messages silently
  // stopped arriving. after() keeps the response instant.
  // The public host the request actually arrived through. Behind ngrok this
  // is the tunnel URL (e.g. https://xxx.ngrok-free.dev); on Vercel it's the
  // deployment host. We trust the forwarded headers because only our own
  // tunnel/proxy sets them.
  const fwdHost =
    req.headers.get('x-forwarded-host') ||
    req.headers.get('host') ||
    new URL(req.url).host;
  const fwdProto = (req.headers.get('x-forwarded-proto') || 'https')
    .split(',')[0]
    .trim();

  // CLIENT link → the public, production portal. Must be a host the worker's
  // CORS allowlist permits (so the portal can load the client's data) and that
  // serves a clean build (no ngrok browser-warning / dev HMR). The local dev
  // server behind ngrok is NOT CORS-allowed and renders blank on mobile, so we
  // default to the deployed Vercel app. Override with PORTAL_BASE_URL.
  const portalBase = resolvePortalBase();
  // INTERNAL send call → must reach THIS server. On Vercel the request origin
  // works; locally (behind ngrok) the forwarded origin is https-onto-http and
  // breaks TLS, so hit the loopback http port the dev server listens on.
  const selfBase = (
    process.env.SELF_BASE_URL ||
    (process.env.VERCEL
      ? `${fwdProto}://${fwdHost}`
      : `http://127.0.0.1:${process.env.PORT || 3000}`)
  ).replace(/\/$/, '');

  after(async () => {
    try {
      const lastTs = await priorConversationTs(from, timestamp);
      const isNewSession = lastTs == null || timestamp - lastTs >= SESSION_GAP_MS;
      if (isNewSession) {
        await routeToBot(portalBase, selfBase, from);
      }
    } catch (e) {
      console.error('routeToBot (background) failed:', e);
    }
  });

  return NextResponse.json({ status: 'ok' });
}
