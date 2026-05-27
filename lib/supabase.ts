// Supabase boot loader and delete RPC. Port of:
//   - legalOfficeLoadFromSupabaseV88 (source line 5239)
//   - supabaseDeleteBySource / supabaseDeleteMany (source line 9775+)
//
// All requests use REST + anon publishable key, matching the source. Live save
// (v90/v91) is intentionally left for Stage 4 — it depends on screen-level
// triggers that don't exist yet.

import { applyLegalOfficeData, LS, lsSet, persistCurrentDataToLocalStorage } from './storage';
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

const SUPABASE_URL = 'https://mtrsrfisfaxmtpujeddh.supabase.co';
const SUPABASE_KEY = 'sb_publishable_XF-KIsQzJKokfdNCze3k6g_3WiG2CuU';
const USER_ID = 'c0307382-5fd2-4a2b-88df-40b22bb9ad26';
const API = SUPABASE_URL.replace(/\/$/, '') + '/rest/v1';

const headers = {
  apikey: SUPABASE_KEY,
  Authorization: 'Bearer ' + SUPABASE_KEY,
  'Content-Type': 'application/json',
  'Cache-Control': 'no-cache',
  Pragma: 'no-cache',
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

async function getTable(table: string): Promise<Row[]> {
  const url = API + '/' + table + '?user_id=eq.' + encodeURIComponent(USER_ID) + '&select=*';
  try {
    const res = await fetch(url, { headers });
    if (!res.ok) {
      console.warn('[LegalOffice Supabase load v88] table load failed', table, res.status, await res.text());
      return [];
    }
    const data = await res.json();
    return Array.isArray(data) ? (data as Row[]) : [];
  } catch (e) {
    console.warn('[LegalOffice Supabase load v88] table error', table, e);
    return [];
  }
}

// ---- normalize functions (source 5273-5374) -------------------------------

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

// ---- v88 boot loader ------------------------------------------------------

export interface SupabaseLoadResult {
  loaded: boolean;
  state?: ReturnType<typeof applyLegalOfficeData>['state'];
}

interface LoadOptions {
  force?: boolean;
  currentState?: AppState;
}

let loading = false;
let loadedOnce = false;

export async function legalOfficeLoadFromSupabaseV88(
  options: LoadOptions = {},
): Promise<SupabaseLoadResult> {
  if (loading) return { loaded: true };
  // In-memory guard: skip if we've already loaded within this page session
  // (avoids re-fetching on every React re-render). The cross-session
  // localStorage guard was intentionally removed — Supabase is the source
  // of truth, so every fresh page load pulls the latest rows from there.
  if (!options.force && loadedOnce) return { loaded: true };
  loading = true;
  try {
    const [
      clientRows,
      caseRows,
      taskRows,
      eventRows,
      docRows,
      financeRows,
      paymentRows,
      timelineRows,
      timelineEntryRows,
    ] = await Promise.all([
      getTable('clients'),
      getTable('cases'),
      getTable('tasks'),
      getTable('calendar_events'),
      getTable('documents'),
      getTable('finances'),
      getTable('payments'),
      getTable('timeline_items'),
      getTable('timeline_entries'),
    ]);

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
    const loadedFinances = [...financeRows, ...paymentRows]
      .map((r) => normalizeFinance(r, clientByUuid, caseByUuid, caseBySource))
      .filter((x): x is Finance => x !== null);

    const loadedTimeline: TimelineItem[] = [...timelineRows, ...timelineEntryRows]
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
      const appStateRows = await getTable('app_state');
      for (const row of appStateRows) {
        const candidate = (row.state || row.data || row.app_state || row.payload || row.value) as
          | Record<string, unknown>
          | undefined;
        if (
          candidate &&
          typeof candidate === 'object' &&
          (Array.isArray((candidate as { clients?: unknown[] }).clients) ||
            Array.isArray((candidate as { cases?: unknown[] }).cases))
        ) {
          const applied = applyLegalOfficeData(candidate as never);
          if (options.currentState) persistCurrentDataToLocalStorage({ ...options.currentState, ...applied.state });
          loadedOnce = true;
          return { loaded: true, state: applied.state };
        }
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
    console.log('[LegalOffice Supabase load v88] loaded rows', {
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
    console.error('[LegalOffice Supabase load v88] failed', e);
    lsSet(LS.SUPA_LOAD_ERROR_V88, String((e as Error)?.message ?? e));
    return { loaded: false };
  } finally {
    loading = false;
  }
}

// ---- Live save (per-table PostgREST upserts) ------------------------------
// Mirrors how the loader reads: writes back into the same columns the
// normalize* functions read from, keyed on (user_id, source_id) so the
// schema's `unique` constraint resolves the upsert.

const upsertHeaders = {
  ...headers,
  Prefer: 'resolution=merge-duplicates,return=minimal',
};

function emptyToNull(v: string | undefined | null): string | null {
  const s = (v ?? '').toString();
  return s.length ? s : null;
}

async function upsert(table: string, rows: Record<string, unknown>[]): Promise<void> {
  if (!rows.length) return;
  const url = API + '/' + table + '?on_conflict=user_id,source_id';
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: upsertHeaders,
      body: JSON.stringify(rows),
    });
    if (!res.ok) {
      console.warn(
        '[LegalOffice Supabase save] upsert failed',
        table,
        res.status,
        await res.text(),
      );
    }
  } catch (e) {
    console.warn('[LegalOffice Supabase save] upsert error', table, e);
  }
}

function clientToRow(c: Client): Record<string, unknown> {
  return {
    user_id: USER_ID,
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
    user_id: USER_ID,
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
    user_id: USER_ID,
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
    user_id: USER_ID,
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
    user_id: USER_ID,
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
  };
}

function financeToRow(f: Finance): Record<string, unknown> {
  return {
    user_id: USER_ID,
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
    user_id: USER_ID,
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
  await Promise.all([
    upsert('clients', s.clients.filter((x) => x.id).map(clientToRow)),
    upsert('cases', s.casesArr.filter((x) => x.id).map(caseToRow)),
    upsert('tasks', s.tasksArr.filter((x) => x.id).map(taskToRow)),
    upsert('calendar_events', s.eventsList.filter((x) => x.id).map(eventToRow)),
    upsert('documents', s.documentsArr.filter((x) => x.id).map(docToRow)),
    upsert('payments', s.finances.filter((x) => x.id).map(financeToRow)),
    upsert('timeline_items', s.timelineItems.filter((x) => x.id).map(timelineToRow)),
  ]);
}

// ---- Supabase Storage: document file upload --------------------------------
// File bytes live in the bucket below; the `documents.relative_path` column
// is what links a row to its blob. Public bucket = direct GET on the public
// URL, no signed-URL dance needed.

const STORAGE_BUCKET = 'legal-office-documents';
const STORAGE_API = SUPABASE_URL.replace(/\/$/, '') + '/storage/v1';

function safeStorageName(name: string): string {
  // Strip anything that isn't url-safe so the path round-trips without
  // double-encoding. Keep dots so the extension survives.
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 180) || 'file';
}

export function documentPublicUrl(relativePath: string | undefined | null): string {
  if (!relativePath) return '';
  return `${STORAGE_API}/object/public/${STORAGE_BUCKET}/${relativePath}`;
}

export interface UploadedDocument {
  path: string;
  publicUrl: string;
}

export async function uploadDocumentToStorage(
  file: File,
  hint: { caseId?: string; clientId?: string } = {},
): Promise<UploadedDocument | null> {
  const subdir = hint.caseId || hint.clientId || 'misc';
  const path = `${USER_ID}/${subdir}/${Date.now()}-${safeStorageName(file.name)}`;
  const url = `${STORAGE_API}/object/${STORAGE_BUCKET}/${path}`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: 'Bearer ' + SUPABASE_KEY,
        'x-upsert': 'true',
        'Content-Type': file.type || 'application/octet-stream',
      },
      body: file,
    });
    if (!res.ok) {
      console.warn(
        '[LegalOffice Supabase storage] upload failed',
        res.status,
        await res.text(),
      );
      return null;
    }
    return { path, publicUrl: documentPublicUrl(path) };
  } catch (e) {
    console.warn('[LegalOffice Supabase storage] upload error', e);
    return null;
  }
}

/**
 * Upload a client profile photo to Supabase Storage and return the
 * public URL. Stored under `client-photos/<USER_ID>/<clientId>/...`.
 * Returns null on failure (callers should fall back to a data URL
 * preview if needed).
 */
export async function uploadClientPhotoToStorage(
  file: File,
  clientId: string,
): Promise<string | null> {
  const path = `${USER_ID}/client-photos/${clientId}/${Date.now()}-${safeStorageName(file.name)}`;
  const url = `${STORAGE_API}/object/${STORAGE_BUCKET}/${path}`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: 'Bearer ' + SUPABASE_KEY,
        'x-upsert': 'true',
        'Content-Type': file.type || 'image/jpeg',
      },
      body: file,
    });
    if (!res.ok) {
      console.warn(
        '[LegalOffice Supabase storage] client-photo upload failed',
        res.status,
        await res.text(),
      );
      return null;
    }
    return documentPublicUrl(path);
  } catch (e) {
    console.warn('[LegalOffice Supabase storage] client-photo upload error', e);
    return null;
  }
}

// ---- Delete RPCs (source line 9775+) --------------------------------------

export async function supabaseDeleteBySource(
  table: string,
  sourceId: string,
): Promise<boolean> {
  if (!sourceId) return false;
  const url =
    API + '/' + table +
    '?user_id=eq.' + encodeURIComponent(USER_ID) +
    '&source_id=eq.' + encodeURIComponent(sourceId);
  try {
    const res = await fetch(url, { method: 'DELETE', headers });
    return res.ok;
  } catch (e) {
    console.warn('[LegalOffice Supabase delete]', table, sourceId, e);
    return false;
  }
}

export async function supabaseDeleteMany(
  table: string,
  ids: string[],
): Promise<void> {
  for (const id of ids) {
    await supabaseDeleteBySource(table, id);
  }
}
