/**
 * A small TTL cache for non-secret resolution data.
 *
 * GOLDEN RULE: cache is an optimization, never a source of authorization.
 * Only non-secret, stable values belong here (e.g. external_id → vk_app_user_*,
 * catalog credential schemas). Credentials, Authorization headers, and any
 * `vk_live_*` MUST NEVER be cached — and never even reach the SDK.
 */

interface Entry<V> {
  value: V;
  expiresAt: number;
}

export class ResolverCache {
  private readonly store = new Map<string, Entry<unknown>>();

  constructor(private readonly ttlMs: number = 5 * 60 * 1000) {}

  get<V>(key: string): V | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value as V;
  }

  set<V>(key: string, value: V): void {
    this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  /** Return the cached value or compute, cache, and return it. */
  async resolve<V>(key: string, compute: () => Promise<V>): Promise<V> {
    const cached = this.get<V>(key);
    if (cached !== undefined) return cached;
    const value = await compute();
    this.set(key, value);
    return value;
  }
}
