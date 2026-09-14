/** Shared helpers for framework adapters. */
import { ConfigError, NotFoundError } from '../core/errors';
import type { Capability } from '../fluent/capability';
import type { JSONSchema } from '../types';

/** Ensure a usable JSON Schema object for function/tool parameters. */
export function normalizeParams(schema: JSONSchema): JSONSchema {
  if (schema && typeof schema === 'object' && Object.keys(schema).length > 0) return schema;
  return { type: 'object', properties: {} };
}

/**
 * Parse a JSON arguments string into an object, tolerating malformed input:
 * the platform validates tool input, so an unparsable payload executes as an
 * empty argument set and surfaces as an `isError` tool result the model can
 * recover from — rather than throwing mid agent-loop.
 */
export function parseArgs(raw: string): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Find a capability by display name or raw name, throwing a typed error when absent. */
export function findCapability(capabilities: readonly Capability[], name: string): Capability {
  const capability = capabilities.find((candidate) => candidate.name === name || candidate.rawName === name);
  if (!capability) throw new NotFoundError(`Unknown capability: ${name}`);
  return capability;
}

/**
 * Guard against tool names a platform would reject (length/charset), throwing a
 * clear ConfigError up front instead of a cryptic platform 400 at call time.
 */
export function validateToolName(name: string, platform: string, pattern: RegExp, maxLength: number): void {
  if (name.length > maxLength || !pattern.test(name)) {
    throw new ConfigError(
      `Capability "${name}" cannot be exposed as a ${platform} tool name: it must be ` +
        `${maxLength} char(s) or fewer and match ${String(pattern)} (got ${name.length} char(s)). ` +
        'Override VinkiusOptions.namespaceCapability to produce platform-compatible names.',
    );
  }
}
