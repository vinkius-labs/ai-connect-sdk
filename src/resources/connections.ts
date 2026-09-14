/**
 * Connections for a user (low-level, 1:1 with the API).
 *
 * A connection is an established connector for a user. Creating one connects the
 * connector (get-or-create user + connection; idempotent per user+connector).
 *
 * The API transport path is `/apps/{app}/users/{externalId}/mcps` (the Vinkius
 * data plane is MCP-based internally); the SDK exposes it as "connections".
 */
import type { HttpClient } from '../core/http';
import { unwrapItem, unwrapList } from '../core/pagination';
import { assertExternalId } from '../core/validate';
import type { Connection, RequestOptions } from '../types';
import { CredentialsClient } from './credentials';
import { ConnectionTokensClient } from './tokens';

export interface CreateConnectionInput {
  /** Connector slug (or catalog id) to connect. */
  connector: string;
}

export class ConnectionsClient {
  constructor(
    private readonly http: HttpClient,
    private readonly appId: string,
    /** The client's external_id (addresses the user directly). */
    private readonly externalId: string,
  ) {
    assertExternalId(externalId);
  }

  private base(): string {
    return `/apps/${encodeURIComponent(this.appId)}/users/${encodeURIComponent(this.externalId)}/mcps`;
  }

  /** List the user's connections (not paginated; empty for an unknown user). */
  async list(opts: RequestOptions = {}): Promise<Connection[]> {
    const body = await this.http.get<unknown>(this.base(), {
      signal: opts.signal,
      idempotencyKey: opts.idempotencyKey,
      timeoutMs: opts.timeoutMs,
    });
    return unwrapList<Connection>(body);
  }

  /** Connect a catalog connector for the user (get-or-create; idempotent). */
  async create(input: CreateConnectionInput, opts: RequestOptions = {}): Promise<Connection> {
    const body = await this.http.post<unknown>(
      this.base(),
      { catalog_mcp_id: input.connector },
      {
        idempotent: true,
        signal: opts.signal,
        idempotencyKey: opts.idempotencyKey,
        timeoutMs: opts.timeoutMs,
      },
    );
    return unwrapItem<Connection>(body);
  }

  async get(connectionId: string, opts: RequestOptions = {}): Promise<Connection> {
    const body = await this.http.get<unknown>(`${this.base()}/${encodeURIComponent(connectionId)}`, {
      signal: opts.signal,
      idempotencyKey: opts.idempotencyKey,
      timeoutMs: opts.timeoutMs,
    });
    return unwrapItem<Connection>(body);
  }

  async delete(connectionId: string, opts: RequestOptions = {}): Promise<void> {
    await this.http.delete<unknown>(`${this.base()}/${encodeURIComponent(connectionId)}`, {
      signal: opts.signal,
      idempotencyKey: opts.idempotencyKey,
      timeoutMs: opts.timeoutMs,
    });
  }

  credentials(connectionId: string): CredentialsClient {
    return new CredentialsClient(this.http, this.appId, this.externalId, connectionId);
  }

  /** Data-plane token management for this connection (mints the vk_live_* + mcp_url). */
  tokens(connectionId: string): ConnectionTokensClient {
    return new ConnectionTokensClient(this.http, this.appId, this.externalId, connectionId);
  }
}
