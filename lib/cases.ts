// Case-related helpers. Ports of source 3776-3779, 3919, 4188-4192, 4399. v3 versions of case modals read directly from source without needing to import this module.

import type { Case, CalendarEvent, Client, Lang, Task } from '@/types';

/** Source line 3776. */
export function caseName(c: Case, lang: Lang): string {
  return lang === 'ar' ? c.titleAr || c.title || '' : c.title || c.titleAr || '';
}

/** Source line 3777. `-u-nu-latn` keeps the Western Arabic digits
 *  the firm uses (0-9) regardless of the user's browser locale. */
export function money(n: number | undefined): string {
  return '₪' + Number(n || 0).toLocaleString('he-IL-u-nu-latn');
}

/** Source line 3919. Computes the next CS-NNNN id. */
export function nextCaseId(cases: Case[]): string {
  let max = 1000;
  for (const c of cases) {
    const n = parseInt(String(c.id || '').replace(/\D/g, ''), 10);
    if (!isNaN(n) && n > max) max = n;
  }
  return 'CS-' + (max + 1);
}

/** Source line 4192. Returns a CSS class + label + next-status for status pill. */
export function caseStatusView(
  status: string | undefined,
  tr: (k: string) => string,
): { cls: 'active' | 'inactive'; label: string; next: 'active' | 'inactive' } {
  if (status === 'inactive' || status === 'closed') {
    return { cls: 'inactive', label: tr('inactive'), next: 'active' };
  }
  return { cls: 'active', label: tr('active'), next: 'inactive' };
}

/** Source line 4399. */
export function caseSearchText(c: Case, clients: Client[]): string {
  const client = clients.find((x) => x.id === c.clientId) || ({} as Client);
  return [
    client.name,
    client.nameAr,
    c.caseNumber,
    client.phone,
    client.idNumber,
    c.title,
    c.titleAr,
    c.court,
    c.courtAr,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** Source line 4188. Collects all hearing-shaped events for a case. */
export function caseHearingCandidates(
  caseId: string,
  cases: Case[],
  events: CalendarEvent[],
  lang: Lang,
  eventTypeLabel: (type: string) => string,
): { date: Date; title: string }[] {
  const c = cases.find((x) => x.id === caseId);
  const out: { date: Date; title: string }[] = [];
  for (const e of events) {
    if (e.caseId !== caseId) continue;
    if (!['hearingMeeting', 'hearing', 'meeting'].includes(String(e.type))) continue;
    const raw = e.dateTime || (e as unknown as { date?: string }).date;
    if (!raw) continue;
    const d = new Date(raw);
    if (isNaN(d.getTime())) continue;
    const title =
      lang === 'ar'
        ? e.titleAr || e.title || eventTypeLabel(String(e.type))
        : e.title || e.titleAr || eventTypeLabel(String(e.type));
    out.push({ date: d, title });
  }
  if (c?.lastHearing) {
    const raw = String(c.lastHearing).includes('T')
      ? c.lastHearing
      : c.lastHearing + 'T09:00:00';
    const d = new Date(raw);
    if (!isNaN(d.getTime())) {
      out.push({ date: d, title: eventTypeLabel('hearingMeeting') });
    }
  }
  return out;
}

/** Source line 4189. Active case → soonest future hearing; otherwise most recent past. */
export function getCaseHearingForStatus(
  caseId: string,
  cases: Case[],
  events: CalendarEvent[],
  lang: Lang,
  eventTypeLabel: (type: string) => string,
): { date: Date; title: string } | null {
  const c = cases.find((x) => x.id === caseId);
  const candidates = caseHearingCandidates(caseId, cases, events, lang, eventTypeLabel);
  if (!candidates.length) return null;
  const now = new Date();
  if (c && c.status === 'active') {
    const future = candidates
      .filter((x) => x.date >= now)
      .sort((a, b) => a.date.getTime() - b.date.getTime());
    if (future.length) return future[0];
  }
  return [...candidates].sort((a, b) => b.date.getTime() - a.date.getTime())[0];
}

/** Source line 4187. Formats a hearing datetime per locale. */
export function formatCaseDateTime(raw: string | Date, lang: Lang): string {
  if (!raw) return '';
  const d =
    raw instanceof Date
      ? raw
      : new Date(String(raw).includes('T') ? raw : String(raw) + 'T09:00:00');
  if (isNaN(d.getTime())) return String(raw);
  return d.toLocaleString(lang === 'ar' ? 'ar-EG-u-nu-latn' : 'he-IL-u-nu-latn', {
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Source line 5055. Open tasks for a case, sorted. We keep the sort simple
 *  (by createdAt asc) — the source uses sortedTasks which lands in Stage 4b. */
export function caseTaskItems(caseId: string, tasks: Task[]): Task[] {
  return tasks
    .filter((x) => String(x.caseId) === String(caseId) && x.status !== 'done')
    .slice()
    .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
}

/** Convenience: lookup display name for a client by id. Source line 3775. */
export function clientName(
  clientId: string,
  clients: Client[],
  lang: Lang,
): string {
  const c = clients.find((x) => x.id === clientId);
  if (!c) return '-';
  return lang === 'ar' ? c.nameAr || c.name || '-' : c.name || c.nameAr || '-';
}
