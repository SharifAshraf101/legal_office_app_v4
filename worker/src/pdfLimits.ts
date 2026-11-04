// PDF size guards and Anthropic retry policy for the Worker's two PDF
// endpoints (POST /api/draft, POST /api/draft-decision).
//
// Mirrors lib/pdfLimits.ts on the app side (the Worker has its own tsconfig and
// cannot import from the app's lib/ — same arrangement as arabicGlossary.ts).
//
// WHY THIS FILE EXISTS. A Worker isolate has a HARD 128 MB memory ceiling, and
// these endpoints receive the PDF as base64 inside a JSON body. For a 28 MB PDF
// (~37 MB of base64) the old code held, at once: the raw request body, the
// parsed JS string, a `.trim()` copy of it, and the `JSON.stringify` of the
// outbound Anthropic request — four ~37 MB copies, ~150 MB, over the limit. The
// isolate was killed mid-request, which the make.com pipeline saw as a bare 502
// with no body: the "module crashed and stopped working" symptom.
//
// The fix is to reject oversized bodies from the Content-Length header BEFORE
// parsing (no copy is ever made) and to stop making the copies we don't need.

/** Anthropic's maximum total request size for the Messages API. */
export const ANTHROPIC_MAX_REQUEST_BYTES = 32 * 1024 * 1024;

/**
 * Largest JSON body we will accept on a PDF endpoint. The base64 of a 23 MB PDF
 * is ~30.7 MB; the rest is the envelope and the id/name fields. Anything beyond
 * this cannot be forwarded to Anthropic anyway, so refusing it early is both
 * correct and what keeps the isolate alive.
 */
export const MAX_PDF_REQUEST_BODY_BYTES = 34 * 1024 * 1024;

/**
 * Page ceiling for a base64 PDF block: 600 pages on a 1M-context model, but
 * only 100 on a 200K-context one — which includes `claude-haiku-4-5`, used by
 * /api/draft-decision. A long scanned filing fails at the model regardless of
 * byte size; we surface Anthropic's own error rather than guess page counts.
 */
export const PDF_MAX_PAGES_200K_MODEL = 100;
export const PDF_MAX_PAGES_1M_MODEL = 600;

export function asMb(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1);
}

/**
 * Reject an oversized PDF request from its Content-Length, BEFORE the body is
 * read. Returns a reason string when the request must be refused, else null.
 *
 * A missing/unparseable Content-Length returns null (we let it through) —
 * chunked uploads have none, and the per-field guard below still applies.
 */
export function oversizedPdfBody(request: Request): string | null {
  const raw = request.headers.get('content-length');
  if (!raw) return null;
  const len = Number(raw);
  if (!Number.isFinite(len) || len <= 0) return null;
  if (len <= MAX_PDF_REQUEST_BODY_BYTES) return null;
  return (
    `Request body is ${asMb(len)} MB, over the ${asMb(MAX_PDF_REQUEST_BODY_BYTES)} MB ` +
    `limit for a PDF endpoint. A PDF base64-expands by 4/3, and Anthropic caps a ` +
    `request at ${asMb(ANTHROPIC_MAX_REQUEST_BYTES)} MB — split or downsample the ` +
    `file before archiving it.`
  );
}

/**
 * Second-line guard on the decoded field, for requests that arrived without a
 * Content-Length. Returns a reason string when the base64 is too long, else
 * null. Takes the LENGTH so the caller needn't copy the string.
 */
export function oversizedPdfField(base64Length: number): string | null {
  if (base64Length <= MAX_PDF_REQUEST_BODY_BYTES) return null;
  return (
    `Encoded PDF is ${asMb(base64Length)} MB, over Anthropic's ` +
    `${asMb(ANTHROPIC_MAX_REQUEST_BYTES)} MB request limit.`
  );
}

/** Anthropic statuses that are worth retrying: rate limit, overload, 5xx. */
function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 529 || status >= 500;
}

export interface AnthropicCallResult {
  response: Response | null;
  /** Set when every attempt failed to produce a response at all. */
  networkError?: string;
  attempts: number;
}

/**
 * POST to the Anthropic Messages API with bounded retries and exponential
 * backoff, honouring `retry-after` when present.
 *
 * The raw `fetch` these handlers used had NO retry (unlike the SDK, which
 * retries twice by default), so a single transient 429/529 propagated as a hard
 * failure and permanently stopped the make.com module that was driving it.
 *
 * `body` is passed already-serialized so the caller controls when the large
 * string is built, and we never copy it per attempt.
 */
export async function callAnthropicWithRetry(
  apiKey: string,
  body: string,
  opts: { maxAttempts?: number; timeoutMs?: number } = {},
): Promise<AnthropicCallResult> {
  const maxAttempts = opts.maxAttempts ?? 3;
  // Generous per-attempt ceiling: a large PDF through a reasoning model can
  // legitimately take minutes. Still bounded, so a hung connection can't pin
  // the isolate open indefinitely.
  const timeoutMs = opts.timeoutMs ?? 120_000;
  let lastNetworkError = '';

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!isRetryableStatus(response.status) || attempt === maxAttempts) {
        return { response, attempts: attempt };
      }
      // Prefer the server's own pacing hint when it gives one.
      const retryAfter = Number(response.headers.get('retry-after'));
      const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
        ? Math.min(retryAfter * 1000, 15_000)
        : Math.min(1000 * 2 ** (attempt - 1), 8000);
      console.warn(
        `[worker] anthropic ${response.status} on attempt ${attempt}/${maxAttempts}; ` +
          `retrying in ${waitMs}ms`,
      );
      await new Promise((r) => setTimeout(r, waitMs));
    } catch (e) {
      lastNetworkError = e instanceof Error ? e.message : String(e);
      if (attempt === maxAttempts) break;
      const waitMs = Math.min(1000 * 2 ** (attempt - 1), 8000);
      console.warn(
        `[worker] anthropic fetch failed on attempt ${attempt}/${maxAttempts} ` +
          `(${lastNetworkError}); retrying in ${waitMs}ms`,
      );
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  return {
    response: null,
    networkError: lastNetworkError || 'unknown',
    attempts: maxAttempts,
  };
}
