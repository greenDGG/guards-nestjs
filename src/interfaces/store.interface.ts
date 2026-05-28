/**
 * IStore — contract for the key-value store used by guards.
 *
 * The default implementation (RedisStoreService) is in-memory and suitable
 * for single-instance deployments only. For multi-instance deployments,
 * implement this interface backed by Redis (ioredis), Memcached, etc.
 *
 * Guards that depend on shared state (rate limits, nonces, circuit breakers,
 * token blacklists) WILL silently break in multi-instance if an in-memory
 * implementation is used — each instance maintains its own independent state.
 */
export interface IStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlMs?: number): Promise<void>;
  del(key: string): Promise<void>;
  incr(key: string): Promise<number>;
  decr(key: string): Promise<number>;
  expire(key: string, ttlMs: number): Promise<void>;
  exists(key: string): Promise<boolean>;
  setnx(key: string, value: string, ttlMs?: number): Promise<boolean>;
  lpush(key: string, value: string): Promise<void>;
  ltrim(key: string, start: number, stop: number): Promise<void>;
  lrange(key: string, start: number, stop: number): Promise<string[]>;
  llen(key: string): Promise<number>;
}
