// Finance helpers. Ports of source 3788-3794, 3823. Names preserved.

import type { Case, Client, Finance, Lang } from '@/types';

/** Source line 3788. Fee-type payments count against the agreed fee balance. */
export function isFeePaymentType(type: string | undefined): boolean {
  return !type || type === 'fee' || type === 'legal_fee';
}

/** Source line 3789. */
export function paymentTypeLabel(type: string | undefined, lang: Lang): string {
  const labels: Record<string, { he: string; ar: string }> = {
    fee: { he: 'שכר טרחה', ar: 'أتعاب' },
    legal_fee: { he: 'שכר טרחה', ar: 'أتعاب' },
    court_fee: { he: 'אגרה', ar: 'رسوم' },
    deposit: { he: 'פיקדון', ar: 'وديعة' },
    misc: { he: 'שונות', ar: 'متفرقات' },
  };
  const item = labels[type ?? 'fee'] || labels.fee;
  return lang === 'ar' ? item.ar : item.he;
}

/** Source line 3790.
 *  Every finance record in this system is an actual payment: they are created
 *  by the payment modal and stored in the D1 `payments` table, which has NO
 *  draft/status column. The `paid` flag is an in-memory-only field that does
 *  not survive the backend round-trip, so requiring `paid === true` here made
 *  saved payments silently drop out of the balance/list after a reload. Count a
 *  record unless it is EXPLICITLY marked unpaid (`paid === false`), which keeps
 *  the door open for a future draft flag without depending on the flag being
 *  restored on load. */
export function allPaidItemsForCase(caseId: string, finances: Finance[]): Finance[] {
  return finances
    .filter((f) => f.caseId === caseId && f.paid !== false)
    .slice()
    .sort(
      (a, b) =>
        new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime(),
    );
}

/** Source line 3791. */
export function financePaidItemsForCase(caseId: string, finances: Finance[]): Finance[] {
  return allPaidItemsForCase(caseId, finances).filter((f) => isFeePaymentType(f.type));
}

/** Source line 3792. */
export function financeNonFeePaidItemsForCase(
  caseId: string,
  finances: Finance[],
): Finance[] {
  return allPaidItemsForCase(caseId, finances).filter((f) => !isFeePaymentType(f.type));
}

/** Source line 3793. Remaining balance = agreedFee − sum(fee payments), clamped to 0. */
export function financeCaseBalance(c: Case, finances: Finance[]): number {
  const paid = financePaidItemsForCase(c.id, finances).reduce(
    (sum, f) => sum + Number(f.amount || 0),
    0,
  );
  return Math.max(0, Number(c.agreedFee || 0) - paid);
}

/** Source line 3794. Searchable text for the Finance screen — uses client
 *  fields since the screen lists cases keyed by client info. */
export function financeSearchText(c: Case, clients: Client[]): string {
  const client = clients.find((x) => x.id === c.clientId) || ({} as Client);
  return [client.name, client.nameAr, client.idNumber, client.phone]
    .filter(Boolean)
    .join(' · ');
}

/** Source line 3823. */
export function financePaymentsForCase(caseId: string, finances: Finance[]): Finance[] {
  return allPaidItemsForCase(caseId, finances);
}

/** Next FIN-NNN id. Mirrors the source's `'FIN-'+(max+1)` pattern (line 4044). */
export function nextPaymentId(finances: Finance[]): string {
  let max = 0;
  for (const f of finances) {
    const n = parseInt(String(f.id || '').replace(/\D/g, ''), 10);
    if (!isNaN(n) && n > max) max = n;
  }
  return 'FIN-' + (max + 1);
}

/** Default Hebrew/Arabic labels by payment type — used when the user leaves
 *  the description field blank (source line 4045). */
export function defaultPaymentDescription(
  type: string,
  lang: Lang,
): string {
  const labelsHe: Record<string, string> = {
    fee: 'שכר טרחה',
    court_fee: 'אגרה',
    deposit: 'פיקדון',
    misc: 'שונות',
  };
  const labelsAr: Record<string, string> = {
    fee: 'أتعاب',
    court_fee: 'رسوم',
    deposit: 'وديعة',
    misc: 'متفرقات',
  };
  if (lang === 'ar') return labelsAr[type] || labelsAr.fee;
  return labelsHe[type] || labelsHe.fee;
}
