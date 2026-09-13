/**
 * Pagination normalization.
 *
 * The API is heterogeneous: some list endpoints return the full Laravel
 * length-aware envelope (`{ data, links, meta }`), others return only
 * `{ data: [...] }`. This module coerces both into {@link Paginated} and
 * exposes the raw array when a plain list is expected.
 */
import type { Paginated } from '../types';
import { ProtocolError } from './errors';

interface RawList<T> {
  data?: T[];
  meta?: Paginated<T>['meta'];
  links?: Paginated<T>['links'];
}

function listEnvelope<T>(body: unknown): RawList<T> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ProtocolError('Expected a list response shaped as an array or { data: [...] }.', {
      details: body,
    });
  }
  const raw = body as RawList<T>;
  if (!Array.isArray(raw.data)) {
    throw new ProtocolError('Expected a list response shaped as an array or { data: [...] }.', {
      details: body,
    });
  }
  return raw;
}

/** Normalize a valid list response into a {@link Paginated} value. */
export function normalizePaginated<T>(body: unknown): Paginated<T> {
  const raw = listEnvelope<T>(body);
  const result: Paginated<T> = { data: raw.data! };
  if (raw.meta) result.meta = raw.meta;
  if (raw.links) result.links = raw.links;
  return result;
}

/** Unwrap a `{ data: [...] }` (or bare array) response into a plain array. */
export function unwrapList<T>(body: unknown): T[] {
  if (Array.isArray(body)) return body as T[];
  return listEnvelope<T>(body).data!;
}

/** Unwrap a single-resource `{ data: {...} }` response. */
export function unwrapItem<T>(body: unknown): T {
  const raw = (body ?? {}) as { data?: T };
  return (raw.data ?? (body as T)) as T;
}

/**
 * Walk every page of a page-based list, yielding each item in order. Starts from
 * `first` (already fetched), then advances `meta.current_page` until `meta.last_page`
 * is reached. `fetchPage` must fetch the given 1-based page number. A single-page
 * response (no `meta`) is yielded exactly once.
 */
export async function* pageIterator<T>(
  first: Paginated<T>,
  fetchPage: (page: number) => Promise<Paginated<T>>,
): AsyncGenerator<T> {
  let current = first;
  let page = current.meta?.current_page ?? 1;
  for (;;) {
    yield* current.data;
    const lastPage = current.meta?.last_page ?? page;
    if (page >= lastPage) return;
    current = await fetchPage(page + 1);
    page += 1;
  }
}
