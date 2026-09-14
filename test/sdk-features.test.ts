import { describe, expect, it, vi } from 'vitest';
import { ConfigError } from '../src';
import type { Vinkius } from '../src';
import { runOpenAIToolCall, toOpenAITools } from '../src/adapters/openai';
import { runAnthropicToolUse } from '../src/adapters/anthropic';
import { runGeminiFunctionCall } from '../src/adapters/gemini';
import { executeByName } from '../src/adapters/json-schema';
import type { Capability } from '../src/fluent/capability';
import { connection, makeVinkius, runtimeRoute, tokenRoute, type Route } from './helpers/mock-fetch';

function connectionsRoute(connections: Array<Record<string, unknown>>): Route {
  return {
    method: 'GET',
    path: /^\/apps\/vk_app_test\/users\/customer-123\/mcps$/,
    respond: () => ({ body: { data: connections } }),
  };
}

describe('user.capabilities() — onConnectorError observability', () => {
  it('invokes onConnectorError for an isolated fan-out failure but keeps the rest', async () => {
    const onConnectorError = vi.fn();
    const { vinkius } = makeVinkius([
      connectionsRoute([
        connection('conn_1', 'github', { ready: true }),
        connection('conn_2', 'slack', { ready: true }),
      ]),
      tokenRoute('conn_1'),
      {
        method: 'POST',
        path: /^\/apps\/vk_app_test\/users\/customer-123\/mcps\/conn_2\/tokens$/,
        respond: () => ({ status: 500, body: { message: 'boom' } }),
      },
      runtimeRoute(),
    ]);

    const capabilities = await vinkius.user('customer-123').capabilities({ onConnectorError });
    expect(capabilities.map((c) => c.connector)).toEqual(['github']);
    expect(onConnectorError).toHaveBeenCalledTimes(1);
    expect(onConnectorError.mock.calls[0]?.[0]).toBe('slack');
    expect(onConnectorError.mock.calls[0]?.[1]).toBeInstanceOf(Error);
  });

  it('does not call onConnectorError when every connector succeeds', async () => {
    const onConnectorError = vi.fn();
    const { vinkius } = makeVinkius([
      connectionsRoute([connection('conn_1', 'github', { ready: true })]),
      tokenRoute('conn_1'),
      runtimeRoute(),
    ]);
    await vinkius.user('customer-123').capabilities({ onConnectorError });
    expect(onConnectorError).not.toHaveBeenCalled();
  });
});

describe('runtime — structuredContent passthrough', () => {
  it('surfaces MCP structuredContent on the CapabilityResult', async () => {
    const { vinkius } = makeVinkius([
      connectionsRoute([connection('conn_1', 'github', { ready: true })]),
      tokenRoute('conn_1'),
      runtimeRoute({
        call: () => ({
          content: [{ type: 'text', text: 'plain' }],
          structuredContent: { issueNumber: 42 },
          isError: false,
        }),
      }),
    ]);

    const capabilities = await vinkius.user('customer-123').capabilities();
    const result = await capabilities.findCapability('github__create_issue')?.execute({});
    expect(result?.content).toEqual([{ type: 'text', text: 'plain' }]);
    expect(result?.structuredContent).toEqual({ issueNumber: 42 });
    expect(result?.isError).toBe(false);
  });
});

describe('per-call timeoutMs (ExecuteOptions)', () => {
  it('times out a long-running tool when timeoutMs is smaller than the latency', async () => {
    const { vinkius } = makeVinkius([
      connectionsRoute([connection('conn_1', 'github', { ready: true })]),
      tokenRoute('conn_1'),
      runtimeRoute({
        call: () => ({ content: [{ type: 'text', text: 'slow' }], isError: false }),
        callDelayMs: 500,
      }),
    ]);

    const capability = (await vinkius.user('customer-123').capabilities()).findCapability(
      'github__create_issue',
    );
    await expect(capability?.execute({}, { timeoutMs: 30 })).rejects.toMatchObject({
      code: 'connection_error',
    });
  });

  it('completes when timeoutMs comfortably exceeds the latency', async () => {
    const { vinkius } = makeVinkius(
      [
        connectionsRoute([connection('conn_1', 'github', { ready: true })]),
        tokenRoute('conn_1'),
        runtimeRoute({ call: () => ({ content: [{ type: 'text', text: 'ok' }], isError: false }) }),
      ],
      { timeoutMs: 5000 },
    );

    const capability = (await vinkius.user('customer-123').capabilities()).findCapability(
      'github__create_issue',
    );
    const result = await capability?.execute({}, { timeoutMs: 5000 });
    expect(result?.isError).toBe(false);
  });
});

describe('run* adapters propagate ExecuteOptions to the runtime', () => {
  async function capabilitiesWithSlowTool(): Promise<readonly Capability[]> {
    const { vinkius } = makeVinkius([
      connectionsRoute([connection('conn_1', 'github', { ready: true })]),
      tokenRoute('conn_1'),
      runtimeRoute({
        call: () => ({ content: [{ type: 'text', text: 'slow' }], isError: false }),
        callDelayMs: 500,
      }),
    ]);
    return vinkius.user('customer-123').capabilities();
  }

  it('runOpenAIToolCall forwards timeoutMs', async () => {
    const caps = await capabilitiesWithSlowTool();
    await expect(
      runOpenAIToolCall(
        caps,
        { function: { name: 'github__create_issue', arguments: '{}' } },
        { timeoutMs: 30 },
      ),
    ).rejects.toMatchObject({ code: 'connection_error' });
  });

  it('runAnthropicToolUse forwards timeoutMs', async () => {
    const caps = await capabilitiesWithSlowTool();
    await expect(
      runAnthropicToolUse(caps, { name: 'github__create_issue', input: {} }, { timeoutMs: 30 }),
    ).rejects.toMatchObject({ code: 'connection_error' });
  });

  it('runGeminiFunctionCall forwards timeoutMs', async () => {
    const caps = await capabilitiesWithSlowTool();
    await expect(
      runGeminiFunctionCall(caps, { name: 'github__create_issue', args: {} }, { timeoutMs: 30 }),
    ).rejects.toMatchObject({ code: 'connection_error' });
  });

  it('executeByName forwards timeoutMs', async () => {
    const caps = await capabilitiesWithSlowTool();
    await expect(executeByName(caps, 'github__create_issue', {}, { timeoutMs: 30 })).rejects.toMatchObject({
      code: 'connection_error',
    });
  });

  it('executes normally when no ExecuteOptions are given', async () => {
    const caps = await capabilitiesWithSlowTool();
    const result = await runOpenAIToolCall(caps, {
      function: { name: 'github__create_issue', arguments: '{"title":"x"}' },
    });
    expect(result.isError).toBe(false);
  });
});

describe('OpenAI adapter — function name validation', () => {
  function clientWithNamespace(fn: (c: string, n: string) => string): Vinkius {
    const { vinkius } = makeVinkius(
      [
        connectionsRoute([connection('conn_1', 'github', { ready: true })]),
        tokenRoute('conn_1'),
        runtimeRoute(),
      ],
      { namespaceCapability: fn },
    );
    return vinkius;
  }

  it('throws ConfigError for a name longer than 64 chars', async () => {
    const vinkius = clientWithNamespace(() => 'x'.repeat(65));
    const caps = await vinkius.user('customer-123').capabilities();
    expect(() => toOpenAITools(caps)).toThrow(ConfigError);
  });

  it('throws ConfigError for names with unsupported characters (dots)', async () => {
    const vinkius = clientWithNamespace((c, n) => `${c}.${n}`); // contains a dot
    const caps = await vinkius.user('customer-123').capabilities();
    expect(() => toOpenAITools(caps)).toThrow(ConfigError);
  });

  it('accepts a valid OpenAI-compatible name', async () => {
    const vinkius = clientWithNamespace((c, n) => `${c}__${n}`);
    const caps = await vinkius.user('customer-123').capabilities();
    expect(() => toOpenAITools(caps)).not.toThrow();
  });
});

describe('auto-pagination iterate()', () => {
  function catalogRoute(pages: Record<string, unknown>): Route {
    return {
      method: 'GET',
      path: /^\/catalog\/mcps$/,
      respond: (c) => {
        const page = c.query.get('page') ?? '1';
        return { body: pages[page] };
      },
    };
  }

  function catalogConn(slug: string): Record<string, unknown> {
    return {
      id: slug,
      slug,
      title: slug,
      short_description: null,
      publisher_type: 'first_party',
      listing_type: '',
      requires_buyer_auth: false,
      tools_count: 1,
    };
  }

  const meta = (current: number, last: number) => ({
    current_page: current,
    from: 1,
    last_page: last,
    path: 'http://localhost:8080/catalog/mcps',
    per_page: 50,
    to: 1,
    total: last,
  });

  it('walks every page of the catalog', async () => {
    const catalog = makeVinkius([
      catalogRoute({
        '1': { data: [catalogConn('github')], meta: meta(1, 2), links: {} },
        '2': { data: [catalogConn('slack')], meta: meta(2, 2), links: {} },
      }),
    ]);

    const seen: string[] = [];
    for await (const connector of catalog.vinkius.catalog.iterate()) {
      seen.push(connector.slug);
    }
    expect(seen).toEqual(['github', 'slack']);
  });

  it('walks every page of app users', async () => {
    const users = makeVinkius([
      {
        method: 'GET',
        path: /^\/apps\/vk_app_test\/users$/,
        respond: (c) => {
          const page = c.query.get('page') ?? '1';
          if (page === '1') {
            return {
              body: {
                data: [
                  {
                    id: 'u1',
                    external_id: 'a',
                    status: 'active',
                    metadata: null,
                    created_at: 'x',
                    updated_at: 'x',
                  },
                ],
                meta: meta(1, 2),
                links: {},
              },
            };
          }
          return {
            body: {
              data: [
                {
                  id: 'u2',
                  external_id: 'b',
                  status: 'active',
                  metadata: null,
                  created_at: 'x',
                  updated_at: 'x',
                },
              ],
              meta: meta(2, 2),
              links: {},
            },
          };
        },
      },
    ]);

    const ids: string[] = [];
    for await (const user of users.vinkius.users.iterate()) {
      ids.push(user.id);
    }
    expect(ids).toEqual(['u1', 'u2']);
  });
});
