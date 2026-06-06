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

/** Source line 4199. Strip non-digits, replace leading 0 with country code 972. */
export function normalizePhoneForLinks(phone: string | undefined): string {
  return String(phone || '')
    .replace(/[^0-9+]/g, '')
    .replace(/^0/, '972');
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
