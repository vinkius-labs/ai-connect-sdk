/**
 * CredentialsHandle — high-level credential management for one connection.
 *
 * Operates on an EXISTING connection (it never connects implicitly). The flat
 * `set(values)` map is wrapped into the HTTP `{ credentials: values }` envelope
 * so the wire shape never leaks into the SDK surface.
 */
import { CatalogClient } from '../resources/catalog';
import { CredentialsClient } from '../resources/credentials';
import type { CredentialSchema, CredentialStatus, RequestOptions } from '../types';
import type { Connector } from './connector';
import type { SdkContext } from './context';
import type { UserContext } from './user';

export class CredentialsHandle {
  constructor(
    private readonly ctx: SdkContext,
    private readonly user: UserContext,
    private readonly connector: Connector,
  ) {}

  /**
   * The credential schema this connector requires (from the catalog).
   * Cached (non-secret, stable data — per the cache golden rule, no credential
   * VALUES ever pass through here, only field descriptors).
   */
  async schema(opts: RequestOptions = {}): Promise<CredentialSchema> {
    return this.ctx.cache.resolve(`credential-schema:${this.connector.slug}`, async () => {
      const detail = await new CatalogClient(this.ctx.http).get(this.connector.slug, opts);
      return detail.credential_schema;
    });
  }

  /** Which credential keys are configured (never the values). */
  async status(opts: RequestOptions = {}): Promise<CredentialStatus> {
    const connectionId = await this.connector.resolveConnectionId(opts);
    return this.client(connectionId).status(opts);
  }

  /** Store credentials (validated server-side against the schema). */
  async set(values: Record<string, string>, opts: RequestOptions = {}): Promise<CredentialStatus> {
    const connectionId = await this.connector.resolveConnectionId(opts);
    return this.client(connectionId).set({ credentials: values }, opts);
  }

  private client(connectionId: string): CredentialsClient {
    return new CredentialsClient(this.ctx.http, this.ctx.appId, this.user.externalId, connectionId);
  }
}
