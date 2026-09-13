/**
 * Vinkius — the SDK root, scoped to a single application.
 *
 * Holds the only secret the integrator manages (`vk_app_sk_*`) and the public
 * app id (`vk_app_*`). Validates configuration eagerly and fails fast with a
 * clear {@link ConfigError}.
 */
import { ConfigError } from '../core/errors';
import { ResolverCache } from '../core/cache';
import { HttpClient } from '../core/http';
import { DEFAULT_RETRY } from '../core/retry';
import { RuntimeClient } from '../core/runtime';
import { AppUsersClient } from '../resources/app-users';
import { CatalogClient } from '../resources/catalog';
import type { VinkiusOptions } from '../types';
import { VERSION } from '../version';
import type { SdkContext } from './context';
import { UserContext } from './user';

const DEFAULT_BASE_URL = 'https://api.vinkius.com';
const DEFAULT_TIMEOUT_MS = 30_000;

export class Vinkius {
  private readonly ctx: SdkContext;

  /** Catalog discovery. */
  readonly catalog: CatalogClient;
  /** Low-level users client, scoped to this application. */
  readonly users: AppUsersClient;

  constructor(options: VinkiusOptions) {
    const appId = options.appId;
    const apiKey = options.apiKey;

    if (typeof appId !== 'string' || !appId.startsWith('vk_app_') || appId.startsWith('vk_app_sk_')) {
      throw new ConfigError('`appId` must be a public application id starting with "vk_app_" (not the secret key).');
    }
    if (typeof apiKey !== 'string' || !apiKey.startsWith('vk_app_sk_')) {
      throw new ConfigError('`apiKey` must be a secret application key starting with "vk_app_sk_".');
    }

    const fetchImpl = options.fetch ?? globalThis.fetch;
    if (typeof fetchImpl !== 'function') {
      throw new ConfigError('No global fetch found. Pass `fetch` in options or use Node >= 18.');
    }

    const baseUrl = normalizeBaseUrl(options.baseUrl ?? DEFAULT_BASE_URL);
    warnIfInsecure(baseUrl);

    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const retry = { ...DEFAULT_RETRY, maxRetries: options.maxRetries ?? DEFAULT_RETRY.maxRetries };
    const boundFetch = fetchImpl.bind(globalThis);
    const userAgent = buildUserAgent(options.userAgent);

    const http = new HttpClient({
      baseUrl,
      apiKey,
      appId,
      timeoutMs,
      retry,
      fetch: boundFetch,
      userAgent,
      hooks: options.hooks,
    });

    this.ctx = {
      http,
      appId,
      cache: new ResolverCache(),
      namespace: options.namespaceCapability ?? ((connector, name) => `${connector}__${name}`),
      // The runtime is the sole execution surface; its config mirrors the API
      // client's transport settings but carries no API auth (the mcp_url embeds
      // the vk_live_* token). Hooks apply to the data plane too — redacted.
      runtime: (mcpUrl: string) =>
        new RuntimeClient(mcpUrl, { timeoutMs, retry, fetch: boundFetch, userAgent, hooks: options.hooks }),
    };

    this.catalog = new CatalogClient(http);
    this.users = new AppUsersClient(http, appId);
  }

  /** A lazy, zero-request handle to one end-user's capabilities. */
  user(externalId: string): UserContext {
    if (typeof externalId !== 'string' || externalId.length === 0) {
      throw new ConfigError('`externalId` must be a non-empty string.');
    }
    if (externalId.startsWith('vk_app_user_')) {
      throw new ConfigError(
        '`externalId` must be YOUR user id (e.g. "alice_123"), not a Vinkius internal id. ' +
          'The SDK resolves identifiers automatically from the external_id you provide.',
      );
    }
    return new UserContext(this.ctx, externalId);
  }
}

function normalizeBaseUrl(url: string): string {
  try {
    return new URL(url).toString().replace(/\/+$/, '');
  } catch {
    throw new ConfigError(`Invalid baseUrl: ${url}`);
  }
}

function warnIfInsecure(baseUrl: string): void {
  try {
    const parsed = new URL(baseUrl);
    const host = parsed.hostname;
    const isLocal =
      host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host.endsWith('.localhost');
    if (parsed.protocol === 'http:' && !isLocal && typeof console !== 'undefined') {
      console.warn('[vinkius] baseUrl uses insecure http:// on a non-local host; use https:// in production.');
    }
  } catch {
    /* already validated */
  }
}

function buildUserAgent(extra?: string): string {
  const runtime =
    typeof process !== 'undefined' && process.version ? ` node/${process.version}` : '';
  const base = `vinkius-connect/${VERSION}${runtime}`;
  return extra ? `${base} ${extra}` : base;
}
