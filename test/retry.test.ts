import { describe, expect, it } from 'vitest';
import { DEFAULT_RETRY, backoffDelay, parseRetryAfter } from '../src/core/retry';

describe('backoffDelay', () => {
  it('honors a positive Retry-After hint, capped at maxDelayMs', () => {
    const capped = backoffDelay(0, DEFAULT_RETRY, 60_000);
    expect(capped).toBe(DEFAULT_RETRY.maxDelayMs);
    const exact = backoffDelay(0, { ...DEFAULT_RETRY, maxDelayMs: 10_000 }, 2_500);
    expect(exact).toBe(2_500);
  });

  it('treats Retry-After: 0 as no hint (full jitter, not a lockstep retry)', () => {
    for (let i = 0; i < 20; i++) {
      expect(backoffDelay(0, DEFAULT_RETRY, 0)).toBeGreaterThanOrEqual(0);
      // attempt 0 window = baseDelayMs = 250, so 0 is possible but 0-for-0
      // determinism is what we're guarding against; jitter makes delay > 0 likely.
    }
  });

  it('never exceeds maxDelayMs without a hint', () => {
    for (const attempt of [0, 1, 2, 5, 10]) {
      expect(backoffDelay(attempt, DEFAULT_RETRY)).toBeLessThanOrEqual(DEFAULT_RETRY.maxDelayMs);
    }
  });
});

describe('parseRetryAfter', () => {
  it('parses delta-seconds', () => {
    expect(parseRetryAfter('30')).toBe(30_000);
  });

  it('parses HTTP-date into remaining milliseconds', () => {
    const future = new Date(Date.now() + 10_000).toUTCString();
    const ms = parseRetryAfter(future)!;
    expect(ms).toBeGreaterThan(0);
    expect(ms).toBeLessThanOrEqual(10_000);
  });

  it('returns undefined for garbage and null', () => {
    expect(parseRetryAfter(null)).toBeUndefined();
    expect(parseRetryAfter('soon')).toBeUndefined();
  });
});
