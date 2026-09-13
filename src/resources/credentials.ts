/**
 * Connection credentials (low-level, 1:1 with the API).
 *
 *   GET /apps/{app}/users/{externalId}/mcps/{connection}/credentials  → CredentialStatus
 *   PUT  (same)  body { credentials: { KEY: value } }                 → CredentialStatus
 *
 * Values are write-only: the API never returns them, only which keys are set.
 * NOTE the low-level `set` takes the raw HTTP envelope `{ credentials: {...} }`;
 * the high-level {@link CredentialsHandle} accepts the flat map instead.
 */
import type { HttpClient } from '../core/http';
import { assertExternalId } from '../core/validate';
import type { CredentialStatus, RequestOptions } from '../types';

export interface SetCredentialsInput {
  credentials: Record<string, string>;
}

export class CredentialsClient {
  constructor(
    private readonly http: HttpClient,
    private readonly appId: string,
    /** The client's external_id (addresses the user directly). */
    private readonly externalId: string,
    private readonly connectionId: string,
  ) {
    assertExternalId(externalId);
  }

  private base(): string {
    const app = encodeURIComponent(this.appId);
    const user = encodeURIComponent(this.externalId);
    const connection = encodeURIComponent(this.connectionId);
    return `/apps/${app}/users/${user}/mcps/${connection}/credentials`;
  }

  /** Which credential keys are configured (never the values). */
  status(opts: RequestOptions = {}): Promise<CredentialStatus> {
    return this.http.get<CredentialStatus>(this.base(), { signal: opts.signal, idempotencyKey: opts.idempotencyKey, timeoutMs: opts.timeoutMs });
  }

  /** Store credentials, validated server-side against the connector schema. */
  set(input: SetCredentialsInput, opts: RequestOptions = {}): Promise<CredentialStatus> {
    return this.http.put<CredentialStatus>(this.base(), input, { signal: opts.signal, idempotencyKey: opts.idempotencyKey, timeoutMs: opts.timeoutMs });
  }
}
