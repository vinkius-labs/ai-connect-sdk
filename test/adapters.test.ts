import { describe, expect, it } from 'vitest';
import { toAISDKTools } from '../src/adapters/ai-sdk';
import { toAnthropicTools } from '../src/adapters/anthropic';
import { runOpenAIToolCall, toOpenAITools } from '../src/adapters/openai';
import { runGeminiFunctionCall, toGeminiTools } from '../src/adapters/gemini';
import { toLangChainTools } from '../src/adapters/langchain';
import { executeByName, toJSONSchemaTools } from '../src/adapters/json-schema';
import { toOpenAIAgentsTools } from '../src/adapters/openai-agents';
import { toLlamaIndexTools } from '../src/adapters/llamaindex';
import { toWorkersAITools } from '../src/adapters/workers-ai';
import type { CapabilitySet } from '../src';
import type { JSONSchema } from '../src/types';
import { connection, makeVinkius, runtimeRoute, tokenRoute, type Route } from './helpers/mock-fetch';

const routes: Route[] = [
  {
    method: 'GET',
    path: /^\/apps\/vk_app_test\/users\/customer-123\/mcps$/,
    respond: () => ({ body: { data: [connection('conn_1', 'github', { ready: true })] } }),
  },
  tokenRoute('conn_1'),
  runtimeRoute(),
];

async function getCapabilities(): Promise<CapabilitySet> {
  const { vinkius } = makeVinkius(routes);
  return vinkius.user('customer-123').capabilities();
}

describe('framework adapters', () => {
  it('converts capabilities to the OpenAI tool format and dispatches execution', async () => {
    const capabilities = await getCapabilities();
    const openai = toOpenAITools(capabilities);
    expect(openai[0]).toMatchObject({
      type: 'function',
      function: { name: 'github__create_issue' },
    });
    const result = await runOpenAIToolCall(capabilities, {
      function: { name: 'github__create_issue', arguments: '{"title":"x"}' },
    });
    expect(result.isError).toBe(false);
  });

  it('converts capabilities to the Anthropic tool format', async () => {
    const capabilities = await getCapabilities();
    const anthropic = toAnthropicTools(capabilities);
    expect(anthropic[0]?.name).toBe('github__create_issue');
    expect(anthropic[0]?.input_schema).toBeTypeOf('object');
  });

  it('converts capabilities to an AI SDK tool map', async () => {
    const capabilities = await getCapabilities();
    const map = toAISDKTools(capabilities);
    expect(Object.keys(map)).toContain('github__create_issue');
    expect(map['github__create_issue']?.description).toBe('Create a GitHub issue');
  });

  it('converts capabilities to Gemini function declarations and dispatches a call', async () => {
    const capabilities = await getCapabilities();
    const decls = toGeminiTools(capabilities);
    expect(decls[0]).toMatchObject({
      name: 'github__create_issue',
      description: 'Create a GitHub issue',
    });
    expect(decls[0]?.parameters).toBeTypeOf('object');
    const result = await runGeminiFunctionCall(capabilities, {
      name: 'github__create_issue',
      args: { title: 'x' },
    });
    expect(result.isError).toBe(false);
  });

  it('builds LangChain tools via the injected tool factory and executes them', async () => {
    const capabilities = await getCapabilities();
    interface FakeTool {
      name: string;
      description: string;
      schema: JSONSchema;
      invoke: (input: Record<string, unknown>) => Promise<string>;
    }
    const fakeTool = (
      func: (input: Record<string, unknown>) => Promise<string>,
      config: { name: string; description: string; schema: JSONSchema },
    ): FakeTool => ({ ...config, invoke: func });

    const tools = toLangChainTools(capabilities, { tool: fakeTool });
    expect(tools[0]?.name).toBe('github__create_issue');
    expect(tools[0]?.schema).toBeTypeOf('object');
    const text = await tools[0]?.invoke({ title: 'x' });
    expect(text).toBe('done');
  });

  it('converts capabilities to neutral JSON Schema tools and executes by raw name', async () => {
    const capabilities = await getCapabilities();
    const tools = toJSONSchemaTools(capabilities);
    expect(tools[0]).toMatchObject({ name: 'github__create_issue' });
    expect(tools[0]?.parameters).toBeTypeOf('object');
    const result = await executeByName(capabilities, 'create_issue', { title: 'x' });
    expect(result.isError).toBe(false);
  });

  it('builds OpenAI Agents tools via the injected tool factory (raw JSON Schema, non-strict)', async () => {
    const capabilities = await getCapabilities();
    interface AgentTool {
      name: string;
      description: string;
      parameters: JSONSchema;
      strict: boolean;
      execute: (args: Record<string, unknown>) => Promise<string>;
    }
    const fakeTool = (config: AgentTool): AgentTool => config;
    const tools = toOpenAIAgentsTools(capabilities, { tool: fakeTool });
    expect(tools[0]?.name).toBe('github__create_issue');
    expect(tools[0]?.strict).toBe(false);
    const text = await tools[0]?.execute({ title: 'x' });
    expect(text).toBe('done');
  });

  it('builds LlamaIndex tools via the injected tool factory', async () => {
    const capabilities = await getCapabilities();
    interface LlamaTool {
      fn: (input: Record<string, unknown>) => Promise<string>;
      config: { name: string; description: string; parameters: JSONSchema };
    }
    const fakeTool = (
      fn: (input: Record<string, unknown>) => Promise<string>,
      config: { name: string; description: string; parameters: JSONSchema },
    ): LlamaTool => ({ fn, config });
    const tools = toLlamaIndexTools(capabilities, { tool: fakeTool });
    expect(tools[0]?.config.name).toBe('github__create_issue');
    const text = await tools[0]?.fn({ title: 'x' });
    expect(text).toBe('done');
  });

  it('converts capabilities to Workers AI embedded tools with a bound function', async () => {
    const capabilities = await getCapabilities();
    const tools = toWorkersAITools(capabilities);
    expect(tools[0]?.name).toBe('github__create_issue');
    expect(tools[0]?.parameters).toBeTypeOf('object');
    const text = await tools[0]?.function({ title: 'x' });
    expect(text).toBe('done');
  });
});
