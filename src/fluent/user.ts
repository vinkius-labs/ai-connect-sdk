/**
 * UserContext — a lazy handle to one end-user's connectors and capabilities.
 *
 * `vinkius.user("usr_123")` performs zero network calls and stores nothing but
 * the client's `external_id`. Every operation addresses the API by that
 * external_id directly — the SDK never resolves nor holds an internal user id.
 */
import { assertExternalId } from '../core/validate';
import { pooledMap } from '../core/pool';
import { AppUsersClient, type CreateAppUserInput } from '../resources/app-users';
import type { AppUser, CapabilityQuery, ConnectorSummary, RequestOptions } from '../types';
import { CapabilitySet } from './capability';
import { Connector } from './connector';
import type { SdkContext } from './context';
import { summarize } from './status';

export class UserContext {
  private readonly users: AppUsersClient;

  constructor(
    private readonly ctx: SdkContext,
    public readonly externalId: string,
  ) {
    assertExternalId(externalId);
    this.users = new AppUsersClient(ctx.http, ctx.appId);
  }

  /** Explicitly upsert the user (e.g. to attach metadata up front). Optional. */
  ensure(metadata?: Record<string, unknown>): Promise<AppUser> {
    const input: CreateAppUserInput = {
      external_id: this.externalId,
      ...(metadata ? { metadata } : {}),
    };
    return this.users.create(input);
  }

  /** Fetch the underlying user resource. */
  get(opts: RequestOptions = {}): Promise<AppUser> {
    return this.users.get(this.externalId, opts);
  }

  /** Lazy handle to one connector. */
  connector(slug: string): Connector {
    return new Connector(this.ctx, this, slug);
  }

  /** Connected connectors for this user, with derived status. */
  async connectors(opts: RequestOptions = {}): Promise<ConnectorSummary[]> {
    const connections = await this.users.connections(this.externalId).list(opts);
    return connections.map(summarize);
  }

  /**
   * Aggregated, executable capabilities across the user's ready connectors.
   *
   * Tools are listed and executed exclusively at the MCP runtime — the sole
   * metered, revocable surface. Because each connection is billed and
   * kill-switched independently by its own `vk_live_*` token, aggregation is a
   * fan-out over the connected connectors (each resolves its own runtime), not a
   * single API call. Only `ready` connectors are included; the rest cannot list
   * tools until connected/credentialed.
   *
   * The connection list is fetched ONCE and each connector handle reuses the
   * connection id already resolved by {@link summarize} — no per-connector
   * re-listing. For a single connector, prefer
   * `user.connector(slug).capabilities()` — it avoids listing every connection.
   */
  async capabilities(opts: CapabilityQuery = {}): Promise<CapabilitySet> {
    const include = opts.include && opts.include.length > 0 ? new Set(opts.include) : undefined;
    const exclude = opts.exclude && opts.exclude.length > 0 ? new Set(opts.exclude) : undefined;
    const reqOpts: RequestOptions = {};
    if (opts.signal) reqOpts.signal = opts.signal;
    if (opts.timeoutMs !== undefined) reqOpts.timeoutMs = opts.timeoutMs;

    const summaries = await this.connectors(reqOpts);
    const targets = summaries.filter(
      (s) => s.status === 'ready' && (!include || include.has(s.slug)) && (!exclude || !exclude.has(s.slug)),
    );

    // Failure-tolerant, concurrency-limited fan-out: one flaky runtime must not
    // sink the whole aggregation (all-failed still throws), and N connectors do
    // not open N simultaneous sockets.
    const MAX_FANOUT_CONCURRENCY = 8;
    let firstError: unknown;
    const settled = await pooledMap(
      targets,
      MAX_FANOUT_CONCURRENCY,
      async (s): Promise<CapabilitySet | null> => {
        try {
          return s.connectionId !== undefined
            ? await this.connector(s.slug).capabilitiesForConnection(s.connectionId, reqOpts)
            : await this.connector(s.slug).capabilities(reqOpts);
        } catch (error) {
          firstError ??= error; // isolated failure — never sinks the batch
          // Surface the partial failure to the caller if they asked to observe it.
          opts.onConnectorError?.(s.slug, error);
          return null;
        }
      },
    );

    const failures = settled.filter((set) => set === null).length;
    if (failures > 0 && failures === targets.length) {
      throw firstError;
    }

    const all = new CapabilitySet();
    for (const set of settled) {
      if (set !== null) all.push(...set);
    }
    return all;
  }
}
