import { describe, expect, it } from 'vitest';
import { deriveStatus, summarize } from '../src/fluent/status';
import type { Connection } from '../src/types';

function makeConnection(overrides: Partial<Connection> = {}): Connection {
  return {
    id: 'conn_1',
    slug: 'github',
    name: 'github',
    description: null,
    status: 'active',
    ready: true,
    created_at: '2026-01-01T00:00:00+00:00',
    ...overrides,
  };
}

describe('deriveStatus', () => {
  it('returns "ready" when active and ready', () => {
    expect(deriveStatus(makeConnection())).toBe('ready');
  });

  it('returns "needs_credentials" when active but not ready', () => {
    expect(deriveStatus(makeConnection({ ready: false }))).toBe('needs_credentials');
  });

  it('returns "disabled" when status is not active', () => {
    expect(deriveStatus(makeConnection({ status: 'suspended' }))).toBe('disabled');
    expect(deriveStatus(makeConnection({ status: 'inactive' }))).toBe('disabled');
  });
});

describe('summarize', () => {
  it('returns a summary with slug, status, and connectionId', () => {
    const conn = makeConnection();
    const s = summarize(conn);
    expect(s).toEqual({ slug: 'github', status: 'ready', connectionId: 'conn_1' });
  });

  it('falls back to name when slug is null', () => {
    const conn = makeConnection({ slug: null, name: 'my-server' });
    expect(summarize(conn).slug).toBe('my-server');
  });
});
