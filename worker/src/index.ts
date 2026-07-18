// Cloudflare Worker API for the legal-office app. Replaces the Supabase
// PostgREST + Storage endpoints the browser used to call directly.
//
//   GET  /api/health        -> { ok: true }                (no auth)
//   GET  /api/photo/<key>   -> streams the R2 object        (no auth: parity
//                              with the old public Storage bucket; <img> tags
//                              cannot send an Authorization header)
//   GET  /api/load          -> all rows for the configured user (auth)
//   POST /api/save          -> upsert all tables            (auth)
//   POST /api/draft         -> read a PDF, draft a reply with Claude, save it (auth)
//   POST /api/upload-photo  -> store a client photo in R2   (auth)
//   GET  /api/legal-actions -> legal actions by court type  (auth)
//   POST /api/suggested-actions -> save AI suggested action (auth)
//   GET  /api/suggested-actions/:case_id -> get suggestions (auth)
//
// Auth is a shared bearer token (APP_TOKEN). CORS is locked to ALLOWED_ORIGIN.

import { corsHeaders, json, preflight } from './cors';
import { buildUpsert, LOAD_TABLES, safeParse, type Env } from './db';

// The office's own registered lawyer. Used to decide whether an incoming
// document was authored by US (no draft needed) vs. the other side / court.
// Overridable per-request via the `lawyer_name` body field.
const DEFAULT_LAWYER_NAME = 'أشرف شريف / אשרף שריף / Ashraf Sharif';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    if (method === 'OPTIONS') return preflight(request, env);

    // ----- public endpoints (no bearer token) -----
    if (path === '/api/health') {
      return json({ ok: true }, request, env);
    }
    if (method === 'GET' && path.startsWith('/api/photo/')) {
      return servePhoto(env, path.slice('/api/photo/'.length));
    }

    // ----- everything below requires a shared token -----
    const auth = request.headers.get('Authorization') || '';
    const provided = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    const allowed = (env.APP_TOKEN || '')
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    if (!provided || !allowed.includes(provided)) {
      return json({ error: 'unauthorized' }, request, env, 401);
    }

    if (method === 'GET' && path === '/api/load') return handleLoad(request, env);
    if (method === 'GET' && path === '/api/file-summary') {
      return handleFileSummary(request, env);
    }
    if (method === 'POST' && path === '/api/file-summary') {
      return handleStoreFileSummary(request, env);
    }
    if (method === 'POST' && path === '/api/save') return handleSave(request, env);
    if (method === 'POST' && path === '/api/draft') return handleDraft(request, env);
    if (method === 'POST' && path === '/api/draft-decision') {
      return handleDraftDecision(request, env);
    }
    if (method === 'GET' && path === '/api/case-notes') {
      return handleCaseNotes(request, env);
    }
    if (method === 'GET' && path === '/api/drafts') {
      return handleDrafts(request, env);
    }
    if (method === 'GET' && path === '/api/skills') {
      return handleSkills(request, env);
    }
    if (method === 'POST' && path === '/api/upload-photo') {
      return handleUploadPhoto(request, env);
    }
    if (method === 'GET' && path === '/api/legal-actions') {
      return handleLegalActions(request, env);
    }
    if (method === 'POST' && path === '/api/suggested-actions') {
      return handleSaveSuggestedAction(request, env);
    }
    if (method === 'POST' && path === '/api/suggest-action') {
      return handleSuggestAction(request, env);
    }
    if (method === 'POST' && path === '/api/split-decision') {
      return handleSplitDecision(request, env);
    }
    if (method === 'POST' && path === '/api/translate') {
      return handleTranslate(request, env);
    }
    if (method === 'GET' && path.startsWith('/api/suggested-actions/')) {
      return handleGetSuggestedActions(request, env);
    }
if (method === 'POST' && path === '/api/whatsapp-messages') {
    return handleSaveWhatsAppMessage(request, env);
  }
  if (method === 'GET' && path.startsWith('/api/whatsapp-messages/')) {
    return handleGetWhatsAppMessages(request, env);
  }
    if (method === 'GET' && path === '/api/document') {
      return handleDocument(request, env);
    }
    return json({ error: 'not found' }, request, env, 404);
    } catch (e) {
      // An unhandled throw (e.g. a D1 write error) would otherwise reach the
      // client as a non-JSON Cloudflare "Error 1101" / 502 page with no body —
      // which is exactly what breaks the make.com pipeline (it sees a bare 502
      // "ConnectionError" and can't tell why). The app and Make both parse
      // JSON, so surface the real error instead of an opaque 502.
      return json(
        {
          error: 'worker_exception',
          detail:
            e instanceof Error
              ? (e.stack || e.message).slice(0, 800)
              : String(e).slice(0, 800),
        },
        request,
        env,
        500,
      );
    }
  },
};

// ---------------------------------------------------------------------------
// GET /api/load
// ---------------------------------------------------------------------------
async function handleLoad(request: Request, env: Env): Promise<Response> {
  const out: Record<string, unknown> = {};
  for (const table of LOAD_TABLES) {
    const extra = table === 'documents' ? " AND source_id NOT LIKE '%/%'" : '';
    const rs = await env.DB.prepare(
      `SELECT * FROM ${table} WHERE user_id = ?${extra}`,
    )
      .bind(env.USER_ID)
      .all();
    out[table] = rs.results ?? [];
  }
  const asRow = await env.DB.prepare(
    `SELECT state, payload, data FROM app_state WHERE user_id = ?`,
  )
    .bind(env.USER_ID)
    .first<{ state?: string; payload?: string; data?: string }>();
  out.app_state = asRow
    ? safeParse(asRow.state) ?? safeParse(asRow.payload) ?? safeParse(asRow.data)
    : null;

  return json(out, request, env);
}

// ---------------------------------------------------------------------------
// GET /api/file-summary
// ---------------------------------------------------------------------------
async function handleFileSummary(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const file = (url.searchParams.get('file') || '').trim();
  const orig = (url.searchParams.get('orig') || '').trim();
  const caseId = (url.searchParams.get('caseId') || '').trim();
  if (!file && !orig && !caseId) {
    return json({ he: '', ar: '', orig: '', language: '' }, request, env);
  }
  const docMatch = /(DOC-\d+)/i.exec(file) || /(DOC-\d+)/i.exec(orig);
  const docId = docMatch ? docMatch[1].toUpperCase() : '';
  const row = await env.DB.prepare(
    'SELECT summary_he, summary_ar, summary_orig, language FROM file_summary ' +
      'WHERE file_name = ?1 OR file_name = ?2 ' +
      "OR (?4 <> '' AND (upper(file_name) LIKE '%' || ?4 || '.%' OR upper(file_name) LIKE '%' || ?4)) " +
      "OR (?3 <> '' AND lower(case_id) LIKE lower(?3) || '%') " +
      'ORDER BY (file_name = ?1) DESC, (file_name = ?2) DESC, ' +
      "(?4 <> '' AND upper(file_name) LIKE '%' || ?4 || '.%') DESC, id DESC LIMIT 1",
  )
    .bind(file, orig, caseId, docId)
    .first<{
      summary_he?: string;
      summary_ar?: string;
      summary_orig?: string;
      language?: string;
    }>();
  return json(
    {
      he: row?.summary_he || '',
      ar: row?.summary_ar || '',
      // The summary in the document's OWN language (any language). Falls back
      // to '' for rows written before this column existed.
      orig: row?.summary_orig || '',
      language: String(row?.language || '').toLowerCase(),
    },
    request,
    env,
  );
}

// ---------------------------------------------------------------------------
// POST /api/file-summary
// ---------------------------------------------------------------------------
async function handleStoreFileSummary(
  request: Request,
  env: Env,
): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'invalid json' }, request, env, 400);
  }
  const fileName = String(body.file_name || '').trim();
  if (!fileName) {
    return json({ error: 'file_name required' }, request, env, 400);
  }
  const str = (v: unknown) => {
    const s = String(v ?? '').trim();
    return s || null;
  };
  const docMatch = /(DOC-\d+)/i.exec(fileName);
  const docId = docMatch ? docMatch[1].toUpperCase() : '';
  if (docId) {
    await env.DB.prepare(
      'DELETE FROM file_summary WHERE file_name = ?1 ' +
        "OR upper(file_name) LIKE '%' || ?2 || '.%' " +
        "OR upper(file_name) LIKE '%' || ?2",
    )
      .bind(fileName, docId)
      .run();
  } else {
    await env.DB.prepare('DELETE FROM file_summary WHERE file_name = ?')
      .bind(fileName)
      .run();
  }
  await env.DB.prepare(
    'INSERT INTO file_summary (client_id, case_id, file_name, summary_he, summary_ar, summary_orig, language, ai_model) ' +
      'VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)',
  )
    .bind(
      str(String(body.client_id ?? '').toLowerCase()),
      str(String(body.case_id ?? '').toLowerCase()),
      fileName,
      str(body.summary_he),
      str(body.summary_ar),
      str(body.summary_orig),
      str(String(body.language ?? '').toLowerCase()),
      str(body.ai_model),
    )
    .run();
  if (docId) {
    await env.DB.prepare(
      'UPDATE documents SET summary_he = COALESCE(?1, summary_he), ' +
        'summary_ar = COALESCE(?2, summary_ar), updated_at = ?3 ' +
        "WHERE user_id = ?4 AND (upper(source_id) = ?5 " +
        "OR upper(file_name) LIKE '%' || ?5 || '.%' OR upper(file_name) LIKE '%' || ?5)",
    )
      .bind(
        str(body.summary_he),
        str(body.summary_ar),
        new Date().toISOString(),
        env.USER_ID,
        docId,
      )
      .run();
  }
  return json({ ok: true }, request, env);
}

// ---------------------------------------------------------------------------
// POST /api/save
// ---------------------------------------------------------------------------
async function handleSave(request: Request, env: Env): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'invalid json' }, request, env, 400);
  }

  const statements: D1PreparedStatement[] = [];
  for (const table of LOAD_TABLES) {
    const rows = Array.isArray(body[table]) ? (body[table] as unknown[]) : [];
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      const built = buildUpsert(table, row as Record<string, unknown>, env.USER_ID);
      if (built) statements.push(env.DB.prepare(built.sql).bind(...built.binds));
    }
  }

  if (statements.length) await env.DB.batch(statements);
  if (Array.isArray(body.timeline_items) || Array.isArray(body.cases)) {
    try {
      await syncCaseNotes(env);
    } catch {
      // never fail the save because the mirror rebuild hiccuped
    }
  }
  // When calendar events were saved, collapse any duplicate hearings a document
  // pipeline may have created for the same case + day.
  if (Array.isArray(body.calendar_events)) {
    try {
      await consolidateHearings(env);
    } catch {
      // never fail the save because the consolidation hiccuped
    }
  }
  const submitted = LOAD_TABLES.reduce(
    (n, t) => n + (Array.isArray(body[t]) ? (body[t] as unknown[]).length : 0),
    0,
  );
  return json(
    {
      ok: true,
      count: statements.length,
      submitted,
      skipped: submitted - statements.length,
    },
    request,
    env,
  );
}

// Source type of a hearing event, inferred from its source document name /
// title / existing note: an invitation to a hearing, a judicial decision, or
// unknown.
function hearingSourceType(
  r: { source_id?: string; title?: string; description?: string },
): 'invitation' | 'decision' | 'other' {
  const hay = (
    String(r.source_id ?? '') +
    ' ' +
    String(r.title ?? '') +
    ' ' +
    String(r.description ?? '')
  ).toLowerCase();
  if (/הזמנ|זימון|تبليغ|دعوة|إحضار|احضار/.test(hay)) return 'invitation';
  if (/החלט|פסק|פרוטוקול|قرار|حكم|محضر/.test(hay)) return 'decision';
  return 'other';
}

// Consolidate AI-imported HEARING events so that each (case, calendar day) has a
// SINGLE calendar event, and annotate WHERE it came from:
//   • same day, one source (e.g. only a decision, or a document duplicated by
//     the pipeline) → keep one, note the source ("מהחלטה שיפוטית" / "מהזמנה
//     לדיון"); for a decision the note is the source ONLY, never its summary.
//   • same day, MULTIPLE sources (e.g. an invitation to a hearing AND a decision
//     that both point to the same hearing) → MERGE into one event with a clear
//     note that it was merged from those sources.
// Only hearing-type events are touched; meetings, reminders, etc. are left alone.
async function consolidateHearings(env: Env): Promise<void> {
  const rs = await env.DB.prepare(
    `SELECT id, source_id, title, description, case_source_id, date_time
     FROM calendar_events
     WHERE user_id = ?1 AND lower(type) IN ('hearing', 'hearingmeeting')
     ORDER BY created_at ASC, id ASC`,
  )
    .bind(env.USER_ID)
    .all();
  const rows = (rs.results ?? []) as Array<{
    id: string;
    source_id?: string;
    title?: string;
    description?: string;
    case_source_id?: string;
    date_time?: string;
  }>;
  // Group by (case, calendar day). Insertion order = created_at ASC, so the
  // first in each group is the earliest — the one we keep.
  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const day = String(r.date_time ?? '').slice(0, 10);
    if (!day) continue;
    const key = String(r.case_source_id ?? '').toLowerCase() + '|' + day;
    const g = groups.get(key);
    if (g) g.push(r);
    else groups.set(key, [r]);
  }
  const now = new Date().toISOString();
  const toDelete: string[] = [];
  for (const group of groups.values()) {
    // Determine the source(s) of this same-day hearing FIRST — a hearing that
    // came from a judicial decision/protocol must NEVER carry the decision's
    // content/summary in the calendar; it shows ONLY the date + a clean note.
    const sources = new Set(group.map(hearingSourceType));
    sources.delete('other');
    const hasInv = sources.has('invitation');
    const hasDec = sources.has('decision');
    const isImported = hasInv || hasDec;
    // Keep the earliest event (stable). We deliberately do NOT prefer the event
    // that carries the decision text — for a decision/protocol hearing that text
    // must be discarded from the calendar (it still lives in file_summary /
    // documents). Manual hearings (source 'other') are left completely alone.
    const keep = group[0];
    for (const r of group) if (r.id !== keep.id) toDelete.push(r.id);
    if (!isImported) continue;
    let he = '';
    let ar = '';
    if (sources.size >= 2) {
      const he_parts: string[] = [];
      const ar_parts: string[] = [];
      if (hasInv) { he_parts.push('הזמנה לדיון'); ar_parts.push('دعوة لجلسة'); }
      if (hasDec) { he_parts.push('החלטה שיפוטית'); ar_parts.push('قرار قضائي'); }
      he =
        'מועד זה אוחד על ידי הבינה המלאכותית (AI) ממספר מסמכים לאותו דיון: ' +
        he_parts.join(' + ') +
        '.';
      ar =
        'دُمج هذا الموعد بواسطة الذكاء الاصطناعي (AI) من عدة مستندات لنفس الجلسة: ' +
        ar_parts.join(' + ') +
        '.';
    } else if (hasInv) {
      he = 'מועד זה יובא מהזמנה לדיון על ידי הבינה המלאכותית (AI).';
      ar = 'أُدرج هذا الموعد من دعوة/تبليغ لجلسة بواسطة الذكاء الاصطناعي (AI).';
    } else if (hasDec) {
      he = 'מועד הדיון יובא מהחלטה שיפוטית על ידי הבינה המלאכותית (AI).';
      ar = 'أُدرج موعد الجلسة من قرار قضائي بواسطة الذكاء الاصطناعي (AI).';
    }
    // ALWAYS overwrite the description for an imported hearing — even if it
    // currently holds the decision summary — so the calendar shows only the
    // clean note, never the decision content or its abridgement.
    if (he && String(keep.description ?? '') !== he) {
      await env.DB.prepare(
        'UPDATE calendar_events SET description = ?2, description_ar = ?3, title = ?6, title_ar = ?7, updated_at = ?4 WHERE user_id = ?1 AND id = ?5',
      )
        .bind(env.USER_ID, he, ar, now, keep.id, 'דיון', 'جلسة')
        .run();
    }
  }
  for (let i = 0; i < toDelete.length; i += 50) {
    const chunk = toDelete.slice(i, i + 50);
    const ph = chunk.map((_, j) => '?' + (j + 2)).join(', ');
    await env.DB.prepare(
      `DELETE FROM calendar_events WHERE user_id = ?1 AND id IN (${ph})`,
    )
      .bind(env.USER_ID, ...chunk)
      .run();
  }
}

async function syncCaseNotes(env: Env): Promise<void> {
  await env.DB.prepare('DELETE FROM case_notes WHERE user_id = ?')
    .bind(env.USER_ID)
    .run();
  await env.DB.prepare(
    'INSERT INTO case_notes ' +
      '(id, user_id, source_id, client_id, case_id, note, note_ar, date, created_at, updated_at) ' +
      'SELECT ti.id, ti.user_id, ti.source_id, c.client_source_id, ti.case_source_id, ' +
      'ti.description, ti.description_ar, ti.date, ti.created_at, ti.updated_at ' +
      'FROM timeline_items ti ' +
      'LEFT JOIN cases c ON c.user_id = ti.user_id AND c.source_id = ti.case_source_id ' +
      "WHERE ti.user_id = ?1 AND lower(coalesce(ti.type, 'note')) = 'note' " +
      "AND coalesce(trim(ti.description), '') <> ''",
  )
    .bind(env.USER_ID)
    .run();
}

// ---------------------------------------------------------------------------
// POST /api/draft
// ---------------------------------------------------------------------------
async function handleDraft(request: Request, env: Env): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'invalid json' }, request, env, 400);
  }
  const pdfB64 = String(body.pdf_base64 || '').trim();
  if (!pdfB64) return json({ error: 'pdf_base64 required' }, request, env, 400);

  const clientSrc = String(body.client_source_id || '').trim();
  const caseSrc = String(body.case_source_id || '').trim();
  const fileName = String(body.file_name || '').trim();
  const skillKey = String(body.skill_key || 'sharia-lawsuit').trim();
  // The registered lawyer / our office. A draft is only needed when the
  // document is from the OTHER side or the court orders a reply — never for
  // documents our own office authored (unless the court ordered a reply).
  const lawyerName =
    DEFAULT_LAWYER_NAME +
    (String(body.lawyer_name || '').trim()
      ? ' / ' + String(body.lawyer_name).trim()
      : '');

  const docMatch =
    /(DOC-\d+)/i.exec(fileName) ||
    /(DOC-\d+)/i.exec(String(body.source_id || '')) ||
    /(DOC-\d+)/i.exec(String(body.document_source_id || ''));
  const docId = docMatch ? docMatch[1].toUpperCase() : '';
  let sourceId = docId ? `DRAFT-${docId}` : '';
  if (!sourceId && fileName) {
    const base = fileName
      .split('/')
      .pop()!
      .replace(/\.[^.]+$/, '')
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .slice(0, 120);
    if (base) sourceId = `DRAFT-${base}`;
  }
  if (!sourceId) {
    return json(
      { error: 'cannot derive source_id (need file_name or DOC id)' },
      request,
      env,
      400,
    );
  }
  const documentSourceId = docId || sourceId;

  const skillRow = await env.DB.prepare(
    'SELECT content FROM skills WHERE user_id = ? AND skill_key = ? ' +
      "AND lower(coalesce(status, 'active')) = 'active' ORDER BY updated_at DESC LIMIT 1",
  )
    .bind(env.USER_ID, skillKey)
    .first<{ content?: string }>();
  const skill = skillRow?.content || '';

  const notes = await fetchDraftNotes(env, clientSrc, caseSrc);
  // All notes the app aggregated for this case (client note + document-upload
  // notes + brain quick-action notes), passed straight from the client so the
  // draft reflects sources that aren't in the case_notes table.
  const notesContext = String(body.notes_context ?? '').trim();

  const systemPrompt =
    'أنت محامٍ خبير في الأحوال الشخصية للمسلمين في إسرائيل، تترافع أمام المحاكم الشرعية ومحاكم شؤون العائلة. مهمتك: قراءة المستند المرفق بالكامل (وهو مستند وارد مثل قرار محكمة أو لائحة دعوى أو طلب من الطرف الآخر) وصياغة مسودة رد قانوني عليه. القالب الحاكم للصياغة والتنسيق وتفاصيل المحامي وبنية الفقرات المرقّمة هو الوثيقة المرجعية التالية، والتزم بها حرفياً كمرجع للأسلوب والشكل:\n\n<skill>\n' +
    skill +
    '\n</skill>\n\nقاعدة اللغة الإلزامية: اكتشف لغة المستند المرفق أياً كانت (عربية، عبرية، إنجليزية، فرنسية، روسية، أو أي لغة أخرى) بالاعتماد على متن المستند القانوني نفسه لا على صفحة الغلاف. كثير من الملفات تبدأ بصفحة أولى آلية بالعبرية هي مجرد "אישור הגשה" (إشعار استلام من نظام المحكمة الإلكتروني) — تجاهل هذه الصفحة عند تحديد اللغة واعتمد على المتن الذي يليها. وبوجه خاص: إذا كان المستند مرتبطاً بالمحكمة الشرعية (בית הדין השרעי / المحكمة الشرعية) بأي شكل — مقدَّماً إليها أو موجَّهاً إليها أو صادراً عنها (قرار أو حكم أو محضر أو أمر منها، مثل "החלטה"/"قرار"/"حكم"/"محضر") — أو كان متنه مكتوباً بالعربية، فاللغة هي ar واكتب المسودة بالعربية حتى لو كانت الصفحة الأولى (إشعار الاستلام) بالعبرية. اكتب المسودة بلغة المستند نفسها فقط، ولا تخلط لغتين في مسودة واحدة. ضع رمز اللغة في الحقل detected_language (مثل ar أو he أو en أو fr أو ru) وضع نص المسودة الكامل في الحقل draft بلغة المستند. لا تختلق وقائع أو تواريخ أو أسماء غير موجودة في المستند أو في ملاحظات القضية. أعِد كائن JSON واحداً فقط، دون أي نص خارج JSON، ودون Markdown، وأول حرف في ردك يجب أن يكون القوس {.';

  const userText =
    'اقرأ المستند المرفق بالكامل كلمةً كلمةً. مكتبنا/المحامي صاحب الملف هو: ' +
    lawyerName +
    '.\n\nأولاً صنِّف المستند:\n' +
    '- author_side = من حرّر/قدّم هذا المستند فعلياً (المحامي الموقّع عليه أو الطرف الذي قدّمه)، وليس بالضرورة من ذُكر اسمه داخله: "ours" فقط إذا حرّره أو قدّمه مكتبنا/المحامي المذكور أعلاه ('  +
    lawyerName +
    ')، أو "opposing" إذا قدّمه الطرف الآخر/الخصم أو محاميه، أو "court" إذا كان صادراً عن المحكمة/القاضي. إذا لم يكن المستند صادراً عن مكتبنا بوضوح، فاعتبره "opposing".\n' +
    '- court_requires_response = true إذا كان المستند يأمر أو يطلب تقديم رد/جواب/تعقيب، وإلا false.\n\n' +
    'قاعدة إعداد المسودة (مهمة جداً وإلزامية): إذا كان author_side = "opposing" أو court_requires_response = true، فيجب عليك إلزامياً ملء الحقل draft بنص مسودة رد قانونية كاملة على هذا المستند وفق القالب الحاكم — ولا تتركه null أبداً في هذه الحالة. أما إذا كان المستند من مكتبنا (author_side = "ours") ولم تأمر المحكمة بالرد، فلا حاجة لمسودة: اترك draft = null.\n\n' +
    'هذه ملاحظات المحامي على هذه القضية، استخدمها في توجيه الرد:\n<case_notes_he>\n' +
    notes.he +
    '\n</case_notes_he>\n<case_notes_ar>\n' +
    notes.ar +
    '\n</case_notes_ar>\n' +
    (notesContext
      ? 'ملاحظات إضافية جُمعت من كل مصادر الملف (ملاحظة الموكل + ملاحظات عند رفع المستندات + ملاحظات الإجراءات السريعة) — التزم بها أيضاً في صياغة الرد:\n<case_notes_all>\n' +
        notesContext +
        '\n</case_notes_all>\n'
      : '') +
    '\n\nصُغ (عند الحاجة فقط) مسودة رد قانوني كامل على هذا المستند وفق القالب الحاكم، بلغة المستند نفسها. أعِد كائن JSON واحداً فقط بهذا الهيكل بالضبط: {"detected_language": "رمز لغة المستند مثل ar أو he أو en أو fr أو ru", "author_side": "ours or opposing or court", "court_requires_response": true or false, "doc_type": "نوع المستند الوارد", "title": "عنوان المسودة بلغة المستند أو null", "draft": "نص المسودة الكامل بلغة المستند أو null"}. لا تكتب أي شيء خارج JSON.';

  const anthropicBody = {
    model: 'claude-sonnet-4-6',
    max_tokens: 8000,
    system: systemPrompt,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'document',
            source: { type: 'base64', media_type: 'application/pdf', data: pdfB64 },
          },
          { type: 'text', text: userText },
        ],
      },
    ],
  };

  let resp: Response;
  try {
    resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': env.ANTHROPIC_API_KEY || '',
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify(anthropicBody),
    });
  } catch (e) {
    return json(
      { error: 'anthropic_fetch_failed', detail: String(e).slice(0, 300) },
      request,
      env,
      502,
    );
  }
  if (!resp.ok) {
    const errText = await resp.text();
    return json(
      { error: 'anthropic_error', status: resp.status, detail: errText.slice(0, 500) },
      request,
      env,
      502,
    );
  }
  const data = (await resp.json()) as {
    content?: Array<{ type: string; text?: string }>;
  };
  const textOut = (data.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text || '')
    .join('');
  const cleaned = textOut
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/, '')
    .replace(/```\s*$/, '')
    .trim();
  let draft: Record<string, unknown>;
  try {
    draft = JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    return json(
      { error: 'draft_parse_failed', raw: cleaned.slice(0, 600) },
      request,
      env,
      502,
    );
  }

  // Gate: a draft is needed only when the document is from the OTHER side, or
  // the court ordered a reply. Our own document with no court order → no draft
  // (the case's suggested-action/recommendation covers that case instead).
  const authorSide = String(draft.author_side ?? '').toLowerCase().trim();
  const courtRequiresResponse =
    draft.court_requires_response === true ||
    String(draft.court_requires_response ?? '').toLowerCase() === 'true';
  // A draft is needed ONLY when the OTHER side authored the document, or the
  // court ordered a reply. Our own document → no draft; a court document that
  // does NOT order a reply → no draft (the suggested-action card covers those).
  // Unknown/unclassified author defaults to needing a draft — never silently
  // drop a reply that might be required (a missed deadline is far worse than an
  // extra draft).
  const draftNeeded =
    authorSide === 'opposing' ||
    courtRequiresResponse ||
    (authorSide !== 'ours' && authorSide !== 'court');
  // The model now returns ONE `draft` field written in the document's own
  // language (any language). `draft_orig` always holds it; `draft_he`/`draft_ar`
  // mirror it ONLY for Hebrew/Arabic documents so the existing bilingual screens
  // and the he/ar fallback keep working. `draft_he`/`draft_ar` older keys are
  // still honored when a caller (e.g. the Make pipeline) sends them instead.
  const langCode = String(draft.detected_language ?? '').toLowerCase().trim();
  const draftNative =
    draft.draft ??
    (langCode.startsWith('he')
      ? draft.draft_he
      : langCode.startsWith('ar')
        ? draft.draft_ar
        : null) ??
    null;
  const draftText = draftNeeded ? draftNative : null;
  const draftHe = draftText != null && langCode.startsWith('he') ? draftText : null;
  const draftAr = draftText != null && langCode.startsWith('ar') ? draftText : null;

  const row: Record<string, unknown> = {
    source_id: sourceId,
    document_source_id: documentSourceId,
    client_source_id: clientSrc || null,
    case_source_id: caseSrc || null,
    file_name: fileName || null,
    title: draft.title ?? null,
    title_ar: draft.title_ar ?? null,
    draft_he: draftHe,
    draft_ar: draftAr,
    draft_orig: draftText,
    language: draft.detected_language ?? null,
    doc_type: draft.doc_type ?? null,
    // 'approved' = classified, draft needed; 'not_needed' = classified, no
    // draft (Make writes 'draft' for unclassified rows — the app re-checks
    // those via /api/draft-decision).
    status: draftNeeded ? 'approved' : 'not_needed',
    date: new Date().toISOString().slice(0, 10),
  };
  let count = 0;
  let persistError = '';
  const built = buildUpsert('drafts', row, env.USER_ID);
  if (built) {
    // Guard the write like /api/suggest-action does: the draft has already been
    // generated (the expensive part), so a D1 write failure here must NOT throw
    // out of the request — an unhandled throw becomes an opaque 502 for the
    // make.com draft step. Report it in the response instead.
    try {
      await env.DB.prepare(built.sql)
        .bind(...built.binds)
        .run();
      count = 1;
    } catch (e) {
      persistError = e instanceof Error ? e.message.slice(0, 300) : String(e).slice(0, 300);
    }
  }

  return json(
    {
      ok: true,
      count,
      source_id: sourceId,
      document_source_id: documentSourceId,
      detected_language: draft.detected_language || '',
      doc_type: draft.doc_type || '',
      title: draft.title || draft.title_ar || '',
      draft_needed: draftNeeded,
      author_side: authorSide || 'unknown',
      court_requires_response: courtRequiresResponse,
      has_draft: !!(draftHe || draftAr),
      notes_scope: notes.scope,
      notes_count: notes.count,
      persist_error: persistError || undefined,
    },
    request,
    env,
  );
}

// ---------------------------------------------------------------------------
// POST /api/draft-decision
// Cheap classification-only check for an EXISTING document (typically a
// Make-written draft still marked status='draft'): reads the PDF with a small
// model, decides whether a reply draft is actually needed, and updates the
// draft row's status to 'approved' (needed) or 'not_needed' — WITHOUT
// regenerating the draft text (any existing draft is preserved). On any
// failure it defaults to 'approved' so a possibly-required reply is never
// silently hidden.
// ---------------------------------------------------------------------------
async function handleDraftDecision(request: Request, env: Env): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'invalid json' }, request, env, 400);
  }
  const pdfB64 = String(body.pdf_base64 || '').trim();
  if (!pdfB64) return json({ error: 'pdf_base64 required' }, request, env, 400);

  const clientSrc = String(body.client_source_id || '').trim();
  const caseSrc = String(body.case_source_id || '').trim();
  const fileName = String(body.file_name || '').trim();
  const lawyerName =
    DEFAULT_LAWYER_NAME +
    (String(body.lawyer_name || '').trim()
      ? ' / ' + String(body.lawyer_name).trim()
      : '');

  const docMatch =
    /(DOC-\d+)/i.exec(fileName) ||
    /(DOC-\d+)/i.exec(String(body.source_id || '')) ||
    /(DOC-\d+)/i.exec(String(body.document_source_id || ''));
  const docId = docMatch ? docMatch[1].toUpperCase() : '';
  let sourceId = docId ? `DRAFT-${docId}` : '';
  if (!sourceId && fileName) {
    const base = fileName
      .split('/')
      .pop()!
      .replace(/\.[^.]+$/, '')
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .slice(0, 120);
    if (base) sourceId = `DRAFT-${base}`;
  }
  if (!sourceId) {
    return json(
      { error: 'cannot derive source_id (need file_name or DOC id)' },
      request,
      env,
      400,
    );
  }
  const documentSourceId = docId || sourceId;

  const systemPrompt =
    'أنت مصنِّف مستندات قانونية لمكتب المحامي: ' +
    lawyerName +
    '. اقرأ المستند المرفق وأعِد كائن JSON واحداً فقط، دون أي نص آخر، وأول حرف {.';
  const userText =
    'صنِّف هذا المستند حسب من حرّره/قدّمه فعلياً (المحامي الموقّع أو الطرف مقدّم الطلب)، لا حسب من ذُكر اسمه داخله:\n' +
    '- author_side = "ours" فقط إذا حرّره أو قدّمه مكتبنا/المحامي ' +
    lawyerName +
    '، أو "opposing" إذا قدّمه الطرف الآخر/الخصم أو محاميه، أو "court" إذا صدر عن المحكمة/القاضي. إذا لم يكن صادراً عن مكتبنا بوضوح فاعتبره "opposing".\n' +
    '- court_requires_response = true إذا كان المستند يأمر أو يطلب تقديم رد/جواب/تعقيب، وإلا false.\n' +
    'أعِد JSON فقط: {"author_side":"ours or opposing or court","court_requires_response":true or false}.';

  let draftNeeded = true; // safe default on any failure
  let authorSide = 'unknown';
  let courtRequiresResponse = false;
  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': env.ANTHROPIC_API_KEY || '',
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 200,
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'document',
                source: {
                  type: 'base64',
                  media_type: 'application/pdf',
                  data: pdfB64,
                },
              },
              { type: 'text', text: userText },
            ],
          },
        ],
      }),
    });
    if (resp.ok) {
      const data = (await resp.json()) as {
        content?: Array<{ type: string; text?: string }>;
      };
      const textOut = (data.content || [])
        .filter((b) => b.type === 'text')
        .map((b) => b.text || '')
        .join('');
      const cleaned = textOut
        .trim()
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/, '')
        .replace(/```\s*$/, '')
        .trim();
      const parsed = JSON.parse(cleaned) as Record<string, unknown>;
      authorSide =
        String(parsed.author_side ?? '').toLowerCase().trim() || 'unknown';
      courtRequiresResponse =
        parsed.court_requires_response === true ||
        String(parsed.court_requires_response ?? '').toLowerCase() === 'true';
      draftNeeded =
        authorSide === 'opposing' ||
        courtRequiresResponse ||
        (authorSide !== 'ours' && authorSide !== 'court');
    }
  } catch {
    // keep safe defaults (draftNeeded = true)
  }

  // Update ONLY the status (+ ids when provided) so any existing draft text,
  // title and language are preserved by buildUpsert (absent columns are not
  // written on conflict).
  const row: Record<string, unknown> = {
    source_id: sourceId,
    document_source_id: documentSourceId,
    status: draftNeeded ? 'approved' : 'not_needed',
  };
  if (clientSrc) row.client_source_id = clientSrc;
  if (caseSrc) row.case_source_id = caseSrc;
  const built = buildUpsert('drafts', row, env.USER_ID);
  if (built) {
    await env.DB.prepare(built.sql)
      .bind(...built.binds)
      .run();
  }

  return json(
    {
      ok: true,
      source_id: sourceId,
      document_source_id: documentSourceId,
      draft_needed: draftNeeded,
      author_side: authorSide,
      court_requires_response: courtRequiresResponse,
    },
    request,
    env,
  );
}

async function fetchDraftNotes(
  env: Env,
  clientSrc: string,
  caseSrc: string,
): Promise<{ he: string; ar: string; count: number; scope: string }> {
  let rows: Array<{ note?: string; note_ar?: string }> = [];
  let scope = 'none';
  if (caseSrc) {
    const rs = await env.DB.prepare(
      'SELECT note, note_ar FROM case_notes WHERE user_id = ? AND upper(case_id) = upper(?) ORDER BY date ASC, created_at ASC',
    )
      .bind(env.USER_ID, caseSrc)
      .all<{ note?: string; note_ar?: string }>();
    rows = rs.results ?? [];
    if (rows.length) scope = 'case';
  }
  if (!rows.length && clientSrc) {
    const rs = await env.DB.prepare(
      'SELECT note, note_ar FROM case_notes WHERE user_id = ? AND lower(client_id) = lower(?) ORDER BY date ASC, created_at ASC',
    )
      .bind(env.USER_ID, clientSrc)
      .all<{ note?: string; note_ar?: string }>();
    rows = rs.results ?? [];
    if (rows.length) scope = 'client';
  }
  const he = rows.map((r) => r.note).filter(Boolean).join('\n\n');
  const ar = rows.map((r) => r.note_ar).filter(Boolean).join('\n\n');
  return { he, ar, count: rows.length, scope };
}

// ---------------------------------------------------------------------------
// GET /api/case-notes
// ---------------------------------------------------------------------------
async function handleCaseNotes(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const caseId = (url.searchParams.get('caseId') || '').trim();
  const clientId = (url.searchParams.get('clientId') || '').trim();
  const binds: unknown[] = [env.USER_ID];
  let sql =
    'SELECT source_id, client_id, case_id, note, note_ar, date, created_at ' +
    'FROM case_notes WHERE user_id = ?1';
  if (caseId) {
    binds.push(caseId);
    sql += ` AND upper(case_id) = upper(?${binds.length})`;
  }
  if (clientId) {
    binds.push(clientId);
    sql += ` AND lower(client_id) = lower(?${binds.length})`;
  }
  sql += ' ORDER BY date DESC, created_at DESC';
  const rs = await env.DB.prepare(sql)
    .bind(...binds)
    .all();
  return json({ notes: rs.results ?? [] }, request, env);
}

// ---------------------------------------------------------------------------
// GET /api/drafts
// ---------------------------------------------------------------------------
async function handleDrafts(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const caseId = (url.searchParams.get('caseId') || '').trim();
  const clientId = (url.searchParams.get('clientId') || '').trim();
  const documentId = (url.searchParams.get('documentId') || '').trim();
  const binds: unknown[] = [env.USER_ID];
  let sql =
    'SELECT source_id, case_source_id, client_source_id, document_source_id, ' +
    'file_name, title, title_ar, draft_he, draft_ar, draft_orig, language, doc_type, ' +
    'status, date, updated_at FROM drafts WHERE user_id = ?1 ' +
    "AND source_id NOT LIKE '%/%'";
  if (caseId) {
    binds.push(caseId);
    sql += ` AND upper(case_source_id) = upper(?${binds.length})`;
  }
  if (clientId) {
    binds.push(clientId);
    sql += ` AND lower(client_source_id) = lower(?${binds.length})`;
  }
  if (documentId) {
    binds.push(documentId);
    sql += ` AND upper(document_source_id) = upper(?${binds.length})`;
  }
  sql += ' ORDER BY date DESC, updated_at DESC';
  const rs = await env.DB.prepare(sql)
    .bind(...binds)
    .all();
  return json({ drafts: rs.results ?? [] }, request, env);
}

// ---------------------------------------------------------------------------
// GET /api/skills
// ---------------------------------------------------------------------------
async function handleSkills(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const key = (url.searchParams.get('key') || '').trim();
  const all = (url.searchParams.get('all') || '').trim() === '1';
  const binds: unknown[] = [env.USER_ID];
  let sql =
    'SELECT source_id, skill_key, title, title_ar, content, language, ' +
    'status, date, updated_at FROM skills WHERE user_id = ?1';
  if (!all) sql += " AND lower(coalesce(status, 'active')) = 'active'";
  if (key) {
    binds.push(key);
    sql += ` AND skill_key = ?${binds.length}`;
  }
  sql += ' ORDER BY updated_at DESC';
  const rs = await env.DB.prepare(sql)
    .bind(...binds)
    .all();
  return json({ skills: rs.results ?? [] }, request, env);
}

// ---------------------------------------------------------------------------
// POST /api/upload-photo
// ---------------------------------------------------------------------------
async function handleUploadPhoto(request: Request, env: Env): Promise<Response> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ error: 'expected multipart/form-data' }, request, env, 400);
  }
  const entry = form.get('file');
  const clientId = String(form.get('clientId') || 'misc');
  if (!entry || typeof entry === 'string') {
    return json({ error: 'no file' }, request, env, 400);
  }
  const file = entry as unknown as {
    name?: string;
    type?: string;
    arrayBuffer(): Promise<ArrayBuffer>;
  };

  const fileName = typeof file.name === 'string' ? file.name : 'file';
  const key = `${env.USER_ID}/client-photos/${clientId}/${Date.now()}-${safeName(fileName)}`;
  await env.PHOTOS.put(key, await file.arrayBuffer(), {
    httpMetadata: { contentType: file.type || 'image/jpeg' },
  });

  const origin = new URL(request.url).origin;
  const url = `${origin}/api/photo/${key}`;
  return json({ url }, request, env);
}

// ---------------------------------------------------------------------------
// GET /api/legal-actions?court_type=sharia
// ---------------------------------------------------------------------------
async function handleLegalActions(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const courtType = (url.searchParams.get('court_type') || '').trim();
  if (!courtType) {
    return json({ error: 'court_type parameter required' }, request, env, 400);
  }
  const rs = await env.DB.prepare(
    `SELECT id, stage, action_name, responsible, deadline, deadline_from, legal_source, practical_notes
     FROM legal_actions
     WHERE court_type = ?
     ORDER BY id ASC`,
  )
    .bind(courtType)
    .all();
  return json({ court_type: courtType, actions: rs.results ?? [] }, request, env);
}

// ---------------------------------------------------------------------------
// POST /api/suggested-actions
// ---------------------------------------------------------------------------
async function handleSaveSuggestedAction(request: Request, env: Env): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'invalid json' }, request, env, 400);
  }
  const str = (v: unknown) => String(v ?? '').trim() || null;
  // client_id and case_id are NOT NULL — bind '' (never null) so an empty value
  // can't throw a constraint error (which would surface as HTTP 1101).
  const req = (v: unknown) => String(v ?? '').trim();
  try {
    await env.DB.prepare(
      `INSERT INTO case_suggested_actions
       (client_id, case_id, document_name, court_type, suggested_action, deadline, legal_source, confidence, reasoning)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
    )
      .bind(
        req(body.client_id),
        req(body.case_id),
        str(body.document_name),
        str(body.court_type),
        str(body.suggested_action),
        str(body.deadline),
        str(body.legal_source),
        str(body.confidence),
        str(body.reasoning),
      )
      .run();
  } catch (e) {
    return json({ error: 'persist_failed', detail: String(e).slice(0, 200) }, request, env, 500);
  }
  return json({ ok: true }, request, env);
}

// Map a case's free-text court ("שלום ירושלים", "משפחה חיפה", "עבודה...",
// "שרעי יפו", "עליון" / "בג\"ץ") to the legal_actions court_type(s) to suggest
// from. Family also gets the civil track as a secondary option, per the
// office's rule. Falls back to civil.
function mapCourtTypes(court: string): string[] {
  const c = (court || '').toLowerCase();
  if (/שרע|شرع/.test(c)) return ['sharia'];
  if (/משפח|عائل|أسر|family/.test(c)) return ['family', 'civil'];
  if (/עבוד|ביטוח לאומי|عمل|تأمين وطني|labor/.test(c)) return ['labor'];
  if (/עליון|בג["”'׳״]?ץ|בגץ|عليا|عدل عليا|high court|hcj/.test(c)) return ['hcj'];
  if (/פליל|جزائ|جناي|criminal/.test(c)) return ['criminal'];
  return ['civil']; // שלום / מחוזי / default
}

// ---------------------------------------------------------------------------
// POST /api/suggest-action
// Generate a court-MATCHED suggested next action for a case: maps the case's
// court to the right legal_actions court_type(s) (family also includes civil),
// then asks a small model to pick the most relevant next step FROM that list
// given the latest document/context. Saves it to case_suggested_actions (so
// the existing GET still serves it) and returns it.
// ---------------------------------------------------------------------------
async function handleSuggestAction(request: Request, env: Env): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'invalid json' }, request, env, 400);
  }
  const caseId = String(body.case_id ?? '').trim();
  const clientId = String(body.client_id ?? '').trim();
  const court = String(body.court ?? '').trim();
  const docSummary = String(body.doc_summary ?? '').trim();
  const docName = String(body.document_name ?? '').trim();
  const lang = String(body.lang ?? 'he').trim().toLowerCase();
  if (!caseId) return json({ error: 'case_id required' }, request, env, 400);

  // The full CHAIN of documents already filed in this case, read straight from
  // the Cloudflare `documents` table, oldest → newest. The model uses it to
  // infer the CURRENT procedural stage (what has already been filed vs. what is
  // missing) and propose the next logical step accordingly.
  let docsChain = '';
  try {
    const dRs = await env.DB.prepare(
      `SELECT title, title_ar, file_name, date, created_at
       FROM documents
       WHERE user_id = ?1 AND upper(case_source_id) = upper(?2)
       ORDER BY COALESCE(NULLIF(date, ''), created_at) ASC, created_at ASC`,
    )
      .bind(env.USER_ID, caseId)
      .all();
    const caseDocs = (dRs.results ?? []) as Array<Record<string, unknown>>;
    docsChain = caseDocs
      .map((d, i) => {
        const name = String(d.title || d.title_ar || d.file_name || '-').trim();
        const when = String(d.date || '').trim();
        return `${i + 1}. ${name}${when ? ' — ' + when : ''}`;
      })
      .join('\n');
  } catch {
    docsChain = '';
  }

  // Shown when the case is at a stage with no proactive step for the office
  // (awaiting the court's decision or the other side's move).
  const waitMsg =
    lang === 'ar'
      ? 'في هذه المرحلة لا يوجد إجراء مبادر مطلوب من المكتب وفق أصول المحاكمات — يجب انتظار قرارات وتوجيهات جديدة في الملف.'
      : 'בשלב זה אין פעולה יזומה הנדרשת מהמשרד לפי סדרי הדין — יש להמתין להחלטות ולהנחיות חדשות בתיק.';

  const courtTypes = mapCourtTypes(court);
  const placeholders = courtTypes.map((_, i) => '?' + (i + 1)).join(', ');
  const rs = await env.DB.prepare(
    `SELECT court_type, stage, action_name, responsible, deadline, deadline_from, legal_source, practical_notes
     FROM legal_actions WHERE court_type IN (${placeholders}) ORDER BY court_type, id`,
  )
    .bind(...courtTypes)
    .all();
  const actions = (rs.results ?? []) as Array<Record<string, unknown>>;
  if (actions.length === 0) {
    return json(
      { ok: false, error: 'no_actions_for_court_type', court_types: courtTypes },
      request,
      env,
    );
  }

  const actionsText = actions
    .map(
      (a) =>
        `- [${a.court_type} | ${a.stage}] ${a.action_name} | אחראי: ${a.responsible || '-'} | מועד: ${a.deadline || '-'} (${a.deadline_from || '-'}) | מקור: ${a.legal_source || '-'}${a.practical_notes ? ' | הערה: ' + a.practical_notes : ''}`,
    )
    .join('\n');

  const systemPrompt =
    'אתה עוזר משפטי במשרד עורכי דין בישראל. קיבלת: (א) את תוכן/פענוח המסמך האחרון שהתקבל בתיק (מה שנקבע או נדרש בו), (ב) את שרשרת המסמכים שכבר הוגשו, ו-(ג) רשימת הפעולות האפשריות לפי סדרי הדין של הערכאה הרלוונטית. משימתך: בחר את הפעולה הדיונית שעל המשרד לנקוט כתגובה למסמך האחרון ו/או לאורו — הפעולה חייבת להתאים למה שנאמר בפועל במסמך האחרון, ולהיות מוקבלת לסדר הדין המתאים של אותה ערכאה. תחילה קבע מהו השלב הנוכחי לפי שרשרת המסמכים, ואז בחר מתוך הרשימה שסופקה את הפעולה התואמת גם לתוכן המסמך האחרון וגם לשלב. בחר אך ורק מתוך הרשימה שסופקה; אל תציע פעולה ששלבה כבר חלף, ואל תמציא פעולות, מועדים או מקורות שאינם ברשימה. החזר אובייקט JSON אחד בלבד, ללא טקסט נוסף, ותו ראשון {.';
  const userText =
    'הערכאה: ' +
    (court || '-') +
    ' (court_type: ' +
    courtTypes.join(' + ') +
    ').\n\nתוכן/פענוח המסמך האחרון שהתקבל בתיק (זהו הבסיס העיקרי — בחר את הפעולה נגדו ו/או לאורו):\n' +
    (docSummary ||
      '(אין תוכן למסמך האחרון — הסתמך על שרשרת המסמכים לעיל)') +
    '\n\nשרשרת המסמכים שכבר הוגשו/מצויים בתיק, לפי סדר הזמן (מהישן לחדש):\n' +
    (docsChain || '(אין עדיין מסמכים בתיק)') +
    '\n\nקבע לפי שרשרת המסמכים מה כבר בוצע ומהו השלב הנוכחי, ובחר את הפעולה הבאה ההגיונית התואמת גם לתוכן המסמך האחרון וגם לשלב זה, מוקבלת לסדר הדין של הערכאה.\n\nרשימת הפעולות האפשריות בערכאה זו (בחר אך ורק מתוכה):\n' +
    actionsText +
    '\n\nאם בשלב הנוכחי אין פעולה יזומה שעל המשרד לנקוט לפי סדרי הדין (התיק ממתין להחלטת בית הדין/בית המשפט או לצעד מצד שכנגד), החזר את suggested_action בדיוק כך: "' +
    waitMsg +
    '" והשאר deadline ו-legal_source ריקים.\n\n' +
    (lang === 'ar'
      ? 'اكتب كل النصوص في الحقول suggested_action و reasoning و deadline و legal_source باللغة العربية الفصحى القانونية المهنية فقط. قائمة الإجراءات والمواعيد والمصادر مكتوبة بالعبرية — تَرجِمها ترجمةً قانونيةً دقيقةً إلى مصطلحات عربية قانونية حقيقية. مُنِعَ منعاً باتاً نقلُ أي كلمة عبرية أو أجنبية نقحرةً (كتابةً صوتيةً بأحرف عربية)؛ كل كلمة يجب أن تكون كلمةً عربيةً صحيحةً وذات معنى قانوني سليم. أبقِ الأرقام وأرقام المواد/الأنظمة كما هي وترجِم أسماءها ووصفها إلى العربية (مثال: «כתב תביעה» ← «لائحة دعوى»، «תקנה» ← «مادة/نظام»، «בית משפט לענייני משפחה» ← «محكمة شؤون الأسرة»). '
      : 'כתוב את suggested_action ואת reasoning בעברית. ') +
    'החזר JSON: {"suggested_action":"שם הפעולה והסבר קצר מה לעשות","deadline":"המועד מתוך הרשימה","legal_source":"התקנה/המקור מתוך הרשימה","reasoning":"נימוק קצר","confidence":"high או medium או low"}.';

  let suggested = '';
  let deadline = '';
  let legalSource = '';
  let reasoning = '';
  let confidence = '';
  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': env.ANTHROPIC_API_KEY || '',
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 900,
        system: systemPrompt,
        messages: [{ role: 'user', content: userText }],
      }),
    });
    if (resp.ok) {
      const data = (await resp.json()) as {
        content?: Array<{ type: string; text?: string }>;
      };
      const textOut = (data.content || [])
        .filter((b) => b.type === 'text')
        .map((b) => b.text || '')
        .join('');
      const cleaned = textOut
        .trim()
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/, '')
        .replace(/```\s*$/, '')
        .trim();
      const parsed = JSON.parse(cleaned) as Record<string, unknown>;
      suggested = String(parsed.suggested_action ?? '').trim();
      deadline = String(parsed.deadline ?? '').trim();
      legalSource = String(parsed.legal_source ?? '').trim();
      reasoning = String(parsed.reasoning ?? '').trim();
      confidence = String(parsed.confidence ?? '').trim();
    }
  } catch {
    // fall through — suggested stays empty, handled below
  }

  if (!suggested) {
    // No proactive step at this stage (or the model returned nothing) → tell
    // the office to wait for new decisions/instructions instead of failing.
    suggested = waitMsg;
    deadline = '';
    legalSource = '';
    if (!reasoning) reasoning = waitMsg;
    confidence = confidence || 'low';
  }

  // `client_id` is NOT NULL in the table — bind '' (never null) so a case
  // without a resolved client can't crash the INSERT (which, being outside the
  // AI try/catch, would surface as a Worker exception / HTTP 1101 and leave the
  // "הצעה לפעולה" card empty). Wrap the write too, so a suggestion is still
  // returned even if persistence hiccups.
  try {
    await env.DB.prepare(
      `INSERT INTO case_suggested_actions
       (client_id, case_id, document_name, court_type, suggested_action, deadline, legal_source, confidence, reasoning)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
    )
      .bind(
        clientId || '',
        caseId,
        docName || null,
        courtTypes.join(','),
        suggested,
        deadline || null,
        legalSource || null,
        confidence || null,
        reasoning || null,
      )
      .run();
  } catch (e) {
    console.warn('[suggest-action] persist failed', String(e).slice(0, 200));
  }

  return json(
    {
      ok: true,
      court_types: courtTypes,
      suggested_action: suggested,
      deadline,
      legal_source: legalSource,
      reasoning,
      confidence,
    },
    request,
    env,
  );
}

// ---------------------------------------------------------------------------
// POST /api/split-decision
// For a court DECISION / PROTOCOL document, split its (Cloudflare) summary into
// the operative DECISION/ruling part and the REST, so the decode box can show
// the decision first and the rest after a separator. Pure text (uses the
// existing summary — no PDF). On any failure returns the whole text as `rest`.
// ---------------------------------------------------------------------------
async function handleSplitDecision(request: Request, env: Env): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'invalid json' }, request, env, 400);
  }
  const summary = String(body.summary ?? '').trim();
  // Distinguish "no language requested" (e.g. the make.com pipeline) from an
  // explicit 'he'/'ar'. The app forces a language; the pipeline sends none, and
  // must get the decision summary back in the SUMMARY'S OWN language (regression
  // fix: previously the missing lang defaulted to 'he' and translated Arabic
  // decision summaries into Hebrew).
  const langSent = String(body.lang ?? '').trim().toLowerCase();
  const clientName = String(body.client_name ?? '').trim();
  const lawyerName =
    DEFAULT_LAWYER_NAME +
    (String(body.lawyer_name || '').trim()
      ? ' / ' + String(body.lawyer_name).trim()
      : '');
  if (!summary) return json({ ok: false, decision: '', rest: '' }, request, env);

  const systemPrompt =
    'אתה עוזר משפטי במשרד עורך הדין ' +
    lawyerName +
    '. קיבלת סיכום של החלטה/פרוטוקול מבית משפט/בית דין. הפרד בבירור בין ההחלטה/ההוראה האופרטיבית של בית המשפט לבין שאר תוכן המסמך (רקע, עובדות, נימוקים, מהלך הדיון).\n\n' +
    (clientName
      ? 'לקוח המשרד בתיק זה — הצד שאנו מייצגים — הוא: ' +
        clientName +
        '. זהו הצד המיוצג על ידי עורך הדין הנ"ל; הצד שכנגד אינו מיוצג על ידינו. זהה לפי השמות בהחלטה מי מבין הצדדים (התובע או הנתבע) הוא לקוח המשרד הזה, והתייחס אל "אנחנו/אותנו" ככוונה ללקוח זה בלבד.\n\n'
      : '') +
    'כלל חילוץ המשימה (task_title) — הקפד עליו בדייקנות:\n' +
    '• צור משימה אך ורק כאשר ההחלטה מחייבת אותנו — כלומר את לקוח המשרד' +
    (clientName ? ' (' + clientName + ')' : '') +
    '/עורך הדין הנ"ל — לבצע פעולה דיונית של תגובה: "להגיב על", "להשיב ל-", "לנמק את", להגיש תגובה/תשובה/הבהרה/התייחסות/כתב טענות — בדרך כלל בתוך מועד.\n' +
    '• אל תיצור משימה עבור חיוב כספי (תשלום סכום, הוצאות, מזונות) — חיוב כספי אינו משימה; השאר task_title ריק.\n' +
    '• אל תיצור משימה כאשר החובה/הפעולה מוטלת על הצד שכנגד (הצד שאיננו מייצגים) ולא על לקוח המשרד, או כאשר ההחלטה היא קביעה/הכרעה בלבד שאינה דורשת מלקוח המשרד פעולת תגובה דיונית; השאר task_title ריק. המשימה שתיווצר חייבת להיות הפעולה המוטלת על הצד שאנו מייצגים בלבד.\n\n' +
    'אם ההחלטה קובעת מועד דיון/ישיבה הבא, חלץ את תאריך הדיון (והשעה אם צוינה) — זה שדה נפרד (hearing_date) ואינו תלוי בכלל המשימה. אל תמציא תוכן, תאריכים או שעות שאינם בסיכום. החזר אובייקט JSON אחד בלבד, ללא טקסט נוסף, ותו ראשון {.';
  const userText =
    'סיכום המסמך:\n' +
    summary +
    '\n\n' +
    (langSent === 'ar'
      ? 'اكتب قيم الحقول decision و rest و task_title باللغة العربية فقط. '
      : langSent === 'he'
        ? 'כתוב את הערכים בשדות decision, rest, task_title בעברית בלבד. '
        : 'כתוב את הערכים בשדות decision, rest ו-task_title באותה שפה שבה כתוב הסיכום שקיבלת — אל תתרגם לשפה אחרת. ') +
    'החזר JSON: {"decision":"ההחלטה/ההוראה האופרטיבית של בית המשפט בלשון תמציתית; אם אין החלטה אופרטיבית ברורה השאר מחרוזת ריקה","rest":"שאר תוכן המסמך (רקע/עובדות/נימוקים/מהלך הדיון) בתמצית","task_title":"רק אם ההחלטה מחייבת אותנו בפעולת תגובה דיונית (להגיב/להשיב/לנמק/להגיש תגובה) — נסח את הפעולה שעלינו לבצע; אחרת (כולל חיוב כספי או חובה על הצד שכנגד) השאר ריק","task_due_date":"תאריך היעד לביצוע המשימה בפורמט YYYY-MM-DD אם מצוין, אחרת ריק","hearing_date":"תאריך מועד הדיון/הישיבה הבא בפורמט YYYY-MM-DD אם נקבע בהחלטה, אחרת ריק","hearing_time":"שעת הדיון בפורמט HH:MM אם צוינה, אחרת ריק"}.';

  let decision = '';
  let rest = '';
  let taskTitle = '';
  let taskDueDate = '';
  let hearingDate = '';
  let hearingTime = '';
  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': env.ANTHROPIC_API_KEY || '',
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 2000,
        system: systemPrompt,
        messages: [{ role: 'user', content: userText }],
      }),
    });
    if (resp.ok) {
      const data = (await resp.json()) as {
        content?: Array<{ type: string; text?: string }>;
      };
      const textOut = (data.content || [])
        .filter((b) => b.type === 'text')
        .map((b) => b.text || '')
        .join('');
      const cleaned = textOut
        .trim()
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/, '')
        .replace(/```\s*$/, '')
        .trim();
      const parsed = JSON.parse(cleaned) as Record<string, unknown>;
      decision = String(parsed.decision ?? '').trim();
      rest = String(parsed.rest ?? '').trim();
      taskTitle = String(parsed.task_title ?? '').trim();
      taskDueDate = String(parsed.task_due_date ?? '').trim();
      hearingDate = String(parsed.hearing_date ?? '').trim();
      hearingTime = String(parsed.hearing_time ?? '').trim();
    }
  } catch {
    // fall through
  }
  // Never lose the content: if the split failed, show everything as `rest`.
  if (!decision && !rest) rest = summary;

  return json(
    {
      ok: true,
      decision,
      rest,
      task_title: taskTitle,
      task_due_date: taskDueDate,
      hearing_date: hearingDate,
      hearing_time: hearingTime,
    },
    request,
    env,
  );
}

// ---------------------------------------------------------------------------
// POST /api/translate
// Translate a short piece of text into a target language (default Arabic).
// Used by the case-brain so the "משימה שנוצרה" box reads ONLY in Arabic for the
// Sharia / Christian / Druze courts even when the underlying task text (stored
// task title or D1 decision description) was written in Hebrew.
// ---------------------------------------------------------------------------
async function handleTranslate(request: Request, env: Env): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'invalid json' }, request, env, 400);
  }
  const text = String(body.text ?? '').trim();
  const target = String(body.target ?? 'ar').trim().toLowerCase();
  if (!text) return json({ ok: true, text: '' }, request, env);
  const targetName =
    target === 'he' ? 'העברית' : target === 'en' ? 'English' : 'العربية';
  let out = '';
  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': env.ANTHROPIC_API_KEY || '',
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 1000,
        system:
          'You are a professional legal translator. Translate the user text into ' +
          targetName +
          ' only. Preserve legal meaning, names, numbers and dates exactly. Output ONLY the translation — no quotes, no notes, no transliteration, nothing else.',
        messages: [{ role: 'user', content: text }],
      }),
    });
    if (resp.ok) {
      const data = (await resp.json()) as {
        content?: Array<{ type: string; text?: string }>;
      };
      out = (data.content || [])
        .filter((b) => b.type === 'text')
        .map((b) => b.text || '')
        .join('')
        .trim();
    }
  } catch {
    out = '';
  }
  // On any failure return the original text so the caller never shows a blank.
  return json({ ok: true, text: out || text }, request, env);
}

// ---------------------------------------------------------------------------
// GET /api/suggested-actions/:case_id
// ---------------------------------------------------------------------------
async function handleGetSuggestedActions(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const caseId = url.pathname.replace('/api/suggested-actions/', '').trim();
  if (!caseId) {
    return json({ error: 'case_id required' }, request, env, 400);
  }
  const rs = await env.DB.prepare(
    `SELECT * FROM case_suggested_actions
     WHERE case_id = ?
     ORDER BY created_at DESC`,
  )
    .bind(caseId)
    .all();
  return json({ case_id: caseId, suggestions: rs.results ?? [] }, request, env);
}

// ---------------------------------------------------------------------------
// GET /api/photo/<key>
// ---------------------------------------------------------------------------
// -----------------------------------------------------------------------
// GET /api/document?path=<relative_path>
// Stream a filing document from the office's Dropbox so a device that never
// connected Dropbox itself (a client opening the portal bot on their phone) can
// still download it. The office connected Dropbox once; its refresh token lives
// here as a Worker secret. Requires the shared APP_TOKEN like every authed
// endpoint, and echoes CORS headers because the browser fetches it with an
// Authorization header (a CORS request, unlike an <img> tag).
// -----------------------------------------------------------------------

// Short-lived Dropbox access token, cached across requests in the same isolate
// so we don't re-exchange the refresh token on every download.
let dropboxTokenCache: { token: string; expiresAt: number } | null = null;

async function getDropboxAccessToken(env: Env): Promise<string | null> {
  if (!env.DROPBOX_REFRESH_TOKEN || !env.DROPBOX_APP_KEY) return null;
  const now = Date.now();
  if (dropboxTokenCache && now < dropboxTokenCache.expiresAt) {
    return dropboxTokenCache.token;
  }
  const body = new URLSearchParams();
  body.set('grant_type', 'refresh_token');
  body.set('refresh_token', env.DROPBOX_REFRESH_TOKEN);
  body.set('client_id', env.DROPBOX_APP_KEY);
  try {
    const res = await fetch('https://api.dropboxapi.com/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    if (!res.ok) {
      console.warn('[worker dropbox] token refresh failed', res.status);
      return null;
    }
    const jsonBody = (await res.json()) as {
      access_token: string;
      expires_in: number;
    };
    dropboxTokenCache = {
      token: jsonBody.access_token,
      expiresAt: now + (jsonBody.expires_in - 60) * 1000,
    };
    return jsonBody.access_token;
  } catch (e) {
    console.warn('[worker dropbox] token refresh error', e);
    return null;
  }
}

// Mirror the browser's dropboxPathForRelative: nest a filing relative_path under
// the office's connected base folder, guarding the doubled-"Clients" case, and
// return a leading-slash Dropbox API path.
function dropboxApiPath(relativePath: string, base: string): string {
  const raw = (relativePath || '').replace(/\/{2,}/g, '/');
  let b = (base || '').replace(/\/+$/, '');
  b = b.replace(/\/Clients$/i, '');
  let full: string;
  if (b && raw.toLowerCase().startsWith(b.toLowerCase() + '/')) {
    full = raw;
  } else {
    full = `${b}/${raw.replace(/^\/+/, '')}`;
  }
  full = full.replace(/\/{2,}/g, '/');
  return full.startsWith('/') ? full : '/' + full;
}

// Dropbox-API-Arg must be Latin-1 safe — escape non-ASCII (Hebrew/Arabic
// filenames) as \uXXXX so the fetch doesn't throw on the header value.
function dropboxApiArgHeader(value: unknown): string {
  return JSON.stringify(value).replace(/[\u007f-\uffff]/g, (ch) =>
    '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0'),
  );
}

function mimeFromExt(name: string): string {
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
  switch (ext) {
    case 'pdf':
      return 'application/pdf';
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    case 'doc':
      return 'application/msword';
    case 'docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    case 'xls':
      return 'application/vnd.ms-excel';
    case 'xlsx':
      return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    case 'txt':
      return 'text/plain; charset=utf-8';
    default:
      return 'application/octet-stream';
  }
}

async function handleDocument(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const relativePath = (url.searchParams.get('path') || '').trim();
  if (!relativePath) {
    return json({ error: 'missing_path' }, request, env, 400);
  }
  const token = await getDropboxAccessToken(env);
  if (!token) {
    // The office hasn't provisioned server-side Dropbox credentials yet.
    return json({ error: 'dropbox_not_configured' }, request, env, 500);
  }
  const apiPath = dropboxApiPath(relativePath, env.DROPBOX_BASE_FOLDER || '');
  let dbxRes: Response;
  try {
    dbxRes = await fetch('https://content.dropboxapi.com/2/files/download', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + token,
        'Dropbox-API-Arg': dropboxApiArgHeader({ path: apiPath }),
      },
    });
  } catch (e) {
    console.warn('[worker dropbox] download error', e);
    return json({ error: 'dropbox_unreachable' }, request, env, 502);
  }
  if (!dbxRes.ok || !dbxRes.body) {
    const detail = (await dbxRes.text().catch(() => '')).slice(0, 300);
    console.warn('[worker dropbox] download failed', dbxRes.status, detail);
    // 409 = path not found → surface as 404 so the client can say "unavailable".
    return json(
      { error: 'document_unavailable', detail },
      request,
      env,
      dbxRes.status === 409 ? 404 : 502,
    );
  }
  const fileName = relativePath.split('/').filter(Boolean).pop() || 'document';
  const headers = new Headers(corsHeaders(request, env));
  headers.set('Content-Type', mimeFromExt(fileName));
  headers.set('Cache-Control', 'private, max-age=3600');
  return new Response(dbxRes.body, { status: 200, headers });
}

async function servePhoto(env: Env, rawKey: string): Promise<Response> {
  let key: string;
  try {
    key = decodeURIComponent(rawKey);
  } catch {
    // A malformed percent-escape (e.g. "/api/photo/%") makes
    // decodeURIComponent throw URIError — treat it as not-found instead of
    // letting it bubble up to a bare 500.
    return new Response('not found', { status: 404 });
  }
  if (!key) return new Response('not found', { status: 404 });

  const obj = await env.PHOTOS.get(key);
  if (!obj) return new Response('not found', { status: 404 });

  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set('etag', obj.httpEtag);
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  return new Response(obj.body, { headers });
}

function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 180) || 'file';
}
// -----------------------------------------------------------------------
// POST /api/whatsapp-messages
// -----------------------------------------------------------------------
async function handleSaveWhatsAppMessage(request: Request, env: Env): Promise<Response> {
  let body: {
    client_phone: string;
    direction: string;
    message_text: string;
    timestamp: number;
    message_type?: string;
    media_url?: string;
    media_mime_type?: string;
    media_id?: string;
    file_name?: string;
  };
  try {
    body = await request.json() as typeof body;
  } catch {
    return json({ error: 'invalid_json' }, request, env, 400);
  }
  if (!body || !body.client_phone) {
    return json({ error: 'missing client_phone' }, request, env, 400);
  }
  try {
    await env.DB.prepare(
      'INSERT INTO whatsapp_messages (client_phone, direction, message_text, timestamp, message_type, media_url, media_mime_type, media_id, file_name) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)'
    ).bind(
      body.client_phone,
      body.direction,
      body.message_text || '',
      body.timestamp,
      body.message_type || 'text',
      body.media_url || null,
      body.media_mime_type || null,
      body.media_id || null,
      body.file_name || null
    ).run();
  } catch (e) {
    console.error('[worker] failed to save whatsapp message', e);
    return json({ error: 'db_error' }, request, env, 500);
  }
  return json({ ok: true }, request, env);
}

// -----------------------------------------------------------------------
// GET /api/whatsapp-messages/:phone
// -----------------------------------------------------------------------
async function handleGetWhatsAppMessages(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const phone = url.pathname.split('/').pop() ?? '';
  const rs = await env.DB.prepare(
    'SELECT * FROM whatsapp_messages WHERE client_phone = ?1 ORDER BY timestamp ASC'
  ).bind(phone).all();
  return json({ messages: rs.results ?? [] }, request, env);
}