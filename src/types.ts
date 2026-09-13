/**
 * Public type contracts for @vinkius/connect.
 *
 * The SDK's domain vocabulary is: an application has end-users; each user has
 * **connectors** (integrations they connect, e.g. GitHub); a connected connector
 * is a **connection**; and the executable units the AI uses are **capabilities**.
 *
 * Raw resource shapes below mirror the API JSON (snake_case). The Vinkius data
 * plane is MCP-based internally, but that is an implementation detail of the
 * platform and never part of the SDK's vocabulary.
 */

/** ISO-8601 timestamp string. */
export type ISODate = string;

/** A JSON Schema object (loosely typed — capability input schemas vary). */
export type JSONSchema = Record<string, unknown>;

/** Optional per-request controls accepted by every SDK call. */
export interface RequestOptions {
  /** Abort the request (composed with the client's timeout). */
  signal?: AbortSignal;
  /**
   * Idempotency key forwarded as the `Idempotency-Key` header. Declaring it
   * makes the request retry-safe: transport-level retries are enabled even for
   * non-idempotent methods, and the server deduplicates replays.
   */
  idempotencyKey?: string;
  /**
   * Per-request deadline in milliseconds, overriding the client-level
   * `timeoutMs`. Covers both the connection wait and the body read, and is
   * composed with `signal`. Useful for long-running tool executions.
   */
  timeoutMs?: number;
}

/** Per-request controls for capability execution (adds idempotency). */
export interface ExecuteOptions extends RequestOptions {
  /**
   * Idempotency key so a retried execution (e.g. after a network timeout) does
   * not duplicate side effects. Forwarded as the `Idempotency-Key` header.
   */
  idempotencyKey?: string;
}

/**
 * Observability hooks. `headers` and `body` are ALWAYS redacted before being
 * handed to these callbacks — secrets never reach a hook. See core/redact.
 * `attempt` is the 0-based retry attempt that produced the event.
 */
export interface Hooks {
  onRequest?: (info: {
    method: string;
    url: string;
    headers: Record<string, string>;
    attempt?: number;
  }) => void;
  onResponse?: (info: {
    status: number;
    url: string;
    requestId?: string;
    body: unknown;
    attempt?: number;
  }) => void;
}

/** Options accepted by the {@link Vinkius} constructor. */
export interface VinkiusOptions {
  /** Public application id — the `vk_app_*` identifier (route key). */
  appId: string;
  /** Secret application key — the `vk_app_sk_*` credential (Bearer auth). */
  apiKey: string;
  /** API base URL. Defaults to the Vinkius Cloud production host. */
  baseUrl?: string;
  /** Per-request timeout in milliseconds. Default: 30000. */
  timeoutMs?: number;
  /** Max automatic retries for idempotent requests. Default: 2. */
  maxRetries?: number;
  /** Custom fetch implementation (for tests / non-standard runtimes). */
  fetch?: typeof globalThis.fetch;
  /** Extra token appended to the default User-Agent. */
  userAgent?: string;
  /** Observability hooks (redacted). */
  hooks?: Hooks;
  /**
   * Controls how a capability's display name is namespaced across connectors.
   * Default: `(connector, name) => `${connector}__${name}``.
   */
  namespaceCapability?: (connector: string, name: string) => string;
}

// ── API resources ─────────────────────────────────────────────────────────

/** An end-user of your application. `id` is the internal public id. */
export interface AppUser {
  id: string;
  external_id: string;
  status: string;
  metadata: Record<string, unknown> | null;
  application_id?: string;
  mcp_count?: number;
  created_at: ISODate;
  updated_at: ISODate;
}

/**
 * A connection — an established connector for a user (isolated per user).
 * `slug` is the connector's catalog identifier.
 */
export interface Connection {
  id: string;
  slug: string | null;
  name: string;
  description: string | null;
  status: string;
  /** Single source of truth for readiness (active + required credentials). */
  ready: boolean;
  tokens_count?: number;
  created_at: ISODate;
  /**
   * Fully-qualified runtime endpoint for this connection ({RUNTIME}/{token}/mcp).
   * Populated by connect() after a `vk_live_*` token is provisioned; the runtime
   * is the ONLY surface for tool listing/execution and every call to it is
   * metered and revocable (kill switch). Treat as a secret — the embedded token
   * authenticates the request. Present only when a token was minted this call.
   */
  runtime_url?: string | null;
}

/**
 * A provisioned data-plane access token for a connection. The plaintext token
 * and its runtime URL are returned ONLY at creation/rotation — never re-fetched.
 * Every tool call through {@link IssuedConnectionToken.mcp_url} is metered
 * against this token, which the user can disable or delete (kill switch).
 */
export interface IssuedConnectionToken {
  id: string;
  name: string;
  is_enabled: boolean;
  /** Plaintext `vk_live_*` — present only on the create/rotate response. */
  token?: string;
  /** Runtime endpoint embedding the token — present only on create/rotate. */
  mcp_url?: string;
  created_at: ISODate;
}

/** A connector available in the catalog. `id` equals `slug`. */
export interface CatalogConnector {
  id: string;
  slug: string;
  title: string;
  short_description: string | null;
  publisher_type: string;
  listing_type: string;
  requires_buyer_auth: boolean;
  server_type?: string;
  tools_count?: number;
}

/** Catalog detail — includes the credential schema. */
export interface CatalogConnectorDetail extends CatalogConnector {
  credential_schema: CredentialSchema;
}

/** Credential field types as described by a connector's `credential_schema`. */
export type CredentialType =
  | 'api_key'
  | 'token'
  | 'password'
  | 'connection_string'
  | 'string'
  | 'number'
  | 'email'
  | 'url'
  | 'select'
  | 'boolean'
  | 'oauth2';

/** A single credential field descriptor. */
export interface CredentialField {
  type: CredentialType;
  label?: string;
  required?: boolean;
  group?: string;
  docs_url?: string;
  placeholder?: string;
  allowed?: string[];
}

/** Map of credential KEY → descriptor. */
export type CredentialSchema = Record<string, CredentialField>;

/** Credential state — which keys are configured (never the values). */
export interface CredentialStatus {
  schema: CredentialSchema;
  configured: Record<string, boolean>;
}

/** Derived state of a connector for a user. */
export type ConnectorStatus = 'not_connected' | 'needs_credentials' | 'ready' | 'disabled';

/** Summary of a connected connector for a user. */
export interface ConnectorSummary {
  slug: string;
  status: ConnectorStatus;
  connectionId?: string;
}

/** Result of a capability execution. `isError` is a result, not a throw. */
export interface CapabilityResult {
  content: Array<{ type: string; text: string }>;
  isError: boolean;
  /**
   * Structured (parsed) output returned by the capability, when the connector
   * provides it. The MCP data plane carries `structuredContent` on tool results;
   * it is surfaced here verbatim (never parsed by the SDK) for callers who
   * prefer typed objects over the string `content`. Absent when unavailable.
   */
  structuredContent?: unknown;
}

/** Raw capability shape returned by the Execution Plane endpoints. */
export interface CapabilityData {
  name: string;
  title?: string | null;
  description?: string | null;
  input_schema?: JSONSchema | null;
  annotations?: unknown;
  /** Present only on the aggregated user-scoped endpoint. */
  connector?: string;
  /** Present only on the aggregated user-scoped endpoint. */
  connection_id?: string;
}

/** Filter for {@link CapabilitySet} aggregation. */
export interface CapabilityQuery extends RequestOptions {
  /** Restrict to these connector slugs (client-side filter before any call). */
  include?: string[];
  /** Exclude these connector slugs (client-side filter before any call). */
  exclude?: string[];
  /**
   * Observe partial fan-out failures. When a single connector's capability list
   * fails, the aggregation is failure-tolerant (the rest still resolves), but by
   * default the failure is swallowed. Provide this callback to be notified of the
   * slug and the thrown error for that connector.
   */
  onConnectorError?: (slug: string, error: unknown) => void;
}

// ── Pagination ──────────────────────────────────────────────────────────────

export interface PageMeta {
  current_page: number;
  from: number | null;
  last_page: number;
  path: string;
  per_page: number;
  to: number | null;
  total: number;
}

export interface PageLinks {
  first: string | null;
  last: string | null;
  prev: string | null;
  next: string | null;
}

/** A normalized list response. `meta`/`links` only present on page-based endpoints. */
export interface Paginated<T> {
  data: T[];
  meta?: PageMeta;
  links?: PageLinks;
}
