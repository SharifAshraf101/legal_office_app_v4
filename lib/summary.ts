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

/** A document summary in three forms: `orig` is the summary in the document's
 *  OWN language (any language); `he`/`ar` are the Hebrew/Arabic translations
 *  used by the bilingual screens. `language` is the document's language code. */
export interface DocSummaryData {
  he: string;
  ar: string;
  orig: string;
  language: string;
}

/** Raw summary for a document, or null when nothing matches. */
export async function fetchDocumentSummaryBoth(
  opts: SummaryOpts,
): Promise<DocSummaryData | null> {
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
      orig?: string;
      language?: string;
    };
    const he = (data.he || '').trim();
    const ar = (data.ar || '').trim();
    const orig = (data.orig || '').trim();
    if (!he && !ar && !orig) return null;
    return { he, ar, orig, language: (data.language || '').toLowerCase() };
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
}): Promise<DocSummaryData | null> {
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
      orig?: string;
      language?: string;
    };
    const he = (data.he || '').trim();
    const ar = (data.ar || '').trim();
    const orig = (data.orig || '').trim();
    if (!he && !ar && !orig) return null;
    return { he, ar, orig, language: (data.language || '').toLowerCase() };
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

/** Normalize a stored / AI-returned language value to 'ar' | 'he' | ''.
 *  Tolerant of the many shapes the value arrives in: the bare codes, full
 *  words in English ("arabic"/"hebrew"), locale tags ("ar-EG"), or the value
 *  itself written in Arabic/Hebrew script ("عربية"/"עברית"). This is why an
 *  Arabic document could wrongly render in Hebrew before — the old code only
 *  matched the exact string 'ar'. */
export function normalizeDocLang(raw?: string | null): 'ar' | 'he' | '' {
  const v = (raw || '').trim().toLowerCase();
  if (!v) return '';
  if (
    v === 'ar' ||
    v.startsWith('ar') ||
    v.includes('arab') ||
    v.includes('عرب') ||
    /[؀-ۿ]/.test(v) // any Arabic-script letter in the value
  ) {
    return 'ar';
  }
  if (
    v === 'he' ||
    v.startsWith('he') ||
    v.includes('hebr') ||
    v.includes('עבר') ||
    /[֐-׿]/.test(v) // any Hebrew-script letter in the value
  ) {
    return 'he';
  }
  return '';
}

/** Detect the dominant script of a piece of text: 'ar' when it has more
 *  Arabic letters than Hebrew, 'he' when the reverse, '' when neither. */
export function detectScriptLang(text?: string | null): 'ar' | 'he' | '' {
  const s = text || '';
  const ar = (s.match(/[؀-ۿ]/g) || []).length;
  const he = (s.match(/[֐-׿]/g) || []).length;
  if (ar === 0 && he === 0) return '';
  return ar >= he ? 'ar' : 'he';
}

/** Resolve the effective language a document's boxes should render in. Order:
 *   1. the stored `language` field, normalized (handles variants); then
 *   2. when only ONE of the summaries is present, that summary's script (an
 *      Arabic-only summary ⇒ Arabic document); then
 *   3. the app language as a last resort.
 *  Never returns '' — the caller always gets a concrete language. */
export function resolveDocLang(
  data: { he: string; ar: string; language?: string },
  appLang: Lang,
): 'ar' | 'he' {
  const norm = normalizeDocLang(data.language);
  if (norm) return norm;
  const he = (data.he || '').trim();
  const ar = (data.ar || '').trim();
  if (ar && !he) return 'ar';
  if (he && !ar) return 'he';
  return appLang === 'ar' ? 'ar' : 'he';
}

/** Choose the summary in the document's own language (he/ar pair). */
export function pickDocumentLanguageSummary(
  data: { he: string; ar: string; language?: string },
  appLang: Lang,
): string | null {
  const docLang = resolveDocLang(data, appLang);
  const primary = docLang === 'ar' ? data.ar : data.he;
  const fallback = docLang === 'ar' ? data.he : data.ar;
  return (primary || fallback || '').trim() || null;
}

/** Text direction of a string: 'rtl' when it contains Hebrew or Arabic-script
 *  letters (covering Arabic-script languages like Farsi/Urdu and the Arabic
 *  presentation forms), otherwise 'ltr'. Detected from the TEXT itself, so it's
 *  correct no matter the app language or any stored language code. */
export function isRtlText(text?: string | null): boolean {
  const s = text || '';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (
      (c >= 0x0590 && c <= 0x05ff) || // Hebrew
      (c >= 0x0600 && c <= 0x06ff) || // Arabic
      (c >= 0x0750 && c <= 0x077f) || // Arabic Supplement
      (c >= 0x08a0 && c <= 0x08ff) || // Arabic Extended-A
      (c >= 0xfb1d && c <= 0xfdff) || // Hebrew + Arabic presentation forms A
      (c >= 0xfe70 && c <= 0xfeff)    // Arabic presentation forms B
    ) {
      return true;
    }
  }
  return false;
}

/** True when a case's court is a religious court whose proceedings are conducted
 *  in Arabic — the Sharia (Muslim), Druze, or Christian ecclesiastical courts.
 *  Documents filed there are summarized in Arabic regardless of the language of
 *  any individual page (e.g. an automatic Hebrew filing-receipt cover page). */
export function isArabicOnlyCourt(court?: string | null): boolean {
  const c = (court || '').toLowerCase();
  if (!c) return false;
  return (
    /שרע|شرع/.test(c) || // Sharia / بيت الدين الشرعي
    /דרוז|درز/.test(c) || // Druze / درزي
    /כנסיי|כנסייה|כנסיה|נוצר|كنسي|كنيسة|مسيح/.test(c) // Christian ecclesiastical
  );
}

/** Short label of the court track a case's suggested action is drawn from —
 *  mirrors the worker's mapCourtTypes — for the "הצעה לפעולה" badge (e.g.
 *  "שרעי" / "משפחה" / "אזרחי"). Returns '' when the case has no court text.
 *  Druze / Christian ecclesiastical courts fall back to the civil track (the
 *  table has no dedicated legal_actions for them), matching the worker. */
export function caseCourtTrackLabel(court: string | null | undefined, lang: Lang): string {
  const c = (court || '').toLowerCase();
  if (!c) return '';
  if (/שרע|شرع/.test(c)) return lang === 'ar' ? 'شرعي' : 'שרעי';
  if (/משפח|عائل|أسر|family/.test(c)) return lang === 'ar' ? 'أحوال شخصية' : 'משפחה';
  if (/עבוד|ביטוח לאומי|عمل|تأمين وطني|labor/.test(c))
    return lang === 'ar' ? 'عمل' : 'עבודה';
  if (/עליון|בג["”'׳״]?ץ|בגץ|عليا|عدل عليا|high court|hcj/.test(c))
    return lang === 'ar' ? 'العليا' : 'בג״ץ';
  if (/פליל|جزائ|جناي|criminal/.test(c)) return lang === 'ar' ? 'جزائي' : 'פלילי';
  return lang === 'ar' ? 'مدني' : 'אזרחי'; // שלום / מחוזי + default
}

/** Summary text in the document's OWN language, for ANY language. Prefers the
 *  native `orig` column (Arabic doc → Arabic, English doc → English, French →
 *  French, …). Falls back to the he/ar translation (document-language aware)
 *  for rows written before the native column existed. */
export function pickNativeSummary(
  data: { he: string; ar: string; orig?: string; language?: string },
  appLang: Lang,
): string | null {
  const orig = (data.orig || '').trim();
  if (orig) return orig;
  return pickDocumentLanguageSummary(data, appLang);
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
        draft_orig?: string;
        language?: string;
      }>;
    };
    const rows = data.drafts || [];
    if (rows.length === 0) return null;
    // The endpoint already filtered to this document (or the case when no
    // document id), so the first row is the right one — no cross-document
    // guessing.
    const row = rows[0];
    // Native-language draft (any language) wins — it's already written in the
    // document's own language, matching the "פענוח" box.
    const orig = (row.draft_orig || '').trim();
    if (orig) return orig;
    const he = (row.draft_he || '').trim();
    const ar = (row.draft_ar || '').trim();
    // Legacy he/ar-only rows: copy the matching column as-is.
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

/** True when a document is (or contains) a court DECISION / PROTOCOL — checked
 *  against the document's type/title/file name AND, when provided, its summary
 *  text. The summary check matters because a decision is often written ON
 *  another document (e.g. a defense), so the file is named "כתב הגנה" while the
 *  summary says "קיימת החלטה…". Those get the split decode (decision first,
 *  then the rest). */
export function isDecisionOrProtocol(
  doc: { type?: string; title?: string; titleAr?: string; fileName?: string },
  summary?: string | null,
): boolean {
  const meta = [doc.type, doc.title, doc.titleAr, doc.fileName]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  const inMeta =
    !!meta &&
    /החלטה|פרוטוקול|פסק[\s-]?דין|قرار|محضر|حكم|protocol|decision|ruling/.test(
      meta,
    );
  if (inMeta) return true;
  const sum = (summary || '').toLowerCase();
  // Strong decision markers inside the summary text.
  return (
    !!sum &&
    /החלטה|פסק[\s-]?דין|פרוטוקול|בית\s*(הדין|המשפט)\s*(מורה|קובע|מחייב|דוחה|הורה|פסק)|נדרש[הת]?\s*להגיב|צו\b|قرار|حكم|محضر|تقرر|يُلزم|أمرت/.test(
      sum,
    )
  );
}

/** Split a court decision/protocol SUMMARY (the one stored in Cloudflare) into
 *  the operative DECISION part, the REST, and any TASK the decision imposes on
 *  the office (action + due date). Returns null on failure (caller shows the
 *  plain summary). */
export async function splitDecisionSummary(
  summary: string,
  lang: Lang,
  /** Our office/lawyer name — a task is only created when the decision
   *  obligates OUR client (this lawyer's client) to a procedural response. */
  lawyerName?: string,
  /** The case's client — the party WE represent. Lets the model tell which
   *  side (plaintiff/defendant) is ours, so the task is the one imposed on our
   *  client, not the opposing party. */
  clientName?: string,
): Promise<{
  decision: string;
  rest: string;
  taskTitle: string;
  taskDueDate: string;
  /** Next hearing/session date the decision sets (YYYY-MM-DD), or ''. */
  hearingDate: string;
  /** Hearing time (HH:MM), or '' when the decision gives only a date. */
  hearingTime: string;
} | null> {
  const text = (summary || '').trim();
  if (!text) return null;
  try {
    const res = await fetch(WORKER_URL + '/api/split-decision', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + APP_TOKEN,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        summary: text,
        lang,
        lawyer_name: lawyerName,
        client_name: clientName,
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      ok?: boolean;
      decision?: string;
      rest?: string;
      task_title?: string;
      task_due_date?: string;
      hearing_date?: string;
      hearing_time?: string;
    };
    if (!data.ok) return null;
    return {
      decision: (data.decision || '').trim(),
      rest: (data.rest || '').trim(),
      taskTitle: (data.task_title || '').trim(),
      taskDueDate: (data.task_due_date || '').trim(),
      hearingDate: (data.hearing_date || '').trim(),
      hearingTime: (data.hearing_time || '').trim(),
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
  /** Language the suggestion text should be written in. 'ar' forces Arabic
   *  (used for Sharia / Druze / Christian ecclesiastical courts). */
  lang?: 'he' | 'ar';
}): Promise<string | null> {
  const { caseId, clientId, court, docSummary, documentName, lang } = opts;
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
        lang: lang || 'he',
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
    if (data.deadline)
      extras.push((lang === 'ar' ? 'الموعد: ' : 'מועד: ') + data.deadline);
    if (data.legal_source)
      extras.push((lang === 'ar' ? 'المصدر: ' : 'מקור: ') + data.legal_source);
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
  opts: {
    caseId?: string;
    documentId?: string;
    preferLang?: 'ar' | 'he' | null;
    /** Sharia / Druze / Christian court → return the Arabic draft only. */
    forceArabic?: boolean;
  },
  lang: Lang,
): Promise<{ text: string | null; status: string | null }> {
  const { caseId, documentId, preferLang, forceArabic } = opts;
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
        draft_orig?: string;
        language?: string;
        status?: string;
      }>;
    };
    const rows = data.drafts || [];
    if (rows.length === 0) return { text: null, status: null };
    const row = rows[0];
    const status = (row.status || '').toLowerCase() || null;
    const orig = (row.draft_orig || '').trim();
    const he = (row.draft_he || '').trim();
    const ar = (row.draft_ar || '').trim();
    let text: string | null;
    if (forceArabic) text = ar || orig || he || null;
    else if (orig) text = orig;
    else if (preferLang === 'ar') text = ar || he || null;
    else if (preferLang === 'he') text = he || ar || null;
    else
      text = pickDocumentLanguageSummary(
        { he, ar, language: (row.language || '').toLowerCase() },
        lang,
      );
    return { text, status };
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
