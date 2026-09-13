/**
 * LangChain.js adapter (`@vinkius/connect/langchain`).
 *
 * Builds LangChain **tools** (LangChain's term). Zero-dependency: instead of
 * importing `@langchain/core`, you inject LangChain's own `tool` factory so the
 * returned objects are genuine LangChain tools (bindable to a model). This
 * mirrors the `ai-sdk` adapter's injection pattern.
 *
 * @example
 * import { tool } from '@langchain/core/tools';
 * const tools = toLangChainTools(await user.capabilities(), { tool });
 * const model = chat.bindTools(tools);
 */
import type { Capability } from '../fluent/capability';
import type { JSONSchema } from '../types';
import { normalizeParams } from './shared';

/** LangChain's `tool` factory (`@langchain/core/tools`), injected by the caller. */
export type LangChainToolFactory<T> = (
  func: (input: Record<string, unknown>) => Promise<string>,
  config: { name: string; description: string; schema: JSONSchema },
) => T;

export interface ToLangChainOptions<T> {
  tool: LangChainToolFactory<T>;
}

/** Convert Vinkius capabilities to LangChain tools using the injected `tool` factory. */
export function toLangChainTools<T>(
  capabilities: readonly Capability[],
  opts: ToLangChainOptions<T>,
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
        schema: normalizeParams(capability.inputSchema),
      },
    ),
  );
}
