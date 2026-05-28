import { createHash } from 'crypto';
import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request, Response } from 'express';
import { GUARD_METADATA } from '../../constants/guard.constants';
import { RiskScoreOptions, RiskWeights } from '../../decorators/risk-score.decorator';
import { BotDetectionService } from '../../services/bot-detection.service';
import { GeoIpService } from '../../services/geo-ip.service';
import { RedisStoreService } from '../../services/redis-store.service';
import { SecurityContextService } from '../../services/security-context.service';
import { RiskScoreBlockedException, RiskScoreChallengeException } from '../../exceptions/detection.exception';

/** Countries with elevated fraud/threat profile (tier 3 = max geo risk) */
const HIGH_RISK_COUNTRIES = new Set(['KP', 'IR', 'SY', 'CU', 'SD']);

/** Countries with moderate elevated risk (tier 2) */
const MEDIUM_RISK_COUNTRIES = new Set(['RU', 'BY', 'VE', 'MM', 'AF', 'SO', 'LY', 'YE']);

export interface RiskBreakdown {
  bot:         number;
  geo:         number;
  trust:       number;
  velocity:    number;
  fingerprint: number;
  total:       number;
}

/**
 * RiskScoreGuard — Stripe / Cloudflare-style risk aggregator
 *
 * Combines five independent signals into a single risk score (0–100)
 * and makes a 3-way decision: allow → challenge → block.
 *
 * ─── Signals ──────────────────────────────────────────────────────────────
 *
 *   Signal       │ Source                                        │ Max pts
 *   ─────────────────────────────────────────────────────────────────────────
 *   Bot          │ securityContext.botScore or BotDetectionService│ 40
 *   Geo risk     │ securityContext.geo or GeoIpService            │ 15
 *   Trust        │ securityContext.trustScore (inverted)          │ 15
 *   Velocity     │ sliding-window request count per IP            │ 15
 *   Fingerprint  │ UA+lang hash vs stored value per IP            │ 15
 *
 * ─── Decisions ────────────────────────────────────────────────────────────
 *
 *   Score < challengeThreshold (40) → allow (pass through)
 *   Score < blockThreshold     (70) → challenge
 *     onChallenge: 'header' → set X-Risk-Challenge header, continue
 *     onChallenge: 'throw'  → 403 RiskScoreChallengeException
 *   Score >= blockThreshold         → 403 RiskScoreBlockedException
 *
 * ─── Composable or standalone ─────────────────────────────────────────────
 *
 *   Works best after detection guards (BotDetectionGuard, GeoIpGuard) —
 *   reads their computed scores from securityContext without re-computing.
 *   If those guards haven't run, calls the services directly.
 *
 *   Stack example:
 *     @UseGuards(BotDetectionGuard, GeoIpGuard, RiskScoreGuard)
 *
 *   Standalone example (RiskScoreGuard calls everything internally):
 *     @UseGuards(RiskScoreGuard)
 *
 * ─── Response headers (always set) ───────────────────────────────────────
 *
 *   X-Risk-Score: 65
 *   X-Risk-Action: challenge
 *
 * ─── SecurityContext written ──────────────────────────────────────────────
 *
 *   ctx.riskScore     = 65;
 *   ctx.riskAction    = 'challenge';
 *   ctx.riskBreakdown = { bot: 40, geo: 5, trust: 8, velocity: 6, fingerprint: 6, total: 65 };
 *
 * Usage:
 *   @RiskScore({ thresholds: { challenge: 40, block: 70 } })
 *   @UseGuards(RiskScoreGuard)
 *   @Post('transfer')
 *   transfer() {}
 */
@Injectable()
export class RiskScoreGuard implements CanActivate {
  private readonly logger = new Logger(RiskScoreGuard.name);

  private readonly DEFAULT_WEIGHTS: Required<RiskWeights> = {
    bot:         40,
    geo:         15,
    trust:       15,
    velocity:    15,
    fingerprint: 15,
  };

  constructor(
    private readonly reflector:    Reflector,
    private readonly botService:   BotDetectionService,
    private readonly geoService:   GeoIpService,
    private readonly store:        RedisStoreService,
    private readonly secCtx:       SecurityContextService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const options = this.reflector.getAllAndOverride<RiskScoreOptions | undefined>(
      GUARD_METADATA.RISK_SCORE_OPTIONS,
      [context.getHandler(), context.getClass()],
    );

    if (!options) return true;

    const request  = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    const ctx      = this.secCtx.get(request);
    const ip       = ctx.ip;

    const weights: Required<RiskWeights> = {
      ...this.DEFAULT_WEIGHTS,
      ...options.weights,
    };

    // ── Gather all signals concurrently ───────────────────────────────────
    const [botPts, geoPts, trustPts, velocityPts, fpPts] = await Promise.all([
      this.scoreBotSignal(request, ctx, weights.bot),
      this.scoreGeoSignal(ip, ctx, weights.geo),
      this.scoreTrustSignal(ctx, weights.trust),
      this.scoreVelocitySignal(ip, options, weights.velocity),
      this.scoreFingerprintSignal(request, ip, weights.fingerprint),
    ]);

    const total = Math.min(100, Math.round(botPts + geoPts + trustPts + velocityPts + fpPts));

    const breakdown: RiskBreakdown = {
      bot:         Math.round(botPts),
      geo:         Math.round(geoPts),
      trust:       Math.round(trustPts),
      velocity:    Math.round(velocityPts),
      fingerprint: Math.round(fpPts),
      total,
    };

    // ── Decision thresholds ────────────────────────────────────────────────
    const challengeAt = options.thresholds?.challenge ?? 40;
    const blockAt     = options.thresholds?.block     ?? 70;

    const action =
      total >= blockAt     ? 'block'     :
      total >= challengeAt ? 'challenge' :
                             'allow';

    // ── Write to SecurityContext ───────────────────────────────────────────
    ctx['riskScore']     = total;
    ctx['riskAction']    = action;
    ctx['riskBreakdown'] = breakdown;

    // ── Set response headers ───────────────────────────────────────────────
    response.setHeader('X-Risk-Score',  String(total));
    response.setHeader('X-Risk-Action', action);

    this.logger.log(
      `RiskScore ip=${ip} score=${total} action=${action} ` +
        `[bot=${breakdown.bot} geo=${breakdown.geo} trust=${breakdown.trust} ` +
        `vel=${breakdown.velocity} fp=${breakdown.fingerprint}]`,
    );

    // ── Enforce decision ───────────────────────────────────────────────────
    if (options.logOnly) return true;

    if (action === 'block') {
      throw new RiskScoreBlockedException(total, breakdown);
    }

    if (action === 'challenge') {
      const mode = options.onChallenge ?? 'throw';
      if (mode === 'throw') {
        throw new RiskScoreChallengeException(total, breakdown);
      }
      // 'header' mode: set challenge header and pass through
      response.setHeader('X-Risk-Challenge', 'true');
    }

    return true;
  }

  // ── Signal scorers ─────────────────────────────────────────────────────

  private async scoreBotSignal(
    request: Request,
    ctx: ReturnType<SecurityContextService['get']>,
    maxPts: number,
  ): Promise<number> {
    // Prefer score already computed by BotDetectionGuard
    if (typeof ctx.botScore === 'number') {
      return (ctx.botScore / 100) * maxPts;
    }
    // Fallback: compute inline via BotDetectionService
    try {
      const score = await this.botService.computeBotScore(request as any, {});
      return (score / 100) * maxPts;
    } catch {
      return 0;
    }
  }

  private async scoreGeoSignal(
    ip: string,
    ctx: ReturnType<SecurityContextService['get']>,
    maxPts: number,
  ): Promise<number> {
    // Prefer geo already fetched by GeoIpGuard
    let countryCode = ctx.geo?.countryCode;

    if (!countryCode) {
      // Fallback: look up now (cached 24h in GeoIpService)
      try {
        const geo = await this.geoService.lookup(ip);
        countryCode = geo?.country_code ?? undefined;
      } catch {
        return 0;
      }
    }

    if (!countryCode) return 0;

    const tier =
      HIGH_RISK_COUNTRIES.has(countryCode)   ? 3 :
      MEDIUM_RISK_COUNTRIES.has(countryCode) ? 2 :
                                               1;

    return (tier / 3) * maxPts;
  }

  private scoreTrustSignal(
    ctx: ReturnType<SecurityContextService['get']>,
    maxPts: number,
  ): number {
    // trustScore 100 = fully trusted → 0 risk contribution
    // trustScore 0   = untrusted     → full risk contribution
    // Missing trustScore: use neutral 75
    const trustScore = typeof ctx.trustScore === 'number' ? ctx.trustScore : 75;
    return (1 - trustScore / 100) * maxPts;
  }

  private async scoreVelocitySignal(
    ip: string,
    options: RiskScoreOptions,
    maxPts: number,
  ): Promise<number> {
    const windowMs    = options.velocity?.windowMs    ?? 60_000;
    const maxRequests = options.velocity?.maxRequests ?? 30;
    const now         = Date.now();
    const key         = `risk:velocity:${ip}`;

    // Push current timestamp, keep last 500 entries max
    await this.store.lpush(key, String(now));
    await this.store.ltrim(key, 0, 499);
    await this.store.expire(key, windowMs * 2);

    // Count entries within the window
    const all = await this.store.lrange(key, 0, -1);
    const count = all.filter((ts) => now - parseInt(ts, 10) <= windowMs).length;

    return Math.min(count / maxRequests, 1) * maxPts;
  }

  private async scoreFingerprintSignal(
    request: Request,
    ip: string,
    maxPts: number,
  ): Promise<number> {
    const ua   = request.headers['user-agent']       ?? '';
    const lang = request.headers['accept-language']  ?? '';
    const enc  = request.headers['accept-encoding']  ?? '';

    const fingerprint = createHash('sha256')
      .update(`${ua}:${lang}:${enc}`)
      .digest('hex')
      .slice(0, 16);

    const key = `risk:fp:${ip}`;
    const stored = await this.store.get(key);

    // Store fingerprint with 7-day TTL (refresh on each request)
    await this.store.set(key, fingerprint, 7 * 24 * 60 * 60 * 1000);

    if (!stored) return 0;          // first time seen for this IP → no signal
    if (stored === fingerprint) return 0;  // same fingerprint → no signal

    // Fingerprint changed for an established IP → moderate risk
    return maxPts * 0.6;
  }
}
