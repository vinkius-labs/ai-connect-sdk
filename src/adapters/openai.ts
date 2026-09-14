/**
 * OpenAI adapter (`@vinkius/connect/openai`).
 *
 * Converts Vinkius capabilities into OpenAI's chat-completions **tool** format
 * (that is OpenAI's own technical term for these). Zero-dependency: uses
 * structural types compatible with the OpenAI SDK — no import of `openai`.
 */
import type { Capability } from '../fluent/capability';
import type { CapabilityResult, ExecuteOptions, JSONSchema } from '../types';
import { findCapability, normalizeParams, parseArgs, validateToolName } from './shared';

export interface OpenAIFunctionTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: JSONSchema;
  };
}

/** Subset of the OpenAI tool-call shape needed to dispatch execution. */
export interface OpenAIToolCall {
  function: { name: string; arguments: string };
}

/**
 * OpenAI tool-function names must be 1–64 chars of `[a-zA-Z0-9_-]`. The SDK
 * namespaces capabilities as `connector__name`, which can violate this (too long,
 * or containing dots/spaces from a connector or capability name).
 */
const OPENAI_NAME_RE = /^[a-zA-Z0-9_-]+$/;
const OPENAI_NAME_MAX = 64;

export function validateOpenAIFunctionName(name: string): void {
  validateToolName(name, 'OpenAI', OPENAI_NAME_RE, OPENAI_NAME_MAX);
}

/** Convert Vinkius capabilities to OpenAI chat-completions `tools`. */
export function toOpenAITools(capabilities: readonly Capability[]): OpenAIFunctionTool[] {
  return capabilities.map((capability) => {
    validateOpenAIFunctionName(capability.name);
    return {
      type: 'function',
      function: {
        name: capability.name,
        description: capability.description,
        parameters: normalizeParams(capability.inputSchema),
      },
    };
  });
}

/** Execute the Vinkius capability named by an OpenAI tool call. */
export async function runOpenAIToolCall(
  capabilities: readonly Capability[],
  call: OpenAIToolCall,
  opts?: ExecuteOptions,
): Promise<CapabilityResult> {
  const capability = findCapability(capabilities, call.function.name);
  return capability.execute(parseArgs(call.function.arguments), opts);
}
