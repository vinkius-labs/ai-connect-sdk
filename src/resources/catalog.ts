/**
 * Catalog discovery.
 *
 *   GET /catalog/mcps                    → paginated CatalogConnector
 *   GET /catalog/mcps/{slug}             → CatalogConnectorDetail (+ credential_schema)
 *   GET /marketplace/search?q=...&page=1 → marketplace-ranked search results
 *
 * Catalog listing/detail use the internal MCP data-plane routes. Search uses
 * the public marketplace endpoint so SDK consumers receive the same ranking
 * and results as the Vinkius website.
 */
import type { HttpClient } from '../core/http';
import { normalizePaginated, pageIterator, unwrapItem } from '../core/pagination';
import type { CatalogConnector, CatalogConnectorDetail, Paginated, RequestOptions } from '../types';

interface MarketplaceSearchConnector {
  id: string;
  slug: string;
  title: string;
  short_description: string | null;
  publisher_type: string;
  listing_type?: string;
  server_type?: string;
  tools_count?: number;
  requires_buyer_auth?: boolean;
  requires_auth?: boolean;
}

interface MarketplaceSearchResponse {
  results?: MarketplaceSearchConnector[];
  has_more?: boolean;
  page?: number;
}

function normalizeMarketplaceSearch(body: unknown): CatalogConnector[] {
  const response = body as MarketplaceSearchResponse;
  if (!Array.isArray(response?.results)) return [];

  return response.results.map((connector) => ({
    id: connector.id,
    slug: connector.slug,
    title: connector.title,
    short_description: connector.short_description,
    publisher_type: connector.publisher_type,
    listing_type: connector.listing_type ?? connector.server_type ?? '',
    requires_buyer_auth: connector.requires_buyer_auth ?? connector.requires_auth ?? false,
    server_type: connector.server_type,
    tools_count: connector.tools_count,
  }));
}

export class CatalogClient {
  constructor(private readonly http: HttpClient) {}

  /** List public connectors (page-based, 50 per page). */
  async list(opts: { page?: number } & RequestOptions = {}): Promise<Paginated<CatalogConnector>> {
    const body = await this.http.get<unknown>('/catalog/mcps', {
      query: { page: opts.page },
      signal: opts.signal, idempotencyKey: opts.idempotencyKey, timeoutMs: opts.timeoutMs,
    });
    return normalizePaginated<CatalogConnector>(body);
  }

  /**
   * Iterate every catalog connector across all pages. Convenience over `list()`
   * for callers that want the full catalog without manual page bookkeeping.
   */
  async *iterate(opts: { page?: number } & RequestOptions = {}): AsyncIterable<CatalogConnector> {
    // Seed with the explicitly-requested page (default 1) if given, so a caller
    // can resume from a known page; otherwise start at the first page.
    const first = await this.list({ ...opts });
    yield* pageIterator(first, (page) => this.list({ ...opts, page }));
  }

  /** Fetch a single connector by slug (or uuid), including its credential schema. */
  async get(slug: string, opts: RequestOptions = {}): Promise<CatalogConnectorDetail> {
    const body = await this.http.get<unknown>(`/catalog/mcps/${encodeURIComponent(slug)}`, {
      signal: opts.signal, idempotencyKey: opts.idempotencyKey, timeoutMs: opts.timeoutMs,
    });
    return unwrapItem<CatalogConnectorDetail>(body);
  }

  /** Search using the same endpoint and ranking as the Vinkius marketplace. */
  async search(query: string, opts: { page?: number } & RequestOptions = {}): Promise<CatalogConnector[]> {
    const body = await this.http.get<unknown>('/marketplace/search', {
      query: { q: query, page: opts.page ?? 1 },
      signal: opts.signal, idempotencyKey: opts.idempotencyKey, timeoutMs: opts.timeoutMs,
    });
    return normalizeMarketplaceSearch(body);
  }
}
