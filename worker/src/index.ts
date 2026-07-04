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
    if (method === 'GET' && path.startsWith('/api/suggested-actions/')) {
      return handleGetSuggestedActions(request, env);
    }
if (method === 'POST' && path === '/api/whatsapp-messages') {
    return handleSaveWhatsAppMessage(request, env);
  }
  if (method === 'GET' && path.startsWith('/api/whatsapp-messages/')) {
    return handleGetWhatsAppMessages(request, env);
  }
    return json({ error: 'not found' }, request, env, 404);
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
    String(body.lawyer_name || '').trim() || DEFAULT_LAWYER_NAME;

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

  const systemPrompt =
    'أنت محامٍ خبير في الأحوال الشخصية للمسلمين في إسرائيل، تترافع أمام المحاكم الشرعية ومحاكم شؤون العائلة. مهمتك: قراءة المستند المرفق بالكامل (وهو مستند وارد مثل قرار محكمة أو لائحة دعوى أو طلب من الطرف الآخر) وصياغة مسودة رد قانوني عليه. القالب الحاكم للصياغة والتنسيق وتفاصيل المحامي وبنية الفقرات المرقّمة هو الوثيقة المرجعية التالية، والتزم بها حرفياً كمرجع للأسلوب والشكل:\n\n<skill>\n' +
    skill +
    '\n</skill>\n\nقاعدة اللغة الإلزامية: اكتشف لغة المستند المرفق أياً كانت (عربية، عبرية، إنجليزية، فرنسية، روسية، أو أي لغة أخرى) بالاعتماد على متن المستند القانوني نفسه لا على صفحة الغلاف. كثير من الملفات تبدأ بصفحة أولى آلية بالعبرية هي مجرد "אישור הגשה" (إشعار استلام من نظام المحكمة الإلكتروني) — تجاهل هذه الصفحة عند تحديد اللغة واعتمد على المتن الذي يليها. وبوجه خاص: إذا كان المستند مقدَّماً إلى أو موجَّهاً إلى المحكمة الشرعية (בית הדין השרעי / المحكمة الشرعية) أو كان متنه مكتوباً بالعربية، فاللغة هي ar واكتب المسودة بالعربية حتى لو كانت الصفحة الأولى (إشعار الاستلام) بالعبرية. اكتب المسودة بلغة المستند نفسها فقط، ولا تخلط لغتين في مسودة واحدة. ضع رمز اللغة في الحقل detected_language (مثل ar أو he أو en أو fr أو ru) وضع نص المسودة الكامل في الحقل draft بلغة المستند. لا تختلق وقائع أو تواريخ أو أسماء غير موجودة في المستند أو في ملاحظات القضية. أعِد كائن JSON واحداً فقط، دون أي نص خارج JSON، ودون Markdown، وأول حرف في ردك يجب أن يكون القوس {.';

  const userText =
    'اقرأ المستند المرفق بالكامل كلمةً كلمةً. مكتبنا/المحامي صاحب الملف هو: ' +
    lawyerName +
    '.\n\nأولاً صنِّف المستند:\n' +
    '- author_side = من حرّر/قدّم هذا المستند؟ "ours" إذا حرّره مكتبنا/المحامي المذكور أعلاه، أو "opposing" إذا قدّمه الطرف الآخر/الخصم، أو "court" إذا كان صادراً عن المحكمة/القاضي.\n' +
    '- court_requires_response = true إذا كان المستند يأمر أو يطلب تقديم رد/جواب/تعقيب، وإلا false.\n\n' +
    'قاعدة إعداد المسودة (مهمة جداً): أعِدّ نص مسودة الرد فقط إذا كان المستند من الطرف الآخر (author_side = "opposing") أو إذا أمرت المحكمة بالرد (court_requires_response = true). أما إذا كان المستند من مكتبنا (author_side = "ours") ولم تأمر المحكمة بالرد، فلا حاجة لمسودة: اترك draft_he و draft_ar = null.\n\n' +
    'هذه ملاحظات المحامي على هذه القضية، استخدمها في توجيه الرد:\n<case_notes_he>\n' +
    notes.he +
    '\n</case_notes_he>\n<case_notes_ar>\n' +
    notes.ar +
    '\n</case_notes_ar>\n\nصُغ (عند الحاجة فقط) مسودة رد قانوني كامل على هذا المستند وفق القالب الحاكم، بلغة المستند نفسها. أعِد كائن JSON واحداً فقط بهذا الهيكل بالضبط: {"detected_language": "رمز لغة المستند مثل ar أو he أو en أو fr أو ru", "author_side": "ours or opposing or court", "court_requires_response": true or false, "doc_type": "نوع المستند الوارد", "title": "عنوان المسودة بلغة المستند أو null", "draft": "نص المسودة الكامل بلغة المستند أو null"}. لا تكتب أي شيء خارج JSON.';

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
  const built = buildUpsert('drafts', row, env.USER_ID);
  if (built) {
    await env.DB.prepare(built.sql)
      .bind(...built.binds)
      .run();
    count = 1;
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
    String(body.lawyer_name || '').trim() || DEFAULT_LAWYER_NAME;

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
    'صنِّف هذا المستند:\n' +
    '- author_side = "ours" إذا حرّره مكتبنا/المحامي ' +
    lawyerName +
    '، أو "opposing" إذا قدّمه الطرف الآخر/الخصم، أو "court" إذا صدر عن المحكمة/القاضي.\n' +
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
  await env.DB.prepare(
    `INSERT INTO case_suggested_actions
     (client_id, case_id, document_name, court_type, suggested_action, deadline, legal_source, confidence, reasoning)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
  )
    .bind(
      str(body.client_id),
      str(body.case_id),
      str(body.document_name),
      str(body.court_type),
      str(body.suggested_action),
      str(body.deadline),
      str(body.legal_source),
      str(body.confidence),
      str(body.reasoning),
    )
    .run();
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
  if (/עליון|בג["”']?ץ|בגץ|عليا|عدل عليا|high court|hcj/.test(c)) return ['hcj'];
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
    'אתה עוזר משפטי במשרד עורכי דין בישראל. בהינתן רשימת הפעולות האפשריות לפי סדרי הדין של הערכאה הרלוונטית, ובהינתן הקשר התיק/המסמך האחרון, בחר את הפעולה הבאה שעל המשרד לנקוט — אך ורק מתוך הרשימה שסופקה. אל תמציא פעולות, מועדים או מקורות שאינם ברשימה. החזר אובייקט JSON אחד בלבד, ללא טקסט נוסף, ותו ראשון {.';
  const userText =
    'הערכאה: ' +
    (court || '-') +
    ' (court_type: ' +
    courtTypes.join(' + ') +
    ').\n\nרשימת הפעולות האפשריות בערכאה זו (בחר אך ורק מתוכה):\n' +
    actionsText +
    '\n\nהקשר/המסמך האחרון בתיק:\n' +
    (docSummary ||
      '(אין סיכום מסמך — הצע את הפעולה ההגיונית הבאה לפי שלבי ההליך)') +
    '\n\nאם בשלב הנוכחי אין פעולה יזומה שעל המשרד לנקוט לפי סדרי הדין (התיק ממתין להחלטת בית הדין/בית המשפט או לצעד מצד שכנגד), החזר את suggested_action בדיוק כך: "' +
    waitMsg +
    '" והשאר deadline ו-legal_source ריקים.\n\nהחזר JSON: {"suggested_action":"שם הפעולה והסבר קצר מה לעשות","deadline":"המועד מתוך הרשימה","legal_source":"התקנה/המקור מתוך הרשימה","reasoning":"נימוק קצר בעברית","confidence":"high או medium או low"}.';

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

  await env.DB.prepare(
    `INSERT INTO case_suggested_actions
     (client_id, case_id, document_name, court_type, suggested_action, deadline, legal_source, confidence, reasoning)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
  )
    .bind(
      clientId || null,
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
  const lang = String(body.lang ?? 'he').trim().toLowerCase();
  if (!summary) return json({ ok: false, decision: '', rest: '' }, request, env);

  const systemPrompt =
    'אתה עוזר משפטי. קיבלת סיכום של מסמך מבית משפט/בית דין מסוג החלטה או פרוטוקול. הפרד בבירור בין ההחלטה/ההוראה האופרטיבית של בית המשפט (מה הוחלט, נקבע או הורה) לבין שאר תוכן המסמך (רקע, עובדות, נימוקים, מהלך הדיון). אם ההחלטה מטילה פעולה עם מועד (למשל "להגיב תוך X ימים" או "עד תאריך"), חלץ אותה כמשימה. אל תמציא תוכן שאינו בסיכום. החזר אובייקט JSON אחד בלבד, ללא טקסט נוסף, ותו ראשון {.';
  const userText =
    'סיכום המסמך:\n' +
    summary +
    '\n\nהחזר JSON בשפת הסיכום: {"decision":"ההחלטה/ההוראה האופרטיבית של בית המשפט בלשון תמציתית; אם אין החלטה אופרטיבית ברורה השאר מחרוזת ריקה","rest":"שאר תוכן המסמך (רקע/עובדות/נימוקים/מהלך הדיון) בתמצית","task_title":"הפעולה שעל המשרד לבצע לפי ההחלטה (למשל: להגיש תגובה להחלטה), או ריק אם אין","task_due_date":"תאריך היעד בפורמט YYYY-MM-DD אם מצוין בהחלטה, אחרת ריק"}.';

  let decision = '';
  let rest = '';
  let taskTitle = '';
  let taskDueDate = '';
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
    }
  } catch {
    // fall through
  }
  // Never lose the content: if the split failed, show everything as `rest`.
  if (!decision && !rest) rest = summary;
  void lang;

  return json(
    { ok: true, decision, rest, task_title: taskTitle, task_due_date: taskDueDate },
    request,
    env,
  );
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
async function servePhoto(env: Env, rawKey: string): Promise<Response> {
  const key = decodeURIComponent(rawKey);
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
  const body = await request.json() as { 
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