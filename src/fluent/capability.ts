/**
 * Capability and CapabilitySet — the agent-facing units of a user's connectors.
 *
 * A {@link Capability} is executable and framework-neutral. {@link CapabilitySet}
 * is an Array subclass with ergonomic helpers (kept minimal to avoid surprising
 * Array-method overrides — hence `findCapability`, not `find`).
 */
import { ProtocolError } from '../core/errors';
import type { CapabilityData, CapabilityResult, ExecuteOptions, JSONSchema } from '../types';

/**
 * Executes a capability at the MCP runtime — the sole execution surface. The
 * runtime target (a connection's `mcp_url`, which embeds its `vk_live_*` token)
 * is bound into the executor when the capability is built, so this signature
 * carries no routing coordinates.
 */
export type CapabilityExecutor = (
  rawName: string,
  args: Record<string, unknown> | undefined,
  opts: ExecuteOptions | undefined,
) => Promise<CapabilityResult>;

interface CapabilityInit {
  connector: string;
  connectionId: string;
  name: string;
  rawName: string;
  title: string | null;
  description: string;
  inputSchema: JSONSchema;
}

export class Capability {
  /** Slug of the connector this capability belongs to. */
  readonly connector: string;
  /** Connection id used to route execution. */
  readonly connectionId: string;
  /** Display name, namespaced across connectors (e.g. `github__create_issue`). */
  readonly name: string;
  /** Raw name as the connector exposes it (e.g. `create_issue`). */
  readonly rawName: string;
  readonly title: string | null;
  readonly description: string;
  readonly inputSchema: JSONSchema;

  constructor(
    private readonly executor: CapabilityExecutor,
    init: CapabilityInit,
  ) {
    this.connector = init.connector;
    this.connectionId = init.connectionId;
    this.name = init.name;
    this.rawName = init.rawName;
    this.title = init.title;
    this.description = init.description;
    this.inputSchema = init.inputSchema;
  }

  /** Execute this capability at the runtime. `isError: true` results are returned, not thrown. */
  execute(args?: Record<string, unknown>, opts?: ExecuteOptions): Promise<CapabilityResult> {
    return this.executor(this.rawName, args, opts);
  }
}

export interface BuildCapabilityContext {
  connector: string;
  connectionId: string;
  namespace: (connector: string, name: string) => string;
  executor: CapabilityExecutor;
}

/** Build a {@link Capability} from a raw {@link CapabilityData} payload. */
export function buildCapability(data: CapabilityData, ctx: BuildCapabilityContext): Capability {
  const rawName = data?.name;
  if (typeof rawName !== 'string' || rawName.trim().length === 0) {
    throw new ProtocolError('Capability payload is missing a non-empty name.', { details: data });
  }
  if (!ctx.connector || !ctx.connectionId) {
    throw new ProtocolError('Capability payload is missing connector routing metadata.', {
      details: { connector: ctx.connector, connectionId: ctx.connectionId },
    });
  }
  return new Capability(ctx.executor, {
    connector: ctx.connector,
    connectionId: ctx.connectionId,
    name: ctx.namespace(ctx.connector, rawName),
    rawName,
    title: data.title ?? null,
    description: data.description ?? '',
    inputSchema: (data.input_schema ?? {}) as JSONSchema,
  });
}

export class CapabilitySet extends Array<Capability> {
  /** Build a CapabilitySet from an array (avoids the `new Array(number)` pitfall). */
  static fromCapabilities(capabilities: readonly Capability[]): CapabilitySet {
    const set = new CapabilitySet();
    set.push(...capabilities);
    return set;
  }

  /** Capabilities belonging to a specific connector slug. */
  forConnector(slug: string): CapabilitySet {
    return CapabilitySet.fromCapabilities(this.filter((capability) => capability.connector === slug));
  }

  /** Find a capability by display name or raw name. */
  findCapability(name: string): Capability | undefined {
    return this.find((capability) => capability.name === name || capability.rawName === name);
  }
}
