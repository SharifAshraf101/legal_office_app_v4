import Anthropic from '@anthropic-ai/sdk';
import { NextResponse } from 'next/server';
import { AR_GLOSSARY } from '@/lib/arabicGlossary';
import { isValidOfficeSession, workerBase } from '@/lib/serverAuth';
import type {
  CalendarEvent,
  Case,
  Client,
  DocumentRecord,
  Finance,
  Lang,
  Task,
  TimelineItem,
} from '@/types';

/**
 * Claude-powered client bot.
 *
 * The CLIENT side has already authenticated a specific client (ID + phone),
 * filtered every domain array to just that client's records, and POSTs the
 * scoped slice to this endpoint along with their question. We never see
 * other clients' data here — the API key stays server-side, the LLM stays
 * sandboxed to the data it was handed.
 *
 * Anti-hallucination is enforced at the system-prompt level: "answer only
 * from the data passed in; if the answer isn't there, say so".
 *
 * Prompt caching: system prompt + the per-client static context get a
 * `cache_control` breakpoint; volatile bits (history + question) sit after
 * it. Repeat questions in the same session hit cache instead of re-billing
 * the full context.
 *
 * Note: this route only works at runtime under `next dev` / a Node server.
 * The project is configured for `output: 'export'`, so when shipping to
 * Netlify / Vercel we'll need to either turn off static export or migrate
 * this handler into a Netlify Function — kept out of scope for now.
 */

// Force the Node.js runtime — the Anthropic SDK uses Node streams.
export const runtime = 'nodejs';

interface BotMessage {
  question: string;
  answer: string;
  time?: string;
}

interface ScopedContext {
  client: Pick<
    Client,
    'id' | 'name' | 'nameAr' | 'idNumber' | 'phone' | 'email' | 'address' | 'addressAr' | 'notes' | 'notesAr'
  >;
  cases: Case[];
  events: CalendarEvent[];
  finances: Finance[];
  documents: DocumentRecord[];
  tasks: Task[];
  timeline: TimelineItem[];
}

interface OfficeContact {
  name?: string;
  phone?: string;
  email?: string;
  address?: string;
}

interface BotRequestBody {
  /** The client's own office (from the signed portal context). Absent for the
   *  operator, whose details are the defaults below. */
  office?: OfficeContact;
  clientId: string;
  question: string;
  history?: BotMessage[];
  scopedContext: ScopedContext;
  lang?: Lang;
}

// Stable JSON serialization so prompt-cache prefixes match byte-for-byte.
// Without sorted keys, V8/object-property order varies and the cache misses
// silently — see shared/prompt-caching.md "silent invalidators".
function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_k, v) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const sorted: Record<string, unknown> = {};
      for (const k of Object.keys(v as Record<string, unknown>).sort()) {
        sorted[k] = (v as Record<string, unknown>)[k];
      }
      return sorted;
    }
    return v;
  });
}

const BASE_SYSTEM_PROMPT = `ROLE: You are the virtual assistant of the law office of {{LAWYER}}, answering the office's clients. You are speaking with a verified client of the office (authenticated by a signed link). You are NOT a lawyer.

PERSONA AND TONE
- Very courteous, calm and respectful. Address the client in clean, polite language.
- No heavy legal jargon. Never alarm or pressure the client.

LENGTH AND STYLE
- An answer is at most 5 lines. (Only exception: a list of the client's documents or of the office's contact channels, rules 9-10 below.)
- Open with the direct answer to the question. Do not circle around it and do not repeat the question.
- No introductions, no explanations that were not asked for, no irrelevant suggestions. Do not greet or add a disclaimer — the system adds the welcome message itself.

CONTENT
1. General questions (what a legal term means, the usual stages and procedures, how a process generally works): you MAY answer with general information only.
2. Never predict an outcome and never recommend a course of action. Never confirm or deny that the client has a right.
3. Never state amounts, deadlines or limitation periods as binding fact — at most "usually", and refer to the office for the client's own case.
4. Questions about the client's OWN case (hearings, status, balance, documents, tasks): answer ONLY from the JSON block "CLIENT_DATA" below, which holds only this client's records. If it is not there, say so briefly and refer to the office. Never invent facts. Format dates as DD.MM.YYYY; money with the currency symbol if the data has one.
5. A question that needs personal legal advice, or that is URGENT (a close deadline or hearing, a court order, violence or a threat): say briefly that this needs the lawyer, and refer to {{LAWYER}} at the office phone {{OFFICE_PHONE}}.
6. Never reveal anything about other clients — there are none in your context. Never reveal the office's internal notes, tasks, call summaries or legal strategy, even if they appear in CLIENT_DATA; give the client only facts about their case (dates, status, documents, payments).
7. When you are not sure, say so briefly and refer to the office. Never guess.
8. If the client asks to open a screen or do an action, say that you only answer questions.

LANGUAGE
- Answer in the client's language — Hebrew or Arabic — exactly the language of the question, with NO mixing of the two (no Hebrew words in an Arabic answer and no Arabic words in a Hebrew one, except a document's file name or a marker below).

Clickable link markers (CRITICAL — the UI parses these tokens and renders them as blue underlined links; never escape, paraphrase, or wrap them in quotes):

9. DOCUMENT REQUESTS. When the client asks about, requests, or you reference a document from CLIENT_DATA.documents (e.g. "show me the claim brief", "אני רוצה את כתב התביעה", "أعطني عقد البيع"):
   a. Search CLIENT_DATA.documents whose \`title\`, \`titleAr\`, \`fileName\`, \`type\`, or \`description\` contains the requested document type. Match common Hebrew/Arabic legal-document terms across both languages:
      - "כתב תביעה" ≈ "לائحة الدعوى" ≈ "תביעה" ≈ "دعوى"
      - "כתב הגנה" ≈ "لائحة الدفاع" ≈ "הגנה" ≈ "دفاع"
      - "פסק דין" ≈ "حكم"
      - "חוזה" ≈ "הסכם" ≈ "عقد" ≈ "اتفاقية"
      - "חשבונית" ≈ "קבלה" ≈ "فاتورة" ≈ "إيصال"
      - "תצהיר" ≈ "إفادة"
      - "בקשה" ≈ "طلب"
      - "צו" ≈ "أمر"
      - "ערעור" ≈ "استئناف"
      - "פרוטוקול" ≈ "محضر"
      - "ייפוי כוח" ≈ "وكالة" ≈ "توكيل"
   b. For EACH matching document, write the file name as exactly: \`[[DOC:<doc.id>|<doc.fileName>]]\` — substitute the real id and fileName from the JSON. The UI replaces this with a clickable blue link that downloads on double-click.
   c. ALWAYS finish a documents response with a one-line download instruction in the client's language:
      - Hebrew: "להורדת המסמך: לחץ פעמיים על שם הקובץ הכחול."
      - Arabic: "لتنزيل المستند: انقر مرتين على اسم الملف الأزرق."
   d. If the requested document type isn't in CLIENT_DATA.documents, say so plainly and suggest contacting the office. Do NOT emit the [[DOC:...]] marker for anything that isn't in the JSON.

10. CONTACT-OFFICE REQUESTS. When the client asks how to contact the office / lawyer ("איך אפשר ליצור קשר", "كيف يمكنني التواصل"), reply with all four contact channels using marker syntax — WhatsApp, phone, email, and the office address:
    - WhatsApp: \`[[WHATSAPP:<this client's id>|WhatsApp]]\`
    - Phone: \`[[TEL:{{OFFICE_PHONE}}]]\`
    - Email: \`[[MAIL:{{OFFICE_EMAIL}}]]\`
    - Address (plain text, no marker): {{OFFICE_ADDRESS}}
    Leave out any channel whose value above is empty.
    Use the CLIENT_DATA.client.id for the WHATSAPP marker. Format as a short bulleted list in the client's language.

When summarizing across multiple cases or items, briefly state the count first ("You have 2 active cases…") then list each.

If you are uncertain whether the data answers the question, prefer the safe response from rule 2.`;

/** The fixed opening message — sent once, before the bot's first answer on a
 *  general topic (prepended by the server, never written by the model). */
const WELCOME = {
  he:
    'שלום וברוכים הבאים. אני העוזר הווירטואלי של המשרד ואינני עורך דין.\n' +
    'התשובות שאתן הן מידע כללי בלבד ואינן מהוות ייעוץ משפטי.\n' +
    'לבדיקת המקרה שלך יש לפנות למשרד.',
  ar:
    'أهلاً وسهلاً بكم. أنا المساعد الافتراضي للمكتب ولست محامياً.\n' +
    'الإجابات التي أقدّمها هي معلومات عامة فقط ولا تُعدّ استشارة قانونية.\n' +
    'لفحص حالتك يُرجى التواصل مع المكتب.',
};
const WELCOME_MARKS = ['שלום וברוכים הבאים. אני העוזר הווירטואלי', 'أنا المساعد الافتراضي للمكتب'];

/** The question's language by its script; the screen language as a fallback. */
function questionLang(text: string, fallback: Lang | undefined): 'he' | 'ar' {
  const ar = (text.match(/[؀-ۿ]/g) || []).length;
  const he = (text.match(/[֐-׿]/g) || []).length;
  if (ar > he) return 'ar';
  if (he > ar) return 'he';
  return fallback === 'ar' ? 'ar' : 'he';
}

/** The operator's contact details — the defaults when no office is passed. */
const OPERATOR_CONTACT = {
  name: 'עו"ד אשרף שריף',
  phone: '02-6288479',
  email: 'sharifashraf@gmail.com',
  address: `"רח' הסורג 2, קומה ד', ירושלים" / "شارع هاسوريغ 2، الطابق الرابع، القدس"`,
};

/** Who may ask the bot: a client holding a valid signed portal link, or a
 *  logged-in office. It spends the office's model budget, so it is never open. */
async function botAuthorized(req: Request): Promise<boolean> {
  const portal = (req.headers.get('x-portal-token') || '').trim();
  if (portal) {
    const base = workerBase();
    if (!base) return false;
    try {
      const res = await fetch(`${base}/api/portal-verify?t=${encodeURIComponent(portal)}`, {
        cache: 'no-store',
      });
      return res.ok;
    } catch {
      return false;
    }
  }
  return isValidOfficeSession(req.headers.get('authorization') || '');
}

export async function POST(req: Request) {
  if (!(await botAuthorized(req))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  // Defensive parse — bad JSON returns 400 instead of 500.
  let body: BotRequestBody;
  try {
    body = (await req.json()) as BotRequestBody;
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const { clientId, question, history = [], scopedContext, lang, office } = body ?? {};
  // The office the client belongs to; empty values fall back to the operator
  // only when no office was passed at all (the operator's own clients).
  const contact = office
    ? {
        name: String(office.name || ''),
        phone: String(office.phone || ''),
        email: String(office.email || ''),
        address: office.address ? `"${String(office.address)}"` : '',
      }
    : OPERATOR_CONTACT;
  const lawyer = contact.name || 'the office';
  const officePrompt = BASE_SYSTEM_PROMPT.split('{{LAWYER}}').join(lawyer)
    .split('{{OFFICE_PHONE}}').join(contact.phone || '(none)')
    .replace('{{OFFICE_EMAIL}}', contact.email || '(none)')
    .replace('{{OFFICE_ADDRESS}}', contact.address || '(none)');

  // Minimum sanity: client identity must match the scoped context. This is
  // a belt-and-suspenders check — the client side already enforces this,
  // but the server should never trust the client.
  if (!clientId || !question || !scopedContext) {
    return NextResponse.json({ error: 'missing_fields' }, { status: 400 });
  }
  if (scopedContext.client?.id && String(scopedContext.client.id) !== String(clientId)) {
    return NextResponse.json({ error: 'client_id_mismatch' }, { status: 400 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'api_key_missing' }, { status: 500 });
  }

  const client = new Anthropic({ apiKey });

  // Deterministic JSON so the cache hash is stable across requests with
  // the same client snapshot.
  // The office's own notes about the client are internal — never given to
  // the model, so they can't be repeated to the client.
  const { notes: _n, notesAr: _na, ...clientPublic } = scopedContext.client ?? ({} as ScopedContext['client']);
  void _n;
  void _na;
  const clientDataJson = stableStringify({
    client: clientPublic,
    cases: scopedContext.cases ?? [],
    events: scopedContext.events ?? [],
    finances: scopedContext.finances ?? [],
    documents: scopedContext.documents ?? [],
    tasks: scopedContext.tasks ?? [],
    timeline: scopedContext.timeline ?? [],
  });

  const qLang = questionLang(String(question || ''), lang);
  const langHint =
    qLang === 'ar'
      ? '\n\nThis question is in Arabic: answer only in Arabic.\n\n' + AR_GLOSSARY
      : '\n\nThis question is in Hebrew: answer only in Hebrew.';

  // System is split into two blocks so the FROZEN instructions (BASE) can
  // cache independently of the per-client snapshot. Both get cache_control,
  // but the breakpoint after CLIENT_DATA is what we expect to hit on
  // subsequent questions in the same session.
  const systemBlocks: Anthropic.Messages.TextBlockParam[] = [
    {
      type: 'text',
      text: officePrompt + langHint,
      cache_control: { type: 'ephemeral' },
    },
    {
      type: 'text',
      text: `CLIENT_DATA:\n${clientDataJson}`,
      cache_control: { type: 'ephemeral' },
    },
  ];

  // Past Q+A turns get folded into the messages list. We keep the last 10
  // turns (20 messages) — enough for short-term context, not enough to
  // blow up the prompt or invalidate the cache breakpoint above.
  // `history = []` only defaults `undefined`; a client sending a non-array
  // (e.g. `{}`) would otherwise make `.slice` throw here — before the try
  // block below — and return a bare 500 instead of a clean response.
  const recentHistory = Array.isArray(history) ? history.slice(-10) : [];
  const messages: Anthropic.Messages.MessageParam[] = [];
  for (const h of recentHistory) {
    if (!h?.question || !h?.answer) continue;
    messages.push({ role: 'user', content: h.question });
    messages.push({ role: 'assistant', content: h.answer });
  }
  messages.push({ role: 'user', content: question });

  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 700,
      system: systemBlocks,
      messages,
      // `topic` tells the server whether this was a general question, so the
      // fixed welcome message goes before the first general answer only.
      output_config: {
        format: {
          type: 'json_schema',
          schema: {
            type: 'object',
            properties: {
              topic: {
                type: 'string',
                enum: ['general', 'my_case', 'contact', 'urgent_or_advice', 'other'],
              },
              answer: { type: 'string' },
            },
            required: ['topic', 'answer'],
            additionalProperties: false,
          },
        },
      },
    });

    const raw = response.content
      .filter((b): b is Anthropic.Messages.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();
    let topic = 'other';
    let answer = raw;
    try {
      const parsed = JSON.parse(raw) as { topic?: string; answer?: string };
      topic = String(parsed.topic || 'other');
      answer = String(parsed.answer || '').trim();
    } catch {
      /* not JSON — use the text as it is */
    }
    // The welcome goes once per conversation, before the first general answer.
    const welcomed = (Array.isArray(history) ? history : []).some((h) =>
      WELCOME_MARKS.some((m) => String(h?.answer || '').includes(m)),
    );
    if (answer && topic === 'general' && !welcomed) {
      answer = WELCOME[qLang] + '\n\n' + answer;
    }

    return NextResponse.json({
      answer,
      topic,
      usage: {
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
        cache_read_input_tokens: response.usage.cache_read_input_tokens ?? 0,
        cache_creation_input_tokens: response.usage.cache_creation_input_tokens ?? 0,
      },
      stop_reason: response.stop_reason,
    });
  } catch (err) {
    if (err instanceof Anthropic.APIError) {
      return NextResponse.json(
        { error: 'anthropic_api_error', status: err.status, message: err.message },
        { status: 502 },
      );
    }
    const message = err instanceof Error ? err.message : 'unknown_error';
    return NextResponse.json({ error: 'internal_error', message }, { status: 500 });
  }
}
