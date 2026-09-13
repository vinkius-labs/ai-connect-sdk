/**
 * Cloudflare Workers AI adapter (`@vinkius/connect/workers-ai`).
 *
 * Produces embedded function-calling tools for `runWithTools` (from
 * `@cloudflare/ai-utils`): each tool carries a bound `function` that executes the
 * Vinkius capability. Zero-dependency — plain objects, no injection.
 *
 * @example
 * import { runWithTools } from '@cloudflare/ai-utils';
 * const tools = toWorkersAITools(await user.capabilities());
 * const res = await runWithTools(
 *   env.AI,
 *   '@hf/nousresearch/hermes-2-pro-mistral-7b',
 *   { messages, tools },
 * );
 */
import type { Capability } from '../fluent/capability';
import type { JSONSchema } from '../types';
import { normalizeParams } from './shared';

/** Embedded tool shape accepted by `runWithTools` (`AiTextGenerationToolInputWithFunction`). */
export interface WorkersAITool {
  name: string;
  description: string;
  parameters: JSONSchema;
  function: (args: Record<string, unknown>) => Promise<string>;
}

/** Convert Vinkius capabilities to Workers AI embedded function-calling tools. */
export function toWorkersAITools(capabilities: readonly Capability[]): WorkersAITool[] {
  return capabilities.map((capability) => ({
    name: capability.name,
    description: capability.description,
    parameters: normalizeParams(capability.inputSchema),
    function: async (args: Record<string, unknown>): Promise<string> => {
      const result = await capability.execute(args);
      return result.content.map((part) => part.text).join('\n');
    },
  }));
}
