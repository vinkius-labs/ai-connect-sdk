/**
 * Google Gemini adapter (`@vinkius/connect/gemini`).
 *
 * Converts Vinkius capabilities into Gemini **function declarations** (Gemini's
 * own term). Zero-dependency: structural types compatible with the unified
 * Google GenAI SDK (`@google/genai`) — no import required.
 *
 * @example
 * const decls = toGeminiTools(await user.capabilities());
 * const response = await model.generateContent({
 *   contents,
 *   tools: [{ functionDeclarations: decls }],
 * });
 */
import type { Capability } from '../fluent/capability';
import type { CapabilityResult, ExecuteOptions, JSONSchema } from '../types';
import { findCapability, normalizeParams, validateToolName } from './shared';

export interface GeminiFunctionDeclaration {
  name: string;
  description: string;
  parameters: JSONSchema;
}

/** Subset of the Gemini `functionCall` part needed to dispatch execution. */
export interface GeminiFunctionCall {
  name: string;
  args?: Record<string, unknown>;
}

/**
 * Gemini function names must start with a letter/underscore and contain only
 * letters, numbers, and underscores (≤64 chars). HYPHENS ARE NOT ALLOWED — a
 * connector slug like `google-calendar` would make Gemini reject every call,
 * so this is validated up front instead of failing at call time.
 */
const GEMINI_NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const GEMINI_NAME_MAX = 64;

export function validateGeminiFunctionName(name: string): void {
  validateToolName(name, 'Gemini', GEMINI_NAME_RE, GEMINI_NAME_MAX);
}

/** Convert Vinkius capabilities to Gemini function declarations. */
export function toGeminiTools(capabilities: readonly Capability[]): GeminiFunctionDeclaration[] {
  return capabilities.map((capability) => {
    validateGeminiFunctionName(capability.name);
    return {
      name: capability.name,
      description: capability.description,
      parameters: normalizeParams(capability.inputSchema),
    };
  });
}

/** Execute the Vinkius capability named by a Gemini function call. */
export async function runGeminiFunctionCall(
  capabilities: readonly Capability[],
  call: GeminiFunctionCall,
  opts?: ExecuteOptions,
): Promise<CapabilityResult> {
  const capability = findCapability(capabilities, call.name);
  return capability.execute(call.args ?? {}, opts);
}
