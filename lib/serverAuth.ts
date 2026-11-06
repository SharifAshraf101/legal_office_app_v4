// Server-side (Next route handler) auth helpers for the multi-tenant SaaS.
//
// The rule these enforce: a Next API route NEVER holds an identity of its own.
// Every Worker call it makes carries the CALLER's `Authorization` header, so
// the Worker's resolveTenant() puts the work on that office's own database.
//
// Before this, these routes sent the operator's APP_TOKEN, which resolveTenant
// maps to mode 'legacy' — the operator's office. That made every tenant's AI
// summary and draft land in the operator's database, and made the routes
// callable by anyone on the internet at the operator's Anthropic expense.
//
// NOTE: no APP_TOKEN fallback lives here on purpose. A fallback would silently
// restore the cross-tenant write the moment a caller forgot its token.

/** The Worker base URL with any trailing slash removed, or '' if unset. */
export function workerBase(): string {
  return (process.env.NEXT_PUBLIC_WORKER_URL || '').replace(/\/$/, '');
}

/**
 * The caller's `Authorization` header, verbatim, or null when absent/malformed.
 * The Worker is the authority on whether the token is valid — this only checks
 * that a bearer credential was actually presented, so unauthenticated calls are
 * rejected here instead of being silently upgraded to operator privileges.
 */
export function forwardAuth(req: Request): string | null {
  const raw = (req.headers.get('authorization') || '').trim();
  if (!raw.toLowerCase().startsWith('bearer ')) return null;
  return raw.slice(7).trim() ? raw : null;
}

/** The bare bearer credential (no "Bearer " prefix), or '' when absent. */
export function bearerToken(req: Request): string {
  const raw = (req.headers.get('authorization') || '').trim();
  if (!raw.toLowerCase().startsWith('bearer ')) return '';
  return raw.slice(7).trim();
}

/** Length-safe constant-time string compare (both empty => false). */
export function secretEquals(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Ask the Worker whether this `Authorization` header belongs to a real, active
 * office session. The Worker is the only authority on that, so we probe it with
 * the cheapest authenticated endpoint there is: `/api/case-notes` filtered by a
 * case id that cannot exist, which returns `{notes:[]}` for a valid session and
 * 401 for anything else. Nothing about the office's data is read or written.
 *
 * Returns false (deny) when the Worker URL isn't configured or is unreachable —
 * an endpoint that spends the office's WhatsApp quota must fail closed.
 */
export async function isValidOfficeSession(authHeader: string): Promise<boolean> {
  const base = workerBase();
  if (!base || !authHeader) return false;
  try {
    const res = await fetch(
      `${base}/api/case-notes?caseId=${encodeURIComponent('__auth_probe__')}`,
      { headers: { Authorization: authHeader }, cache: 'no-store' },
    );
    return res.ok;
  } catch {
    return false;
  }
}
