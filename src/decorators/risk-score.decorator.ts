import { SetMetadata } from '@nestjs/common';
import { GUARD_METADATA } from '../constants/guard.constants';

export interface RiskWeights {
  /** Max points from bot detection signals (default: 40) */
  bot?:         number;
  /** Max points from geo risk tier (default: 15) */
  geo?:         number;
  /** Max points from inverted trust score (default: 15) */
  trust?:       number;
  /** Max points from request velocity (default: 15) */
  velocity?:    number;
  /** Max points from fingerprint change (default: 15) */
  fingerprint?: number;
}

export interface RiskScoreOptions {
  /**
   * Score thresholds for the three-way decision.
   * Scores below challenge → allow, between challenge and block → challenge, above block → block.
   */
  thresholds?: {
    challenge?: number;  // default: 40
    block?:     number;  // default: 70
  };

  /**
   * Per-signal maximum point contributions.
   * All weights should sum to 100 for a clean 0–100 scale.
   */
  weights?: RiskWeights;

  /**
   * Velocity window — count of requests from this IP within windowMs.
   * A count >= maxRequests earns the full velocity weight.
   */
  velocity?: {
    windowMs?:    number;  // default: 60_000 (1 min)
    maxRequests?: number;  // default: 30
  };

  /**
   * What to do when a request lands in the challenge zone.
   * 'throw'  → 403 RiskScoreChallengeException — client must handle (CAPTCHA, step-up auth)
   * 'header' → set X-Risk-Challenge: true and pass through — client decides
   * @default 'throw'
   */
  onChallenge?: 'throw' | 'header';

  /**
   * Score and log but never block or challenge — useful for observing scores in production
   * before enabling enforcement.
   * @default false
   */
  logOnly?: boolean;
}

/**
 * Attach RiskScoreGuard configuration to a handler or controller.
 *
 * @example
 * // Defaults: challenge >= 40, block >= 70
 * @RiskScore()
 * @UseGuards(RiskScoreGuard)
 * @Post('transfer')
 * transfer() {}
 *
 * @example
 * // Strict fintech thresholds + observe-only mode during ramp
 * @RiskScore({ thresholds: { challenge: 30, block: 60 }, logOnly: true })
 * @UseGuards(RiskScoreGuard)
 * @Post('withdraw')
 * withdraw() {}
 *
 * @example
 * // After detection guards ran (best mode — no recomputation)
 * @RiskScore({ onChallenge: 'header' })
 * @UseGuards(BotDetectionGuard, GeoIpGuard, RiskScoreGuard)
 * @Post('order')
 * order() {}
 */
export const RiskScore = (options: RiskScoreOptions = {}) =>
  SetMetadata(GUARD_METADATA.RISK_SCORE_OPTIONS, options);
