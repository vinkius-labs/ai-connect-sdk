/**
 * Input guards for the low-level API.
 *
 * App users are addressed by their client-supplied `external_id` — the value is
 * placed directly into the request path (`/apps/{app}/users/{external_id}/...`).
 * The API resolves the user by `(application_id, external_id)` from the
 * authenticated app context, so the client never resolves or holds a Vinkius id.
 *
 * The value must be URL-path-safe: `encodeURIComponent` handles most characters,
 * but a `/` (encoded `%2F`) and whitespace are rejected by common routing layers,
 * so we reject them up front with a clear error.
 */
import { ConfigError } from './errors';

const UNSAFE_EXTERNAL_ID = /[\s/\\]/;

/** Throw unless `value` is a usable, URL-path-safe external id. */
export function assertExternalId(value: string): void {
  if (typeof value !== 'string' || value.length === 0 || value.length > 255) {
    throw new ConfigError('`externalId` must be a non-empty string of at most 255 characters.');
  }
  if (UNSAFE_EXTERNAL_ID.test(value)) {
    throw new ConfigError(
      `Invalid externalId ${JSON.stringify(value)}: it must not contain whitespace, "/" or "\\".`,
    );
  }
}
