import { SetMetadata } from '@nestjs/common';
import { GUARD_METADATA } from '../constants/guard.constants';

export interface ConcurrencyOptions {
  /**
   * Maximum number of simultaneous in-flight requests allowed.
   * When this limit is reached, new requests get 429 until a slot frees up.
   */
  maxConcurrent: number;

  /**
   * How to scope the concurrency counter.
   *
   *   'ip'         — shared limit per client IP (default)
   *   'user'       — shared limit per authenticated user (JWT sub)
   *   'user+route' — per user per route (most granular)
   *   'global'     — single counter for all clients on this endpoint
   */
  keyBy?: 'ip' | 'user' | 'user+route' | 'global';

  /**
   * Safety TTL in milliseconds.
   * If a request handler crashes without releasing its slot, the counter
   * would grow unboundedly. This TTL auto-resets the key after the given
   * period so the system self-heals.
   *
   * Set to roughly 2× your worst-case handler timeout.
   * Default: 30 000 ms (30 seconds).
   */
  ttlMs?: number;
}

export const Concurrent = (options: ConcurrencyOptions): MethodDecorator & ClassDecorator =>
  SetMetadata(GUARD_METADATA.CONCURRENCY_OPTIONS, options);
