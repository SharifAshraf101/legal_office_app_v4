// Daily briefing — GET /api/briefing?day=YYYY-MM-DD&lang=he|ar and
// POST /api/briefing-argument { caseId, day, lang }.
//
// A day is a calendar day in Israel time. The briefing lists that day's
// calendar entries, the open tasks due that day (and how many are overdue),
// and for every HEARING tied to a case: the case's details and its last
// three actions (the documents filed in it, newest first, with their AI
// summaries). The "what to argue" suggestion is a separate call (a model
// reads the case's reply drafts from the brain screen), cached per case, day
// and language so it is written once.

import type { Env } from './db';
import { callAnthropicWithRetry } from './pdfLimits';
import type { Ctx } from './tenant';

const TZ = 'Asia/Jerusalem';
const ARGUMENT_MODEL = 'claude-sonnet-4-6';
const DRAFT_CHARS = 5000; // per draft, two newest drafts

type R = Record<string, unknown>;
const str = (v: unknown) => String(v ?? '').trim();

/** "YYYY-MM-DD" (Israel) and "HH:MM" of a stored date-time. */
function israelParts(iso: unknown): { day: string; time: string } {
  const s = str(iso);
  if (!s) return { day: '', time: '' };
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return { day: s, time: '' };
  // No zone in the value: it was written as Israel local time.
  if (!/[zZ]|[+-]\d{2}:?\d{2}$/.test(s)) return { day: s.slice(0, 10), time: s.slice(11, 16) };
  const d = new Date(s);
  if (isNaN(d.getTime())) return { day: s.slice(0, 10), time: s.slice(11, 16) };
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
    .formatToParts(d)
    .reduce<Record<string, string>>((o, x) => ((o[x.type] = x.value), o), {});
  return { day: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

export function todayInIsrael(): string {
  return israelParts(new Date().toISOString()).day;
}

const isDone = (s: unknown) => ['done', 'completed', 'closed'].includes(str(s).toLowerCase());
const isHearing = (e: R) =>
  str(e.type) === 'hearingMeeting' || /דיון|جلسة|ישיבה/.test(str(e.title) + ' ' + str(e.title_ar));

export async function handleBriefing(ctx: Ctx, url: URL): Promise<unknown> {
  const day = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get('day') || '')
    ? String(url.searchParams.get('day'))
    : todayInIsrael();
  const ar = url.searchParams.get('lang') === 'ar';
  const pick = (r: R | undefined, he: string, a: string) => (r ? (ar ? str(r[a]) || str(r[he]) : str(r[he]) || str(r[a])) : '');

  const all = async (sql: string, ...binds: unknown[]) =>
    ((await ctx.db.prepare(sql).bind(ctx.tenantId, ...binds).all()).results ?? []) as R[];

  // Events are stored in UTC — take a ±1 day window and keep the Israel day.
  const lo = new Date(Date.parse(day + 'T00:00:00Z') - 86400000).toISOString();
  const hi = new Date(Date.parse(day + 'T00:00:00Z') + 2 * 86400000).toISOString();
  const [events, tasks, clients, cases] = await Promise.all([
    all(
      'SELECT source_id, case_source_id, client_source_id, title, title_ar, date_time, description, description_ar, type FROM calendar_events WHERE user_id = ?1 AND date_time >= ?2 AND date_time < ?3',
      lo,
      hi,
    ),
    all(
      'SELECT source_id, case_source_id, client_source_id, title, due_date, status, priority FROM tasks WHERE user_id = ?1 AND due_date IS NOT NULL AND due_date <= ?2',
      day,
    ),
    all('SELECT source_id, full_name, full_name_ar FROM clients WHERE user_id = ?1'),
    all(
      'SELECT source_id, client_source_id, case_number, title, title_ar, court, court_ar, status FROM cases WHERE user_id = ?1',
    ),
  ]);
  const clientBy = new Map(clients.map((c) => [str(c.source_id).toUpperCase(), c]));
  const caseBy = new Map(cases.map((c) => [str(c.source_id).toUpperCase(), c]));
  const caseInfo = (caseId: unknown, clientId?: unknown) => {
    const c = caseBy.get(str(caseId).toUpperCase());
    const cl = clientBy.get(str(c?.client_source_id || clientId).toUpperCase());
    return {
      caseId: c ? str(c.source_id) : str(caseId),
      caseNumber: c ? str(c.case_number) : '',
      caseTitle: pick(c, 'title', 'title_ar'),
      court: pick(c, 'court', 'court_ar'),
      clientName: pick(cl, 'full_name', 'full_name_ar'),
    };
  };

  const dayEvents = events
    .map((e) => ({ e, p: israelParts(e.date_time) }))
    .filter((x) => x.p.day === day)
    .sort((a, b) => a.p.time.localeCompare(b.p.time));

  const eventsOut = dayEvents.map(({ e, p }) => ({
    id: str(e.source_id),
    time: p.time,
    type: str(e.type),
    hearing: isHearing(e),
    title: pick(e, 'title', 'title_ar'),
    description: pick(e, 'description', 'description_ar').slice(0, 200),
    ...caseInfo(e.case_source_id, e.client_source_id),
  }));

  const openTasks = tasks.filter((t) => !isDone(t.status));
  const prio = (p: unknown) => ({ high: 0, urgent: 0, medium: 1, normal: 1, low: 2 })[str(p).toLowerCase()] ?? 1;
  const taskOut = (t: R) => ({
    id: str(t.source_id),
    title: str(t.title),
    dueDate: str(t.due_date).slice(0, 10),
    priority: str(t.priority) || 'medium',
    ...caseInfo(t.case_source_id, t.client_source_id),
  });
  const dueToday = openTasks.filter((t) => str(t.due_date).slice(0, 10) === day).sort((a, b) => prio(a.priority) - prio(b.priority));
  const overdue = openTasks
    .filter((t) => str(t.due_date).slice(0, 10) < day)
    .sort((a, b) => str(b.due_date).localeCompare(str(a.due_date)));

  // Hearings tied to a case: the case and its last three actions.
  const hearingEvents = dayEvents.filter(({ e }) => isHearing(e) && str(e.case_source_id));
  const hearings = [];
  for (const { e, p } of hearingEvents) {
    const caseId = str(e.case_source_id);
    const docs = await all(
      'SELECT source_id, title, title_ar, file_name, date, summary_he, summary_ar FROM documents WHERE user_id = ?1 AND upper(case_source_id) = upper(?2) ORDER BY date DESC, updated_at DESC LIMIT 3',
      caseId,
    );
    let actions = docs.map((d) => ({
      kind: 'document',
      date: str(d.date).slice(0, 10),
      title: pick(d, 'title', 'title_ar') || str(d.file_name),
      summary: pick(d, 'summary_he', 'summary_ar').slice(0, 260),
    }));
    if (actions.length < 3) {
      const tl = await all(
        'SELECT type, title, title_ar, date, description, description_ar FROM timeline_items WHERE user_id = ?1 AND upper(case_source_id) = upper(?2) ORDER BY date DESC, updated_at DESC LIMIT ?3',
        caseId,
        3 - actions.length,
      );
      actions = actions.concat(
        tl.map((t) => ({
          kind: str(t.type) || 'note',
          date: str(t.date).slice(0, 10),
          title: pick(t, 'title', 'title_ar'),
          summary: pick(t, 'description', 'description_ar').slice(0, 200),
        })),
      );
    }
    const draftCount = await ctx.db
      .prepare("SELECT count(*) AS n FROM drafts WHERE user_id = ?1 AND upper(case_source_id) = upper(?2) AND source_id NOT LIKE '%/%'")
      .bind(ctx.tenantId, caseId)
      .first<{ n: number }>();
    hearings.push({
      eventId: str(e.source_id),
      time: p.time,
      title: pick(e, 'title', 'title_ar'),
      ...caseInfo(caseId, e.client_source_id),
      actions,
      drafts: Number(draftCount?.n || 0),
    });
  }

  return {
    day,
    events: eventsOut,
    hearings,
    tasksToday: dueToday.map(taskOut),
    overdue: { count: overdue.length, items: overdue.slice(0, 5).map(taskOut) },
  };
}

/* --------------------------------------------------- what to argue (AI) */

const ARG_DDL =
  'CREATE TABLE IF NOT EXISTS briefing_argument (case_source_id TEXT NOT NULL, day TEXT NOT NULL, lang TEXT NOT NULL, text TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (case_source_id, day, lang))';

export async function handleBriefingArgument(
  env: Env,
  ctx: Ctx,
  body: { caseId?: string; day?: string; lang?: string; refresh?: boolean },
): Promise<{ status: number; body: unknown }> {
  const caseId = str(body.caseId);
  const day = /^\d{4}-\d{2}-\d{2}$/.test(str(body.day)) ? str(body.day) : todayInIsrael();
  const lang = body.lang === 'ar' ? 'ar' : 'he';
  if (!caseId) return { status: 400, body: { error: 'caseId required' } };

  await ctx.db.prepare(ARG_DDL).run();
  if (!body.refresh) {
    const hit = await ctx.db
      .prepare('SELECT text FROM briefing_argument WHERE upper(case_source_id) = upper(?1) AND day = ?2 AND lang = ?3')
      .bind(caseId, day, lang)
      .first<{ text: string }>();
    if (hit?.text) return { status: 200, body: { text: hit.text, cached: true } };
  }

  const one = (sql: string, ...b: unknown[]) => ctx.db.prepare(sql).bind(ctx.tenantId, ...b).first<R>();
  const many = async (sql: string, ...b: unknown[]) =>
    ((await ctx.db.prepare(sql).bind(ctx.tenantId, ...b).all()).results ?? []) as R[];
  const c = await one(
    'SELECT source_id, client_source_id, case_number, title, title_ar, court, court_ar, description, description_ar FROM cases WHERE user_id = ?1 AND upper(source_id) = upper(?2)',
    caseId,
  );
  if (!c) return { status: 404, body: { error: 'case_not_found' } };
  const [docs, drafts] = await Promise.all([
    many(
      'SELECT title, title_ar, file_name, date, summary_he, summary_ar FROM documents WHERE user_id = ?1 AND upper(case_source_id) = upper(?2) ORDER BY date DESC, updated_at DESC LIMIT 5',
      caseId,
    ),
    many(
      "SELECT title, title_ar, file_name, draft_orig, draft_he, draft_ar, date, updated_at FROM drafts WHERE user_id = ?1 AND upper(case_source_id) = upper(?2) AND source_id NOT LIKE '%/%' ORDER BY COALESCE(date, updated_at) DESC, updated_at DESC LIMIT 2",
      caseId,
    ),
  ]);
  if (!docs.length && !drafts.length) {
    const none = lang === 'ar' ? 'لا توجد مستندات أو مسودات في هذا الملف يمكن الاستناد إليها.' : 'אין בתיק מסמכים או טיוטות שאפשר להסתמך עליהם.';
    return { status: 200, body: { text: none, empty: true } };
  }

  const material = [
    `CASE: ${str(c.case_number)} — ${str(c.title) || str(c.title_ar)} — court: ${str(c.court) || str(c.court_ar)}`,
    str(c.description) || str(c.description_ar) ? `CASE NOTES: ${(str(c.description) || str(c.description_ar)).slice(0, 800)}` : '',
    'RECENT DOCUMENTS (newest first):',
    ...docs.map(
      (d) =>
        `- ${str(d.date).slice(0, 10)} ${str(d.title) || str(d.title_ar) || str(d.file_name)}: ${(str(d.summary_he) || str(d.summary_ar)).slice(0, 700)}`,
    ),
    'REPLY DRAFTS FROM THE BRAIN SCREEN (newest first):',
    ...drafts.map(
      (d) =>
        `### ${str(d.title) || str(d.title_ar) || str(d.file_name)}\n${(str(d.draft_orig) || str(d.draft_he) || str(d.draft_ar)).slice(0, DRAFT_CHARS)}`,
    ),
  ]
    .filter(Boolean)
    .join('\n');

  const prompt =
    (lang === 'ar'
      ? 'أنت مساعد لمحامٍ يستعد لجلسة في المحكمة. اعتماداً فقط على المواد أدناه (آخر الإجراءات في الملف ومسودات الردود)، اكتب ما يجدر بالمحامي أن يطرحه أمام المحكمة في الجلسة. اكتب بالعربية فقط.'
      : 'אתה עוזר לעורך דין שמתכונן לדיון בבית המשפט. על סמך החומרים שלהלן בלבד (הפעולות האחרונות בתיק וטיוטות התשובה), כתוב מה ראוי שעורך הדין יטען בפני בית המשפט בדיון. כתוב בעברית בלבד.') +
    '\n\nRules: at most 5 short lines, one argument per line, each starting with "• ". The strongest point first. Only what the materials support — no invented facts, dates, amounts or rulings. No introduction and no closing.\n\n' +
    material;

  const call = await callAnthropicWithRetry(
    env.ANTHROPIC_API_KEY || '',
    JSON.stringify({ model: ARGUMENT_MODEL, max_tokens: 600, messages: [{ role: 'user', content: prompt }] }),
  );
  if (!call.response?.ok) return { status: 502, body: { error: 'model_unavailable' } };
  const data = (await call.response.json()) as { content?: Array<{ type: string; text?: string }> };
  const text = (data.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text || '')
    .join('')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 5)
    .join('\n');
  if (!text) return { status: 502, body: { error: 'empty_answer' } };
  await ctx.db
    .prepare(
      'INSERT OR REPLACE INTO briefing_argument (case_source_id, day, lang, text, created_at) VALUES (?1, ?2, ?3, ?4, ?5)',
    )
    .bind(str(c.source_id), day, lang, text, new Date().toISOString())
    .run();
  return { status: 200, body: { text } };
}
