/**
 * Retry policy and backoff math.
 *
 * Retries apply only to idempotent requests and only for transient statuses
 * (429, 502, 503, 504) or network errors. Backoff uses full jitter to avoid
 * thundering-herd retries; a `Retry-After` header, when present, wins.
 */

export interface RetryPolicy {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export const DEFAULT_RETRY: RetryPolicy = {
  maxRetries: 2,
  baseDelayMs: 250,
  maxDelayMs: 4000,
};

/** Whether an HTTP status is worth retrying. */
export function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 502 || status === 503 || status === 504;
}

/**
 * Compute the delay before the next attempt (0-indexed).
 * A positive `retryAfterMs` (server hint) wins, capped at `maxDelayMs`.
 * `Retry-After: 0` is treated as NO hint: honoring it exactly would make
 * simultaneous clients hammer the server in lockstep — full jitter instead.
 * Without a hint, full jitter over an exponentially growing window.
 */
export function backoffDelay(attempt: number, policy: RetryPolicy, retryAfterMs?: number): number {
  if (retryAfterMs !== undefined && retryAfterMs > 0) {
    return Math.min(retryAfterMs, policy.maxDelayMs);
  }
  const window = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** attempt);
  return Math.round(Math.random() * window);
}

/** Parse a `Retry-After` header (delta-seconds or HTTP-date) into milliseconds. */
export function parseRetryAfter(headerValue: string | null): number | undefined {
  if (!headerValue) return undefined;
  const seconds = Number(headerValue);
  if (!Number.isNaN(seconds)) return Math.max(0, seconds * 1000);
  const asDate = Date.parse(headerValue);
  if (!Number.isNaN(asDate)) return Math.max(0, asDate - Date.now());
  return undefined;
}

/** Promise-based sleep that rejects if the (optional) signal aborts. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortReason(signal));
      return;
    }
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = (): void => {
      cleanup();
      reject(abortReason(signal));
    };
    const cleanup = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function abortReason(signal?: AbortSignal): unknown {
  return signal?.reason ?? new Error('Aborted');
}
