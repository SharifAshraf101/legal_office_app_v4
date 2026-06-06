// CORS handling. The browser app talks to this Worker cross-origin, so every
// response must echo the caller's origin (locked to ALLOWED_ORIGIN, never '*')
// and the JSON POST to /api/save triggers an OPTIONS preflight that we must
// answer or autosave fails silently.

import type { Env } from './db';

export function corsHeaders(request: Request, env: Env): Record<string, string> {
  const origin = request.headers.get('Origin') || '';
  const list = (env.ALLOWED_ORIGIN || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
  if (list.includes(origin)) {
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
