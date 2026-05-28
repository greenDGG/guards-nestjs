import { SetMetadata } from '@nestjs/common';
import { Request } from 'express';
import { GUARD_METADATA } from '../constants/guard.constants';

export type RateLimitProfile = 'login' | 'payment' | 'search' | 'api' | 'public';

export interface RateLimitByRouteOptions {
  /**
   * Named preset. Overrides all other defaults.
   * Individual fields (max, burstMax, etc.) override the profile when set.
   *
   *   'login'   → 5 req/60s  | burst 2/5s   | keyBy ip   | penalty 5min after 3 violations
   *   'payment' → 10 req/60s | burst 2/10s  | keyBy user | penalty 15min after 2 violations
   *   'search'  → 60 req/60s | burst 15/5s  | keyBy user | no penalty
   *   'api'     → 100 req/60s| burst 20/5s  | keyBy user | no penalty
   *   'public'  → 30 req/60s | burst 10/5s  | keyBy ip   | no penalty
   */
  profile?: RateLimitProfile;

  /** Maximum requests in the sustained window. */
  max?: number;

  /** Sustained window size in milliseconds. @default 60_000 */
  windowMs?: number;

  /**
   * Maximum requests in the short burst window.
   * Catches attacks that stay within the sustained rate but concentrate requests.
   * If omitted, burst checking is disabled.
   */
  burstMax?: number;

  /**
   * Burst window size in milliseconds.
   * @default windowMs / 10  (when burstMax is set)
   */
  burstWindowMs?: number;

  /**
   * Penalty box duration in milliseconds.
   * After `violationsBeforePenalty` limit-exceeded events, the IP/user is locked
   * out for this duration — all requests return 429 without checking any window.
   * Set to 0 to disable (default for non-sensitive profiles).
   * @default 0
   */
  penaltyMs?: number;

  /**
   * Number of limit-exceeded events before entering the penalty box.
   * @default 3
   */
  violationsBeforePenalty?: number;

  /**
   * Whether to key the counter by IP or authenticated user (JWT sub).
   * Falls back to IP if keyBy='user' but no JWT is present.
   * @default 'ip'
   */
  keyBy?: 'ip' | 'user';

  /**
   * If this function returns true the guard lets the request through unconditionally.
   * @example skipIf: (req) => req.ip === '127.0.0.1'
   */
  skipIf?: (req: Request) => boolean;
}

/**
 * Attach RateLimitByRouteGuard to a handler or controller.
 *
 * @example
 * // Profile shorthand — all defaults baked in
 * @RateLimit('login')
 * @UseGuards(RateLimitByRouteGuard)
 * @Post('login')
 * login() {}
 *
 * @example
 * // Profile + override
 * @RateLimit({ profile: 'payment', max: 5 })  // stricter than default
 * @UseGuards(RateLimitByRouteGuard)
 * @Post('checkout')
 * checkout() {}
 *
 * @example
 * // Custom config with burst + penalty
 * @RateLimit({
 *   max: 3, windowMs: 60_000,
 *   burstMax: 1, burstWindowMs: 5_000,
 *   penaltyMs: 600_000, violationsBeforePenalty: 2,
 * })
 * @UseGuards(RateLimitByRouteGuard)
 * @Post('otp')
 * otp() {}
 *
 * @example
 * // Controller-level default + handler override
 * @RateLimit('api')
 * @UseGuards(RateLimitByRouteGuard)
 * @Controller('api')
 * export class ApiController {
 *   @RateLimit('search')  // overrides 'api' for this route
 *   @Get('search')
 *   search() {}
 * }
 */
export const RateLimit = (options: RateLimitProfile | RateLimitByRouteOptions) =>
  SetMetadata(
    GUARD_METADATA.RATE_LIMIT_BY_ROUTE_OPTIONS,
    typeof options === 'string' ? { profile: options } : options,
  );
