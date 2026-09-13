/**
 * Typed error hierarchy.
 *
 * Every failure surfaces as a {@link VinkiusError} subclass carrying `status`,
 * a stable `code`, and (when available) the server `requestId`. Secrets are
 * never placed on error objects — `details` only ever holds the parsed API body,
 * which by contract never echoes credentials.
 */

/** Stable, machine-readable error codes. */
export type VinkiusErrorCode =
  | 'config_error'
  | 'auth_error'
  | 'not_found'
  | 'validation_error'
  | 'rate_limit'
  | 'quota_exceeded'
  | 'overage_blocked'
  | 'connector_not_connected'
  | 'not_implemented'
  | 'connection_error'
  | 'protocol_error'
  | 'api_error';

export interface VinkiusErrorInit {
  code: VinkiusErrorCode;
  status?: number;
  requestId?: string | undefined;
  details?: unknown;
  cause?: unknown;
}

/** Base class for every error thrown by the SDK. */
export class VinkiusError extends Error {
  /** HTTP status (0 for client-side / transport errors). */
  readonly status: number;
  /** Stable machine-readable code. */
  readonly code: VinkiusErrorCode;
  /** Server-provided request id, when present. */
  readonly requestId: string | undefined;
  /** Parsed API response body (never contains secrets). */
  readonly details: unknown;

  constructor(message: string, init: VinkiusErrorInit) {
    super(message, init.cause !== undefined ? { cause: init.cause } : undefined);
    this.name = new.target.name;
    this.status = init.status ?? 0;
    this.code = init.code;
    this.requestId = init.requestId;
    this.details = init.details;
    // Restore prototype chain for reliable `instanceof` across transpilation.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

type SubInit = Omit<VinkiusErrorInit, 'code'>;

/** Invalid SDK configuration (bad key prefixes, missing fetch, etc.). */
export class ConfigError extends VinkiusError {
  constructor(message: string, init: SubInit = {}) {
    super(message, { ...init, code: 'config_error' });
  }
}

/** 401/403 — authentication or authorization failure. */
export class AuthError extends VinkiusError {
  constructor(message: string, init: SubInit = {}) {
    super(message, { ...init, code: 'auth_error' });
  }
}

/** 404 — resource not found (also returned for cross-tenant access). */
export class NotFoundError extends VinkiusError {
  constructor(message: string, init: SubInit = {}) {
    super(message, { ...init, code: 'not_found' });
  }
}

/** 422 — request validation failed. */
export class ValidationError extends VinkiusError {
  /** Field → messages, as returned by the API. */
  readonly errors: Record<string, string[]>;
  constructor(message: string, errors: Record<string, string[]>, init: SubInit = {}) {
    super(message, { ...init, code: 'validation_error' });
    this.errors = errors;
  }
}

/** 429 — control-plane rate limit. Retried automatically for idempotent calls. */
export class RateLimitError extends VinkiusError {
  /** Milliseconds to wait before retrying, if the server advertised it. */
  readonly retryAfterMs: number | undefined;
  constructor(message: string, init: SubInit & { retryAfterMs?: number } = {}) {
    const { retryAfterMs, ...rest } = init;
    super(message, { ...rest, code: 'rate_limit' });
    this.retryAfterMs = retryAfterMs;
  }
}

/** 429 (data-plane) — plan quota exhausted. */
export class QuotaError extends VinkiusError {
  readonly upgradeUrl: string | undefined;
  constructor(message: string, init: SubInit & { upgradeUrl?: string } = {}) {
    const { upgradeUrl, ...rest } = init;
    super(message, { ...rest, code: 'quota_exceeded' });
    this.upgradeUrl = upgradeUrl;
  }
}

/** 402 — overage blocked. */
export class OverageError extends VinkiusError {
  readonly upgradeUrl: string | undefined;
  constructor(message: string, init: SubInit & { upgradeUrl?: string } = {}) {
    const { upgradeUrl, ...rest } = init;
    super(message, { ...rest, code: 'overage_blocked' });
    this.upgradeUrl = upgradeUrl;
  }
}

/** Client-side — a connector slug is not connected for the user. */
export class ConnectorNotConnectedError extends VinkiusError {
  constructor(message: string, init: SubInit = {}) {
    super(message, { ...init, code: 'connector_not_connected' });
  }
}

/** A feature depends on an endpoint that is not yet available. */
export class NotImplementedError extends VinkiusError {
  constructor(message: string, init: SubInit = {}) {
    super(message, { ...init, code: 'not_implemented' });
  }
}

/** Network failure, timeout, or aborted request. */
export class ConnectionError extends VinkiusError {
  constructor(message: string, init: SubInit = {}) {
    super(message, { ...init, code: 'connection_error' });
  }
}

/** A successful HTTP response violated the documented API wire contract. */
export class ProtocolError extends VinkiusError {
  constructor(message: string, init: SubInit = {}) {
    super(message, { ...init, code: 'protocol_error' });
  }
}

// ── Mapping ───────────────────────────────────────────────────────────────

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
}

/** Extract a human message from an API body, honoring both `message` and `error`. */
function pickMessage(body: unknown, fallback: string): string {
  const b = asRecord(body);
  if (b) {
    if (typeof b['message'] === 'string' && b['message']) return b['message'];
    if (typeof b['error'] === 'string' && b['error']) return b['error'];
    if (Array.isArray(b['content'])) {
      for (const entry of b['content']) {
        const c = asRecord(entry);
        if (c && typeof c['text'] === 'string' && c['text']) return c['text'];
      }
    }
  }
  if (typeof body === 'string' && body) return body;
  return fallback;
}

/** Whether an API body is the MCP-shaped quota/overage envelope. */
function isMcpShaped(body: unknown): boolean {
  const b = asRecord(body);
  return !!b && (b['isError'] === true || typeof b['upgrade_url'] === 'string');
}

function pickUpgradeUrl(body: unknown): string | undefined {
  const b = asRecord(body);
  return b && typeof b['upgrade_url'] === 'string' ? b['upgrade_url'] : undefined;
}

function pickErrors(body: unknown): Record<string, string[]> {
  const b = asRecord(body);
  const errors = b?.['errors'];
  if (errors && typeof errors === 'object') return errors as Record<string, string[]>;
  return {};
}

/**
 * Map an HTTP error response to the appropriate {@link VinkiusError} subclass.
 */
export function mapHttpError(
  status: number,
  body: unknown,
  requestId: string | undefined,
  retryAfterMs?: number,
): VinkiusError {
  const base = { status, requestId, details: body } as const;
  const message = pickMessage(body, `Request failed with status ${status}`);

  switch (status) {
    case 401:
    case 403:
      return new AuthError(message, base);
    case 404:
      return new NotFoundError(message, base);
    case 422:
      return new ValidationError(message, pickErrors(body), base);
    case 402:
      return new OverageError(message, { ...base, upgradeUrl: pickUpgradeUrl(body) });
    case 429:
      return isMcpShaped(body)
        ? new QuotaError(message, { ...base, upgradeUrl: pickUpgradeUrl(body) })
        : new RateLimitError(message, { ...base, retryAfterMs });
    default:
      return new VinkiusError(message, { ...base, code: 'api_error' });
  }
}
