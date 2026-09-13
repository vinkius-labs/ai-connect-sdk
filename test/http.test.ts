import { describe, expect, it } from 'vitest';
import { ConfigError, ConnectionError, NotFoundError, Vinkius } from '../src';
import { runOpenAIToolCall } from '../src/adapters/openai';
import { makeVinkius, type Route } from './helpers/mock-fetch';

describe('config validation', () => {
  it('rejects a non-public appId', () => {
    expect(() => new Vinkius({ appId: 'vk_app_sk_x', apiKey: 'vk_app_sk_x' })).toThrow(ConfigError);
  });
  it('rejects a non-secret apiKey', () => {
    expect(() => new Vinkius({ appId: 'vk_app_x', apiKey: 'nope' })).toThrow(ConfigError);
  });
  it('rejects a Vinkius internal user id passed as externalId', () => {
    const v = new Vinkius({ appId: 'vk_app_x', apiKey: 'vk_app_sk_x', fetch: (() => {}) as never });
    expect(() => v.user('vk_app_user_abc123')).toThrow(ConfigError);
  });
});

describe('HttpClient behavior', () => {
  it('retries idempotent requests on 503, then succeeds', async () => {
    let attempts = 0;
    const route: Route = {
      method: 'GET',
      path: /^\/apps\/vk_app_test\/users\/someuser$/,
      respond: () => {
        attempts += 1;
        return attempts < 2 ? { status: 503, body: { message: 'unavailable' } } : { body: { data: { id: 'x' } } };
      },
    };
    const { vinkius } = makeVinkius([route], { maxRetries: 2 });
    await expect(vinkius.users.get('someuser')).resolves.toMatchObject({ id: 'x' });
    expect(attempts).toBe(2);
  });

  it('times out slow requests as a ConnectionError', async () => {
    const route: Route = {
      method: 'GET',
      path: /^\/apps\/vk_app_test\/users\/someuser$/,
      respond: () => ({ delayMs: 200, body: { data: { id: 'x' } } }),
    };
    const { vinkius } = makeVinkius([route], { timeoutMs: 20, maxRetries: 0 });
    await expect(vinkius.users.get('someuser')).rejects.toMatchObject({ code: 'connection_error' });
  });

  it('redacts the Authorization header before it reaches hooks', async () => {
    const seen: Array<Record<string, string>> = [];
    const route: Route = {
      method: 'GET',
      path: /^\/apps\/vk_app_test\/users\/someuser$/,
      respond: () => ({ body: { data: { id: 'x' } } }),
    };
    const { vinkius } = makeVinkius([route], {
      hooks: { onRequest: (info) => seen.push(info.headers) },
    });
    await vinkius.users.get('someuser');
    expect(seen[0]?.['authorization']).toBe('[REDACTED]');
  });

  it('reports the 0-based attempt to hooks when a request is retried', async () => {
    const attempts: number[] = [];
    let count = 0;
    const route: Route = {
      method: 'GET',
      path: /^\/apps\/vk_app_test\/users\/someuser$/,
      respond: () => {
        count += 1;
        return count < 2 ? { status: 503, body: {} } : { body: { data: { id: 'x' } } };
      },
    };
    const { vinkius } = makeVinkius([route], {
      maxRetries: 2,
      hooks: { onResponse: (info) => attempts.push(info.attempt ?? -1) },
    });
    await vinkius.users.get('someuser');
    expect(attempts).toEqual([0, 1]);
  });

  it('times out a response whose body stalls after the headers', async () => {
    const stalledFetch = (async (): Promise<Response> => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"data":'));
          // Never closes — body hangs after headers.
        },
      });
      return new Response(stream, { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof globalThis.fetch;

    const { vinkius } = makeVinkius([], { timeoutMs: 50, fetch: stalledFetch });
    await expect(vinkius.users.get('someuser')).rejects.toMatchObject({ code: 'connection_error' });
  });

  it('aborts when the caller signal fires', async () => {
    const controller = new AbortController();
    const route: Route = {
      method: 'GET',
      path: /^\/apps\/vk_app_test\/users\/someuser$/,
      respond: () => ({ delayMs: 500, body: {} }),
    };
    const { vinkius } = makeVinkius([route], { maxRetries: 0 });
    const promise = vinkius.users.get('someuser', { signal: controller.signal });
    controller.abort();
    await expect(promise).rejects.toBeInstanceOf(ConnectionError);
  });

  it('retries a POST carrying an idempotency key (the key makes it retry-safe)', async () => {
    let attempts = 0;
    const route: Route = {
      method: 'POST',
      path: /^\/apps\/vk_app_test\/users$/,
      respond: (c) => {
        attempts += 1;
        if (attempts < 2) return { status: 503, body: { message: 'unavailable' } };
        return { body: { data: { id: 'x', external_id: (c.body as { external_id: string }).external_id } } };
      },
    };
    const { vinkius, calls } = makeVinkius([route], { maxRetries: 2 });
    const result = await vinkius.users.create({ external_id: 'usr_1' }, { idempotencyKey: 'key-123' });
    expect(result.id).toBe('x');
    expect(attempts).toBe(2);
    expect(calls.every((c) => c.headers.get('idempotency-key') === 'key-123')).toBe(true);
  });
});

describe('adapter dispatch', () => {
  it('throws a typed NotFoundError for an unknown capability', async () => {
    await expect(runOpenAIToolCall([], { function: { name: 'nope', arguments: '{}' } })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});
