// Shared helpers for the WhatsApp "bot invitation" flow.
//
// The office wants EVERY client to be told they can self-serve through the
// client bot — both when the client writes to the office first (the incoming
// webhook flow) AND when the office sends the client a message/document (the
// outgoing send flow). These helpers keep the invite text, the client lookup
// and the "already invited this conversation?" dedup identical across both
// paths, so a change here fixes every entry point at once.

import { phonesMatch } from '@/lib/clients';

// A WhatsApp conversation "starts" once the line has been quiet for this long.
// The invite is sent at most once per such conversation (mirrors the webhook's
// re-engagement window), so a client is never spammed with repeat links.
export const SESSION_GAP_MS = 30 * 60 * 1000;

export const OFFICE_PHONE = '02-6288479';

// Stable substring present in every bot-invite message (the deep link always
// contains it). Used to detect, from the stored WhatsApp history, whether the
// client already received the invite in the current conversation — so we never
// re-send it on every outgoing message. Manual messages never contain this.
export const BOT_INVITE_MARKER = '/portal?phone=';

// Minimal shape of the client rows returned by the worker's /api/load.
export interface ClientRow {
  phone?: string;
  full_name?: string;
  full_name_ar?: string;
}

/** The public portal base URL the CLIENT opens (must be internet-reachable and
 *  CORS-allowed by the worker). Override with PORTAL_BASE_URL. */
export function resolvePortalBase(): string {
  return (
    process.env.PORTAL_BASE_URL || 'https://legal-office-app-v4.vercel.app'
  ).replace(/\/$/, '');
}

/** All client rows for the configured office, used to resolve a phone number
 *  to a known client. Best-effort — returns [] on any failure. */
export async function loadOfficeClients(
  workerUrl: string,
  appToken: string,
): Promise<ClientRow[]> {
  try {
    const res = await fetch(`${workerUrl}/api/load`, {
      headers: { Authorization: `Bearer ${appToken}` },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { clients?: ClientRow[] };
    return Array.isArray(data?.clients) ? data.clients : [];
  } catch (e) {
    console.error('loadOfficeClients failed:', e);
    return [];
  }
}

/** Best display name for the client at `phone`, or '' when not found. Any
 *  matching record is accepted (a phone shared by two family-member clients
 *  should still be recognised as "a known client" for the invite). */
export function clientNameForPhone(
  clients: ClientRow[],
  phone: string | undefined,
): string {
  const match = clients.find((c) => phonesMatch(c.phone, phone));
  if (!match) return '';
  return (match.full_name || match.full_name_ar || '').trim();
}

/** True when `phone` belongs to at least one known client. */
export function isKnownClient(
  clients: ClientRow[],
  phone: string | undefined,
): boolean {
  return clients.some((c) => phonesMatch(c.phone, phone));
}

/** The bilingual bot-invitation message. `phone` is embedded in the deep link
 *  so the portal opens scoped to that client. */
export function botInviteMessage(
  name: string,
  portalBase: string,
  phone: string,
): string {
  const link = `${portalBase}/portal?phone=${encodeURIComponent(phone)}&lang=he`;
  return (
    `שלום${name ? ' ' + name : ''}, ` +
    `כדי לקבל מידע על התיק שלך — סטטוס, דיונים, תשלומים ומסמכים — ` +
    `היכנס/י לבוט הלקוחות:\n${link}\n\n` +
    `مرحباً، للاطلاع على معلومات ملفك (الحالة، الجلسات، المدفوعات والمستندات) ` +
    `ادخل إلى بوت الموكلين عبر الرابط أعلاه.`
  );
}

/** The "not a client" reply for an unrecognised sender. */
export function unknownSenderMessage(): string {
  return (
    `שלום, מספר הטלפון אינו מזוהה כלקוח במערכת. ` +
    `לפניות נא ליצור קשר עם המשרד: ${OFFICE_PHONE}.\n\n` +
    `مرحباً، رقم هاتفك غير مسجّل كموكل لدينا. للتواصل مع المكتب: ${OFFICE_PHONE}.`
  );
}

interface StoredMessage {
  direction?: string;
  message_text?: string;
  timestamp?: number | string;
}

/** True when a bot invitation has already been sent to this client within the
 *  CURRENT conversation (the run of messages ending at `nowTs` with no gap
 *  longer than SESSION_GAP_MS). Used to send the invite at most once per
 *  conversation instead of after every single message. */
export function conversationHasBotInvite(
  messages: StoredMessage[],
  nowTs: number,
): boolean {
  const sorted = [...messages]
    .map((m) => ({
      direction: String(m.direction || ''),
      text: String(m.message_text || ''),
      ts: Number(m.timestamp) || 0,
    }))
    .sort((a, b) => b.ts - a.ts); // newest first

  let cursor = nowTs;
  for (const m of sorted) {
    // A gap longer than the session window means everything from here back is a
    // previous conversation — stop looking.
    if (cursor - m.ts >= SESSION_GAP_MS) break;
    if (m.direction === 'outgoing' && m.text.includes(BOT_INVITE_MARKER)) {
      return true;
    }
    cursor = m.ts;
  }
  return false;
}
