import { Vinkius } from '../../src';
import type { VinkiusOptions } from '../../src';

export interface RecordedCall {
  method: string;
  url: string;
  path: string;
  query: URLSearchParams;
  body: unknown;
  headers: Headers;
}

export interface MockResponse {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
  /** Simulate latency; honors the request's AbortSignal (for timeout tests). */
  delayMs?: number;
}

export type Responder = (call: RecordedCall) => MockResponse | Promise<MockResponse>;

export interface Route {
  method: string;
  path: RegExp;
  respond: Responder;
}

export function createMockFetch(routes: Route[]): {
  fetch: typeof globalThis.fetch;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];

  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const rawUrl = typeof input === 'string' ? input : input.toString();
    const url = new URL(rawUrl);
    const method = (init?.method ?? 'GET').toUpperCase();
    const bodyText = typeof init?.body === 'string' ? init.body : undefined;
    const call: RecordedCall = {
      method,
      url: rawUrl,
      path: url.pathname,
      query: url.searchParams,
      body: bodyText ? JSON.parse(bodyText) : undefined,
      headers: new Headers(init?.headers as HeadersInit | undefined),
    };
    calls.push(call);

    const route = routes.find((r) => r.method === method && r.path.test(url.pathname));
    if (!route) throw new Error(`No mock route for ${method} ${url.pathname}`);

    const res = await route.respond(call);

    if (res.delayMs && res.delayMs > 0) {
      await waitOrAbort(res.delayMs, init?.signal ?? undefined);
    }

    const payload = res.body === undefined ? '' : JSON.stringify(res.body);
    return new Response(payload, {
      status: res.status ?? 200,
      headers: new Headers(res.headers),
    });
  };

  return { fetch: fetchImpl as unknown as typeof globalThis.fetch, calls };
}

function abortError(): Error {
  const error = new Error('aborted');
  error.name = 'AbortError';
  return error;
}

function waitOrAbort(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    // Faithful to real fetch: an already-aborted signal rejects immediately.
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(abortError());
      },
      { once: true },
    );
  });
}

/** Build a Vinkius client wired to a mock fetch. Retries off by default. */
export function makeVinkius(
  routes: Route[],
  overrides: Partial<VinkiusOptions> = {},
): { vinkius: Vinkius; calls: RecordedCall[] } {
  const { fetch, calls } = createMockFetch(routes);
  const vinkius = new Vinkius({
    appId: 'vk_app_test',
    apiKey: 'vk_app_sk_test',
    baseUrl: 'http://localhost:8080',
    maxRetries: 0,
    fetch,
    ...overrides,
  });
  return { vinkius, calls };
}

// ── Fixtures ────────────────────────────────────────────────────────────────

export function appUser(id: string, externalId: string): Record<string, unknown> {
  return {
    id,
    external_id: externalId,
    status: 'active',
    metadata: null,
    application_id: 'vk_app_test',
    created_at: '2026-01-01T00:00:00+00:00',
    updated_at: '2026-01-01T00:00:00+00:00',
  };
}

export function connection(
  id: string,
  slug: string,
  opts: { ready?: boolean; status?: string } = {},
): Record<string, unknown> {
  return {
    id,
    slug,
    name: slug,
    description: null,
    status: opts.status ?? 'active',
    ready: opts.ready ?? true,
    created_at: '2026-01-01T00:00:00+00:00',
  };
}

export function capabilityData(
  name = 'create_issue',
  connector = 'github',
  connectionId = 'conn_1',
): Record<string, unknown> {
  return {
    name,
    title: 'Create Issue',
    description: 'Create a GitHub issue',
    input_schema: { type: 'object', properties: { title: { type: 'string' } } },
    connector,
    connection_id: connectionId,
  };
}

// ── Runtime (data-plane) fixtures ─────────────────────────────────────────────
//
// Tool listing/execution happens at the MCP runtime, not the API. connect() and
// capabilities() first mint a data-plane token (POST .../tokens) whose response
// carries the `mcp_url`; the SDK then talks JSON-RPC directly to that URL.

/** A distinct host so runtime calls are trivially routable in the mock. */
export const RUNTIME_MCP_URL = 'http://localhost:9090/vk_live_test/mcp';
export const RUNTIME_MCP_PATH = /^\/vk_live_test\/mcp$/;

/** The one-time token/mcp_url the API returns from POST .../mcps/{id}/tokens. */
export function issuedToken(mcpUrl = RUNTIME_MCP_URL): Record<string, unknown> {
  return {
    id: 'tok_1',
    name: 'Execution Plane token',
    is_enabled: true,
    token: 'vk_live_test',
    mcp_url: mcpUrl,
    created_at: '2026-01-01T00:00:00+00:00',
  };
}

/** Route: mint a token for a connection (returns mcp_url pointing at the runtime). */
export function tokenRoute(connectionId = 'conn_1', mcpUrl = RUNTIME_MCP_URL): Route {
  return {
    method: 'POST',
    path: new RegExp(`^/apps/vk_app_test/users/customer-123/mcps/${connectionId}/tokens$`),
    respond: () => ({ body: { data: issuedToken(mcpUrl) } }),
  };
}

/** A runtime tool definition (camelCase inputSchema, as the runtime emits). */
export function runtimeTool(name = 'create_issue'): Record<string, unknown> {
  return {
    name,
    title: 'Create Issue',
    description: 'Create a GitHub issue',
    inputSchema: { type: 'object', properties: { title: { type: 'string' } } },
  };
}

/** Route: the runtime JSON-RPC endpoint. Handles tools/list and tools/call. */
export function runtimeRoute(
  handlers: {
    tools?: Array<Record<string, unknown>>;
    call?: (body: { params?: { name?: string; arguments?: unknown } }) => {
      content: Array<{ type: string; text: string }>;
      isError: boolean;
    };
    /** Simulated latency for tools/call (honors the request's abort signal). */
    callDelayMs?: number;
  } = {},
): Route {
  return {
    method: 'POST',
    path: RUNTIME_MCP_PATH,
    respond: (c) => {
      const rpc = c.body as { id?: unknown; method?: string; params?: { name?: string; arguments?: unknown } };
      if (rpc.method === 'tools/list') {
        return { body: { jsonrpc: '2.0', id: rpc.id, result: { tools: handlers.tools ?? [runtimeTool()] } } };
      }
      if (rpc.method === 'tools/call') {
        const result = handlers.call
          ? handlers.call(rpc)
          : { content: [{ type: 'text', text: 'done' }], isError: false };
        return {
          body: { jsonrpc: '2.0', id: rpc.id, result },
          ...(handlers.callDelayMs ? { delayMs: handlers.callDelayMs } : {}),
        };
      }
      return { body: { jsonrpc: '2.0', id: rpc.id, error: { code: -32601, message: 'Method not found' } } };
    },
  };
}
