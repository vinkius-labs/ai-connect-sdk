import { readFileSync } from 'node:fs';
import { defineConfig } from 'tsup';

const { version } = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
) as { version: string };

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/adapters/openai.ts',
    'src/adapters/anthropic.ts',
    'src/adapters/ai-sdk.ts',
    'src/adapters/gemini.ts',
    'src/adapters/langchain.ts',
    'src/adapters/json-schema.ts',
    'src/adapters/openai-agents.ts',
    'src/adapters/llamaindex.ts',
    'src/adapters/workers-ai.ts',
  ],
  format: ['esm', 'cjs'],
  target: 'es2022',
  outDir: 'dist',
  dts: true,
  clean: true,
  sourcemap: true,
  treeshake: true,
  splitting: false,
  // Inject the package version so src/version.ts stays in sync automatically.
  define: { __SDK_VERSION__: JSON.stringify(version) },
});
