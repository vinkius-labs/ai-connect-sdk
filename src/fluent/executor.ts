/** Factory for a {@link CapabilityExecutor} bound to one connection's runtime. */
import type { RuntimeClient } from '../core/runtime';
import type { CapabilityExecutor } from './capability';

/**
 * Bind an executor to a connection's runtime client. Execution goes straight to
 * the MCP runtime (metered against the connection's `vk_live_*` token); the API
 * is never an execution surface.
 */
export function makeExecutor(runtime: RuntimeClient): CapabilityExecutor {
  return (rawName, args, opts) =>
    runtime.callTool(rawName, args, {
      signal: opts?.signal,
      idempotencyKey: opts?.idempotencyKey,
      timeoutMs: opts?.timeoutMs,
    });
}
