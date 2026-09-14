import { describe, expect, it } from 'vitest';
import { connection, makeVinkius, type Route } from './helpers/mock-fetch';

const listRoute: Route = {
  method: 'GET',
  path: /^\/apps\/vk_app_test\/users\/customer-123\/mcps$/,
  respond: () => ({ body: { data: [connection('conn_1', 'github')] } }),
};

describe('CredentialsHandle', () => {
  const catalogRoute: Route = {
    method: 'GET',
    path: /^\/catalog\/mcps\/github$/,
    respond: () => ({
      body: {
        data: {
          id: 'github',
          slug: 'github',
          credential_schema: { GITHUB_TOKEN: { type: 'api_key', required: true } },
        },
      },
    }),
  };

  it('reads the schema from the catalog', async () => {
    const { vinkius } = makeVinkius([catalogRoute]);
    const schema = await vinkius.user('customer-123').connector('github').credentials.schema();
    expect(schema['GITHUB_TOKEN']?.type).toBe('api_key');
  });

  it('caches the schema per client instance (one catalog fetch for repeated reads)', async () => {
    const { vinkius, calls } = makeVinkius([catalogRoute]);
    const credentials = vinkius.user('customer-123').connector('github').credentials;
    await credentials.schema();
    await credentials.schema();
    expect(calls.filter((c) => c.path.startsWith('/catalog/'))).toHaveLength(1);
  });

  it('wraps set(values) into the { credentials } envelope and addresses by external_id', async () => {
    const { vinkius, calls } = makeVinkius([
      listRoute,
      {
        method: 'PUT',
        path: /^\/apps\/vk_app_test\/users\/customer-123\/mcps\/conn_1\/credentials$/,
        respond: () => ({
          body: { schema: { GITHUB_TOKEN: { type: 'api_key' } }, configured: { GITHUB_TOKEN: true } },
        }),
      },
    ]);
    const status = await vinkius
      .user('customer-123')
      .connector('github')
      .credentials.set({ GITHUB_TOKEN: 'ghp_x' });
    expect(status.configured['GITHUB_TOKEN']).toBe(true);
    const put = calls.find((c) => c.method === 'PUT');
    expect(put?.body).toEqual({ credentials: { GITHUB_TOKEN: 'ghp_x' } });
  });
});
