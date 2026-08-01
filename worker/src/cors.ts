// CORS handling. The browser app talks to this Worker cross-origin, so every
// response must echo the caller's origin (locked to ALLOWED_ORIGIN, never '*')
// and the JSON POST to /api/save triggers an OPTIONS preflight that we must
// answer or autosave fails silently.

import type { Env } from './db';

/**
 * Match an Origin against one ALLOWED_ORIGIN entry. Exact string match, or a
 * wildcard pattern where `*` stands for any run of characters — so a single
 * `https://*.vercel.app` entry covers every per-deploy preview URL (Better
 * Auth's trustedOrigins understands the same wildcard form, so the two stay in
 * sync from the one env var).
 */
function matchOrigin(origin: string, pattern: string): boolean {
  if (!origin) return false;
  if (pattern === origin) return true;
  if (!pattern.includes('*')) return false;
  const rx = new RegExp(
    '^' +
      pattern
        .split('*')
        .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('.*') +
      '$',
  );
  return rx.test(origin);
}

export function corsHeaders(request: Request, env: Env): Record<string, string> {
  const origin = request.headers.get('Origin') || '';
  const list = (env.ALLOWED_ORIGIN || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    // Better Auth signs sessions into cookies, so browser auth calls run with
    // credentials — which requires a specific origin (never '*') + this header.
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
  if (list.some((pattern) => matchOrigin(origin, pattern))) {
    headers['Access-Control-Allow-Origin'] = origin;
  }
  return headers;
}

export function preflight(request: Request, env: Env): Response {
  return new Response(null, { status: 204, headers: corsHeaders(request, env) });
}

export function json(
  body: unknown,
  request: Request,
  env: Env,
  status = 200,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...corsHeaders(request, env),
    },
  });
}
