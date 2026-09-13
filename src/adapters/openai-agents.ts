/**
 * OpenAI Agents SDK adapter (`@vinkius/connect/openai-agents`).
 *
 * Builds function tools for `@openai/agents` — distinct from the chat-completions
 * `@vinkius/connect/openai` adapter. Inject the SDK's own `tool` factory; the
 * capability's JSON Schema is passed as raw `parameters` with `strict: false`, so
 * the platform (not the model) owns input validation.
 *
 * @example
 * import { tool } from '@openai/agents';
 * const tools = toOpenAIAgentsTools(await user.capabilities(), { tool });
 * const agent = new Agent({ name: 'assistant', tools });
 */
import type { Capability } from '../fluent/capability';
import type { JSONSchema } from '../types';
import { normalizeParams } from './shared';

/** `@openai/agents` `tool` factory (object form), injected by the caller. */
export type OpenAIAgentsToolFactory<T> = (config: {
  name: string;
  description: string;
  parameters: JSONSchema;
  strict: boolean;
  execute: (args: Record<string, unknown>) => Promise<string>;
}) => T;

export interface ToOpenAIAgentsOptions<T> {
  tool: OpenAIAgentsToolFactory<T>;
}

/** Convert Vinkius capabilities to `@openai/agents` function tools. */
export function toOpenAIAgentsTools<T>(
  capabilities: readonly Capability[],
  opts: ToOpenAIAgentsOptions<T>,
): T[] {
  return capabilities.map((capability) =>
    opts.tool({
      name: capability.name,
      description: capability.description,
      parameters: normalizeParams(capability.inputSchema),
      // Raw JSON Schema: disable strict mode (connector schemas are not authored
      // to OpenAI's strict-mode constraints). Validation happens platform-side.
      strict: false,
      execute: async (args: Record<string, unknown>): Promise<string> => {
        const result = await capability.execute(args);
        return result.content.map((part) => part.text).join('\n');
      },
    }),
  );
}
