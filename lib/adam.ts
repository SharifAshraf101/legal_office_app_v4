'use client';

// The Adam bridge, client side (server: worker/src/adam.ts; Adam's side:
// scripts/adam-bridge.mjs). The case-brain screen sends a request package and
// reads back Adam's merged draft, comparison table and disputed points.

import { officeAuthHeader } from './officeToken';

const WORKER_URL = (process.env.NEXT_PUBLIC_WORKER_URL || '').replace(/\/$/, '');

export type AdamStatus = 'pending' | 'working' | 'done' | 'error' | 'cancelled';

export interface AdamComparisonRow {
  claim: string;
  adam?: string;
  yosef?: string;
  saeed?: string;
  assessment?: string;
  recommendation?: string;
}

export interface AdamDispute {
  point: string;
  adam?: string;
  yosef?: string;
  saeed?: string;
}

export interface AdamResult {
  /** The merged draft (Draft B), with the real names. */
  draft: string;
  /** One-paragraph note from Adam to the lawyer. */
  summary?: string;
  comparison?: AdamComparisonRow[];
  disputes?: AdamDispute[];
  /** Yosef's / Saeed's answers (as received, anonymized). */
  yosef?: string;
  saeed?: string;
  /** Items still to complete / citations not verified. */
  toVerify?: string[];
  devilsAdvocate?: string;
}

export interface AdamJob {
  id: string;
  caseId: string;
  documentId: string | null;
  status: AdamStatus;
  title: string;
  note: string;
  createdAt: string;
  updatedAt: string;
  result: AdamResult | null;
}

export interface AdamPackage {
  caseId: string;
  documentId?: string;
  docTitle?: string;
  docFileName?: string;
  docLink?: string;
  language: 'he' | 'ar';
  court?: string;
  caseTitle?: string;
  caseNumber?: string;
  clientName?: string;
  officeName?: string;
  decode?: string;
  currentDraft?: string;
  notes?: string;
  request?: string;
  requestedAt: string;
}

const headers = (): Record<string, string> => ({ 'Content-Type': 'application/json', ...officeAuthHeader() });

export async function sendToAdam(pkg: AdamPackage): Promise<AdamJob | null> {
  if (!WORKER_URL) return null;
  const res = await fetch(WORKER_URL + '/api/adam/jobs', {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ package: pkg }),
  });
  if (!res.ok) return null;
  return ((await res.json()) as { job: AdamJob }).job;
}

/** The newest request for this case (+ document), or null. */
export async function latestAdamJob(caseId: string, documentId?: string): Promise<AdamJob | null> {
  if (!WORKER_URL || !caseId) return null;
  const q = new URLSearchParams({ caseId });
  if (documentId) q.set('documentId', documentId);
  const res = await fetch(WORKER_URL + '/api/adam/jobs?' + q.toString(), { headers: headers(), cache: 'no-store' });
  if (!res.ok) return null;
  const jobs = ((await res.json()) as { jobs: AdamJob[] }).jobs || [];
  return jobs.find((j) => j.status !== 'cancelled') || null;
}

export async function cancelAdamJob(id: string): Promise<void> {
  if (!WORKER_URL) return;
  await fetch(WORKER_URL + '/api/adam/jobs/' + encodeURIComponent(id) + '/status', {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ status: 'cancelled' }),
  });
}
