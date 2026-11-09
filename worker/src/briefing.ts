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

export async function handleBriefing(env: Env, ctx: Ctx, url: URL): Promise<unknown> {
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

  // Hearings tied to a case: the case and its last three actions — written in
  // the CASE's language (its court documents), whatever the app language.
  const hearingEvents = dayEvents.filter(({ e }) => isHearing(e) && str(e.case_source_id));
  const hearings = [];
  for (const { e, p } of hearingEvents) {
    const caseId = str(e.case_source_id);
    const caseLang = await caseLanguage(ctx, caseId, ar ? 'ar' : 'he');
    const cAr = caseLang === 'ar';
    const pick = (r: R | undefined, he: string, a: string) =>
      r ? (cAr ? str(r[a]) || str(r[he]) : str(r[he]) || str(r[a])) : '';
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
    const cc = caseBy.get(caseId.toUpperCase());
    const ccl = clientBy.get(str(cc?.client_source_id || e.client_source_id).toUpperCase());
    // The card's own texts follow the case language; what the records hold
    // only in the other language is translated (and kept).
    const card = {
      title: pick(e, 'title', 'title_ar'),
      caseTitle: pick(cc, 'title', 'title_ar'),
      court: pick(cc, 'court', 'court_ar'),
      clientName: pick(ccl, 'full_name', 'full_name_ar'),
    };
    const tr = await translateTexts(
      env,
      ctx,
      [...Object.values(card), ...actions.flatMap((x) => [x.title, x.summary])],
      caseLang,
    );
    const t = (s: string) => tr.get(str(s)) || s;
    hearings.push({
      eventId: str(e.source_id),
      time: p.time,
      ...caseInfo(caseId, e.client_source_id),
      title: t(card.title),
      caseTitle: t(card.caseTitle),
      court: t(card.court),
      clientName: t(card.clientName),
      lang: caseLang,
      actions: actions.map((x) => ({ ...x, title: t(x.title), summary: t(x.summary) })),
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

/** The language of a case's court documents: the majority of its drafts'
 *  detected language (the language of the document each draft answers);
 *  `fallback` (the app language) when the case has no drafts. */
async function caseLanguage(ctx: Ctx, caseId: string, fallback: 'he' | 'ar'): Promise<'he' | 'ar'> {
  const rs = await ctx.db
    .prepare(
      "SELECT lower(language) AS l, count(*) AS n FROM drafts WHERE user_id = ?1 AND upper(case_source_id) = upper(?2) AND source_id NOT LIKE '%/%' GROUP BY lower(language)",
    )
    .bind(ctx.tenantId, caseId)
    .all<{ l: string | null; n: number }>();
  let ar = 0;
  let he = 0;
  for (const r of rs.results ?? []) {
    if (String(r.l || '').startsWith('ar')) ar += Number(r.n) || 0;
    else if (String(r.l || '').startsWith('he')) he += Number(r.n) || 0;
  }
  if (ar === 0 && he === 0) return fallback;
  return ar >= he ? 'ar' : 'he';
}

/* ----------------------------------- texts the card lacks in its language */

const TRANSLATE_MODEL = 'claude-haiku-4-5';
const TR_DDL =
  'CREATE TABLE IF NOT EXISTS briefing_translation (src TEXT NOT NULL, lang TEXT NOT NULL, text TEXT NOT NULL, PRIMARY KEY (src, lang))';

/** Translates the texts that are not in `to` (one model call for all the
 *  misses; every translation is kept, so a text is translated once). The
 *  office's records hold no Arabic for some fields (case titles, courts,
 *  document titles, Hebrew notes) — an Arabic case's card would mix. */
async function translateTexts(env: Env, ctx: Ctx, texts: string[], to: 'he' | 'ar'): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const need = [...new Set(texts.map(str).filter((t) => t && foreignLetters(t, to) > 0))];
  if (!need.length) return out;
  try {
    await ctx.db.prepare(TR_DDL).run();
    const marks = need.map((_, i) => `?${i + 2}`).join(', ');
    const hit = await ctx.db
      .prepare(`SELECT src, text FROM briefing_translation WHERE lang = ?1 AND src IN (${marks})`)
      .bind(to, ...need)
      .all<{ src: string; text: string }>();
    for (const r of hit.results ?? []) out.set(r.src, r.text);
    const miss = need.filter((t) => !out.has(t));
    if (!miss.length) return out;
    const call = await callAnthropicWithRetry(
      env.ANTHROPIC_API_KEY || '',
      JSON.stringify({
        model: TRANSLATE_MODEL,
        max_tokens: 4000,
        messages: [
          {
            role: 'user',
            content:
              (to === 'ar'
                ? 'Translate each item into Arabic (legal register used in Israeli Sharia / family courts). Keep names of people as they are spelled in Arabic, keep numbers and case numbers unchanged.'
                : 'Translate each item into Hebrew (legal register used in Israeli courts). Keep numbers and case numbers unchanged.') +
              ' Return ONLY a JSON array of strings, the same length and order as the input.\n\n' +
              JSON.stringify(miss),
          },
        ],
      }),
    );
    if (!call.response?.ok) return out;
    const data = (await call.response.json()) as { content?: Array<{ type: string; text?: string }> };
    const raw = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text || '').join('');
    const arr = JSON.parse(raw.slice(raw.indexOf('['), raw.lastIndexOf(']') + 1)) as unknown[];
    if (!Array.isArray(arr) || arr.length !== miss.length) return out;
    const stmts = [];
    for (let i = 0; i < miss.length; i++) {
      const t = str(arr[i]);
      if (!t) continue;
      out.set(miss[i], t);
      stmts.push(ctx.db.prepare('INSERT OR REPLACE INTO briefing_translation (src, lang, text) VALUES (?1, ?2, ?3)').bind(miss[i], to, t));
    }
    if (stmts.length) await ctx.db.batch(stmts);
  } catch {
    /* untranslated texts are shown as they are */
  }
  return out;
}

/** Letters of the other language in a text (link markers / numbers aside). */
function foreignLetters(text: string, lang: 'he' | 'ar'): number {
  return (text.match(lang === 'ar' ? /[֐-׿]/g : /[؀-ۿ]/g) || []).length;
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
  if (!caseId) return { status: 400, body: { error: 'caseId required' } };
  // The suggestion is written in the case's language (its court documents);
  // the app language only decides a case that has no drafts.
  const lang = await caseLanguage(ctx, caseId, body.lang === 'ar' ? 'ar' : 'he');

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
  // Whom the office represents — the suggestion argues for this client only
  // (without it the model sided with whichever party a draft quoted most).
  const client = await one(
    'SELECT full_name, full_name_ar FROM clients WHERE user_id = ?1 AND upper(source_id) = upper(?2)',
    str(c.client_source_id),
  );
  // Both spellings from the client card, so the name is found in a Hebrew or
  // an Arabic document alike.
  const clientName = [...new Set([str(client?.full_name), str(client?.full_name_ar)].filter(Boolean))].join(' / ');
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
    `OUR CLIENT (the office represents ONLY this party): ${clientName || 'unknown'}`,
    `CASE:${str(c.case_number)} — ${str(c.title) || str(c.title_ar)} — court: ${str(c.court) || str(c.court_ar)}`,
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
    "\n\nWhich side the office is on: OUR CLIENT is the person registered on the client card linked to this case (name below). Find that name among the parties in the documents — that party is our client, and every other party named there (e.g. the spouse) is the opposing side. From that, decide whether our client is the plaintiff or the defendant. You argue ONLY for our client, never for the other party: write every line from our client's side; a claim of the other side is something to rebut, never to adopt." +
    '\n\nRules: at most 5 short lines, one argument per line, each starting with "• ". The strongest point first. Only what the materials support — no invented facts, dates, amounts or rulings. No introduction and no closing.\n\n' +
    material;

  const ask = async (messages: Array<{ role: 'user' | 'assistant'; content: string }>) => {
    const call = await callAnthropicWithRetry(
      env.ANTHROPIC_API_KEY || '',
      JSON.stringify({ model: ARGUMENT_MODEL, max_tokens: 600, messages }),
    );
    if (!call.response?.ok) return null;
    const data = (await call.response.json()) as { content?: Array<{ type: string; text?: string }> };
    return (data.content || [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text || '')
      .join('')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(0, 5)
      .join('\n');
  };
  const first: Array<{ role: 'user' | 'assistant'; content: string }> = [{ role: 'user', content: prompt }];
  let text = await ask(first);
  if (text === null) return { status: 502, body: { error: 'model_unavailable' } };
  // One language, no mixing: an Arabic case's drafts are Arabic, so a Hebrew
  // answer (or the reverse) tends to carry words over — ask once more.
  if (text && foreignLetters(text, lang) > 0) {
    const again = await ask([
      ...first,
      { role: 'assistant', content: text },
      {
        role: 'user',
        content:
          lang === 'ar'
            ? 'أعد كتابة الأسطر نفسها بالعربية فقط، دون أي كلمة أو حرف بالعبرية، وبالصيغة نفسها.'
            : 'כתוב שוב את אותן שורות בעברית בלבד, בלי אף מילה או אות בערבית, באותו מבנה.',
      },
    ]);
    if (again && foreignLetters(again, lang) < foreignLetters(text, lang)) text = again;
  }
  if (!text) return { status: 502, body: { error: 'empty_answer' } };
  await ctx.db
    .prepare(
      'INSERT OR REPLACE INTO briefing_argument (case_source_id, day, lang, text, created_at) VALUES (?1, ?2, ?3, ?4, ?5)',
    )
    .bind(str(c.source_id), day, lang, text, new Date().toISOString())
    .run();
  return { status: 200, body: { text, lang } };
}
