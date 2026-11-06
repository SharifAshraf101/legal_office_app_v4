// Office session-token accessor — deliberately dependency-free (no better-auth
// import) so the Worker data modules can attach the bearer token without
// pulling in the whole auth client. The token is issued/managed by
// lib/officeAuth.ts (login / signup) and read from here everywhere else.

export const OFFICE_TOKEN_KEY = 'office_session_token';

export function getOfficeToken(): string {
  if (typeof window === 'undefined') return '';
  try {
    return window.localStorage.getItem(OFFICE_TOKEN_KEY) || '';
  } catch {
    return '';
  }
}

export function setOfficeToken(token: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(OFFICE_TOKEN_KEY, token);
  } catch {
    /* ignore */
  }
}

export function clearOfficeToken(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(OFFICE_TOKEN_KEY);
  } catch {
    /* ignore */
  }
  // The admin-dashboard button belongs to the session being signed out — the
  // next account to sign in on this browser must not inherit it.
  setAdminUser(false);
}

export function hasOfficeToken(): boolean {
  return !!getOfficeToken();
}

/** Authorization header for Worker DATA calls, or {} when not logged in. */
export function officeAuthHeader(): Record<string, string> {
  const t = getOfficeToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

// --- Operator-office flag -------------------------------------------------
// Some features run on infrastructure that exists ONCE for the whole system,
// not once per office: the WhatsApp business number and its inbound webhook,
// and the Dropbox/make.com document pipeline. Only the operator office (tenant
// #1) owns them. Every other office must not see those features — using them
// would send from the operator's number and write into the operator's data.
//
// The Worker decides (`office.is_operator` on GET /api/load, mirroring the
// Worker's own usesDropbox() rule) and lib/cloudflare.ts records it here on
// every load. Unknown defaults to FALSE — hide rather than leak.
export const OFFICE_IS_OPERATOR_KEY = 'office_is_operator';

/** Fired when the flag CHANGES, so mounted components can re-render (the
 *  answer arrives with /api/load, i.e. after the shell has already painted). */
export const OFFICE_ROLE_EVENT = 'office-role-change';

export function setOperatorOffice(isOperator: boolean): void {
  if (typeof window === 'undefined') return;
  const next = isOperator ? '1' : '0';
  try {
    if (window.localStorage.getItem(OFFICE_IS_OPERATOR_KEY) === next) return;
    window.localStorage.setItem(OFFICE_IS_OPERATOR_KEY, next);
  } catch {
    /* ignore */
  }
  try {
    window.dispatchEvent(new Event(OFFICE_ROLE_EVENT));
  } catch {
    /* ignore */
  }
}

export function isOperatorOffice(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(OFFICE_IS_OPERATOR_KEY) === '1';
  } catch {
    return false;
  }
}

// --- WhatsApp-enabled flag ------------------------------------------------
// True for the operator (original setup) and for any office that connected its
// own WhatsApp number (`office.whatsapp_enabled` on GET /api/load). Shows the
// communication tab. Display only — the Worker serves each office its own data.
export const OFFICE_WA_ENABLED_KEY = 'office_whatsapp_enabled';

export function setWhatsAppEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  const next = enabled ? '1' : '0';
  try {
    if (window.localStorage.getItem(OFFICE_WA_ENABLED_KEY) === next) return;
    window.localStorage.setItem(OFFICE_WA_ENABLED_KEY, next);
  } catch {
    /* ignore */
  }
  try {
    window.dispatchEvent(new Event(OFFICE_ROLE_EVENT));
  } catch {
    /* ignore */
  }
}

export function isWhatsAppEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(OFFICE_WA_ENABLED_KEY) === '1';
  } catch {
    return false;
  }
}

// --- Admin-dashboard flag -------------------------------------------------
// True only when the signed-in account is the system owner's own login (the
// Worker decides: `office.is_admin` on GET /api/load). Shows the dashboard
// button in the top bar. Display only — /api/admin/* checks the session itself,
// so flipping this in devtools opens nothing. Unknown defaults to FALSE.
export const OFFICE_IS_ADMIN_KEY = 'office_is_admin';

export function setAdminUser(isAdmin: boolean): void {
  if (typeof window === 'undefined') return;
  const next = isAdmin ? '1' : '0';
  try {
    if (window.localStorage.getItem(OFFICE_IS_ADMIN_KEY) === next) return;
    window.localStorage.setItem(OFFICE_IS_ADMIN_KEY, next);
  } catch {
    /* ignore */
  }
  try {
    window.dispatchEvent(new Event(OFFICE_ROLE_EVENT));
  } catch {
    /* ignore */
  }
}

export function isAdminUser(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(OFFICE_IS_ADMIN_KEY) === '1';
  } catch {
    return false;
  }
}

// --- Admin console token (operator-only) ---------------------------------
// Separate from the office session token. Only the operator's OWN device ever
// stores this — it's typed once on the /admin page. Its presence is therefore a
// reliable "this is the admin's browser" signal, used to show the discreet
// admin link ONLY to the operator (regular offices never have it).
export const OFFICE_ADMIN_TOKEN_KEY = 'office_admin_token';

export function hasAdminToken(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return !!window.localStorage.getItem(OFFICE_ADMIN_TOKEN_KEY);
  } catch {
    return false;
  }
}
