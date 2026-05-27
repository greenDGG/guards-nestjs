import { SetMetadata } from '@nestjs/common';
import { GUARD_METADATA } from '../constants/guard.constants';

export interface NonceOptions {
  /**
   * Header that carries the nonce value.
   * @default 'x-nonce'
   */
  header?: string;

  /**
   * How long to remember a used nonce (ms).
   * Must be >= the signature timestamp window to fully prevent replays.
   * @default 600_000 (10 minutes)
   */
  ttlMs?: number;

  /**
   * Whether the nonce header is required.
   * false → 400 if missing
   * true  → skip nonce check if header is absent (use with caution)
   * @default false (required)
   */
  optional?: boolean;

  /**
   * Minimum nonce length in characters.
   * Short nonces are easier to brute-force or collide.
   * @default 16
   */
  minLength?: number;

  /**
   * Scope nonces by user (JWT sub) or API key — prevents cross-user nonce collisions.
   * 'user'   → nonce "abc" from user 1 ≠ nonce "abc" from user 2
   * 'global' → nonces are shared across all users (stronger but may cause false positives)
   * @default 'user'
   */
  scope?: 'user' | 'global';
}

export const Nonce = (options: NonceOptions = {}) =>
  SetMetadata(GUARD_METADATA.NONCE_OPTIONS, options);
