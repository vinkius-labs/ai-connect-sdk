import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ResolverCache } from '../src/core/cache';

describe('ResolverCache', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('stores and retrieves a value', () => {
    const cache = new ResolverCache(10_000);
    cache.set('key1', 'value1');
    expect(cache.get('key1')).toBe('value1');
  });

  it('returns undefined for a missing key', () => {
    const cache = new ResolverCache();
    expect(cache.get('nope')).toBeUndefined();
  });

  it('expires entries after TTL', () => {
    const cache = new ResolverCache(100);
    cache.set('key', 'val');
    expect(cache.get('key')).toBe('val');
    vi.advanceTimersByTime(101);
    expect(cache.get('key')).toBeUndefined();
  });

  it('deletes a specific key', () => {
    const cache = new ResolverCache();
    cache.set('a', 1);
    cache.set('b', 2);
    cache.delete('a');
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBe(2);
  });

  it('clears all entries', () => {
    const cache = new ResolverCache();
    cache.set('a', 1);
    cache.set('b', 2);
    cache.clear();
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBeUndefined();
  });

  it('resolve() returns cached value without recomputing', async () => {
    const cache = new ResolverCache(10_000);
    const compute = vi.fn().mockResolvedValue('computed');
    const v1 = await cache.resolve('k', compute);
    const v2 = await cache.resolve('k', compute);
    expect(v1).toBe('computed');
    expect(v2).toBe('computed');
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it('resolve() recomputes after TTL expiry', async () => {
    const cache = new ResolverCache(100);
    let call = 0;
    const compute = vi.fn().mockImplementation(async () => `v${++call}`);
    expect(await cache.resolve('k', compute)).toBe('v1');
    vi.advanceTimersByTime(101);
    expect(await cache.resolve('k', compute)).toBe('v2');
    expect(compute).toHaveBeenCalledTimes(2);
  });
});
