import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { IStore } from '../interfaces/store.interface';

interface MemoryEntry {
  value: string;
  expiresAt?: number;
}

interface ListEntry {
  values: string[];
  expiresAt?: number;
}

/**
 * In-memory store that mimics Redis semantics.
 *
 * ⚠  SINGLE-INSTANCE ONLY.
 * Guards that depend on shared state (rate limits, nonces, circuit breakers,
 * token blacklists) will silently break in multi-instance deployments because
 * each process maintains its own independent Map.
 *
 * For multi-instance: implement IStore backed by Redis (ioredis) and swap the
 * provider in your module: { provide: RedisStoreService, useClass: MyRedisStore }
 */
@Injectable()
export class RedisStoreService implements IStore, OnModuleInit {
  private readonly logger = new Logger(RedisStoreService.name);
  private store = new Map<string, MemoryEntry>();
  private listStore = new Map<string, ListEntry>();

  onModuleInit(): void {
    if (process.env.NODE_ENV === 'production') {
      this.logger.warn(
        'RedisStoreService is using an in-memory store. ' +
        'This is NOT suitable for multi-instance production deployments. ' +
        'Implement IStore backed by Redis and register it as a provider.',
      );
    }
  }

  async get(key: string): Promise<string | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(key: string, value: string, ttlMs?: number): Promise<void> {
    this.store.set(key, {
      value,
      expiresAt: ttlMs ? Date.now() + ttlMs : undefined,
    });
  }

  async del(key: string): Promise<void> {
    this.store.delete(key);
    this.listStore.delete(key);
  }

  async incr(key: string): Promise<number> {
    const current = parseInt((await this.get(key)) ?? '0', 10);
    const next = current + 1;
    const existing = this.store.get(key);
    await this.set(key, String(next), existing?.expiresAt ? existing.expiresAt - Date.now() : undefined);
    return next;
  }

  async expire(key: string, ttlMs: number): Promise<void> {
    const entry = this.store.get(key);
    if (entry) {
      this.store.set(key, { ...entry, expiresAt: Date.now() + ttlMs });
    }
    const listEntry = this.listStore.get(key);
    if (listEntry) {
      this.listStore.set(key, { ...listEntry, expiresAt: Date.now() + ttlMs });
    }
  }

  async lpush(key: string, value: string): Promise<void> {
    const entry = this.listStore.get(key);
    if (!entry) {
      this.listStore.set(key, { values: [value] });
    } else {
      entry.values.unshift(value);
    }
  }

  async ltrim(key: string, start: number, stop: number): Promise<void> {
    const entry = this.listStore.get(key);
    if (entry) {
      entry.values = entry.values.slice(start, stop + 1);
    }
  }

  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    const entry = this.listStore.get(key);
    if (!entry) return [];
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.listStore.delete(key);
      return [];
    }
    const end = stop === -1 ? entry.values.length : stop + 1;
    return entry.values.slice(start, end);
  }

  async llen(key: string): Promise<number> {
    const entry = this.listStore.get(key);
    if (!entry) return 0;
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.listStore.delete(key);
      return 0;
    }
    return entry.values.length;
  }

  async exists(key: string): Promise<boolean> {
    return (await this.get(key)) !== null || (await this.llen(key)) > 0;
  }

  /**
   * Decrement a counter key by 1. Never goes below 0.
   * Companion to incr() — used to release concurrency slots.
   */
  async decr(key: string): Promise<number> {
    const current = parseInt((await this.get(key)) ?? '0', 10);
    if (current <= 0) return 0;
    const next = current - 1;
    const existing = this.store.get(key);
    await this.set(key, String(next), existing?.expiresAt ? existing.expiresAt - Date.now() : undefined);
    return next;
  }

  /**
   * Set key to value ONLY if the key does not already exist (atomic in single-instance Node.js).
   * Returns true if the key was set, false if it already existed.
   * Maps to Redis SETNX / SET NX EX.
   */
  async setnx(key: string, value: string, ttlMs?: number): Promise<boolean> {
    const existing = await this.get(key);
    if (existing !== null) return false;
    await this.set(key, value, ttlMs);
    return true;
  }

  /**
   * FOR TESTS ONLY — wipes all in-memory state.
   * Never call this from production code: it clears rate limit counters,
   * nonces, circuit breaker state, and trust scores for every active user.
   */
  async flushAll(): Promise<void> {
    this.store.clear();
    this.listStore.clear();
  }
}
