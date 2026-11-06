import { NextRequest, NextResponse, after } from 'next/server';
import { dropboxRawUrl } from '@/lib/dropbox';
import { bearerToken, isValidOfficeSession, secretEquals } from '@/lib/serverAuth';
import {
  botInviteMessage,
  clientNameForPhone,
  conversationHasBotInvite,
  isKnownClient,
  loadOfficeClients,
  fetchPortalLink,
} from '@/lib/whatsappBot';

const WORKER_URL = process.env.NEXT_PUBLIC_WORKER_URL || 'https://legal-office-api-v4.sharifashraf.workers.dev';
const APP_TOKEN = process.env.APP_TOKEN || process.env.NEXT_PUBLIC_APP_TOKEN || '';

/**
 * Who may send a WhatsApp message through this route.
 *
 * This route holds the office's Meta credentials, so an unauthenticated caller
 * could previously send arbitrary messages from the business number — and, via
 * `document.url`, make Meta fetch any URL it named. Two callers are legitimate:
 *
 *   • the office UI in a logged-in browser — presents its Better Auth session
 *     token, which only the Worker can validate (one cheap probe per send);
 *   • this server calling itself (the webhook's bot-invite / unknown-sender
 *     replies, and the invite follow-up below) — presents APP_TOKEN, which is
 *     server-side only and never reaches a browser.
 *
 * Anything else is rejected before a single Meta call is made.
 */
async function authorizeSend(
  req: NextRequest,
): Promise<{ ok: true; internal: boolean } | { ok: false }> {
  const token = bearerToken(req);
  if (!token) return { ok: false };
  // Server-to-server self-call. Constant-time compare so the token can't be
  // recovered a byte at a time from response timing.
  if (APP_TOKEN && secretEquals(token, APP_TOKEN)) {
    return { ok: true, internal: true };
  }
  if (await isValidOfficeSession(`Bearer ${token}`)) {
    return { ok: true, internal: false };
  }
  return { ok: false };
}

async function resolveDocumentUrl(document?: { name?: string; url?: string; relativePath?: string }) {
  if (!document) return undefined;

  // A direct URL already resolved in the browser (where the office's Dropbox
  // tokens live) is the fast path. Normalise any Dropbox SHARE page URL
  // (…?dl=0) into a RAW/direct link so Meta fetches the FILE itself, not
  // Dropbox's HTML preview page.
  if (typeof document.url === 'string' && document.url.trim()) {
    return dropboxRawUrl(document.url.trim());
  }

  const relativePath = document.relativePath?.trim();
  if (!relativePath) return undefined;

  if (/^data:/i.test(relativePath)) return relativePath;
  if (/^https?:\/\//i.test(relativePath)) return dropboxRawUrl(relativePath);

  // A filing-relative path (e.g. "Clients/CLT-101 - X/CS-1001/f.pdf"). The
  // browser Dropbox client can't run here (it reads tokens from localStorage,
  // which the server has no access to), so resolve a short-lived DIRECT link
  // SERVER-SIDE via the worker, which holds the office's Dropbox refresh token
  // as a secret. This makes documents deliver even when the sender's browser
  // has no Dropbox connection of its own.
  try {
    const res = await fetch(
      `${WORKER_URL}/api/document-link?path=${encodeURIComponent(relativePath)}`,
      { headers: { Authorization: `Bearer ${APP_TOKEN}` } },
    );
    if (res.ok) {
      const data = (await res.json()) as { link?: string };
      if (data?.link) return data.link;
    } else {
      console.warn('[WhatsApp send] worker document-link failed', res.status);
    }
  } catch (error) {
    console.error('[WhatsApp send] worker document-link error', error);
  }
  return undefined;
}

// After the office sends a client a message/document, make sure that client has
// been handed the self-service bot link — once per conversation, never on every
// message. Best-effort and runs AFTER the response, so it never delays or fails
// the actual send.
async function maybeSendBotInvite(selfBase: string, to: string): Promise<void> {
  try {
    const res = await fetch(
      `${WORKER_URL}/api/whatsapp-messages/${encodeURIComponent(to)}`,
      { headers: { Authorization: `Bearer ${APP_TOKEN}` } },
    );
    if (!res.ok) return;
    const data = (await res.json()) as {
      messages?: Array<{ direction?: string; message_text?: string; timestamp?: number }>;
    };
    const messages = Array.isArray(data?.messages) ? data.messages : [];
    // Already invited in this conversation → nothing to do.
    if (conversationHasBotInvite(messages, Date.now())) return;

    const clients = await loadOfficeClients(WORKER_URL, APP_TOKEN);
    // Only invite recognised clients — never hand a scoped portal link to a
    // number that isn't a client in the system.
    if (!isKnownClient(clients, to)) return;

    const name = clientNameForPhone(clients, to);
    const link = await fetchPortalLink(WORKER_URL, APP_TOKEN, to);
    if (!link) return; // no signed link — never fall back to an unsigned one
    const message = botInviteMessage(name, link);
    await fetch(`${selfBase}/api/whatsapp/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Server-to-server: APP_TOKEN never leaves the server (see authorizeSend).
        Authorization: `Bearer ${APP_TOKEN}`,
      },
      // autoInvite:false stops the invite itself from triggering another invite.
      body: JSON.stringify({ to, message, autoInvite: false }),
    });
  } catch (e) {
    console.error('[WhatsApp send] auto bot-invite failed:', e);
  }
}

export async function POST(req: NextRequest) {
  // Authorize FIRST — before parsing the body, resolving any document link, or
  // touching Meta. An anonymous request must cost nothing and send nothing.
  const auth = await authorizeSend(req);
  if (!auth.ok) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: {
    to?: string;
    message?: string;
    document?: { name?: string; url?: string; relativePath?: string };
    /** When false, skip the automatic bot-invite follow-up. Set on the invite
     *  itself (and on system replies) so they never trigger another invite. */
    autoInvite?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const { to, message, document, autoInvite } = body;

  if (!to) {
    return NextResponse.json({ error: 'Missing recipient phone number' }, { status: 400 });
  }

  // A logged-in office sends from ITS OWN connected number, through the Worker
  // (which holds each office's credentials and logs into the office's own DB).
  // Only the operator — not yet connected there — answers 409 `legacy` and
  // falls through to the original Vercel-configured number below.
  if (!auth.internal) {
    let docUrl: string | undefined;
    try {
      docUrl = await resolveDocumentUrl(document);
    } catch {
      docUrl = undefined;
    }
    try {
      const wres = await fetch(`${WORKER_URL}/api/whatsapp-send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: req.headers.get('authorization') || '',
        },
        body: JSON.stringify({
          to,
          message,
          document: document ? { name: document.name, url: docUrl || document.url } : undefined,
        }),
      });
      const wdata = (await wres.json().catch(() => ({}))) as { legacy?: boolean };
      if (!(wres.status === 409 && wdata.legacy)) {
        return NextResponse.json(wdata, { status: wres.status });
      }
    } catch (error) {
      console.error('[WhatsApp send] worker send failed', error);
      return NextResponse.json({ error: 'Failed to reach the WhatsApp service' }, { status: 502 });
    }
  }

  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!phoneNumberId || !accessToken) {
    return NextResponse.json(
      { error: 'WhatsApp credentials are not configured' },
      { status: 500 },
    );
  }

  let resolvedDocumentUrl: string | undefined;
  try {
    resolvedDocumentUrl = await resolveDocumentUrl(document);
  } catch (error) {
    console.error('[WhatsApp send] failed to resolve document link', error);
    return NextResponse.json(
      { error: 'Failed to resolve document link' },
      { status: 502 },
    );
  }
  // A document was requested but we couldn't produce a link for it. Don't
  // silently downgrade to a text-only send (which would drop the attachment
  // the caller intended to deliver) — surface the failure instead.
  if (document && !resolvedDocumentUrl) {
    return NextResponse.json(
      { error: 'Could not resolve a shareable link for the attached document' },
      { status: 502 },
    );
  }
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

  // Message already delivered by Meta above (response.ok). Logging it to D1 is
  // best-effort: a failure here must NOT fail the request, or the UI would
  // treat a successfully-sent message as failed and re-send it (duplicates).
  try {
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
  } catch (error) {
    console.error('[WhatsApp send] failed to log outgoing message to D1', error);
  }

  // 3 — Hand the client the self-service bot link (once per conversation). Runs
  // after the response so it never delays the send the office just made. The
  // invite itself is sent with autoInvite:false, so it doesn't loop.
  if (autoInvite !== false) {
    const fwdHost =
      req.headers.get('x-forwarded-host') ||
      req.headers.get('host') ||
      new URL(req.url).host;
    const fwdProto = (req.headers.get('x-forwarded-proto') || 'https')
      .split(',')[0]
      .trim();
    const selfBase = (
      process.env.SELF_BASE_URL ||
      (process.env.VERCEL
        ? `${fwdProto}://${fwdHost}`
        : `http://127.0.0.1:${process.env.PORT || 3000}`)
    ).replace(/\/$/, '');
    after(() => maybeSendBotInvite(selfBase, to));
  }

  return NextResponse.json(data);
}
