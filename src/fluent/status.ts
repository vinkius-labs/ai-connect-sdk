/** Map a {@link Connection} to its derived {@link ConnectorStatus}. */
import type { Connection, ConnectorStatus, ConnectorSummary } from '../types';

/**
 * The backend owns "readiness" (`Connection.ready`); the SDK only maps it.
 * `not_connected` is handled by the caller when no connection matches.
 */
export function deriveStatus(connection: Connection): ConnectorStatus {
  if (connection.status !== 'active') return 'disabled';
  return connection.ready ? 'ready' : 'needs_credentials';
}

export function summarize(connection: Connection): ConnectorSummary {
  const summary: ConnectorSummary = {
    slug: connection.slug ?? connection.name,
    status: deriveStatus(connection),
  };
  if (connection.id) summary.connectionId = connection.id;
  return summary;
}
