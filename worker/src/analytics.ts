// GET /api/analytics — the office's monthly figures for the Analytics screen.
//
// Months are calendar months in Israel time. "New" clients / cases count by
// the row's created_at; a case counts as CLOSED in the month its status last
// changed to a closed one (status is not active / pending — the app has no
// closing date, so updated_at of a closed case is the best record of it).
// Money: every payment row is a receipt; fee-type rows (fee / legal_fee /
// untyped) count against a case's agreed fee — the same rule as the app's
// lib/finance.ts — so a case's debt is max(0, agreed − fee receipts).

import type { Ctx } from './tenant';

const MONTHS = 12;
const isFee = (t: unknown) => !t || t === 'fee' || t === 'legal_fee';
const isOpen = (s: unknown) => {
  const v = String(s || 'active').toLowerCase();
  return v === 'active' || v === 'pending';
};

/** "YYYY-MM" of an ISO timestamp / date, in Israel time. */
function monthOf(iso: unknown): string {
  const s = String(iso || '');
  if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s.slice(0, 7); // a plain date
  const d = new Date(s);
  if (isNaN(d.getTime())) return s.slice(0, 7);
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit' })
    .formatToParts(d)
    .reduce<Record<string, string>>((o, x) => ((o[x.type] = x.value), o), {});
  return `${p.year}-${p.month}`;
}

/** The last MONTHS months, oldest first, ending at `end` ("YYYY-MM"). */
function monthRange(end: string): string[] {
  let [y, m] = end.split('-').map(Number);
  const out: string[] = [];
  for (let i = 0; i < MONTHS; i++) {
    out.unshift(`${y}-${String(m).padStart(2, '0')}`);
    m -= 1;
    if (m === 0) {
      m = 12;
      y -= 1;
    }
  }
  return out;
}

type R = Record<string, unknown>;

export async function handleAnalytics(ctx: Ctx): Promise<unknown> {
  const all = async (sql: string) =>
    ((await ctx.db.prepare(sql).bind(ctx.tenantId).all()).results ?? []) as R[];
  const [clients, cases, payments] = await Promise.all([
    all('SELECT source_id, full_name, full_name_ar, created_at FROM clients WHERE user_id = ?1'),
    all(
      'SELECT source_id, client_source_id, status, court, court_ar, agreed_fee, created_at, updated_at FROM cases WHERE user_id = ?1',
    ),
    all('SELECT case_source_id, date, amount, type, created_at FROM payments WHERE user_id = ?1'),
  ]);

  const now = monthOf(new Date().toISOString());
  const months = monthRange(now);
  const row = () => ({
    newClients: 0,
    newCases: 0,
    closedCases: 0,
    collected: 0, // all receipts
    collectedFee: 0, // fee receipts
    collectedOther: 0, // court fees, deposits, misc
    agreedNew: 0, // agreed fees of the cases opened that month
  });
  const byMonth = new Map(months.map((m) => [m, row()]));
  const at = (m: string) => byMonth.get(m);

  for (const c of clients) {
    const r = at(monthOf(c.created_at));
    if (r) r.newClients += 1;
  }
  for (const c of cases) {
    const r = at(monthOf(c.created_at));
    if (r) {
      r.newCases += 1;
      r.agreedNew += Number(c.agreed_fee) || 0;
    }
    if (!isOpen(c.status)) {
      const rc = at(monthOf(c.updated_at || c.created_at));
      if (rc) rc.closedCases += 1;
    }
  }
  const feePaidByCase = new Map<string, number>();
  for (const p of payments) {
    const amount = Number(p.amount) || 0;
    const key = String(p.case_source_id || '').toUpperCase();
    if (isFee(p.type)) feePaidByCase.set(key, (feePaidByCase.get(key) || 0) + amount);
    const r = at(monthOf(p.date || p.created_at));
    if (!r) continue;
    r.collected += amount;
    if (isFee(p.type)) r.collectedFee += amount;
    else r.collectedOther += amount;
  }

  // Debt now: per case, then per client.
  const clientName = new Map(clients.map((c) => [String(c.source_id).toUpperCase(), c]));
  const debtByClient = new Map<string, number>();
  let debt = 0;
  let agreed = 0;
  let feePaid = 0;
  const status = { active: 0, pending: 0, closed: 0 };
  const courts = new Map<string, { he: string; ar: string; count: number }>();
  for (const c of cases) {
    const fee = Number(c.agreed_fee) || 0;
    const paid = feePaidByCase.get(String(c.source_id).toUpperCase()) || 0;
    const owed = Math.max(0, fee - paid);
    agreed += fee;
    feePaid += Math.min(fee, paid);
    debt += owed;
    if (owed > 0) {
      const k = String(c.client_source_id || '').toUpperCase();
      debtByClient.set(k, (debtByClient.get(k) || 0) + owed);
    }
    const s = String(c.status || 'active').toLowerCase();
    if (s === 'active') status.active += 1;
    else if (s === 'pending') status.pending += 1;
    else status.closed += 1;
    if (isOpen(c.status)) {
      const he = String(c.court || c.court_ar || '').trim() || '—';
      const ar = String(c.court_ar || c.court || '').trim() || '—';
      const cur = courts.get(he) || { he, ar, count: 0 };
      cur.count += 1;
      courts.set(he, cur);
    }
  }
  const topDebtors = [...debtByClient.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([id, amount]) => {
      const c = clientName.get(id);
      return {
        clientId: id,
        name: String(c?.full_name || c?.full_name_ar || id),
        nameAr: String(c?.full_name_ar || c?.full_name || id),
        amount,
      };
    });
  const topCourts = [...courts.values()].sort((a, b) => b.count - a.count).slice(0, 5);

  return {
    months: months.map((m) => ({ month: m, ...byMonth.get(m)! })),
    totals: {
      clients: clients.length,
      cases: cases.length,
      openCases: status.active + status.pending,
      debt,
      agreed,
      feePaid,
      debtors: debtByClient.size,
    },
    status,
    topDebtors,
    topCourts,
  };
}
