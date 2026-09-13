<div align="center">

# @vinkius/connect

### Give your AI application real-world capabilities.

[![npm](https://img.shields.io/npm/v/@vinkius/connect.svg?color=cb3837&logo=npm)](https://www.npmjs.com/package/@vinkius/connect)
[![Connectors](https://api.vinkius.com/badges/connectors.svg)](https://vinkius.com)
[![AI Capabilities](https://api.vinkius.com/badges/capabilities.svg)](https://vinkius.com)

</div>

**Vinkius Connect** gives the AI application you're building access to thousands of
tools, services, and systems — so your AI can take action for each user.

Your application identifies the user. Vinkius handles the connectivity,
authentication, permissions, protocols, and execution behind the capabilities
that user has connected.

```
Your AI Application
        │
        ▼
      User
        │
        ▼
   Connectors
        │
        ▼
   Capabilities
        │
        ▼
      Action
```

### Connectors provide access. Capabilities provide action.

A connector connects your user to an external system. A capability is what your AI
can actually do with it.

```
GitHub connector
       │
       ├── list repositories
       ├── create issue
       ├── create pull request
       ├── review code
       └── search code
```

```ts
const capabilities = await vinkius.user('alice_123').capabilities();
// → the capabilities available to this user
```

Built on the [Vinkius AI Connectivity Cloud](https://vinkius.com) — one managed
connectivity layer that works with OpenAI, Anthropic, Gemini, the Vercel AI SDK,
LangChain, LlamaIndex, Cloudflare Workers AI, and any OpenAI-compatible runtime.

- **Capabilities, not integrations.** Your agent calls capabilities. Vinkius turns
  calls into action — authentication, permissions, protocol and execution are
  resolved for you.
- **Connectors power capabilities.** A connector can provide many capabilities.
  Vinkius maintains the connectors and the capabilities your agents use through them.
- **User-scoped.** Each user has their own connected connectors and capabilities,
  isolated from every other user.
- **Portable.** Switch models, clients or frameworks without rebuilding your
  connectivity. Your capabilities stay yours.
- **Zero runtime dependencies.** Runs on Node 18+, Bun, Deno, and edge runtimes.
- **Security-first.** One secret to manage. Credentials are write-only. Every
  request carries identity. See [SECURITY.md](./SECURITY.md).

## Contents

- [Get your API credentials](#get-your-api-credentials)
- [Install](#install)
- [Quick start](#quick-start)
- [Concepts](#concepts)
- [Connect a connector](#connect-a-connector)
- [Execute a capability](#execute-a-capability)
- [Framework adapters](#framework-adapters)
- [Low-level API](#low-level-api)
- [Configuration](#configuration)
- [Errors](#errors)
- [Security](#security)
- [Compatibility](#compatibility)
- [License](#license)

## Get your API credentials

Vinkius Connect authenticates with two values from a Vinkius Cloud **Application**:

| Value    | Prefix        | What it is                                                                 |
| -------- | ------------- | -------------------------------------------------------------------------- |
| `appId`  | `vk_app_…`    | The Application's public id — identifies your tenant                       |
| `apiKey` | `vk_app_sk_…` | An **Application Key** — the secret your backend uses to act for its users |

To create them in the [Vinkius Cloud](https://cloud.vinkius.com) dashboard:

1. Open **Build AI Apps** (`/ai-agents`) and click **New AI Application**. Give it a
   name (e.g. `Acme Copilot`) and create it.
2. Open the application. Your **App ID** (`vk_app_…`) is shown under the app name and
   in the page URL — copy it into `appId`.
3. Go to the **App Keys** tab → **New Key**. Select the permissions your backend
   needs, then **Create Key**.
4. The **Application Key** (`vk_app_sk_…`) is shown **once**, in a _"Copy this key
   now"_ dialog. Copy it into `apiKey` — it cannot be retrieved afterward.

You can **rotate** or **revoke** a key anytime from the same **App Keys** tab.
Rotating invalidates the old key immediately and reveals the new one once.

> **Keep `vk_app_sk_…` server-side only** — an environment variable or your secrets
> manager. Never ship it to a browser, mobile app, or any client the user controls.

```bash
# .env  (server-side)
VINKIUS_APP_ID=vk_app_xxxxxxxxxxxxxxxx
VINKIUS_APP_KEY=vk_app_sk_xxxxxxxxxxxxxxxxxxxxxxxx
```

## Install

```bash
npm install @vinkius/connect
# or: pnpm add @vinkius/connect · yarn add @vinkius/connect · bun add @vinkius/connect
```

## Quick start

Give your agent the capabilities a specific user has connected — one line:

```ts
import { Vinkius } from '@vinkius/connect';

const vinkius = new Vinkius({
  appId: process.env.VINKIUS_APP_ID!,
  apiKey: process.env.VINKIUS_APP_KEY!,
});

// The AI capabilities this user's connectors provide
const capabilities = await vinkius.user('alice_123').capabilities();
```

End-to-end with OpenAI — three imports, and the model can call your user's real
capabilities:

```ts
import OpenAI from 'openai';
import { Vinkius } from '@vinkius/connect';
import { toOpenAITools, runOpenAIToolCall } from '@vinkius/connect/openai';

const openai = new OpenAI();
const vinkius = new Vinkius({
  appId: process.env.VINKIUS_APP_ID!,
  apiKey: process.env.VINKIUS_APP_KEY!,
});

const capabilities = await vinkius.user('alice_123').capabilities();

const completion = await openai.chat.completions.create({
  model: 'your-model',
  messages: [{ role: 'user', content: 'Open a GitHub issue titled "Ship it"' }],
  tools: toOpenAITools(capabilities),
});

const call = completion.choices[0]?.message.tool_calls?.[0];
if (call) {
  const result = await runOpenAIToolCall(capabilities, call);
  console.log(result.content);
}
```

No per-connector glue, no OAuth plumbing, no storing tokens. The user connects
GitHub once in your app; every agent turn just works.

## Concepts

The SDK is split into two planes over the same `vk_app_sk_*` credential:

- **Control plane** — provisioning and state: `users`, `connectors`, `credentials`,
  `catalog`.
- **Execution plane** — runtime: `capabilities()` and `execute()`.

`user.capabilities()` is the primary contract: it returns the AI capabilities
available to **that user**, as executable, framework-neutral objects. A connector is
not a capability — a single connector can provide many capabilities.

```ts
const user = vinkius.user('alice_123');

await user.connectors(); // connected connectors + status
await user.capabilities(); // all capabilities for this user
await user.capabilities({ include: ['github', 'slack'] }); // subset
```

Users are addressed by **your own `external_id`** (`"alice_123"`), which comes from
your auth system. There is no Vinkius user id to resolve, cache, or store — the
platform derives everything from your Application credentials plus the id you pass.

## Connect a connector

```ts
const github = vinkius.user('alice_123').connector('github');

await github.connect(); // provision the connection (idempotent)
await github.credentials.set({ GITHUB_TOKEN: token }); // write-only
console.log(await github.status()); // not_connected | needs_credentials | ready | disabled

await github.capabilities(); // capabilities this connector provides
await github.disconnect();
```

Credentials are **write-only**: you can set them and check which keys are configured,
but the SDK never returns secret values.

```ts
await github.credentials.schema(); // fields this connector requires
await github.credentials.status(); // which keys are configured (never the values)
```

## Execute a capability

```ts
const capabilities = await vinkius.user('alice_123').capabilities();

const result = await capabilities
  .findCapability('github__create_issue')
  ?.execute({ owner: 'acme', repo: 'product', title: 'Hello Vinkius' });

// result → { content: [{ type, text }], isError }
```

Your agent calls the capability. Vinkius resolves authentication, permissions,
protocol and execution, then returns a structured result. A capability-level failure
comes back as `isError: true` — a result, not a thrown exception — so your agent
loop can feed the error back to the model and let it recover.

## Framework adapters

Adapters are zero-dependency subpath exports that convert capabilities into your
framework's **tool** format (each framework's own term). Where a framework needs one
of its own factories, you inject it — no peer dependency, no version coupling.

| Framework                        | Import                           | Notes                                    |
| -------------------------------- | -------------------------------- | ---------------------------------------- |
| OpenAI (chat completions)        | `@vinkius/connect/openai`        | `toOpenAITools`, `runOpenAIToolCall`     |
| OpenAI Agents (`@openai/agents`) | `@vinkius/connect/openai-agents` | `toOpenAIAgentsTools` (inject `tool`)    |
| Anthropic (Messages)             | `@vinkius/connect/anthropic`     | `toAnthropicTools`, `runAnthropicToolUse` |
| Google Gemini                    | `@vinkius/connect/gemini`        | `toGeminiTools`, `runGeminiFunctionCall` |
| Vercel AI SDK                    | `@vinkius/connect/ai-sdk`        | `toAISDKTools` (inject `jsonSchema`)     |
| LangChain.js                     | `@vinkius/connect/langchain`     | `toLangChainTools` (inject `tool`)       |
| LlamaIndex.TS                    | `@vinkius/connect/llamaindex`    | `toLlamaIndexTools` (inject `tool`)      |
| Cloudflare Workers AI            | `@vinkius/connect/workers-ai`    | `toWorkersAITools` (for `runWithTools`)  |
| Any / neutral                    | `@vinkius/connect/json-schema`   | `toJSONSchemaTools`, `executeByName`     |

### OpenAI (chat completions)

```ts
import { toOpenAITools, runOpenAIToolCall } from '@vinkius/connect/openai';

const capabilities = await vinkius.user('alice_123').capabilities();
const tools = toOpenAITools(capabilities);
// … then runOpenAIToolCall(capabilities, toolCall) on each returned tool call.
```

### Anthropic (Messages)

```ts
import { toAnthropicTools } from '@vinkius/connect/anthropic';

const capabilities = await vinkius.user('alice_123').capabilities();
const tools = toAnthropicTools(capabilities); // pass as `tools` to messages.create
```

### Google Gemini

Produces function declarations for the unified Google GenAI SDK (`@google/genai`).

```ts
import { toGeminiTools, runGeminiFunctionCall } from '@vinkius/connect/gemini';

const capabilities = await vinkius.user('alice_123').capabilities();
const response = await model.generateContent({
  contents,
  tools: [{ functionDeclarations: toGeminiTools(capabilities) }],
});

// on a returned functionCall part:
const result = await runGeminiFunctionCall(capabilities, functionCall);
```

### Vercel AI SDK

Pass the AI SDK's own `jsonSchema` helper so parameters are wrapped correctly.

```ts
import { jsonSchema } from 'ai';
import { toAISDKTools } from '@vinkius/connect/ai-sdk';

const capabilities = await vinkius.user('alice_123').capabilities();
const tools = toAISDKTools(capabilities, { jsonSchema });
```

### LangChain.js

Inject LangChain's own `tool` factory so the returned objects are genuine, bindable
LangChain tools — the adapter keeps zero dependencies.

```ts
import { tool } from '@langchain/core/tools';
import { toLangChainTools } from '@vinkius/connect/langchain';

const capabilities = await vinkius.user('alice_123').capabilities();
const tools = toLangChainTools(capabilities, { tool });
const model = chat.bindTools(tools);
```

### OpenAI Agents (`@openai/agents`)

Distinct from the chat-completions adapter. Inject the Agents SDK's `tool` factory;
the JSON Schema is passed as raw `parameters` with `strict: false`.

```ts
import { Agent, tool } from '@openai/agents';
import { toOpenAIAgentsTools } from '@vinkius/connect/openai-agents';

const capabilities = await vinkius.user('alice_123').capabilities();
const agent = new Agent({
  name: 'assistant',
  tools: toOpenAIAgentsTools(capabilities, { tool }),
});
```

### LlamaIndex.TS

Inject LlamaIndex's `tool` factory. Accepts raw JSON Schema — no Zod required.

```ts
import { tool } from 'llamaindex';
import { toLlamaIndexTools } from '@vinkius/connect/llamaindex';

const capabilities = await vinkius.user('alice_123').capabilities();
const tools = toLlamaIndexTools(capabilities, { tool });
```

### Cloudflare Workers AI

`toWorkersAITools` produces embedded function-calling tools (each with a bound
`function`) for `runWithTools` from `@cloudflare/ai-utils`.

```ts
import { runWithTools } from '@cloudflare/ai-utils';
import { toWorkersAITools } from '@vinkius/connect/workers-ai';

const capabilities = await vinkius.user('alice_123').capabilities();
const res = await runWithTools(env.AI, 'your-model', {
  messages,
  tools: toWorkersAITools(capabilities),
});
```

### Neutral / other frameworks

`toJSONSchemaTools` emits plain `{ name, description, parameters }` definitions — the
lowest common denominator for any OpenAI-compatible provider or custom agent loop,
with `executeByName` to dispatch.

A few frameworks are intentionally covered by the adapters above rather than their
own subpath:

- **Mastra** — consumes Vercel AI SDK tools natively; use the `ai-sdk` adapter.
- **Claude Agent SDK** (`@anthropic-ai/claude-agent-sdk`) — requires a Zod schema
  and in-process MCP registration. Use the Messages-API `anthropic` adapter.
- **CrewAI** — a Python framework. Use the neutral JSON Schema output as the bridge
  until a Vinkius Python SDK exists.

## Low-level API

Every fluent call has a REST equivalent for full control:

```ts
const connection = await vinkius.users.connections('alice_123').create({ connector: 'github' });

await vinkius.users
  .connections('alice_123')
  .credentials(connection.id)
  .set({ credentials: { GITHUB_TOKEN: '…' } });
```

The fluent `credentials.set(values)` takes the flat map; the low-level client takes
the HTTP envelope `{ credentials: values }`.

## Configuration

```ts
new Vinkius({
  appId: 'vk_app_…',
  apiKey: 'vk_app_sk_…',
  baseUrl: 'https://api.vinkius.com', // default
  timeoutMs: 30_000, // default
  maxRetries: 2, // default (idempotent requests only)
  fetch: globalThis.fetch, // override for tests/edge
  userAgent: 'acme-ai/1.0', // appended to the default User-Agent
  namespaceCapability: (connector, name) => `${connector}__${name}`, // default
  hooks: {
    onRequest: ({ method, url }) => {}, // headers/body are redacted
    onResponse: ({ status, requestId }) => {},
  },
});
```

## Errors

All failures are subclasses of `VinkiusError` with `status`, `code`, and `requestId`:

`AuthError` · `NotFoundError` · `ValidationError` · `RateLimitError` · `QuotaError` ·
`OverageError` · `ConnectorNotConnectedError` · `ConnectionError` · `ConfigError` ·
`NotImplementedError`.

Capability execution returns `{ content, isError }` — an `isError: true` result is
returned, not thrown. Quota/overage limits surface as `QuotaError`/`OverageError`.

## Security

- **One secret to manage.** Only `vk_app_sk_*` is sensitive; keep it server-side.
- **Identity on every request.** Each call carries your `vk_app_*` app id and is
  validated against the key server-side — a key can only ever act for its own app.
- **Write-only credentials.** Connector secrets can be set but never read back.
  The model never receives raw secrets.
- **Redaction by design.** Authorization headers and secret values are stripped
  before any observability hook sees them.

Full details and disclosure policy in [SECURITY.md](./SECURITY.md).

## Compatibility

- **Runtimes:** Node 18+, Bun, Deno, and edge runtimes (anything with `fetch`).
- **Modules:** ships dual ESM + CommonJS with bundled TypeScript types.
- Discovery and provisioning (`users`, `connectors`, `credentials`, `catalog`) are
  available today. `user.capabilities()` and `capability.execute()` run on the
  Vinkius Execution Plane; make sure your Vinkius Cloud environment has it enabled.

## License

[Apache 2.0](./LICENSE) © Vinkius