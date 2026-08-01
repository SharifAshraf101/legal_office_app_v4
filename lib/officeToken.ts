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
}

export function hasOfficeToken(): boolean {
  return !!getOfficeToken();
}

/** Authorization header for Worker DATA calls, or {} when not logged in. */
export function officeAuthHeader(): Record<string, string> {
  const t = getOfficeToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
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
