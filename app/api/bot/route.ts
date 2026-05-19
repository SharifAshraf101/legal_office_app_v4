import Anthropic from '@anthropic-ai/sdk';
import { NextResponse } from 'next/server';
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

interface BotRequestBody {
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

const BASE_SYSTEM_PROMPT = `You are the customer-service bot for "Legal Office" — a small law-firm practice management system. You are speaking directly with a verified client who has authenticated with their national ID number and phone.

Hard rules (non-negotiable):

1. Answer ONLY based on the JSON data block titled "CLIENT_DATA" that follows this prompt. That data is scoped to this single client — their cases, events (hearings/meetings), finances (fees + payments), documents, tasks, and timeline.
2. NEVER invent facts. If the requested information is not present in CLIENT_DATA, say so explicitly ("I don't have that information in your file. Please contact the office.") and stop. Do not guess, infer beyond what is written, or pad with generic legal advice.
3. NEVER reveal, reference, or compare against any other client. There are no other clients in your context — pretend they don't exist.
4. NEVER provide legal advice. If asked, redirect: "For legal advice, please speak directly with the lawyer."
5. Respond in the SAME language as the question. Hebrew → Hebrew. Arabic → Arabic. Match RTL formatting.
6. Be concise. Lawyers' clients want specific facts (next hearing date, balance owed, status of case), not paragraphs. Use short sentences, occasional bullet points for lists.
7. Format dates as DD.MM.YYYY. Format money with the currency symbol if present in the data, otherwise plain numbers.
8. If the client asks about a tab/screen/feature (e.g. "open my case"), tell them the lawyer's app does that — you only answer questions, you do not navigate.

When summarizing across multiple cases or items, briefly state the count first ("You have 2 active cases…") then list each.

If you are uncertain whether the data answers the question, prefer the safe response from rule 2.`;

export async function POST(req: Request) {
  // Defensive parse — bad JSON returns 400 instead of 500.
  let body: BotRequestBody;
  try {
    body = (await req.json()) as BotRequestBody;
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const { clientId, question, history = [], scopedContext, lang } = body ?? {};

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
  const clientDataJson = stableStringify({
    client: scopedContext.client,
    cases: scopedContext.cases ?? [],
    events: scopedContext.events ?? [],
    finances: scopedContext.finances ?? [],
    documents: scopedContext.documents ?? [],
    tasks: scopedContext.tasks ?? [],
    timeline: scopedContext.timeline ?? [],
  });

  const langHint =
    lang === 'ar'
      ? '\n\nThe client speaks Arabic. Default to Arabic responses unless they explicitly write in another language.'
      : '\n\nThe client speaks Hebrew. Default to Hebrew responses unless they explicitly write in another language.';

  // System is split into two blocks so the FROZEN instructions (BASE) can
  // cache independently of the per-client snapshot. Both get cache_control,
  // but the breakpoint after CLIENT_DATA is what we expect to hit on
  // subsequent questions in the same session.
  const systemBlocks: Anthropic.Messages.TextBlockParam[] = [
    {
      type: 'text',
      text: BASE_SYSTEM_PROMPT + langHint,
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
  const recentHistory = history.slice(-10);
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
      max_tokens: 1024,
      system: systemBlocks,
      messages,
    });

    const answer = response.content
      .filter((b): b is Anthropic.Messages.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();

    return NextResponse.json({
      answer,
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
