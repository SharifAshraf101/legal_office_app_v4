// Cloudflare backend client. Drop-in replacement for lib/supabase.ts: it keeps
// the SAME exported function names and signatures, so the only change at the
// call sites (hooks/useAppState.tsx, components/ClientAvatar.tsx) is the import
// path. Instead of hitting Supabase PostgREST/Storage directly, it talks to the
// Cloudflare Worker in worker/ (one GET /api/load, one POST /api/save, one
// POST /api/upload-photo). The Worker returns rows in the exact snake_case
// shape PostgREST used, so the normalize*/`*ToRow` helpers are ported verbatim.

import { applyLegalOfficeData, persistCurrentDataToLocalStorage } from './storage';
import { firstNonEmpty, isNonEmpty } from './utils';
import type {
  AppState,
  Case,
  CalendarEvent,
  Client,
  DocumentRecord,
  Finance,
  Task,
  TimelineItem,
} from '@/types';

// Configured via .env.local (see .env.example). NEXT_PUBLIC_* values are inlined
// into the client bundle at build time, the same way the Supabase URL/key were
// hardcoded before — only now they live outside the committed source.
const WORKER_URL = (process.env.NEXT_PUBLIC_WORKER_URL || '').replace(/\/$/, '');
const APP_TOKEN = process.env.NEXT_PUBLIC_APP_TOKEN || '';

// Only Authorization + Content-Type — any extra custom request header would have
// to be added to the Worker's Access-Control-Allow-Headers or the preflight fails.
// Freshness is enforced with `cache: 'no-store'` on the fetch instead.
const jsonHeaders = {
  Authorization: 'Bearer ' + APP_TOKEN,
  'Content-Type': 'application/json',
};

type Row = Record<string, unknown>;
const first = firstNonEmpty as <T = string>(o: Row | null | undefined, names: string[], def: T) => T;

function dateFromRow(r: Row): string {
  const val = first<string>(
    r,
    [
      'dateTime',
      'date_time',
      'event_time',
      'event_start',
      'start_time',
      'starts_at',
      'start_at',
      'dueDateTime',
      'due_date_time',
      'due_date',
      'date',
      'created_at',
    ],
    '',
  );
  if (!val) return '';
  try {
    if (String(val).includes('T')) return new Date(val).toISOString();
    const time = first<string>(r, ['time', 'hour', 'event_time_only'], '09:00');
    return new Date(String(val).slice(0, 10) + 'T' + String(time || '09:00')).toISOString();
  } catch {
    return String(val);
  }
}

// ---- normalize functions (ported from lib/supabase.ts) --------------------

function normalizeClient(r: Row): Client {
  const id = String(first(r, ['source_id', 'client_source_id', 'local_id', 'external_id', 'id'], '')).trim();
  const appId = id && !id.includes('-0000-') ? id : 'CLT-' + String(first(r, ['id'], '')).slice(0, 8);
  const name = String(first(r, ['full_name', 'name', 'client_name', 'title'], '')).trim();
  return {
    id: appId,
    name,
    nameAr: String(first(r, ['full_name_ar', 'name_ar', 'nameAr'], name)),
    phone: String(first(r, ['phone', 'phone_number', 'mobile'], '')),
    email: String(first(r, ['email'], '')),
    idNumber: String(first(r, ['id_number', 'idNumber', 'identity_number'], '')),
    address: String(first(r, ['address'], '')),
    addressAr: String(first(r, ['address_ar', 'addressAr', 'address'], '')),
    notes: String(first(r, ['notes', 'description'], '')),
    notesAr: String(first(r, ['notes_ar', 'notesAr', 'notes', 'description'], '')),
    photoUrl: String(first(r, ['photo_url', 'photoUrl'], '')),
    photoIcon: '\u{1F464}',
    supabaseId: String(first(r, ['id'], '')),
  };
}

function normalizeCase(r: Row, clientByUuid: Record<string, string>): Case {
  const id = String(first(r, ['source_id', 'case_source_id', 'local_id', 'external_id', 'id'], '')).trim();
  const appId = id && !id.includes('-0000-') ? id : 'CS-' + String(first(r, ['id'], '')).slice(0, 8);
  const clientId =
    String(first(r, ['client_source_id', 'clientId'], '')) ||
    clientByUuid[String(first(r, ['client_id'], ''))] ||
    '';
  const title = String(first(r, ['case_type', 'title', 'name', 'matter', 'claim_type'], ''));
  return {
    id: appId,
    clientId,
    caseNumber: String(first(r, ['case_number', 'caseNumber', 'court_case_number', 'number'], '')),
    title,
    titleAr: String(first(r, ['title_ar', 'titleAr', 'case_type_ar', 'case_type'], title)),
    status: String(first(r, ['status'], 'active')) || 'active',
    description: String(first(r, ['description', 'notes'], '')),
    descriptionAr: String(first(r, ['description_ar', 'descriptionAr', 'description', 'notes'], '')),
    court: String(first(r, ['court', 'court_name'], '')),
    courtAr: String(first(r, ['court_ar', 'courtAr', 'court', 'court_name'], '')),
    agreedFee: Number(first(r, ['agreed_fee', 'agreedFee', 'fee'], 0) || 0),
    lastHearing: String(first(r, ['last_hearing', 'lastHearing'], '')),
    supabaseId: String(first(r, ['id'], '')),
  };
}

function normalizeTask(
  r: Row,
  clientByUuid: Record<string, string>,
  caseByUuid: Record<string, string>,
  caseBySource: Record<string, Case>,
): Task {
  const caseId =
    String(first(r, ['case_source_id', 'caseId'], '')) ||
    caseByUuid[String(first(r, ['case_id'], ''))] ||
    '';
  const c = caseBySource[caseId] || ({} as Case);
  const clientId =
    String(first(r, ['client_source_id', 'clientId'], '')) ||
    clientByUuid[String(first(r, ['client_id'], ''))] ||
    c.clientId ||
    '';
  const id = String(first(r, ['source_id', 'task_source_id', 'local_id', 'external_id', 'id'], '')).trim();
  const appId = id && !id.includes('-0000-') ? id : 'TASK-' + String(first(r, ['id'], '')).slice(0, 8);
  const dueRaw = String(first(r, ['due_date', 'dueDate', 'date'], ''));
  return {
    id: appId,
    title: String(first(r, ['title', 'name', 'subject'], '')),
    caseId,
    clientId,
    dueDate: dueRaw ? dueRaw.slice(0, 10) : '',
    status: String(first(r, ['status'], 'open')) || 'open',
    priority: String(first(r, ['priority'], 'normal')) || 'normal',
    notes: String(first(r, ['notes', 'description'], '')),
    createdAt: String(first(r, ['created_at', 'createdAt'], new Date().toISOString())),
    doneAt: String(first(r, ['done_at', 'doneAt'], '')),
    supabaseId: String(first(r, ['id'], '')),
  };
}

function normalizeEvent(
  r: Row,
  clientByUuid: Record<string, string>,
  caseByUuid: Record<string, string>,
  caseBySource: Record<string, Case>,
): CalendarEvent | null {
  const rawType = String(first(r, ['type', 'event_type', 'category'], 'hearingMeeting'));
  const title = String(first(r, ['title', 'name', 'subject'], ''));
  const lower = (rawType + ' ' + title).toLowerCase();
  if (['task', 'document', 'note', 'call'].includes(rawType) || /כתב תביעה|מסמך|document|task/.test(lower)) {
    return null;
  }
  const caseId =
    String(first(r, ['case_source_id', 'caseId'], '')) ||
    caseByUuid[String(first(r, ['case_id'], ''))] ||
    '';
  const c = caseBySource[caseId] || ({} as Case);
  const clientId =
    String(first(r, ['client_source_id', 'clientId'], '')) ||
    clientByUuid[String(first(r, ['client_id'], ''))] ||
    c.clientId ||
    '';
  const dt = dateFromRow(r);
  if (!dt) return null;
  const id = String(first(r, ['source_id', 'event_source_id', 'local_id', 'external_id', 'id'], '')).trim();
  const appId = id && !id.includes('-0000-') ? id : 'EV-' + String(first(r, ['id'], '')).slice(0, 8);
  return {
    id: appId,
    caseId,
    clientId,
    client_source_id: clientId,
    case_source_id: caseId,
    title,
    titleAr: String(first(r, ['title_ar', 'titleAr', 'title'], title)),
    dateTime: dt,
    description: String(first(r, ['description', 'notes'], title)),
    descriptionAr: String(first(r, ['description_ar', 'descriptionAr', 'description', 'notes'], title)),
    type: rawType === 'meeting' ? 'meeting' : 'hearingMeeting',
    supabaseId: String(first(r, ['id'], '')),
  };
}

function normalizeDocument(
  r: Row,
  clientByUuid: Record<string, string>,
  caseByUuid: Record<string, string>,
  caseBySource: Record<string, Case>,
): DocumentRecord {
  const caseId =
    String(first(r, ['case_source_id', 'caseId'], '')) ||
    caseByUuid[String(first(r, ['case_id'], ''))] ||
    '';
  const c = caseBySource[caseId] || ({} as Case);
  const clientId =
    String(first(r, ['client_source_id', 'clientId'], '')) ||
    clientByUuid[String(first(r, ['client_id'], ''))] ||
    c.clientId ||
    '';
  const id = String(first(r, ['source_id', 'doc_source_id', 'document_source_id', 'id'], '')).trim();
  const appId = id && !id.includes('-0000-') ? id : 'DOC-' + String(first(r, ['id'], '')).slice(0, 8);
  return {
    id: appId,
    caseId,
    clientId,
    title: String(first(r, ['title', 'file_name', 'filename', 'name'], '')),
    titleAr: String(first(r, ['title_ar', 'titleAr'], '')),
    description: String(first(r, ['description', 'notes'], '')),
    descriptionAr: String(first(r, ['description_ar', 'descriptionAr', 'notes_ar'], '')),
    fileName: String(first(r, ['file_name', 'filename', 'title', 'name'], '')),
    relativePath: String(first(r, ['relative_path', 'path', 'document_path'], '')),
    date: String(first(r, ['date', 'created_at', 'uploaded_at'], new Date().toISOString())).slice(0, 10),
    // Keep the FULL timestamp so same-day documents sort by time, newest first.
    uploadedAt: String(first(r, ['uploaded_at', 'created_at'], '')) || undefined,
    summaryHe: String(first(r, ['summary_he', 'summaryHe'], '')) || undefined,
    summaryAr: String(first(r, ['summary_ar', 'summaryAr'], '')) || undefined,
    type: 'document',
  };
}

function normalizeFinance(
  r: Row,
  _clientByUuid: Record<string, string>,
  caseByUuid: Record<string, string>,
  _caseBySource: Record<string, Case>,
): Finance | null {
  const caseId =
    String(first(r, ['case_source_id', 'caseId'], '')) ||
    caseByUuid[String(first(r, ['case_id'], ''))] ||
    '';
  if (!caseId) return null;
  const id = String(first(r, ['source_id', 'payment_source_id', 'id'], '')).trim();
  const appId = id && !id.includes('-0000-') ? id : 'PAY-' + String(first(r, ['id'], '')).slice(0, 8);
  return {
    id: appId,
    caseId,
    date: String(first(r, ['date', 'payment_date', 'created_at'], new Date().toISOString())).slice(0, 10),
    amount: Number(first(r, ['amount', 'sum'], 0) || 0),
    type: String(first(r, ['type', 'payment_type'], 'payment')),
    description: String(first(r, ['description', 'notes'], '')),
    descriptionAr: String(first(r, ['description_ar', 'descriptionAr', 'description', 'notes'], '')),
  };
}

// ---- /api/load boot loader (name kept for call-site compatibility) --------

export interface SupabaseLoadResult {
  loaded: boolean;
  state?: ReturnType<typeof applyLegalOfficeData>['state'];
}

interface LoadOptions {
  force?: boolean;
  currentState?: AppState;
}

interface LoadResponse {
  clients?: Row[];
  cases?: Row[];
  tasks?: Row[];
  calendar_events?: Row[];
  documents?: Row[];
  payments?: Row[];
  timeline_items?: Row[];
  app_state?: Record<string, unknown> | null;
}

let loading = false;
let loadedOnce = false;

export async function legalOfficeLoadFromSupabaseV88(
  options: LoadOptions = {},
): Promise<SupabaseLoadResult> {
  if (loading) return { loaded: true };
  // In-memory guard: skip if we've already loaded within this page session
  // (avoids re-fetching on every React re-render). Cloudflare is the source of
  // truth, so every fresh page load pulls the latest rows from there.
  if (!options.force && loadedOnce) return { loaded: true };
  loading = true;
  try {
    const res = await fetch(WORKER_URL + '/api/load', { headers: jsonHeaders, cache: 'no-store' });
    if (!res.ok) {
      console.warn('[LegalOffice Cloudflare load] failed', res.status, await res.text());
      return { loaded: false };
    }
    const data = (await res.json()) as LoadResponse;

    const clientRows = data.clients ?? [];
    const caseRows = data.cases ?? [];
    const taskRows = data.tasks ?? [];
    const eventRows = data.calendar_events ?? [];
    const docRows = data.documents ?? [];
    const paymentRows = data.payments ?? [];
    const timelineRows = data.timeline_items ?? [];

    const loadedClients = clientRows
      .map(normalizeClient)
      .filter((x) => x.id && (x.name || x.phone || x.idNumber));
    const clientByUuid: Record<string, string> = {};
    loadedClients.forEach((c) => {
      if (c.supabaseId) clientByUuid[c.supabaseId] = c.id;
    });

    const loadedCases = caseRows
      .map((r) => normalizeCase(r, clientByUuid))
      .filter((x) => x.id && (x.clientId || x.caseNumber || x.title));
    const caseByUuid: Record<string, string> = {};
    const caseBySource: Record<string, Case> = {};
    loadedCases.forEach((c) => {
      if (c.supabaseId) caseByUuid[c.supabaseId] = c.id;
      caseBySource[c.id] = c;
    });

    const loadedTasks = taskRows
      .map((r) => normalizeTask(r, clientByUuid, caseByUuid, caseBySource))
      .filter((x) => x.id && x.title);
    const loadedEvents = eventRows
      .map((r) => normalizeEvent(r, clientByUuid, caseByUuid, caseBySource))
      .filter((x): x is CalendarEvent => x !== null);
    const loadedDocs = docRows
      .map((r) => normalizeDocument(r, clientByUuid, caseByUuid, caseBySource))
      .filter((x) => x.id && (x.title || x.fileName));
    const loadedFinances = paymentRows
      .map((r) => normalizeFinance(r, clientByUuid, caseByUuid, caseBySource))
      .filter((x): x is Finance => x !== null);

    const loadedTimeline: TimelineItem[] = timelineRows
      .map((r) => {
        const caseId =
          String(first(r, ['case_source_id', 'caseId'], '')) ||
          caseByUuid[String(first(r, ['case_id'], ''))] ||
          '';
        const id = String(first(r, ['source_id', 'id'], ''));
        return {
          id: id || 'TL-' + Date.now(),
          caseId,
          type: String(first(r, ['type', 'item_type'], 'note')),
          title: String(first(r, ['title', 'name', 'subject'], '')),
          titleAr: String(first(r, ['title_ar', 'titleAr', 'title'], '')),
          date: String(first(r, ['date', 'created_at'], new Date().toISOString())).slice(0, 10),
          description: String(first(r, ['description', 'notes'], '')),
          descriptionAr: String(first(r, ['description_ar', 'descriptionAr', 'description', 'notes'], '')),
        };
      })
      .filter((x) => isNonEmpty(x.caseId) && isNonEmpty(x.title));

    const total =
      loadedClients.length +
      loadedCases.length +
      loadedTasks.length +
      loadedEvents.length +
      loadedDocs.length +
      loadedFinances.length +
      loadedTimeline.length;

    if (total === 0) {
      const candidate = data.app_state;
      if (
        candidate &&
        typeof candidate === 'object' &&
        (Array.isArray((candidate as { clients?: unknown[] }).clients) ||
          Array.isArray((candidate as { cases?: unknown[] }).cases))
      ) {
        const applied = applyLegalOfficeData(candidate as never);
        if (options.currentState) {
          persistCurrentDataToLocalStorage({ ...options.currentState, ...applied.state });
        }
        loadedOnce = true;
        return { loaded: true, state: applied.state };
      }
      return { loaded: false };
    }

    const applied = applyLegalOfficeData({
      clients: loadedClients,
      cases: loadedCases,
      tasks: loadedTasks,
      events: loadedEvents,
      documents: loadedDocs,
      finances: loadedFinances,
      payments: loadedFinances,
      timeline: loadedTimeline,
    });
    if (options.currentState) {
      persistCurrentDataToLocalStorage({ ...options.currentState, ...applied.state });
    }
    loadedOnce = true;
    console.log('[LegalOffice Cloudflare load] loaded rows', {
      clients: loadedClients.length,
      cases: loadedCases.length,
      tasks: loadedTasks.length,
      events: loadedEvents.length,
      documents: loadedDocs.length,
      finances: loadedFinances.length,
      timeline: loadedTimeline.length,
    });
    return { loaded: true, state: applied.state };
  } catch (e) {
    console.error('[LegalOffice Cloudflare load] failed', e);
    return { loaded: false };
  } finally {
    loading = false;
  }
}

// ---- Live save (one POST /api/save) ---------------------------------------
// Mirrors how the loader reads: writes back into the same columns the
// normalize* functions read from, keyed on (user_id, source_id) so the
// Worker's ON CONFLICT upsert resolves.

function emptyToNull(v: string | undefined | null): string | null {
  const s = (v ?? '').toString();
  return s.length ? s : null;
}

function clientToRow(c: Client): Record<string, unknown> {
  return {
    source_id: c.id,
    full_name: emptyToNull(c.name),
    full_name_ar: emptyToNull(c.nameAr),
    phone: emptyToNull(c.phone),
    email: emptyToNull(c.email),
    id_number: emptyToNull(c.idNumber),
    address: emptyToNull(c.address),
    address_ar: emptyToNull(c.addressAr),
    notes: emptyToNull(c.notes),
    notes_ar: emptyToNull(c.notesAr),
    photo_url: emptyToNull(c.photoUrl),
  };
}

function caseToRow(c: Case): Record<string, unknown> {
  return {
    source_id: c.id,
    client_source_id: emptyToNull(c.clientId),
    case_number: emptyToNull(c.caseNumber),
    title: emptyToNull(c.title),
    title_ar: emptyToNull(c.titleAr),
    status: c.status || 'active',
    description: emptyToNull(c.description),
    description_ar: emptyToNull(c.descriptionAr),
    court: emptyToNull(c.court),
    court_ar: emptyToNull(c.courtAr),
    agreed_fee: typeof c.agreedFee === 'number' ? c.agreedFee : 0,
    last_hearing: emptyToNull(c.lastHearing),
  };
}

function taskToRow(t: Task): Record<string, unknown> {
  return {
    source_id: t.id,
    case_source_id: emptyToNull(t.caseId),
    client_source_id: emptyToNull(t.clientId),
    title: t.title || '',
    due_date: emptyToNull(t.dueDate),
    status: t.status || 'open',
    priority: t.priority || 'normal',
    notes: emptyToNull(t.notes),
    done_at: emptyToNull(t.doneAt),
  };
}

function eventToRow(e: CalendarEvent): Record<string, unknown> {
  return {
    source_id: e.id,
    case_source_id: emptyToNull(e.caseId ?? e.case_source_id),
    client_source_id: emptyToNull(e.clientId ?? e.client_source_id),
    title: emptyToNull(e.title),
    title_ar: emptyToNull(e.titleAr),
    date_time: emptyToNull(e.dateTime),
    description: emptyToNull(e.description),
    description_ar: emptyToNull(e.descriptionAr),
    type: e.type || 'hearingMeeting',
  };
}

function docToRow(d: DocumentRecord): Record<string, unknown> {
  return {
    source_id: d.id,
    case_source_id: emptyToNull(d.caseId),
    client_source_id: emptyToNull(d.clientId),
    title: emptyToNull(d.title),
    title_ar: emptyToNull(d.titleAr),
    description: emptyToNull(d.description),
    description_ar: emptyToNull(d.descriptionAr),
    file_name: emptyToNull(d.fileName),
    relative_path: emptyToNull(d.relativePath),
    date: emptyToNull(d.date),
    summary_he: emptyToNull(d.summaryHe),
    summary_ar: emptyToNull(d.summaryAr),
  };
}

function financeToRow(f: Finance): Record<string, unknown> {
  return {
    source_id: f.id,
    case_source_id: emptyToNull(f.caseId),
    date: emptyToNull(f.date),
    amount: typeof f.amount === 'number' ? f.amount : 0,
    type: f.type || 'payment',
    description: emptyToNull(f.description),
    description_ar: emptyToNull(f.descriptionAr),
  };
}

function timelineToRow(t: TimelineItem): Record<string, unknown> {
  return {
    source_id: t.id,
    case_source_id: emptyToNull(t.caseId),
    type: t.type || 'note',
    title: emptyToNull(t.title),
    title_ar: emptyToNull(t.titleAr),
    date: emptyToNull(t.date),
    description: emptyToNull(t.description),
    description_ar: emptyToNull(t.descriptionAr),
  };
}

export interface SupabaseSaveInput {
  clients: Client[];
  casesArr: Case[];
  tasksArr: Task[];
  eventsList: CalendarEvent[];
  documentsArr: DocumentRecord[];
  finances: Finance[];
  timelineItems: TimelineItem[];
}

export async function legalOfficeSaveToSupabase(s: SupabaseSaveInput): Promise<void> {
  const body = {
    clients: s.clients.filter((x) => x.id).map(clientToRow),
    cases: s.casesArr.filter((x) => x.id).map(caseToRow),
    tasks: s.tasksArr.filter((x) => x.id).map(taskToRow),
    calendar_events: s.eventsList.filter((x) => x.id).map(eventToRow),
    documents: s.documentsArr.filter((x) => x.id).map(docToRow),
    payments: s.finances.filter((x) => x.id).map(financeToRow),
    timeline_items: s.timelineItems.filter((x) => x.id).map(timelineToRow),
  };
  try {
    const res = await fetch(WORKER_URL + '/api/save', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.warn('[LegalOffice Cloudflare save] failed', res.status, await res.text());
    }
  } catch (e) {
    console.warn('[LegalOffice Cloudflare save] error', e);
  }
}

// ---- Client photo upload (POST /api/upload-photo) -------------------------
// Returns the public URL of the uploaded photo, or null on failure (callers
// fall back to a data URL preview).

export async function uploadClientPhotoToStorage(
  file: File,
  clientId: string,
): Promise<string | null> {
  const form = new FormData();
  form.append('file', file);
  form.append('clientId', clientId);
  try {
    const res = await fetch(WORKER_URL + '/api/upload-photo', {
      method: 'POST',
      // NOTE: no Content-Type header — the browser sets the multipart boundary.
      headers: { Authorization: 'Bearer ' + APP_TOKEN },
      body: form,
    });
    if (!res.ok) {
      console.warn('[LegalOffice Cloudflare storage] photo upload failed', res.status, await res.text());
      return null;
    }
    const data = (await res.json()) as { url?: string };
    return data.url || null;
  } catch (e) {
    console.warn('[LegalOffice Cloudflare storage] photo upload error', e);
    return null;
  }
}
