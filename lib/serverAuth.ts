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
