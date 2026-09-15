// The office's own view of its subscription (Phase 4), client side.
//
// The Worker is the authority — it computes entitlement on every request and
// enforces it (see worker/src/billing.ts and the 402 gate in the router). This
// module only CACHES the answer that arrives with GET /api/load so the UI can
// explain what is happening. Nothing here grants access; hiding this state
// would not unlock anything, and neither does tampering with it.
//
// Deliberately dependency-free, like lib/officeToken.ts, so the data modules
// can update it without pulling UI code in.

export const OFFICE_BILLING_KEY = 'office_billing_v1';
export const OFFICE_BILLING_EVENT = 'office-billing-change';

/** What a lapsed subscription costs the office: writes, not access to data. */
export type BillingEffective =
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'expired'
  | 'canceled';

export interface OfficeBilling {
  plan: string;
  status: 'trialing' | 'active' | 'canceled';
  effective: BillingEffective;
  entitled_until: string | null;
  days_left: number | null;
  in_grace: boolean;
  blocked: boolean;
  price_amount: number;
  price_currency: string;
}

function read(): OfficeBilling | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(OFFICE_BILLING_KEY);
    return raw ? (JSON.parse(raw) as OfficeBilling) : null;
  } catch {
    return null;
  }
}

export function getOfficeBilling(): OfficeBilling | null {
  return read();
}

/** Store the state from /api/load, notifying the UI only when it CHANGED. */
export function setOfficeBilling(billing: OfficeBilling | null | undefined): void {
  if (typeof window === 'undefined' || !billing) return;
  const next = JSON.stringify(billing);
  try {
    if (window.localStorage.getItem(OFFICE_BILLING_KEY) === next) return;
    window.localStorage.setItem(OFFICE_BILLING_KEY, next);
  } catch {
    /* ignore */
  }
  try {
    window.dispatchEvent(new Event(OFFICE_BILLING_EVENT));
  } catch {
    /* ignore */
  }
}

export function clearOfficeBilling(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(OFFICE_BILLING_KEY);
  } catch {
    /* ignore */
  }
  try {
    window.dispatchEvent(new Event(OFFICE_BILLING_EVENT));
  } catch {
    /* ignore */
  }
}

/**
 * Called when a write comes back 402. The office was entitled when the page
 * loaded and lapsed mid-session (or the cached state was stale), so flip to
 * blocked NOW rather than leaving the office typing into a screen whose changes
 * the server is refusing. The next /api/load overwrites this with the truth.
 */
export function markBillingBlocked(): void {
  const current = read();
  setOfficeBilling({
    plan: current?.plan ?? 'standard',
    status: current?.status ?? 'active',
    effective: current?.status === 'canceled' ? 'canceled' : 'expired',
    entitled_until: current?.entitled_until ?? null,
    days_left: current?.days_left ?? null,
    in_grace: false,
    blocked: true,
    price_amount: current?.price_amount ?? 0,
    price_currency: current?.price_currency ?? 'ILS',
  });
}
