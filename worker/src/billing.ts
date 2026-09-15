// Subscription entitlement (Phase 4) — the ONE place that decides whether an
// office is currently paid up, and what that means for what it may do.
//
// Design rule: nothing here is scheduled. Only three states are ever STORED
// ('trialing' | 'active' | 'canceled'); "past_due" and "expired" are DERIVED by
// comparing now against the entitlement date on every request. A cron that
// ages offices out would be one more thing that can silently stop running, and
// an office's access would then depend on a job having fired — this way the
// answer is recomputed from the data itself, every time.
//
// What lapsing does NOT do: delete anything, or hide an office's own files. A
// law office locked out of its case data mid-hearing is a worse failure than an
// unpaid invoice, so a lapsed office keeps full READ access and loses WRITES
// (and the AI endpoints that spend money). See the router gate in index.ts.

/** Free trial granted when an office is approved. */
export const TRIAL_DAYS = 14;

/**
 * Days after the entitlement date during which access continues untouched while
 * the app warns. Manual collection means a bank transfer can genuinely be a few
 * days late; cutting an office off on the exact hour would punish that.
 */
export const GRACE_DAYS = 7;

/** What the tenant row stores. */
export type StoredBillingStatus = 'trialing' | 'active' | 'canceled';

/** What a request actually sees, after comparing against the clock. */
export type EffectiveBillingStatus =
  | 'trialing'
  | 'active'
  | 'past_due' // lapsed, still inside the grace window — full access + warning
  | 'expired' // lapsed past grace — reads only
  | 'canceled'; // deliberately ended — reads only

/** The billing columns this module reads off a tenant row. */
export interface TenantBillingRow {
  plan?: string | null;
  billing_status?: string | null;
  trial_ends_at?: string | null;
  paid_until?: string | null;
  price_amount?: number | null;
  price_currency?: string | null;
}

export interface BillingState {
  plan: string;
  /** The stored status, unchanged. */
  status: StoredBillingStatus;
  /** The status after applying the clock — what the UI should show. */
  effective: EffectiveBillingStatus;
  /** Paid/trial-through date, ISO, or null when the office has neither. */
  entitledUntil: string | null;
  /** Whole days until entitledUntil; negative once lapsed. */
  daysLeft: number;
  /** True while lapsed but still inside GRACE_DAYS. */
  inGrace: boolean;
  /** True when writes and AI endpoints must be refused. */
  blocked: boolean;
  priceAmount: number;
  priceCurrency: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** An office that is never billed — the operator's own. */
export function operatorBilling(): BillingState {
  return {
    plan: 'operator',
    status: 'active',
    effective: 'active',
    entitledUntil: null,
    daysLeft: Number.POSITIVE_INFINITY,
    inGrace: false,
    blocked: false,
    priceAmount: 0,
    priceCurrency: 'ILS',
  };
}

function parseIso(value?: string | null): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Resolve a tenant row's billing columns against the current time.
 * `now` is injectable so the admin console and tests can ask "what will this
 * office look like on date X" without waiting for date X.
 */
export function computeBilling(
  row: TenantBillingRow,
  now: number = Date.now(),
): BillingState {
  const plan = (row.plan || 'standard').trim() || 'standard';
  const priceAmount = Number(row.price_amount ?? 0) || 0;
  const priceCurrency = (row.price_currency || 'ILS').trim() || 'ILS';
  const raw = (row.billing_status || 'trialing').trim();
  const status: StoredBillingStatus =
    raw === 'active' || raw === 'canceled' || raw === 'trialing'
      ? raw
      : 'trialing';

  const base = { plan, status, priceAmount, priceCurrency };

  // Cancelling is an explicit decision, so it takes effect immediately and no
  // grace applies — but it still only drops the office to read-only.
  if (status === 'canceled') {
    return {
      ...base,
      effective: 'canceled',
      entitledUntil: null,
      daysLeft: 0,
      inGrace: false,
      blocked: true,
    };
  }

  const untilIso = status === 'trialing' ? row.trial_ends_at : row.paid_until;
  const until = parseIso(untilIso);

  // No date at all: 'trialing' with no trial_ends_at, or 'active' never paid.
  // Treat as lapsed rather than as free access — the admin console surfaces it.
  if (until === null) {
    return {
      ...base,
      effective: 'expired',
      entitledUntil: null,
      daysLeft: 0,
      inGrace: false,
      blocked: true,
    };
  }

  const msLeft = until - now;
  const daysLeft = Math.ceil(msLeft / DAY_MS);

  if (msLeft >= 0) {
    return {
      ...base,
      effective: status, // 'trialing' | 'active'
      entitledUntil: untilIso ?? null,
      daysLeft,
      inGrace: false,
      blocked: false,
    };
  }

  const inGrace = now - until <= GRACE_DAYS * DAY_MS;
  return {
    ...base,
    effective: inGrace ? 'past_due' : 'expired',
    entitledUntil: untilIso ?? null,
    daysLeft, // negative — "3 days overdue"
    inGrace,
    blocked: !inGrace,
  };
}

/** The wire shape sent to the app on GET /api/load and to the admin console. */
export function billingPayload(state: BillingState) {
  return {
    plan: state.plan,
    status: state.status,
    effective: state.effective,
    entitled_until: state.entitledUntil,
    days_left: Number.isFinite(state.daysLeft) ? state.daysLeft : null,
    in_grace: state.inGrace,
    blocked: state.blocked,
    price_amount: state.priceAmount,
    price_currency: state.priceCurrency,
  };
}

/** ISO timestamp `days` from `from` — used for trial start and period extension. */
export function isoPlusDays(days: number, from: number = Date.now()): string {
  return new Date(from + days * DAY_MS).toISOString();
}

/**
 * The end of the next paid period when a payment is recorded. Months are added
 * from whichever is later — the current entitlement date or today — so paying
 * early EXTENDS the subscription instead of shortening it, and paying late does
 * not bill the office for the time it was already locked out.
 */
export function nextPeriodEnd(
  currentEnd: string | null | undefined,
  months: number,
  now: number = Date.now(),
): string {
  const current = parseIso(currentEnd);
  const startMs = current !== null && current > now ? current : now;
  const d = new Date(startMs);
  const targetMonth = d.getUTCMonth() + months;
  const anchorDay = d.getUTCDate();
  d.setUTCMonth(targetMonth);
  // Rolling 31 Jan forward one month lands on 2/3 March in JS. Clamp back to
  // the last day of the intended month so a period never silently gains days.
  if (d.getUTCDate() < anchorDay) d.setUTCDate(0);
  return d.toISOString();
}
