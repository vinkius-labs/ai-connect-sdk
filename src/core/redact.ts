/**
 * Secret redaction for observability hooks.
 *
 * The SDK never logs by default, but any data handed to a user-provided hook is
 * scrubbed first so that credentials, tokens, and Authorization headers can
 * never leak through logging.
 */

const REDACTED = '[REDACTED]';
const MAX_DEPTH = 6;

/** Header names whose values must never be surfaced. */
const SECRET_HEADERS = new Set(['authorization', 'idempotency-key', 'cookie', 'set-cookie']);

/** Object keys (case-insensitive) whose values must never be surfaced. */
const SECRET_KEYS = new Set([
  'authorization',
  'apikey',
  'api_key',
  'token',
  'access_token',
  'refresh_token',
  'mcp_url',
  'credentials',
  'password',
  'secret',
  'client_secret',
]);

/** Return a copy of headers with secret values redacted. */
export function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    out[key] = SECRET_HEADERS.has(key.toLowerCase()) ? REDACTED : value;
  }
  return out;
}

/**
 * Mask any `vk_live_*` path segment in a URL. The data-plane runtime endpoint
 * embeds its bearer token in the path (`{RUNTIME}/{vk_live_*}/mcp`), so the raw
 * URL must never reach an observability hook.
 */
export function redactUrl(url: string): string {
  return url.replace(/vk_live_[A-Za-z0-9_-]+/g, REDACTED);
}

/**
 * Deep-clone a value, redacting any property whose key looks like a secret.
 * Depth-limited and cycle-safe.
 */
export function redactBody(value: unknown): unknown {
  return clone(value, 0, new WeakSet<object>());
}

function clone(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (depth >= MAX_DEPTH) return '[TRUNCATED]';
  if (seen.has(value as object)) return '[CIRCULAR]';
  seen.add(value as object);

  let out: unknown;
  try {
    if (Array.isArray(value)) {
      out = value.map((item) => clone(item, depth + 1, seen));
    } else {
      const record: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
        record[key] = SECRET_KEYS.has(key.toLowerCase()) ? REDACTED : clone(val, depth + 1, seen);
      }
      out = record;
    }
  } finally {
    // Backtrack: only the ACTIVE recursion path counts as a cycle. Shared
    // (diamond) references that appear twice but do not loop must clone again
    // instead of being flagged [CIRCULAR].
    seen.delete(value as object);
  }
  return out;
}
