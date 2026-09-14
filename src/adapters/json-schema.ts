/**
 * Neutral JSON Schema adapter (`@vinkius/connect/json-schema`).
 *
 * The lowest common denominator: converts Vinkius capabilities into plain
 * function definitions `{ name, description, parameters }` (JSON Schema). Use it
 * with any OpenAI-compatible provider not listed here, or as the bridge for
 * environments outside this TS SDK (e.g. wrapping a capability as a CrewAI
 * `BaseTool` in Python, or feeding a custom agent loop).
 */
import type { Capability } from '../fluent/capability';
import type { CapabilityResult, ExecuteOptions, JSONSchema } from '../types';
import { findCapability, normalizeParams } from './shared';

export interface JSONSchemaTool {
  name: string;
  description: string;
  parameters: JSONSchema;
}

/** Convert Vinkius capabilities to neutral JSON Schema tool definitions. */
export function toJSONSchemaTools(capabilities: readonly Capability[]): JSONSchemaTool[] {
  return capabilities.map((capability) => ({
    name: capability.name,
    description: capability.description,
    parameters: normalizeParams(capability.inputSchema),
  }));
}

/** Execute a capability by (namespaced or raw) name — a generic dispatch helper. */
export async function executeByName(
  capabilities: readonly Capability[],
  name: string,
  args?: Record<string, unknown>,
  opts?: ExecuteOptions,
): Promise<CapabilityResult> {
  const capability = findCapability(capabilities, name);
  return capability.execute(args ?? {}, opts);
}
