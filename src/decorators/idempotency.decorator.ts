import { SetMetadata } from '@nestjs/common';
import { GUARD_METADATA } from '../constants/guard.constants';

export interface IdempotencyOptions {
  /**
   * Name of the header carrying the idempotency key.
   * @default 'idempotency-key'
   */
  header?: string;

  /**
   * How long to cache the response (ms).
   * After this period the key can be reused and the request will process again.
   * @default 86_400_000 (24 hours)
   */
  ttlMs?: number;

  /**
   * How long to hold the processing lock (ms).
   * If the handler takes longer than this, the lock is released automatically.
   * Should be longer than your p99 response time.
   * @default 30_000 (30 seconds)
   */
  lockTtlMs?: number;

  /**
   * Whether the idempotency key is optional.
   * false → missing header returns 400 Bad Request
   * true  → missing header skips idempotency (request is processed normally)
   * @default false
   */
  optional?: boolean;

  /**
   * Scope the key per authenticated user.
   * Strongly recommended for payment endpoints — prevents one user from
   * "stealing" another user's idempotency key to get their response.
   * @default true
   */
  scopeByUser?: boolean;
}

export const Idempotent = (options: IdempotencyOptions = {}) =>
  SetMetadata(GUARD_METADATA.IDEMPOTENCY_OPTIONS, options);
