/**
 * The HTTP client: fetch-based, dependency-free, runtime-agnostic.
 *
 * Responsibilities:
 *  - Bearer auth with the `vk_app_sk_*` key (never logged).
 *  - Automatic retries (idempotent requests only) with full-jitter backoff,
 *    honoring `Retry-After`.
 *  - Consistent error mapping (see {@link mapHttpError}).
 *  - Redacted observability hooks.
 *
 * Transport mechanics (timeout, abort composition, retries, hooks) live in
 * {@link Transport} and are shared with the data-plane RuntimeClient.
 */
import type { Hooks } from '../types';
import { mapHttpError } from './errors';
import type { FetchLike } from './transport';
import { Transport } from './transport';
import type { RetryPolicy } from './retry';

export interface HttpClientConfig {
  baseUrl: string;
  apiKey: string;
  /** Public application id (`vk_app_*`) — sent on every request as the tenant binding. */
  appId: string;
  timeoutMs: number;
  retry: RetryPolicy;
  fetch: FetchLike;
  userAgent: string;
  hooks?: Hooks | undefined;
}

/** Header carrying the public app id — the API authenticates it against the key. */
const APP_ID_HEADER = 'x-vinkius-app-id';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface HttpRequest {
  method: HttpMethod;
  path: string;
  query?: Record<string, string | number | boolean | undefined | null> | undefined;
  body?: unknown;
  signal?: AbortSignal | undefined;
  /** Force retry-safety. Defaults to true for GET/PUT/DELETE, false otherwise. */
  idempotent?: boolean | undefined;
  /**
   * Idempotency key forwarded as the `Idempotency-Key` header. Declaring it is
   * itself a retry-safety declaration: the server deduplicates replays, so a
   * request carrying one is retried even when its method is not idempotent.
   */
  idempotencyKey?: string | undefined;
  headers?: Record<string, string> | undefined;
  /** Per-request deadline in ms, overriding the client-level `timeoutMs`. */
  timeoutMs?: number | undefined;
}

export class HttpClient {
  private readonly transport: Transport;

  constructor(private readonly cfg: HttpClientConfig) {
    this.transport = new Transport(cfg);
  }

  get<T>(path: string, req: Omit<HttpRequest, 'method' | 'path' | 'body'> = {}): Promise<T> {
    return this.request<T>({ ...req, method: 'GET', path });
  }

  post<T>(path: string, body?: unknown, req: Omit<HttpRequest, 'method' | 'path' | 'body'> = {}): Promise<T> {
    return this.request<T>({ ...req, method: 'POST', path, body });
  }

  put<T>(path: string, body?: unknown, req: Omit<HttpRequest, 'method' | 'path' | 'body'> = {}): Promise<T> {
    return this.request<T>({ ...req, method: 'PUT', path, body });
  }

  patch<T>(
    path: string,
    body?: unknown,
    req: Omit<HttpRequest, 'method' | 'path' | 'body'> = {},
  ): Promise<T> {
    return this.request<T>({ ...req, method: 'PATCH', path, body });
  }

  delete<T>(path: string, req: Omit<HttpRequest, 'method' | 'path' | 'body'> = {}): Promise<T> {
    return this.request<T>({ ...req, method: 'DELETE', path });
  }

  async request<T>(req: HttpRequest): Promise<T> {
    const url = this.buildUrl(req.path, req.query);
    const headers = this.buildHeaders(req);
    const retryable = (req.idempotent ?? isIdempotentMethod(req.method)) || req.idempotencyKey !== undefined;

    const result = await this.transport.send({
      url,
      method: req.method,
      headers,
      body: req.body === undefined ? undefined : JSON.stringify(req.body),
      signal: req.signal,
      retryable,
      label: 'Request',
      timeoutMs: req.timeoutMs,
    });

    if (result.status >= 200 && result.status < 300) return result.body as T;
    throw mapHttpError(result.status, result.body, result.requestId, result.retryAfterMs);
  }

  private buildUrl(path: string, query?: HttpRequest['query']): string {
    const base = this.cfg.baseUrl.replace(/\/+$/, '');
    const url = new URL(`${base}${path.startsWith('/') ? path : `/${path}`}`);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
  }

  private buildHeaders(req: HttpRequest): Record<string, string> {
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.cfg.apiKey}`,
      [APP_ID_HEADER]: this.cfg.appId,
      accept: 'application/json',
      'user-agent': this.cfg.userAgent,
      ...req.headers,
    };
    if (req.body !== undefined) headers['content-type'] = 'application/json';
    if (req.idempotencyKey) headers['idempotency-key'] = req.idempotencyKey;
    return headers;
  }
}

function isIdempotentMethod(method: HttpMethod): boolean {
  return method === 'GET' || method === 'PUT' || method === 'DELETE';
}
