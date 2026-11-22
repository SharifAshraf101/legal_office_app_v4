// Client signature on a document — the app's side of worker/src/sign.ts.
//
// The lawyer marks where the client signs on a PDF of the case and sends a
// link; the client draws a signature on a phone; the app stamps it onto the PDF
// and files the signed copy in the case (components/SignedDocsFiler.tsx).

import { officeAuthHeader } from './officeToken';

const WORKER_URL = (process.env.NEXT_PUBLIC_WORKER_URL || '').replace(/\/$/, '');

/** Where the signature goes: a page and a box on it, as fractions of the page
 *  (0–1) measured from its TOP-LEFT corner, so it survives any zoom. */
export interface SignBox {
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SignRequest extends SignBox {
  token: string;
  doc_id: string | null;
  case_id: string | null;
  client_id: string | null;
  relative_path: string;
  file_name: string | null;
  title: string | null;
  signer_name: string | null;
  phone: string | null;
  lang: 'he' | 'ar';
  status: 'pending' | 'signed' | 'filed' | 'cancelled';
  created_at: string;
  expires_at: string;
  opened_at: string | null;
  signed_at: string | null;
  filed_at: string | null;
  signed_doc_id: string | null;
  /** Only in the "signed, not yet filed" listing. */
  signature?: string;
}

/** The link the client opens. */
export function signLink(token: string): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  return origin + '/sign/?t=' + token;
}

async function post(path: string, body: unknown): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(WORKER_URL + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...officeAuthHeader() },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    return res.ok ? data : null;
  } catch {
    return null;
  }
}

export async function createSignRequest(input: {
  docId: string;
  caseId: string;
  clientId: string;
  relativePath: string;
  fileName: string;
  title: string;
  signerName: string;
  phone: string;
  officeName: string;
  lang: 'he' | 'ar';
  days: number;
  box: SignBox;
}): Promise<{ token: string } | null> {
  const data = await post('/api/sign-requests', {
    doc_id: input.docId,
    case_id: input.caseId,
    client_id: input.clientId,
    relative_path: input.relativePath,
    file_name: input.fileName,
    title: input.title,
    signer_name: input.signerName,
    phone: input.phone,
    office_name: input.officeName,
    lang: input.lang,
    days: input.days,
    ...input.box,
  });
  const token = data && typeof data.token === 'string' ? data.token : '';
  return token ? { token } : null;
}

async function list(query: string): Promise<SignRequest[]> {
  try {
    const res = await fetch(WORKER_URL + '/api/sign-requests' + query, {
      headers: officeAuthHeader(),
      cache: 'no-store',
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { requests?: SignRequest[] };
    return data.requests || [];
  } catch {
    return [];
  }
}

/** Every request of a case, newest first (no signature images). */
export const listCaseSignRequests = (caseId: string) => list('?case=' + encodeURIComponent(caseId));

/** Signed by the client and not yet filed in the case — with the signature. */
export const listSignedUnfiled = () => list('?signed=1');

/** Take the job of filing one signed document (false = another device has it). */
export async function claimSignRequest(token: string): Promise<boolean> {
  const data = await post('/api/sign-requests/claim', { token });
  return !!data && data.claimed === true;
}

export async function markSignRequestFiled(token: string, signedDocId: string): Promise<boolean> {
  return !!(await post('/api/sign-requests/filed', { token, signed_doc_id: signedDocId }));
}

export async function cancelSignRequest(token: string): Promise<boolean> {
  return !!(await post('/api/sign-requests/cancel', { token }));
}

// ---- The client's page (public; the token is the authorization) -----------

export interface SignMeta extends SignBox {
  state: 'pending' | 'signed' | 'expired' | 'cancelled';
  title: string;
  signer_name: string;
  office_name: string;
  lang: 'he' | 'ar';
}

export async function fetchSignMeta(token: string): Promise<SignMeta | null> {
  try {
    const res = await fetch(WORKER_URL + '/api/sign/meta?t=' + encodeURIComponent(token), { cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json()) as SignMeta;
  } catch {
    return null;
  }
}

export async function fetchSignFile(token: string): Promise<ArrayBuffer | null> {
  try {
    const res = await fetch(WORKER_URL + '/api/sign/file?t=' + encodeURIComponent(token), { cache: 'no-store' });
    if (!res.ok) return null;
    return await res.arrayBuffer();
  } catch {
    return null;
  }
}

export async function submitSignature(token: string, signature: string): Promise<'ok' | 'gone' | 'error'> {
  try {
    const res = await fetch(WORKER_URL + '/api/sign/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ t: token, signature, consent: true }),
    });
    if (res.ok) return 'ok';
    return res.status === 409 || res.status === 410 ? 'gone' : 'error';
  } catch {
    return 'error';
  }
}
