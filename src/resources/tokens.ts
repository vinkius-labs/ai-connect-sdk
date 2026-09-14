/**
 * Connection tokens (low-level, 1:1 with the API).
 *
 *   POST /apps/{app}/users/{externalId}/mcps/{connection}/tokens  → IssuedConnectionToken
 *
 * A token is the `vk_live_*` data-plane credential bound to one connection. The
 * API returns its plaintext AND its runtime `mcp_url` ONLY on this create call —
 * they are never re-fetchable. Every tool call through the runtime is metered
 * against this token, and the user can disable/delete it (kill switch).
 *
 * The SDK provisions exactly one token per connection at connect() time and
 * remembers its runtime URL; it never silently re-mints on execution, so a
 * revoked token fails closed instead of quietly billing a fresh one.
 */
import type { HttpClient } from '../core/http';
import { unwrapItem } from '../core/pagination';
import { assertExternalId } from '../core/validate';
import type { IssuedConnectionToken, RequestOptions } from '../types';

export interface IssueTokenInput {
  /** Optional label for the token (shown in the dashboard). */
  name?: string;
}

export class ConnectionTokensClient {
  constructor(
    private readonly http: HttpClient,
    private readonly appId: string,
    private readonly externalId: string,
    private readonly connectionId: string,
  ) {
    assertExternalId(externalId);
  }

  private base(): string {
    const app = encodeURIComponent(this.appId);
    const user = encodeURIComponent(this.externalId);
    const connection = encodeURIComponent(this.connectionId);
    return `/apps/${app}/users/${user}/mcps/${connection}/tokens`;
  }

  /** Mint a data-plane token; the response carries the one-time plaintext + mcp_url. */
  async issue(input: IssueTokenInput = {}, opts: RequestOptions = {}): Promise<IssuedConnectionToken> {
    const body = await this.http.post<unknown>(
      this.base(),
      input.name !== undefined ? { name: input.name } : {},
      // Not retry-safe: each POST mints a distinct token. Never auto-retry.
      {
        idempotent: false,
        signal: opts.signal,
        idempotencyKey: opts.idempotencyKey,
        timeoutMs: opts.timeoutMs,
      },
    );
    return unwrapItem<IssuedConnectionToken>(body);
  }
}
