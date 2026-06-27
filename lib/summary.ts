// Document-summary fetcher (client side).
//
// Calls the Cloudflare Worker's /api/file-summary endpoint, which reads the D1
// `file_summary` table — the SINGLE source of truth for document summaries
// (they are NOT duplicated onto the documents row). Used by the case-brain
// "פענוח המסמך" card and the case-documents screen.
//
// D1 keys summaries by the SAVED (renamed) file name for app uploads
// (CLT-101_CS-1001_..._DOC-004.pdf) but by the ORIGINAL name for older
// rows, so we pass both. `caseId` is an optional fallback (returns the
// newest summary for the case) — omit it for per-document lookups that
// must resolve to a specific file only.

import type { Lang } from '@/types';
import { dropboxPathForRelative, getDropboxTemporaryLink } from './dropbox';

// Same Worker config the rest of the app uses (see lib/cloudflare.ts).
const WORKER_URL = (process.env.NEXT_PUBLIC_WORKER_URL || '').replace(/\/$/, '');
const APP_TOKEN = process.env.NEXT_PUBLIC_APP_TOKEN || '';

// Persisted "already attempted on-demand generation" set, so a slow/costly
// Claude generation (summary or draft) for a given document is tried at most
// ONCE per browser — not re-fired every time the case-brain modal re-opens.
// Mirrors loadDecisionImportKeys/rememberDecisionImportKey in lib/tasks.ts.
// Keys are `summary:<DOC-id>` / `draft:<DOC-id>`.
const GEN_ATTEMPTS_LS = 'law_gen_attempts_v1';

/** Load the persisted set of documents already attempted for generation. */
export function loadGenAttempts(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = localStorage.getItem(GEN_ATTEMPTS_LS);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

/** Mark a generation key as attempted (in memory + persisted). */
export function rememberGenAttempt(set: Set<string>, key: string): void {
  set.add(key);
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(GEN_ATTEMPTS_LS, JSON.stringify([...set]));
  } catch {
    /* ignore quota / serialization errors */
  }
}

export interface SummaryOpts {
  renamed?: string;
  original?: string;
  caseId?: string;
}

/** Raw { he, ar, language } summary for a document, or null when nothing
 *  matches. `language` is the document's own language ("ar" / "he" / ""). */
export async function fetchDocumentSummaryBoth(
  opts: SummaryOpts,
): Promise<{ he: string; ar: string; language: string } | null> {
  const { renamed, original, caseId } = opts;
  if (!renamed && !original && !caseId) return null;
  const params = new URLSearchParams();
  if (renamed) params.set('file', renamed);
  if (original) params.set('orig', original);
  if (caseId) params.set('caseId', caseId);
  try {
    const res = await fetch(
      WORKER_URL + '/api/file-summary?' + params.toString(),
      {
        method: 'GET',
        headers: { Authorization: 'Bearer ' + APP_TOKEN },
      },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      he?: string;
      ar?: string;
      language?: string;
    };
    const he = (data.he || '').trim();
    const ar = (data.ar || '').trim();
    if (!he && !ar) return null;
    return { he, ar, language: (data.language || '').toLowerCase() };
  } catch {
    return null;
  }
}

/** Generate a summary for a PDF document that has none yet: obtain a temporary
 *  Dropbox link for it, hand that to /api/generate-summary (which fetches the
 *  PDF server-side, asks Claude, and stores the result in file_summary), then
 *  return the summary. Returns null when generation isn't possible — not a PDF,
 *  Dropbox not connected, or an error. Used as a fallback when no pre-existing
 *  summary is found, so summaries appear for every case, not only the ones the
 *  external pipeline processed. */
export async function generateDocumentSummary(opts: {
  /** Stored relative path, used to locate the file in Dropbox. */
  relativePath?: string;
  /** Renamed file name (CLT-…_CS-…_…_DOC-NNN.pdf) — the file_summary key. */
  fileName: string;
  clientId?: string;
  caseId?: string;
}): Promise<{ he: string; ar: string; language: string } | null> {
  const { relativePath, fileName, clientId, caseId } = opts;
  if (!relativePath || !/\.pdf$/i.test(fileName)) return null;
  let fileUrl: string | null = null;
  try {
    fileUrl = await getDropboxTemporaryLink(dropboxPathForRelative(relativePath));
  } catch {
    fileUrl = null;
  }
  if (!fileUrl) return null;
  try {
    // Trailing slash matches next.config `trailingSlash: true` (avoids a 308).
    const res = await fetch('/api/generate-summary/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileUrl, fileName, clientId, caseId }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      he?: string;
      ar?: string;
      language?: string;
    };
    const he = (data.he || '').trim();
    const ar = (data.ar || '').trim();
    if (!he && !ar) return null;
    return { he, ar, language: (data.language || '').toLowerCase() };
  } catch {
    return null;
  }
}

/** Summary string in the DOCUMENT's own language (Arabic doc → Arabic
 *  summary, Hebrew doc → Hebrew summary). Falls back to the app `lang` when
 *  the document language is unknown, then to whichever summary exists. */
export async function fetchDocumentSummary(
  opts: SummaryOpts,
  lang: Lang,
): Promise<string | null> {
  const data = await fetchDocumentSummaryBoth(opts);
  if (!data) return null;
  return pickDocumentLanguageSummary(data, lang);
}

/** Choose the summary in the document's own language. */
export function pickDocumentLanguageSummary(
  data: { he: string; ar: string; language?: string },
  appLang: Lang,
): string | null {
  const docLang = (data.language || '').toLowerCase();
  let primary: string;
  let fallback: string;
  if (docLang === 'ar') {
    primary = data.ar;
    fallback = data.he;
  } else if (docLang === 'he') {
    primary = data.he;
    fallback = data.ar;
  } else {
    // Unknown document language — fall back to the app language.
    primary = appLang === 'ar' ? data.ar : data.he;
    fallback = appLang === 'ar' ? data.he : data.ar;
  }
  return (primary || fallback || '').trim() || null;
}

/** Reply-draft text for a case's document, from the D1 `drafts` table (written
 *  by the Make pipeline). Fetches the case's drafts and prefers the one whose
 *  `document_source_id` matches the given document (the one shown in the
 *  "פענוח המסמך" box), falling back to the newest.
 *
 *  `preferLang` is the language the "פענוח המסמך" box renders in (the
 *  document's language). When given, the draft is copied VERBATIM from the
 *  matching column — `draft_ar` for an Arabic document, `draft_he` for a Hebrew
 *  one (falling back to the other column only if the requested one is empty).
 *  No transformation/translation — pure copy. Used by the "טיוטת תגובה" card. */
export async function fetchDocumentDraft(
  opts: { caseId?: string; documentId?: string; preferLang?: 'ar' | 'he' | null },
  lang: Lang,
): Promise<string | null> {
  const { caseId, documentId, preferLang } = opts;
  if (!caseId && !documentId) return null;
  const params = new URLSearchParams();
  // Filter to THIS specific document when we know it, so the card shows the
  // draft for the SAME document the "פענוח" box decodes — never another
  // document's draft. Only fall back to the case scope when no document id.
  if (documentId) params.set('documentId', documentId);
  else if (caseId) params.set('caseId', caseId);
  try {
    const res = await fetch(WORKER_URL + '/api/drafts?' + params.toString(), {
      method: 'GET',
      headers: { Authorization: 'Bearer ' + APP_TOKEN },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      drafts?: Array<{
        document_source_id?: string;
        draft_he?: string;
        draft_ar?: string;
        language?: string;
      }>;
    };
    const rows = data.drafts || [];
    if (rows.length === 0) return null;
    // The endpoint already filtered to this document (or the case when no
    // document id), so the first row is the right one — no cross-document
    // guessing.
    const row = rows[0];
    const he = (row.draft_he || '').trim();
    const ar = (row.draft_ar || '').trim();
    // Match the "פענוח" box language exactly: copy the matching column as-is.
    if (preferLang === 'ar') return ar || he || null;
    if (preferLang === 'he') return he || ar || null;
    // Document language unknown — fall back to the draft row's own language.
    return pickDocumentLanguageSummary(
      { he, ar, language: (row.language || '').toLowerCase() },
      lang,
    );
  } catch {
    return null;
  }
}

/** Fetch the newest non-empty `suggested_action` for ONE exact case_id. */
async function fetchSuggestedActionFor(id: string): Promise<string | null> {
  try {
    const res = await fetch(
      WORKER_URL + '/api/suggested-actions/' + encodeURIComponent(id),
      { method: 'GET', headers: { Authorization: 'Bearer ' + APP_TOKEN } },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      suggestions?: Array<{ suggested_action?: string }>;
    };
    // Endpoint returns rows ordered created_at DESC → the first non-empty
    // suggested_action is the newest one.
    for (const row of data.suggestions || []) {
      const txt = (row.suggested_action || '').trim();
      if (txt) return txt;
    }
    return null;
  } catch {
    return null;
  }
}

/** Latest AI "suggested action" for a case, from the D1 `case_suggested_actions`
 *  table (written by the Make pipeline). Calls the Worker's
 *  GET /api/suggested-actions/:case_id and returns the newest row's
 *  `suggested_action` text, or null when there is none yet.
 *  Used by the case-brain "הצעה לפעולה" card.
 *
 *  The Worker matches case_id with a case-SENSITIVE `=`, but the pipeline may
 *  write the id in a different case than the app uses (e.g. it stores
 *  `cs-1010` while the app's case id is `CS-1010`). So we try the id as-is,
 *  then lower-case, then upper-case, and return the first match. */
export async function fetchSuggestedAction(caseId: string): Promise<string | null> {
  const id = (caseId || '').trim();
  if (!id) return null;
  const candidates = [...new Set([id, id.toLowerCase(), id.toUpperCase()])];
  for (const candidate of candidates) {
    const txt = await fetchSuggestedActionFor(candidate);
    if (txt) return txt;
  }
  return null;
}

/** True when a document is a court DECISION or PROTOCOL (by type/title/file
 *  name), in Hebrew or Arabic. Those get the split decode (decision first,
 *  then the rest). */
export function isDecisionOrProtocol(doc: {
  type?: string;
  title?: string;
  titleAr?: string;
  fileName?: string;
}): boolean {
  const hay = [doc.type, doc.title, doc.titleAr, doc.fileName]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  if (!hay) return false;
  return /החלטה|פרוטוקול|פסק[\s-]?דין|قرار|محضر|حكم|protocol|decision|ruling/.test(
    hay,
  );
}

/** Split a court decision/protocol SUMMARY (the one stored in Cloudflare) into
 *  the operative DECISION part and the REST, via the Worker. Returns null on
 *  failure (caller shows the plain summary). */
export async function splitDecisionSummary(
  summary: string,
  lang: Lang,
): Promise<{ decision: string; rest: string } | null> {
  const text = (summary || '').trim();
  if (!text) return null;
  try {
    const res = await fetch(WORKER_URL + '/api/split-decision', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + APP_TOKEN,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ summary: text, lang }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      ok?: boolean;
      decision?: string;
      rest?: string;
    };
    if (!data.ok) return null;
    return {
      decision: (data.decision || '').trim(),
      rest: (data.rest || '').trim(),
    };
  } catch {
    return null;
  }
}

/** Generate a COURT-MATCHED suggested next action for a case: the Worker maps
 *  the case's court ("שלום/מחוזי"→civil, "משפחה"→family+civil, "עבודה/ביטוח
 *  לאומי"→labor, "שרעי"→sharia, "עליון/בג״ץ"→hcj) to the relevant
 *  `legal_actions`, then picks the next step from THAT list given the latest
 *  document context. Saves it to `case_suggested_actions` and returns the
 *  formatted text. Returns null on failure (caller falls back to the existing
 *  suggestion). Used by the case-brain "הצעה לפעולה" card. */
export async function generateSuggestedAction(opts: {
  caseId: string;
  clientId?: string;
  court?: string;
  docSummary?: string;
  documentName?: string;
}): Promise<string | null> {
  const { caseId, clientId, court, docSummary, documentName } = opts;
  if (!caseId) return null;
  try {
    const res = await fetch(WORKER_URL + '/api/suggest-action', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + APP_TOKEN,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        case_id: caseId,
        client_id: clientId || '',
        court: court || '',
        doc_summary: docSummary || '',
        document_name: documentName || '',
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      ok?: boolean;
      suggested_action?: string;
      deadline?: string;
      legal_source?: string;
    };
    if (!data.ok || !data.suggested_action) return null;
    let txt = data.suggested_action.trim();
    const extras: string[] = [];
    if (data.deadline) extras.push('מועד: ' + data.deadline);
    if (data.legal_source) extras.push('מקור: ' + data.legal_source);
    if (extras.length) txt += ' — ' + extras.join(' · ');
    return txt;
  } catch {
    return null;
  }
}

/** Generate a reply draft for a PDF document that has none yet: obtain a
 *  temporary Dropbox link and hand it to /api/generate-draft (which fetches the
 *  PDF server-side and forwards it to the Worker's /api/draft → Claude → saves
 *  it in `drafts`). Returns true when a draft was produced. Used by the
 *  case-brain to fill the "טיוטת תגובה" card for the last document on demand. */
export async function generateDocumentDraft(opts: {
  relativePath?: string;
  fileName: string;
  clientId?: string;
  caseId?: string;
  documentId?: string;
  lawyerName?: string;
}): Promise<{ draftNeeded: boolean; hasDraft: boolean }> {
  const { relativePath, fileName, clientId, caseId, documentId, lawyerName } = opts;
  // Non-PDF can't be read/classified — default to "needed" so we never hide a
  // possibly-required reply.
  if (!relativePath || !/\.pdf$/i.test(fileName)) {
    return { draftNeeded: true, hasDraft: false };
  }
  let fileUrl: string | null = null;
  try {
    fileUrl = await getDropboxTemporaryLink(dropboxPathForRelative(relativePath));
  } catch {
    fileUrl = null;
  }
  if (!fileUrl) return { draftNeeded: true, hasDraft: false };
  try {
    const res = await fetch('/api/generate-draft/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileUrl, fileName, clientId, caseId, documentId, lawyerName }),
    });
    if (!res.ok) return { draftNeeded: true, hasDraft: false };
    const data = (await res.json()) as { has_draft?: boolean; draft_needed?: boolean };
    // draft_needed defaults to true unless the worker explicitly says false.
    return { draftNeeded: data.draft_needed !== false, hasDraft: !!data.has_draft };
  } catch {
    return { draftNeeded: true, hasDraft: false };
  }
}

/** Like {@link fetchDocumentDraft} but also returns the draft row's `status`,
 *  so the case-brain can gate the "טיוטת תגובה" card:
 *   - 'approved'   → a draft IS needed; show the text.
 *   - 'not_needed' → no draft needed; hide the card (show the suggested action).
 *   - 'draft'      → unclassified (written by the Make pipeline for every
 *                    document) → re-check once via {@link classifyDraftDecision}.
 *   - null         → no draft row yet.
 */
export async function fetchDraftState(
  opts: { caseId?: string; documentId?: string; preferLang?: 'ar' | 'he' | null },
  lang: Lang,
): Promise<{ text: string | null; status: string | null }> {
  const { caseId, documentId, preferLang } = opts;
  if (!caseId && !documentId) return { text: null, status: null };
  const params = new URLSearchParams();
  if (documentId) params.set('documentId', documentId);
  else if (caseId) params.set('caseId', caseId);
  try {
    const res = await fetch(WORKER_URL + '/api/drafts?' + params.toString(), {
      method: 'GET',
      headers: { Authorization: 'Bearer ' + APP_TOKEN },
    });
    if (!res.ok) return { text: null, status: null };
    const data = (await res.json()) as {
      drafts?: Array<{
        draft_he?: string;
        draft_ar?: string;
        language?: string;
        status?: string;
      }>;
    };
    const rows = data.drafts || [];
    if (rows.length === 0) return { text: null, status: null };
    const row = rows[0];
    const he = (row.draft_he || '').trim();
    const ar = (row.draft_ar || '').trim();
    let text: string | null;
    if (preferLang === 'ar') text = ar || he || null;
    else if (preferLang === 'he') text = he || ar || null;
    else
      text = pickDocumentLanguageSummary(
        { he, ar, language: (row.language || '').toLowerCase() },
        lang,
      );
    return { text, status: (row.status || '').toLowerCase() || null };
  } catch {
    return { text: null, status: null };
  }
}

/** Ask the Worker whether a reply draft is actually needed for a document:
 *  true when the OTHER side authored it or the court ordered a reply; false for
 *  our own document with no court order. Updates the draft row's status as a
 *  side effect (caches the decision). Non-PDF or any failure → defaults to
 *  `true` so a possibly-required reply is never hidden. */
export async function classifyDraftDecision(opts: {
  relativePath?: string;
  fileName: string;
  clientId?: string;
  caseId?: string;
  documentId?: string;
  lawyerName?: string;
}): Promise<{ draftNeeded: boolean }> {
  const { relativePath, fileName, clientId, caseId, documentId, lawyerName } = opts;
  if (!relativePath || !/\.pdf$/i.test(fileName)) return { draftNeeded: true };
  let fileUrl: string | null = null;
  try {
    fileUrl = await getDropboxTemporaryLink(dropboxPathForRelative(relativePath));
  } catch {
    fileUrl = null;
  }
  if (!fileUrl) return { draftNeeded: true };
  try {
    const res = await fetch('/api/classify-draft/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileUrl, fileName, clientId, caseId, documentId, lawyerName }),
    });
    if (!res.ok) return { draftNeeded: true };
    const data = (await res.json()) as { draft_needed?: boolean };
    return { draftNeeded: data.draft_needed !== false };
  } catch {
    return { draftNeeded: true };
  }
}

export interface DecisionInfo {
  taskDescription: string;
  taskDueDate: string;
  hearingDate: string;
}

/** Task + hearing derived from a ruling document, from the Cloudflare D1
 *  decisions/tasks/hearings tables. Matched by the document's renamed name,
 *  falling back to the client's latest decision. */
export async function fetchDecisionInfo(opts: {
  renamed?: string;
  clientId?: string;
}): Promise<DecisionInfo | null> {
  const { renamed, clientId } = opts;
  if (!renamed && !clientId) return null;
  const params = new URLSearchParams();
  if (renamed) params.set('file', renamed);
  if (clientId) params.set('clientId', clientId);
  try {
    const res = await fetch('/api/decision/?' + params.toString(), {
      method: 'GET',
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Partial<DecisionInfo>;
    const info: DecisionInfo = {
      taskDescription: (data.taskDescription || '').trim(),
      taskDueDate: (data.taskDueDate || '').trim(),
      hearingDate: (data.hearingDate || '').trim(),
    };
    return info.taskDescription || info.taskDueDate || info.hearingDate
      ? info
      : null;
  } catch {
    return null;
  }
}
