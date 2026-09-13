import { describe, expect, it } from 'vitest';
import { normalizePaginated, unwrapItem, unwrapList } from '../src/core/pagination';

describe('normalizePaginated', () => {
  it('normalizes a full Laravel paginated response', () => {
    const body = {
      data: [{ id: '1' }, { id: '2' }],
      meta: { current_page: 1, from: 1, last_page: 3, path: '/foo', per_page: 2, to: 2, total: 6 },
      links: { first: '/foo?page=1', last: '/foo?page=3', prev: null, next: '/foo?page=2' },
    };
    const result = normalizePaginated(body);
    expect(result.data).toHaveLength(2);
    expect(result.meta?.total).toBe(6);
    expect(result.links?.next).toBe('/foo?page=2');
  });

  it('normalizes a bare { data: [...] } response (no meta/links)', () => {
    const body = { data: [{ id: 'a' }] };
    const result = normalizePaginated(body);
    expect(result.data).toEqual([{ id: 'a' }]);
    expect(result.meta).toBeUndefined();
    expect(result.links).toBeUndefined();
  });

  it('rejects a malformed paginated response', () => {
    expect(() => normalizePaginated(null)).toThrow('Expected a list response');
    expect(() => normalizePaginated(undefined)).toThrow('Expected a list response');
  });
});

describe('unwrapList', () => {
  it('unwraps a { data: [...] } envelope', () => {
    expect(unwrapList({ data: [1, 2, 3] })).toEqual([1, 2, 3]);
  });

  it('passes through a bare array', () => {
    expect(unwrapList([4, 5])).toEqual([4, 5]);
  });

  it('rejects null or undefined instead of treating a malformed response as empty', () => {
    expect(() => unwrapList(null)).toThrow('Expected a list response');
    expect(() => unwrapList(undefined)).toThrow('Expected a list response');
  });
});

describe('unwrapItem', () => {
  it('unwraps { data: {...} } into the item', () => {
    expect(unwrapItem({ data: { id: 'x', name: 'foo' } })).toEqual({ id: 'x', name: 'foo' });
  });

  it('returns the body itself if no data wrapper', () => {
    const bare = { id: 'x', name: 'foo' };
    expect(unwrapItem(bare)).toEqual(bare);
  });
});
