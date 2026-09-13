/**
 * LlamaIndex.TS adapter (`@vinkius/connect/llamaindex`).
 *
 * Builds LlamaIndex tools by injecting the framework's `tool` factory. LlamaIndex
 * accepts a raw JSON Schema for `parameters`, so no Zod is required — the adapter
 * stays dependency-free.
 *
 * @example
 * import { tool } from 'llamaindex';
 * const tools = toLlamaIndexTools(await user.capabilities(), { tool });
 * const myAgent = agent({ tools, llm });
 */
import type { Capability } from '../fluent/capability';
import type { JSONSchema } from '../types';
import { normalizeParams } from './shared';

/** LlamaIndex `tool(fn, config)` factory, injected by the caller. */
export type LlamaIndexToolFactory<T> = (
  fn: (input: Record<string, unknown>) => Promise<string>,
  config: { name: string; description: string; parameters: JSONSchema },
) => T;

export interface ToLlamaIndexOptions<T> {
  tool: LlamaIndexToolFactory<T>;
}

/** Convert Vinkius capabilities to LlamaIndex.TS tools using the injected `tool` factory. */
export function toLlamaIndexTools<T>(
  capabilities: readonly Capability[],
  opts: ToLlamaIndexOptions<T>,
): T[] {
  return capabilities.map((capability) =>
    opts.tool(
      async (input: Record<string, unknown>): Promise<string> => {
        const result = await capability.execute(input);
        return result.content.map((part) => part.text).join('\n');
      },
      {
        name: capability.name,
        description: capability.description,
        parameters: normalizeParams(capability.inputSchema),
      },
    ),
  );
}
