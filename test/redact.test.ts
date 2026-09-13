import { describe, expect, it } from 'vitest';
import { redactBody, redactHeaders } from '../src/core/redact';

describe('redactHeaders', () => {
  it('redacts Authorization and cookie headers (case-insensitive keys)', () => {
    const out = redactHeaders({
      Authorization: 'Bearer vk_app_sk_xxx',
      'content-type': 'application/json',
      Cookie: 'session=abc',
      'Idempotency-Key': 'idem-1234',
    });
    expect(out['Authorization']).toBe('[REDACTED]');
    expect(out['Cookie']).toBe('[REDACTED]');
    expect(out['Idempotency-Key']).toBe('[REDACTED]');
    expect(out['content-type']).toBe('application/json');
  });

  it('passes through non-secret headers unchanged', () => {
    const out = redactHeaders({ 'x-request-id': 'abc', accept: '*/*' });
    expect(out).toEqual({ 'x-request-id': 'abc', accept: '*/*' });
  });
});

describe('redactBody', () => {
  it('redacts known secret keys at any depth', () => {
    const body = {
      user: 'alice',
      credentials: { GITHUB_TOKEN: 'ghp_xxx' },
      nested: { config: { api_key: 'sk-xxx', safe: 'ok' } },
    };
    const out = redactBody(body) as Record<string, unknown>;
    expect(out['credentials']).toBe('[REDACTED]');
    expect((out['nested'] as Record<string, unknown>)['config']).toEqual({
      api_key: '[REDACTED]',
      safe: 'ok',
    });
    expect(out['user']).toBe('alice');
  });

  it('handles arrays, primitives, and null', () => {
    expect(redactBody(null)).toBe(null);
    expect(redactBody(42)).toBe(42);
    expect(redactBody('hello')).toBe('hello');
    expect(redactBody([1, { token: 'x' }])).toEqual([1, { token: '[REDACTED]' }]);
  });

  it('detects circular references', () => {
    const obj: Record<string, unknown> = { name: 'a' };
    obj['self'] = obj;
    const out = redactBody(obj) as Record<string, unknown>;
    expect(out['self']).toBe('[CIRCULAR]');
  });

  it('clones shared (non-cyclic) references instead of flagging them as circular', () => {
    const shared = { safe: 'ok' };
    const body = { a: shared, b: shared };
    const out = redactBody(body) as Record<string, unknown>;
    expect(out['a']).toEqual({ safe: 'ok' });
    expect(out['b']).toEqual({ safe: 'ok' });
  });

  it('truncates at max depth', () => {
    let deep: Record<string, unknown> = { leaf: true };
    for (let i = 0; i < 10; i++) deep = { child: deep };
    const out = redactBody(deep) as Record<string, unknown>;
    // Should eventually hit [TRUNCATED]
    let cursor: unknown = out;
    let found = false;
    for (let i = 0; i < 12; i++) {
      if (cursor === '[TRUNCATED]') {
        found = true;
        break;
      }
      if (typeof cursor === 'object' && cursor !== null) {
        cursor = (cursor as Record<string, unknown>)['child'] ?? (cursor as Record<string, unknown>)['leaf'];
      } else break;
    }
    expect(found).toBe(true);
  });
});
