import { describe, expect, it } from 'vitest';
import { AuthError, NotFoundError, OverageError, QuotaError, RateLimitError, ValidationError } from '../src';
import { makeVinkius, type Route } from './helpers/mock-fetch';

function getUserWith(status: number, body: unknown, headers?: Record<string, string>): Route {
  return {
    method: 'GET',
    path: /^\/apps\/vk_app_test\/users\/someuser$/,
    respond: () => ({ status, body, ...(headers ? { headers } : {}) }),
  };
}

describe('error mapping', () => {
  it('maps 401 to AuthError (reads the "error" key)', async () => {
    const { vinkius } = makeVinkius([getUserWith(401, { error: 'Unauthenticated.' })]);
    await expect(vinkius.users.get('someuser')).rejects.toMatchObject({
      name: 'AuthError',
      status: 401,
      code: 'auth_error',
      message: 'Unauthenticated.',
    });
    await expect(vinkius.users.get('someuser')).rejects.toBeInstanceOf(AuthError);
  });

  it('maps 404 to NotFoundError', async () => {
    const { vinkius } = makeVinkius([getUserWith(404, { message: 'Not found.' })]);
    await expect(vinkius.users.get('someuser')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('maps 422 to ValidationError with field errors', async () => {
    const { vinkius } = makeVinkius([
      getUserWith(422, { message: 'Invalid', errors: { external_id: ['required'] } }),
    ]);
    const error = await vinkius.users.get('someuser').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).errors['external_id']).toEqual(['required']);
  });

  it('maps 429 MCP-shaped bodies to QuotaError with upgradeUrl', async () => {
    const { vinkius } = makeVinkius([
      getUserWith(429, {
        content: [{ type: 'text', text: 'quota' }],
        isError: true,
        upgrade_url: 'https://u',
      }),
    ]);
    const error = await vinkius.users.get('someuser').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(QuotaError);
    expect((error as QuotaError).upgradeUrl).toBe('https://u');
  });

  it('maps plain 429 to RateLimitError', async () => {
    const { vinkius } = makeVinkius([getUserWith(429, { message: 'slow down' }, { 'retry-after': '1' })]);
    await expect(vinkius.users.get('someuser')).rejects.toBeInstanceOf(RateLimitError);
  });

  it('maps 402 to OverageError', async () => {
    const { vinkius } = makeVinkius([getUserWith(402, { isError: true, upgrade_url: 'https://u' })]);
    await expect(vinkius.users.get('someuser')).rejects.toBeInstanceOf(OverageError);
  });
});
