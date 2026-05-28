import { SetMetadata } from '@nestjs/common';
import { GUARD_METADATA } from '../constants/guard.constants';

export interface SessionHijackOptions {
  /**
   * Score thresholds.
   * warn:  log + penalize trust score, allow through  (default: 30)
   * block: throw SessionHijackedException 401          (default: 60)
   */
  thresholds?: {
    warn?:  number;
    block?: number;
  };

  /**
   * How many different /24 subnets the session is allowed to use before
   * the subnet signal fires at full weight.
   * Set to 2 or 3 for users that frequently switch networks (mobile + WiFi).
   * @default 1
   */
  maxSubnetChanges?: number;

  /**
   * Trust score penalty applied on warn action.
   * Feeds into AdaptiveRateLimitGuard and RiskScoreGuard.
   * @default 10
   */
  warnPenalty?: number;

  /**
   * TTL for session state in the store.
   * Should match or exceed your JWT expiry.
   * @default 86_400_000 (24 hours)
   */
  sessionTtlMs?: number;

  /**
   * Log signals but never block or penalize — safe for observation mode.
   * @default false
   */
  logOnly?: boolean;
}

/**
 * Attach SessionHijackGuard to a handler or controller.
 *
 * @example
 * // Default thresholds: warn >= 30, block >= 60
 * @SessionProtect()
 * @UseGuards(SessionHijackGuard)
 * @Get('account')
 * account() {}
 *
 * @example
 * // Strict — lower thresholds for sensitive operations
 * @SessionProtect({ thresholds: { warn: 15, block: 40 } })
 * @UseGuards(SessionHijackGuard)
 * @Post('withdraw')
 * withdraw() {}
 *
 * @example
 * // Mobile-friendly — allow 2 subnet changes (WiFi + cellular)
 * @SessionProtect({ maxSubnetChanges: 2, thresholds: { block: 70 } })
 * @UseGuards(SessionHijackGuard)
 * @Get('feed')
 * feed() {}
 */
export const SessionProtect = (options: SessionHijackOptions = {}) =>
  SetMetadata(GUARD_METADATA.SESSION_HIJACK_OPTIONS, options);
