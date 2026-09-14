import { describe, expect, it } from 'vitest';
import { appUser, connection, makeVinkius, tokenRoute } from './helpers/mock-fetch';

describe('UserContext (external_id addressing)', () => {
  it('makes no request when creating a user handle', () => {
    const { vinkius, calls } = makeVinkius([]);
    vinkius.user('customer-123');
    expect(calls).toHaveLength(0);
  });

  it('ensure() upserts by external_id and forwards metadata', async () => {
    const { vinkius, calls } = makeVinkius([
      {
        method: 'POST',
        path: /^\/apps\/vk_app_test\/users$/,
        respond: (c) => ({
          body: { data: appUser('vk_app_user_1', (c.body as { external_id: string }).external_id) },
        }),
      },
    ]);
    await vinkius.user('usr_42').ensure({ plan: 'pro' });
    expect(calls[0]?.body).toEqual({ external_id: 'usr_42', metadata: { plan: 'pro' } });
  });

  it('connects a connector by external_id, then provisions its runtime token', async () => {
    const { vinkius, calls } = makeVinkius([
      {
        method: 'POST',
        path: /^\/apps\/vk_app_test\/users\/customer-123\/mcps$/,
        respond: () => ({ body: { data: connection('conn_1', 'github') } }),
      },
      tokenRoute(),
    ]);
    const result = await vinkius.user('customer-123').connector('github').connect();
    expect(result.id).toBe('conn_1');
    expect(result.runtime_url).toBeTruthy();
    // Two requests: create the connection (external_id goes straight into the
    // path), then mint the connection's data-plane token.
    expect(calls.map((c) => c.path)).toEqual([
      '/apps/vk_app_test/users/customer-123/mcps',
      '/apps/vk_app_test/users/customer-123/mcps/conn_1/tokens',
    ]);
    // The wire body maps the connector slug to the API field.
    expect(calls[0]?.body).toEqual({ catalog_mcp_id: 'github' });
  });

  it('sends Authorization and X-Vinkius-App-Id on every request', async () => {
    const seen: Array<{ auth: string | null; appId: string | null }> = [];
    const { vinkius } = makeVinkius([
      {
        method: 'GET',
        path: /^\/apps\/vk_app_test\/users\/customer-123\/mcps$/,
        respond: (c) => {
          seen.push({ auth: c.headers.get('authorization'), appId: c.headers.get('x-vinkius-app-id') });
          return { body: { data: [] } };
        },
      },
    ]);
    await vinkius.user('customer-123').connectors();
    expect(seen[0]?.auth).toBe('Bearer vk_app_sk_test');
    expect(seen[0]?.appId).toBe('vk_app_test');
  });

  it('rejects an external_id containing a slash', () => {
    const { vinkius } = makeVinkius([]);
    expect(() => vinkius.user('acme/alice')).toThrow(/externalId/);
  });
});
