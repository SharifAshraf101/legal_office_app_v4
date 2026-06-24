// Client-related helpers. Ports of source functions 3925, 4199-4205, 4611 v3 versions of client modals read directly from source without needing to import this module.
// — names preserved so screen code reads naturally.

import type { Case, Client, Lang } from '@/types';

/** Source line 3925. Computes the next CLT-NNN id by taking max numeric tail + 1. */
export function nextClientId(clients: Client[]): string {
  let max = 100;

  for (const c of clients) {
    const n = parseInt(String(c.id || '').replace(/\D/g, ''), 10);
    if (!isNaN(n) && n > max) max = n;
  }
  return 'CLT-' + (max + 1);
}

/** Source line 4199. Strip non-digits, normalize to 972XXXXXXXXX format. */
export function normalizePhoneForLinks(phone: string | undefined): string {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.startsWith('972')) return digits;
  if (digits.startsWith('0')) return '972' + digits.slice(1);
  if (digits.length >= 9 && digits.length <= 10) return '972' + digits;
  return digits;
}

/** Source line 4200. */
export function clientDisplayName(c: Client, lang: Lang): string {
  return lang === 'ar' ? c.nameAr || c.name || '' : c.name || c.nameAr || '';
}

/** Source line 4201. */
export function clientInitials(c: Client, lang: Lang): string {
  const name = clientDisplayName(c, lang).trim();
  if (!name) return '\u{1F464}';
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((x) => x[0])
    .join('')
    .toUpperCase();
}

/**
 * True when two phone numbers refer to the same line, regardless of how
 * they were typed. Both are normalized to the canonical `972XXXXXXXXX`
 * form first, so "050-123-4567", "0501234567" and the WhatsApp
 * sender id "972501234567" all compare equal. Empty / unparseable
 * numbers never match (guards against two blank phones matching).
 */
export function phonesMatch(
  a: string | undefined,
  b: string | undefined,
): boolean {
  const na = normalizePhoneForLinks(a);
  const nb = normalizePhoneForLinks(b);
  return Boolean(na && nb && na === nb);
}

/**
 * Resolve a single client from a phone number (e.g. a WhatsApp sender id).
 * Returns the matching client ONLY when exactly one client's phone matches
 * — zero matches or an ambiguous multi-match both return null, so callers
 * never auto-bind a WhatsApp sender to the wrong file.
 */
export function findClientByPhone(
  clients: Client[],
  phone: string | undefined,
): Client | null {
  const matches = clients.filter((c) => phonesMatch(c.phone, phone));
  return matches.length === 1 ? matches[0] : null;
}

/** Source line 4203. */
export function whatsappUrl(phone: string | undefined, text: string): string {
  const p = normalizePhoneForLinks(phone);
  return 'https://wa.me/' + p + (text ? '?text=' + encodeURIComponent(text) : '');
}

/** Source line 4205. */
export function whatsappAppUrl(phone: string | undefined, text: string): string {
  const p = normalizePhoneForLinks(phone);
  return 'whatsapp://send?phone=' + p + (text ? '&text=' + encodeURIComponent(text) : '');
}

/** Source line 4611. */
export function clientSearchText(c: Client): string {
  return [c.name, c.nameAr, c.idNumber, c.phone].filter(Boolean).join(' · ');
}

/** Count active / closed cases for a client. Used by ClientsScreen rows. */
export function clientCaseCounts(
  clientId: string,
  cases: Case[],
): { active: number; closed: number } {
  let active = 0;
  let closed = 0;
  for (const c of cases) {
    if (c.clientId !== clientId) continue;
    if (c.status === 'active') active++;
    else if (c.status === 'inactive' || c.status === 'closed') closed++;
  }
  return { active, closed };
}
