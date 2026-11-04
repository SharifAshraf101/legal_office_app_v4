// Hard limits for sending a PDF to Claude as a base64 `document` block, and the
// guards that keep an oversized archive file from taking a route (or the Worker)
// down with it.
//
// WHY THIS FILE EXISTS. Both PDF routes used to cap the RAW file at 28 MB and
// then base64-encode it. Base64 inflates by 4/3, so a 28 MB PDF became a
// ~37.3 MB request body — past Anthropic's 32 MB per-request ceiling. Every file
// between ~24 MB and 28 MB therefore passed our own check and then failed at the
// model with an opaque 400, which is what the make.com pipeline surfaced as a
// crashed module. The cap has to be expressed in POST-ENCODING bytes.

/** Anthropic's maximum total request size for the Messages API. */
export const ANTHROPIC_MAX_REQUEST_BYTES = 32 * 1024 * 1024;

/**
 * Largest RAW PDF we will encode and forward.
 *
 * 23 MB raw -> ~30.7 MB of base64, leaving ~1.3 MB of headroom inside the 32 MB
 * ceiling for the system prompt, the JSON envelope, and the per-request
 * overhead. Do not raise this without re-doing that arithmetic.
 */
export const PDF_MAX_BYTES = 23 * 1024 * 1024;

/**
 * Page ceiling for a base64 PDF block. Anthropic allows 600 pages on a
 * 1M-context model but only 100 on a 200K-context one — which includes
 * `claude-haiku-4-5`, the model the classifier and summary paths use. We cannot
 * count pages without parsing the PDF, so this is documentation for the error
 * message rather than an enforced guard: a 150-page scanned filing fails at the
 * model no matter how few bytes it occupies.
 */
export const PDF_MAX_PAGES_200K_MODEL = 100;
export const PDF_MAX_PAGES_1M_MODEL = 600;

/** Exact length of the base64 encoding of `byteLength` bytes. */
export function base64Length(byteLength: number): number {
  return 4 * Math.ceil(byteLength / 3);
}

/** Human-readable MB, one decimal place. */
export function asMb(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1);
}

export interface PdfSizeRejection {
  error: 'file_too_large';
  /** Raw size we were handed. */
  bytes: number;
  /** What it would have become on the wire. */
  encodedBytes: number;
  limitBytes: number;
  detail: string;
}

/**
 * Check a raw PDF against the encoded-size ceiling. Returns null when it fits,
 * or a payload describing the rejection — phrased so the make.com module that
 * receives it says something actionable instead of "502".
 */
export function checkPdfSize(byteLength: number): PdfSizeRejection | null {
  if (byteLength <= PDF_MAX_BYTES) return null;
  const encodedBytes = base64Length(byteLength);
  return {
    error: 'file_too_large',
    bytes: byteLength,
    encodedBytes,
    limitBytes: PDF_MAX_BYTES,
    detail:
      `PDF is ${asMb(byteLength)} MB, which base64-encodes to ` +
      `${asMb(encodedBytes)} MB and exceeds Anthropic's ` +
      `${asMb(ANTHROPIC_MAX_REQUEST_BYTES)} MB request limit. ` +
      `Maximum supported PDF is ${asMb(PDF_MAX_BYTES)} MB — ` +
      `split or downsample the file before archiving it.`,
  };
}

/**
 * Timeout for pulling the source PDF (a short-lived Dropbox link). Without an
 * explicit signal a stalled download hangs until the platform kills the whole
 * function, which reads downstream as "Claude is stuck" even though no model
 * call was ever made.
 */
export const PDF_FETCH_TIMEOUT_MS = 45_000;
