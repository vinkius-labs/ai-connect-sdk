/**
 * RuntimeClient — the ONLY surface for tool listing and execution.
 *
 * Vinkius meters, bills, and kill-switches every tool call at the runtime, keyed
 * by the `vk_live_*` token embedded in the connection's `mcp_url` path. The API
 * is NEVER an execution surface. This client therefore talks JSON-RPC 2.0 over
 * Streamable HTTP directly to `{RUNTIME}/{token}/mcp`, statelessly (one POST, no
 * `initialize` handshake, no session id).
 *
 * Responsibilities:
 *  - `tools/list` (free, un-metered) and `tools/call` (metered) as single POSTs.
 *  - Retries for the idempotent `tools/list` only; `tools/call` retries solely
 *    when the caller supplies an idempotency key (side-effect safety).
 *  - Runtime error mapping: revoked token (403) → AuthError, unknown (404) →
 *    NotFoundError, transient (5xx) → ConnectionError, JSON-RPC errors →
 *    ProtocolError. Tool-level failures are returned as `{ isError: true }`.
 *  - Redacted observability hooks (the `vk_live_*` path segment is masked).
 */
import {
  AuthError,
  NotFoundError,
  ProtocolError,
  VinkiusError,
} from './errors';
import type { RetryPolicy } from './retry';
import { Transport, type FetchLike } from './transport';
import type { CapabilityData, CapabilityResult, Hooks } from '../types';

/** JSON-RPC protocol version advertised to the runtime (2026-era stateless). */
const MCP_PROTOCOL_VERSION = '2026-07-28';

export interface RuntimeClientConfig {
  timeoutMs: number;
  retry: RetryPolicy;
  fetch: FetchLike;
  userAgent: string;
  hooks?: Hooks | undefined;
}

interface RuntimeCallOptions {
  signal?: AbortSignal | undefined;
  /** When set, retries the (otherwise non-idempotent) call safely. */
  idempotencyKey?: string | undefined;
  /** Per-call deadline in ms, overriding the client-level `timeoutMs`. */
  timeoutMs?: number | undefined;
}

interface JsonRpcEnvelope {
  jsonrpc?: string;
  id?: unknown;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
}

/**
 * A stateless JSON-RPC client bound to ONE runtime endpoint (mcp_url). The mcp_url
 * already embeds the `vk_live_*` token, so no auth headers are added here.
 */
export class RuntimeClient {
  private nextId = 1;
  private readonly transport: Transport;
  private readonly userAgent: string;

  constructor(
    /** Full runtime endpoint: {RUNTIME}/{token}/mcp. Embeds the vk_live_* token. */
    private readonly mcpUrl: string,
    cfg: RuntimeClientConfig,
  ) {
    this.transport = new Transport(cfg);
    this.userAgent = cfg.userAgent;
  }

  /** List the tools this connection exposes. Free (un-metered) at the runtime. */
  async listTools(opts: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<CapabilityData[]> {
    const result = await this.rpc('tools/list', {}, { signal: opts.signal, timeoutMs: opts.timeoutMs }, true);
    const tools = (result as { tools?: unknown }).tools;
    if (!Array.isArray(tools)) {
      throw new ProtocolError('Runtime tools/list returned no tools array.', { details: result });
    }
    return tools.map(normalizeToolDefinition);
  }

  /** Execute a tool. Metered against the connection's token. */
  async callTool(
    name: string,
    args: Record<string, unknown> | undefined,
    opts: RuntimeCallOptions = {},
  ): Promise<CapabilityResult> {
    const result = await this.rpc(
      'tools/call',
      { name, arguments: args ?? {} },
      opts,
      opts.idempotencyKey !== undefined,
    );
    return normalizeCallResult(result);
  }

  /** Issue one stateless JSON-RPC request, mapping transport + protocol errors. */
  private async rpc(
    method: string,
    params: Record<string, unknown>,
    opts: RuntimeCallOptions,
    retryable: boolean,
  ): Promise<unknown> {
    const bodyText = JSON.stringify({ jsonrpc: '2.0', id: this.nextId++, method, params });
    const result = await this.transport.send({
      url: this.mcpUrl,
      method: 'POST',
      headers: this.headers(opts.idempotencyKey),
      body: bodyText,
      signal: opts.signal,
      retryable,
      label: 'Runtime request',
      timeoutMs: opts.timeoutMs,
    });

    if (result.status < 200 || result.status >= 300) {
      throw mapRuntimeHttpError(result.status, result.body);
    }
    return this.unwrapEnvelope(result.body);
  }

  /** Extract the JSON-RPC `result`, or map a JSON-RPC `error` object. */
  private unwrapEnvelope(body: unknown): unknown {
    // The runtime may answer as an SSE stream; take the last data frame.
    const envelope = extractEnvelope(body);
    if (!envelope || typeof envelope !== 'object') {
      throw new ProtocolError('Runtime returned a non-JSON-RPC response.', { details: body });
    }
    const rpc = envelope as JsonRpcEnvelope;
    if (rpc.error) {
      throw new ProtocolError(rpc.error.message ?? 'Runtime returned a JSON-RPC error.', {
        details: rpc.error,
      });
    }
    if (rpc.result === undefined) {
      throw new ProtocolError('Runtime JSON-RPC response has no result.', { details: body });
    }
    return rpc.result;
  }

  private headers(idempotencyKey?: string): Record<string, string> {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': MCP_PROTOCOL_VERSION,
      'user-agent': this.userAgent,
    };
    if (idempotencyKey) headers['idempotency-key'] = idempotencyKey;
    return headers;
  }
}

/** Map a raw runtime tool definition (camelCase) to the SDK's CapabilityData. */
function normalizeToolDefinition(tool: unknown): CapabilityData {
  const t = (tool && typeof tool === 'object' ? tool : {}) as Record<string, unknown>;
  const name = t['name'];
  if (typeof name !== 'string' || name.trim().length === 0) {
    throw new ProtocolError('Runtime tool definition is missing a name.', { details: tool });
  }
  return {
    name,
    title: typeof t['title'] === 'string' ? (t['title'] as string) : null,
    description: typeof t['description'] === 'string' ? (t['description'] as string) : null,
    // Runtime uses JSON-Schema `inputSchema` (camelCase); the SDK contract is snake_case.
    input_schema: (t['inputSchema'] ?? t['input_schema'] ?? {}) as CapabilityData['input_schema'],
    ...(t['annotations'] !== undefined ? { annotations: t['annotations'] } : {}),
  };
}

/** Map a runtime tools/call JSON-RPC result to the SDK's CapabilityResult. */
function normalizeCallResult(result: unknown): CapabilityResult {
  const r = (result && typeof result === 'object' ? result : {}) as Record<string, unknown>;
  const rawContent = r['content'];
  const content = Array.isArray(rawContent)
    ? rawContent
        .filter((e): e is Record<string, unknown> => !!e && typeof e === 'object')
        .map((e) => ({
          type: typeof e['type'] === 'string' ? (e['type'] as string) : 'text',
          text: typeof e['text'] === 'string' ? (e['text'] as string) : JSON.stringify(e),
        }))
    : [];
  const normalized: CapabilityResult = { content, isError: r['isError'] === true };
  // The MCP data plane may return a parsed object alongside the textual content.
  // Surface it verbatim when present — never parsed or transformed by the SDK.
  if ('structuredContent' in r) normalized.structuredContent = r['structuredContent'];
  return normalized;
}

/** Runtime transport errors are plain `{ error }` bodies (see runtime routes). */
function mapRuntimeHttpError(status: number, body: unknown): VinkiusError {
  const message = pickRuntimeMessage(body, `Runtime request failed with status ${status}`);
  const base = { status, details: body } as const;
  if (status === 401 || status === 403) return new AuthError(message, base);
  if (status === 404) return new NotFoundError(message, base);
  return new VinkiusError(message, { ...base, code: 'connection_error' });
}

function pickRuntimeMessage(body: unknown, fallback: string): string {
  if (body && typeof body === 'object') {
    const b = body as Record<string, unknown>;
    if (typeof b['error'] === 'string' && b['error']) return b['error'];
    const err = b['error'];
    if (err && typeof err === 'object' && typeof (err as Record<string, unknown>)['message'] === 'string') {
      return (err as Record<string, unknown>)['message'] as string;
    }
    if (typeof b['message'] === 'string' && b['message']) return b['message'];
  }
  if (typeof body === 'string' && body) return body;
  return fallback;
}

/** Accept either a JSON object or an SSE stream string; return the JSON-RPC envelope. */
function extractEnvelope(body: unknown): unknown {
  if (typeof body !== 'string') return body;
  let last: unknown;
  for (const line of body.split('\n')) {
    const trimmed = line.trim();
    // The SSE spec allows `data:` with OR without a following space.
    if (trimmed.startsWith('data:')) {
      const payloadText = trimmed.slice(5).trimStart();
      try {
        const payload = JSON.parse(payloadText);
        if (payload && typeof payload === 'object') last = payload;
      } catch {
        // Ignore non-JSON SSE frames (comments, keep-alives).
      }
    }
  }
  return last ?? body;
}
