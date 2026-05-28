import { SetMetadata } from '@nestjs/common';
import { GUARD_METADATA } from '../constants/guard.constants';

export interface ReplayProtectionOptions {
  /**
   * HMAC secret used to verify the signature.
   * Can be a string or an async function (e.g. to fetch from secrets manager).
   */
  secret: string | (() => string | Promise<string>);

  /**
   * Maximum age of the x-timestamp header in seconds.
   * Requests older than this are rejected as stale.
   * @default 300 (5 minutes)
   */
  maxAgeSeconds?: number;

  /**
   * How long to remember a used nonce in the store.
   * Must be >= maxAgeSeconds to fully close the replay window.
   * @default 600_000 (10 minutes)
   */
  nonceTtlMs?: number;

  /**
   * Header carrying the Unix timestamp (seconds since epoch).
   * @default 'x-timestamp'
   */
  timestampHeader?: string;

  /**
   * Header carrying the per-request nonce.
   * @default 'x-nonce'
   */
  nonceHeader?: string;

  /**
   * Header carrying the HMAC-SHA256 hex signature.
   * @default 'x-signature'
   */
  signatureHeader?: string;
}

/**
 * Attaches ReplayProtectionOptions to a handler or controller.
 *
 * The guard validates:
 *   1. x-timestamp is within maxAgeSeconds
 *   2. HMAC-SHA256(secret, `${timestamp}.${nonce}.${body}`) matches x-signature
 *   3. x-nonce has not been used before (stored in RedisStoreService with TTL)
 *
 * @example
 * @ReplayProtect({ secret: process.env.API_SECRET })
 * @UseGuards(ReplayProtectionGuard)
 * @Post('transfer')
 * transfer() {}
 */
export const ReplayProtect = (options: ReplayProtectionOptions) =>
  SetMetadata(GUARD_METADATA.REPLAY_PROTECTION_OPTIONS, options);
