/**
 * Minimal multi-user chatbot handler.
 *
 * Each user gets their own capabilities — the same code serves every user.
 * Run with: `tsx examples/chatbot.ts` (after `npm run build` or via ts loader).
 */
import { Vinkius } from '../src';

const vinkius = new Vinkius({
  appId: process.env.VINKIUS_APP_ID ?? 'vk_app_example',
  apiKey: process.env.VINKIUS_APP_KEY ?? 'vk_app_sk_example',
});

export async function handleChat(userId: string, message: string): Promise<void> {
  const user = vinkius.user(userId);

  // The capabilities this specific user has connected.
  const capabilities = await user.capabilities();

  // Hand `capabilities` to your agent/LLM framework. Here we just print them.
  // eslint-disable-next-line no-console
  console.log(`user=${userId} message=${message} capabilities=${capabilities.map((c) => c.name).join(', ')}`);
}
