'use client';

// Office authentication — the browser side of the multi-tenant login.
//
// Talks to the Worker's Better Auth endpoints (/api/auth/*) using BEARER tokens
// (the SPA and the Worker are different origins, so cookies would be blocked as
// third-party — see the Worker's bearer plugin). The token Better Auth issues
// on sign-in/sign-up is stored via lib/officeToken and (a) re-sent on auth
// requests, (b) attached to our Worker data calls elsewhere.

import { createAuthClient } from 'better-auth/react';
import { getOfficeToken, setOfficeToken } from './officeToken';

const WORKER_URL = process.env.NEXT_PUBLIC_WORKER_URL || '';

export const authClient = createAuthClient({
  baseURL: WORKER_URL,
  fetchOptions: {
    // Attach the stored token as `Authorization: Bearer` on auth requests.
    auth: {
      type: 'Bearer',
      token: () => getOfficeToken(),
    },
    // Capture the token Better Auth returns on sign-in / sign-up.
    onSuccess: (ctx) => {
      const t = ctx.response.headers.get('set-auth-token');
      if (t) setOfficeToken(t);
    },
  },
});

export const { signIn, signUp, signOut, useSession, getSession, changePassword } =
  authClient;
