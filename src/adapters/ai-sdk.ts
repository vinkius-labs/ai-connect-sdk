/**
 * Vercel AI SDK adapter (`@vinkius/connect/ai-sdk`).
 *
 * Converts Vinkius capabilities into the AI SDK's **tool** map (the AI SDK's own
 * term). Because the AI SDK expects `parameters` as a schema wrapper, pass its
 * `jsonSchema` helper via options to have it applied; otherwise the raw JSON
 * Schema is used.
 *
 * @example
 * import { jsonSchema } from 'ai';
 * const tools = toAISDKTools(await user.capabilities(), { jsonSchema });
 */
import type { Capability } from '../fluent/capability';
import type { CapabilityResult, JSONSchema } from '../types';
import { normalizeParams } from './shared';

export interface AISDKTool {
  description: string;
  parameters: unknown;
  execute: (args: Record<string, unknown>) => Promise<CapabilityResult>;
}

export interface ToAISDKOptions {
  /** The AI SDK `jsonSchema` helper, applied to each capability's parameters. */
  jsonSchema?: (schema: JSONSchema) => unknown;
}

/** Convert Vinkius capabilities to an AI SDK tool map keyed by display name. */
export function toAISDKTools(
  capabilities: readonly Capability[],
  opts: ToAISDKOptions = {},
): Record<string, AISDKTool> {
  const result: Record<string, AISDKTool> = {};
  for (const capability of capabilities) {
    const params = normalizeParams(capability.inputSchema);
    result[capability.name] = {
      description: capability.description,
      parameters: opts.jsonSchema ? opts.jsonSchema(params) : params,
      execute: (args: Record<string, unknown>): Promise<CapabilityResult> => capability.execute(args),
    };
  }
  return result;
}
