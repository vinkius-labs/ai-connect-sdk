import { describe, expect, it } from 'vitest';
import { ConnectorNotConnectedError } from '../src';
import {
  connection,
  makeVinkius,
  runtimeRoute,
  RUNTIME_MCP_PATH,
  RUNTIME_MCP_URL,
  runtimeTool,
  tokenRoute,
  type Route,
} from './helpers/mock-fetch';

function listRoute(connections: Array<Record<string, unknown>>): Route {
  return {
    method: 'GET',
    path: /^\/apps\/vk_app_test\/users\/customer-123\/mcps$/,
    respond: () => ({ body: { data: connections } }),
  };
}

function createRoute(): Route {
  return {
    method: 'POST',
    path: /^\/apps\/vk_app_test\/users\/customer-123\/mcps$/,
    respond: () => ({ body: { data: connection('conn_1', 'github') } }),
  };
}

describe('Connector (external_id addressing)', () => {
  it('connect() provisions a runtime token and returns the runtime_url', async () => {
    const { vinkius, calls } = makeVinkius([createRoute(), tokenRoute()]);
    const github = vinkius.user('customer-123').connector('github');
    const result = await github.connect();
    expect(result.id).toBe('conn_1');
    expect(result.slug).toBe('github');
    // The connection now carries its runtime endpoint (embeds the vk_live_* token).
    expect(result.runtime_url).toBe(RUNTIME_MCP_URL);
    // Two calls: create the connection, then mint its data-plane token.
    expect(calls.map((c) => c.path)).toEqual([
      '/apps/vk_app_test/users/customer-123/mcps',
      '/apps/vk_app_test/users/customer-123/mcps/conn_1/tokens',
    ]);
  });

  it('derives status from connection.ready', async () => {
    const ready = makeVinkius([listRoute([connection('conn_1', 'github', { ready: true })])]);
    expect(await ready.vinkius.user('customer-123').connector('github').status()).toBe('ready');

    const needs = makeVinkius([listRoute([connection('conn_1', 'github', { ready: false })])]);
    expect(await needs.vinkius.user('customer-123').connector('github').status()).toBe('needs_credentials');

    const disabled = makeVinkius([listRoute([connection('conn_1', 'github', { status: 'suspended' })])]);
    expect(await disabled.vinkius.user('customer-123').connector('github').status()).toBe('disabled');

    const missing = makeVinkius([listRoute([])]);
    expect(await missing.vinkius.user('customer-123').connector('slack').status()).toBe('not_connected');
  });

  it('clears a memoized connection id when status no longer finds the connection', async () => {
    const { vinkius } = makeVinkius([createRoute(), tokenRoute(), listRoute([]), listRoute([])]);
    const github = vinkius.user('customer-123').connector('github');
    await github.connect();
    expect(await github.status()).toBe('not_connected');
    await expect(github.capabilities()).rejects.toBeInstanceOf(ConnectorNotConnectedError);
  });

  it('lists capabilities from the runtime after resolving the connection', async () => {
    const { vinkius, calls } = makeVinkius([
      listRoute([connection('conn_1', 'github')]),
      tokenRoute(),
      runtimeRoute(),
    ]);

    const capabilities = await vinkius.user('customer-123').connector('github').capabilities();

    expect(capabilities).toHaveLength(1);
    expect(capabilities[0]).toMatchObject({
      connector: 'github',
      connectionId: 'conn_1',
      rawName: 'create_issue',
      name: 'github__create_issue',
    });
    // Resolve the connection (API), mint the token (API), then list tools (runtime).
    expect(calls.map((call) => call.path)).toEqual([
      '/apps/vk_app_test/users/customer-123/mcps',
      '/apps/vk_app_test/users/customer-123/mcps/conn_1/tokens',
      '/vk_live_test/mcp',
    ]);
  });

  it('throws ConnectorNotConnectedError when listing capabilities of an unconnected connector', async () => {
    const { vinkius } = makeVinkius([listRoute([])]);
    await expect(vinkius.user('customer-123').connector('github').capabilities()).rejects.toBeInstanceOf(
      ConnectorNotConnectedError,
    );
  });

  it('shares a single token mint across concurrent capability resolutions', async () => {
    const { vinkius, calls } = makeVinkius([
      listRoute([connection('conn_1', 'github')]),
      tokenRoute(),
      runtimeRoute(),
    ]);
    const github = vinkius.user('customer-123').connector('github');

    const [a, b] = await Promise.all([github.capabilities(), github.capabilities()]);

    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    // Parallel callers share the in-flight provisioning: exactly one mint.
    const tokenCalls = calls.filter((c) => c.path.endsWith('/tokens'));
    expect(tokenCalls).toHaveLength(1);
  });

  it('unwraps JSON-RPC results from SSE frames, with or without the space after data:', async () => {
    const sseRuntime: Route = {
      method: 'POST',
      path: RUNTIME_MCP_PATH,
      respond: (c) => {
        const rpc = c.body as { id: unknown };
        const keepAlive = 'data: {"jsonrpc":"2.0","id":0,"result":{"tools":[]}}';
        const final = `data:${JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result: { tools: [runtimeTool()] } })}`;
        return { headers: { 'content-type': 'text/event-stream' }, body: `${keepAlive}\n\n${final}\n\n` };
      },
    };
    const { vinkius } = makeVinkius([listRoute([connection('conn_1', 'github')]), tokenRoute(), sseRuntime]);

    const capabilities = await vinkius.user('customer-123').connector('github').capabilities();

    expect(capabilities).toHaveLength(1);
    expect(capabilities[0]?.rawName).toBe('create_issue');
  });
});
