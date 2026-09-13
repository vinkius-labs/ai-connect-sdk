/**
 * @vinkius/connect — Ship AI features, not integration projects. Give every
 * user of your AI app their own connectors and AI capabilities.
 *
 * Domain vocabulary: users have **connectors**; a connected connector is a
 * **connection**; the executable units the agent calls are **capabilities**.
 *
 * @packageDocumentation
 */

// ── High-level (fluent) ─────────────────────────────────────────────────────
export { Vinkius } from './fluent/vinkius';
export { UserContext } from './fluent/user';
export { Connector } from './fluent/connector';
export { CredentialsHandle } from './fluent/credentials';
export { Capability, CapabilitySet } from './fluent/capability';
export type { CapabilityExecutor } from './fluent/capability';

// ── Low-level (resource clients) ────────────────────────────────────────────
export { CatalogClient } from './resources/catalog';
export { AppUsersClient } from './resources/app-users';
export { ConnectionsClient } from './resources/connections';
export { CredentialsClient } from './resources/credentials';
export { ConnectionTokensClient } from './resources/tokens';
export type { CreateAppUserInput, UpdateAppUserInput } from './resources/app-users';
export type { CreateConnectionInput } from './resources/connections';
export type { SetCredentialsInput } from './resources/credentials';
export type { IssueTokenInput } from './resources/tokens';

// ── Infrastructure ──────────────────────────────────────────────────────────
export { ResolverCache } from './core/cache';
export { VERSION } from './version';

// ── Errors ──────────────────────────────────────────────────────────────────
export {
  VinkiusError,
  ConfigError,
  AuthError,
  NotFoundError,
  ValidationError,
  RateLimitError,
  QuotaError,
  OverageError,
  ConnectorNotConnectedError,
  NotImplementedError,
  ConnectionError,
  ProtocolError,
} from './core/errors';
export type { VinkiusErrorCode } from './core/errors';

// ── Types ───────────────────────────────────────────────────────────────────
export type * from './types';
