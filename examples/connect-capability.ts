/**
 * "Connect your GitHub" flow: connect the connector → set credentials → check readiness.
 */
import { Vinkius } from '../src';

const vinkius = new Vinkius({
  appId: process.env.VINKIUS_APP_ID ?? 'vk_app_example',
  apiKey: process.env.VINKIUS_APP_KEY ?? 'vk_app_sk_example',
});

export async function connectGithub(userId: string, githubToken: string): Promise<void> {
  const github = vinkius.user(userId).connector('github');

  await github.connect();
  const schema = await github.credentials.schema();
  await github.credentials.set({ GITHUB_TOKEN: githubToken });

  const status = await github.status();
  // eslint-disable-next-line no-console
  console.log(`github status=${status} requires=${Object.keys(schema).join(',')}`);
}
