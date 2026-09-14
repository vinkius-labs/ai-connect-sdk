import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ConfigError,
  ConnectionError,
  NotImplementedError,
  NotFoundError,
  ProtocolError,
  ValidationError,
  Vinkius,
} from '../src';
import { buildCapability } from '../src/fluent/capability';
import { toAISDKTools } from '../src/adapters/ai-sdk';
import { runAnthropicToolUse, toAnthropicTools } from '../src/adapters/anthropic';
import { runOpenAIToolCall, toOpenAITools } from '../src/adapters/openai';
import { toGeminiTools } from '../src/adapters/gemini';
import { sleep } from '../src/core/retry';
import { appUser, connection, makeVinkius, runtimeRoute, tokenRoute, type Route } from './helpers/mock-fetch';

function connectionsRoute(connections: Array<Record<string, unknown>>): Route {
  return {
    method: 'GET',
    path: /^\/apps\/vk_app_test\/users\/customer-123\/mcps$/,
    respond: () => ({ body: { data: connections } }),
  };
}

async function getCapabilities(overrides: Parameters<typeof makeVinkius>[1] = {}) {
  const { vinkius } = makeVinkius(
    [
      connectionsRoute([connection('conn_1', 'github', { ready: true })]),
      tokenRoute('conn_1'),
      runtimeRoute(),
    ],
    overrides,
  );
  return vinkius.user('customer-123').capabilities();
}

// ── Config validation ───────────────────────────────────────────────────────

describe('config validation (gaps)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects an invalid baseUrl', () => {
    expect(() => new Vinkius({ appId: 'vk_app_x', apiKey: 'vk_app_sk_x', baseUrl: 'not a url' })).toThrow(
      ConfigError,
    );
  });

  it('rejects construction when no global fetch exists', () => {
    const g = globalThis as { fetch?: unknown };
    const original = g.fetch;
    g.fetch = undefined;
    try {
      expect(() => new Vinkius({ appId: 'vk_app_x', apiKey: 'vk_app_sk_x' })).toThrow(ConfigError);
    } finally {
      g.fetch = original;
    }
  });

  it('warns on insecure http:// baseUrl for non-local hosts', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const route: Route = {
      method: 'GET',
      path: /^\/apps\/vk_app_test\/users\/someuser$/,
      respond: () => ({ body: { data: appUser('u1', 'someuser') } }),
    };
    const { vinkius } = makeVinkius([route], { baseUrl: 'http://api.example.com' });
    await vinkius.users.get('someuser');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('insecure'));
  });
});

// ── Capability building guards ──────────────────────────────────────────────

describe('buildCapability guards', () => {
  const executor = async (): Promise<{
    content: Array<{ type: string; text: string }>;
    isError: boolean;
  }> => ({
    content: [],
    isError: false,
  });
  const ctx = {
    connector: 'github',
    connectionId: 'conn_1',
    namespace: (c: string, n: string) => `${c}__${n}`,
    executor,
  };

  it('rejects a payload without a usable name', () => {
    expect(() => buildCapability({ name: '   ' }, ctx)).toThrow(ProtocolError);
    expect(() => buildCapability({}, ctx)).toThrow(ProtocolError);
  });

  it('rejects a payload without routing metadata', () => {
    expect(() => buildCapability({ name: 'ok' }, { ...ctx, connector: '' })).toThrow(ProtocolError);
    expect(() => buildCapability({ name: 'ok' }, { ...ctx, connectionId: '' })).toThrow(ProtocolError);
  });

  it('falls back to an empty object schema and normalizeParams fills the envelope', async () => {
    const capabilities = await getCapabilities();
    expect(capabilities.length).toBeGreaterThan(0);
    // The fixture always carries a schema; exercise normalizeParams directly
    // through a capability built with a null input_schema.
    const cap = buildCapability({ name: 'no_schema', input_schema: null }, ctx);
    expect(cap.inputSchema).toEqual({});
    const tools = toOpenAITools([cap]);
    expect(tools[0]?.function.parameters).toEqual({ type: 'object', properties: {} });
  });
});

// ── Resource methods not exercised elsewhere ────────────────────────────────

describe('resource clients (update/delete/get/credentials)', () => {
  it('updates and deletes a user', async () => {
    const { vinkius, calls } = makeVinkius([
      {
        method: 'PATCH',
        path: /^\/apps\/vk_app_test\/users\/u1$/,
        respond: () => ({ body: { data: appUser('u1', 'u1') } }),
      },
      { method: 'DELETE', path: /^\/apps\/vk_app_test\/users\/u1$/, respond: () => ({ body: {} }) },
    ]);
    await expect(vinkius.users.update('u1', { status: 'disabled' })).resolves.toMatchObject({ id: 'u1' });
    await expect(vinkius.users.delete('u1')).resolves.toBeUndefined();
    expect(calls.map((c) => c.method)).toEqual(['PATCH', 'DELETE']);
  });

  it('gets and deletes a connection', async () => {
    const { vinkius, calls } = makeVinkius([
      {
        method: 'GET',
        path: /^\/apps\/vk_app_test\/users\/customer-123\/mcps\/conn_9$/,
        respond: () => ({ body: { data: connection('conn_9', 'github') } }),
      },
      {
        method: 'DELETE',
        path: /^\/apps\/vk_app_test\/users\/customer-123\/mcps\/conn_9$/,
        respond: () => ({ body: {} }),
      },
    ]);
    await expect(vinkius.users.connections('customer-123').get('conn_9')).resolves.toMatchObject({
      id: 'conn_9',
    });
    await expect(vinkius.users.connections('customer-123').delete('conn_9')).resolves.toBeUndefined();
    expect(calls.map((c) => c.method)).toEqual(['GET', 'DELETE']);
  });

  it('reads and sets credentials through the fluent handle', async () => {
    const { vinkius, calls } = makeVinkius([
      connectionsRoute([connection('conn_1', 'github', { ready: true })]),
      {
        method: 'GET',
        path: /^\/apps\/vk_app_test\/users\/customer-123\/mcps\/conn_1\/credentials$/,
        respond: () => ({
          body: { schema: { api_key: { type: 'api_key' } }, configured: { api_key: true } },
        }),
      },
      {
        method: 'PUT',
        path: /^\/apps\/vk_app_test\/users\/customer-123\/mcps\/conn_1\/credentials$/,
        respond: () => ({ body: { schema: {}, configured: { api_key: true } } }),
      },
    ]);
    const handle = vinkius.user('customer-123').connector('github').credentials;
    await expect(handle.status()).resolves.toMatchObject({ configured: { api_key: true } });
    await expect(handle.set({ api_key: 'secret' })).resolves.toMatchObject({ configured: { api_key: true } });
    const put = calls.find((c) => c.method === 'PUT');
    expect(put?.body).toEqual({ credentials: { api_key: 'secret' } });
  });

  it('issues a token with an explicit name', async () => {
    const { vinkius, calls } = makeVinkius([
      {
        method: 'POST',
        path: /^\/apps\/vk_app_test\/users\/customer-123\/mcps\/conn_1\/tokens$/,
        respond: () => ({
          body: { data: { id: 'tok_1', name: 'agent', is_enabled: true, created_at: 'x' } },
        }),
      },
    ]);
    const issued = await vinkius.users.connections('customer-123').tokens('conn_1').issue({ name: 'agent' });
    expect(issued.id).toBe('tok_1');
    expect(calls[0]?.body).toEqual({ name: 'agent' });
  });

  it('fetches the underlying user resource', async () => {
    const { vinkius } = makeVinkius([
      {
        method: 'GET',
        path: /^\/apps\/vk_app_test\/users\/customer-123$/,
        respond: () => ({ body: { data: appUser('u1', 'customer-123') } }),
      },
    ]);
    await expect(vinkius.user('customer-123').get()).resolves.toMatchObject({ id: 'u1' });
  });

  it('normalizes marketplace search results, including fallback fields', async () => {
    const { vinkius } = makeVinkius([
      {
        method: 'GET',
        path: /^\/marketplace\/search$/,
        respond: (c) => {
          if (c.query.get('q') === 'none') return { body: { results: [] } };
          return {
            body: {
              results: [
                {
                  id: 'slack',
                  slug: 'slack',
                  title: 'Slack',
                  short_description: null,
                  publisher_type: 'first_party',
                  server_type: 'mcp',
                  requires_auth: true,
                },
              ],
            },
          };
        },
      },
    ]);
    expect(await vinkius.catalog.search('none')).toEqual([]);
    const found = await vinkius.catalog.search('slack');
    expect(found[0]).toMatchObject({ listing_type: 'mcp', requires_buyer_auth: true });
  });
});

// ── Connector handle behaviors ──────────────────────────────────────────────

describe('connector handle (disconnect, memoization, bad mint)', () => {
  it('disconnects by deleting the resolved connection', async () => {
    const { vinkius, calls } = makeVinkius([
      connectionsRoute([connection('conn_1', 'github', { ready: true })]),
      {
        method: 'DELETE',
        path: /^\/apps\/vk_app_test\/users\/customer-123\/mcps\/conn_1$/,
        respond: () => ({ body: {} }),
      },
    ]);
    await vinkius.user('customer-123').connector('github').disconnect();
    expect(calls.some((c) => c.method === 'DELETE' && c.path.endsWith('/mcps/conn_1'))).toBe(true);
  });

  it('mints at most one token per handle across repeated capability listings', async () => {
    const { vinkius, calls } = makeVinkius([
      connectionsRoute([connection('conn_1', 'github', { ready: true })]),
      tokenRoute('conn_1'),
      runtimeRoute(),
    ]);
    const handle = vinkius.user('customer-123').connector('github');
    await handle.capabilities();
    await handle.capabilities();
    expect(calls.filter((c) => c.path.endsWith('/tokens'))).toHaveLength(1);
  });

  it('throws a ProtocolError when token minting returns no mcp_url', async () => {
    const { vinkius } = makeVinkius([
      connectionsRoute([connection('conn_1', 'github', { ready: true })]),
      {
        method: 'POST',
        path: /^\/apps\/vk_app_test\/users\/customer-123\/mcps\/conn_1\/tokens$/,
        respond: () => ({ body: { data: { id: 'tok_1', name: 'x', is_enabled: true, created_at: 'x' } } }),
      },
    ]);
    await expect(vinkius.user('customer-123').connector('github').capabilities()).rejects.toBeInstanceOf(
      ProtocolError,
    );
  });
});

// ── Adapters ────────────────────────────────────────────────────────────────

describe('adapters (gaps)', () => {
  it('runs an Anthropic tool_use block and throws typed NotFoundError for unknown names', async () => {
    const capabilities = await getCapabilities();
    const result = await runAnthropicToolUse(capabilities, { name: 'create_issue', input: { title: 'x' } });
    expect(result.isError).toBe(false);
    await expect(runAnthropicToolUse(capabilities, { name: 'nope', input: {} })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('validates tool names for Gemini (no hyphens) and Anthropic (≤128)', async () => {
    await expect(
      getCapabilities({ namespaceCapability: (c, n) => `${c}-${n}` }).then(toGeminiTools),
    ).rejects.toBeInstanceOf(ConfigError);
    await expect(
      getCapabilities({ namespaceCapability: () => 'y'.repeat(129) }).then(toAnthropicTools),
    ).rejects.toBeInstanceOf(ConfigError);
  });

  it('tolerates malformed tool-call arguments (executes with an empty object)', async () => {
    const capabilities = await getCapabilities();
    const result = await runOpenAIToolCall(capabilities, {
      function: { name: 'create_issue', arguments: '{broken json' },
    });
    expect(result.isError).toBe(false);
  });

  it('supports the AI SDK jsonSchema wrapper and dispatches execution', async () => {
    const capabilities = await getCapabilities();
    const tools = toAISDKTools(capabilities, { jsonSchema: (schema) => ({ wrapped: schema }) });
    const tool = tools['github__create_issue'];
    expect(tool).toBeDefined();
    expect((tool?.parameters as { wrapped?: unknown }).wrapped).toBeTypeOf('object');
    const result = await tool?.execute({ title: 'x' });
    expect(result?.isError).toBe(false);
  });
});

// ── Transport: network vs stream failures ───────────────────────────────────

const encoder = new TextEncoder();

function flakyFetch(failures: number, mode: 'network' | 'stream'): typeof globalThis.fetch {
  let attempts = 0;
  return (async (): Promise<Response> => {
    attempts += 1;
    if (attempts <= failures) {
      if (mode === 'network') throw new Error('ECONNRESET');
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode('{"data":'));
          controller.error(new Error('stream broken'));
        },
      });
      return new Response(stream, { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify({ data: { id: 'x' } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof globalThis.fetch;
}

describe('transport failure modes', () => {
  it('retries a network failure and succeeds on the next attempt', async () => {
    const { vinkius } = makeVinkius([], { maxRetries: 2, fetch: flakyFetch(1, 'network') });
    await expect(vinkius.users.get('someuser')).resolves.toMatchObject({ id: 'x' });
  });

  it('maps a network failure without retries to a ConnectionError', async () => {
    const { vinkius } = makeVinkius([], { maxRetries: 0, fetch: flakyFetch(1, 'network') });
    await expect(vinkius.users.get('someuser')).rejects.toBeInstanceOf(ConnectionError);
  });

  it('retries when the body stream breaks mid-read', async () => {
    const { vinkius } = makeVinkius([], { maxRetries: 2, fetch: flakyFetch(1, 'stream') });
    await expect(vinkius.users.get('someuser')).resolves.toMatchObject({ id: 'x' });
  });

  it('maps a stream failure without retries to a ConnectionError', async () => {
    const { vinkius } = makeVinkius([], { maxRetries: 0, fetch: flakyFetch(1, 'stream') });
    await expect(vinkius.users.get('someuser')).rejects.toBeInstanceOf(ConnectionError);
  });

  it('reports a caller abort that fires during the body read', async () => {
    const controller = new AbortController();
    const abortingFetch = (async (_input: unknown, init?: RequestInit): Promise<Response> => {
      const stream = new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(encoder.encode('{"data":'));
          init?.signal?.addEventListener(
            'abort',
            () => c.error(Object.assign(new Error('aborted'), { name: 'AbortError' })),
            { once: true },
          );
        },
      });
      return new Response(stream, { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof globalThis.fetch;

    const { vinkius } = makeVinkius([], { maxRetries: 0, fetch: abortingFetch });
    const pending = vinkius.users.get('someuser', { signal: controller.signal });
    await new Promise((resolve) => setTimeout(resolve, 20));
    controller.abort();
    await expect(pending).rejects.toMatchObject({ message: expect.stringContaining('aborted by caller') });
  });
});

// ── retry.sleep ─────────────────────────────────────────────────────────────

describe('sleep', () => {
  it('rejects immediately when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(sleep(1_000, controller.signal)).rejects.toBeInstanceOf(Error);
  });

  it('rejects when aborted mid-sleep and resolves otherwise', async () => {
    const controller = new AbortController();
    const pending = sleep(1_000, controller.signal);
    setTimeout(() => controller.abort(), 5);
    await expect(pending).rejects.toBeInstanceOf(Error);
    await expect(sleep(5)).resolves.toBeUndefined();
  });
});

// ── Error mapping gaps ──────────────────────────────────────────────────────

describe('error mapping (gaps)', () => {
  function routeWith(status: number, body: unknown): Route {
    return {
      method: 'GET',
      path: /^\/apps\/vk_app_test\/users\/someuser$/,
      respond: () => ({ status, body }),
    };
  }

  it('exposes NotImplementedError with a stable code', () => {
    const error = new NotImplementedError('coming soon');
    expect(error.code).toBe('not_implemented');
    expect(error.status).toBe(0);
  });

  it('maps 422 without an errors field to an empty errors record', async () => {
    const { vinkius } = makeVinkius([routeWith(422, { message: 'Invalid' })]);
    const error = await vinkius.users.get('someuser').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).errors).toEqual({});
  });

  it('picks the message from an MCP content array when message/error are absent', async () => {
    const { vinkius } = makeVinkius([routeWith(400, { content: [{ type: 'text', text: 'from content' }] })]);
    await expect(vinkius.users.get('someuser')).rejects.toMatchObject({ message: 'from content' });
  });
});

// ── CapabilitySet helpers ───────────────────────────────────────────────────

describe('CapabilitySet.forConnector', () => {
  it('filters capabilities by connector slug', async () => {
    const capabilities = await getCapabilities();
    expect(capabilities.forConnector('github')).toHaveLength(capabilities.length);
    expect(capabilities.forConnector('nope')).toHaveLength(0);
  });
});
