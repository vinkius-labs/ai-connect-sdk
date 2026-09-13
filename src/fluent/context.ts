/** Shared runtime context threaded through the fluent layer. */
import type { ResolverCache } from '../core/cache';
import type { HttpClient } from '../core/http';
import type { RuntimeClient } from '../core/runtime';

export interface SdkContext {
  readonly http: HttpClient;
  readonly appId: string;
  /**
   * Shared, process-scoped TTL cache for NON-SECRET, stable resolution data
   * (e.g. catalog credential schemas). Per the cache golden rule, secrets —
   * credentials and anything `vk_live_*` — must NEVER enter this cache.
   */
  readonly cache: ResolverCache;
  readonly namespace: (connector: string, name: string) => string;
  /**
   * Build a client for the MCP runtime — the ONLY surface for tool listing and
   * execution. Given a connection's `mcp_url` (which embeds its `vk_live_*`
   * token), returns a client that talks JSON-RPC directly to the runtime.
   */
  readonly runtime: (mcpUrl: string) => RuntimeClient;
}
