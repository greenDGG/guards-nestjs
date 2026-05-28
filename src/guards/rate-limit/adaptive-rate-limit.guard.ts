import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request, Response } from 'express';
import { GUARD_METADATA } from '../../constants/guard.constants';
import { RedisStoreService } from '../../services/redis-store.service';
import { SecurityContextService } from '../../services/security-context.service';
import { RateLimitExceededException } from '../../exceptions/throttle.exception';

// ── Tier definitions ───────────────────────────────────────────────────────

export interface SignalTier {
  /** Score must be <= maxScore to match this tier (tiers evaluated lowest-first) */
  maxScore: number;
  multiplier: number;
  label: string;
}

export interface AdaptiveRateLimitOptions {
  /** Sliding window size in milliseconds */
  windowMs: number;

  /**
   * Maximum requests for a fully trusted, clean user.
   * Actual limit = baseMax × trustMultiplier × botMultiplier
   */
  baseMax: number;

  /** Key the rate limit by 'ip' (default) or 'user' (JWT sub) */
  keyBy?: 'ip' | 'user';

  /**
   * Trust score tiers — reflects long-term reputation (stored in Redis).
   * Score starts at 50 for unknown users, grows with good behavior,
   * shrinks with anomalies.
   *
   * Default:
   *   0–25   → ×0.02  (≈ 2 req/min on baseMax 100) — severely untrusted
   *   26–50  → ×0.10  (≈ 10 req/min)               — new / unknown user
   *   51–75  → ×0.50  (≈ 50 req/min)               — regular user
   *   76–90  → ×1.00  (= baseMax)                  — trusted user
   *   91–100 → ×2.00  (= 2× baseMax)               — VIP / verified
   */
  trustTiers?: SignalTier[];

  /**
   * Bot score tiers — reflects real-time behavior on this request.
   * Computed by BotDetectionGuard and stored in SecurityContext.
   * If BotDetectionGuard has not run, defaults to score 0 (clean).
   *
   * Default:
   *   0–20   → ×1.00  — clean
   *   21–50  → ×0.50  — mildly suspicious
   *   51–70  → ×0.10  — likely automated
   *   71–100 → ×0.02  — confirmed bot
   */
  botTiers?: SignalTier[];

  /**
   * Absolute minimum effective limit regardless of multipliers.
   * Prevents a multiplier combination from dropping to 0.
   * @default 1
   */
  minLimit?: number;

  /**
   * Expose trust and bot scoring details in response headers.
   *
   * DEFAULT: false — hidden to prevent attackers from using the headers to
   * calibrate their bots (they can read X-RateLimit-Trust-Score and know
   * exactly how far they are from the next tier threshold).
   *
   * Enable only in development / internal dashboards.
   */
  exposeDebugHeaders?: boolean;
}

// ── Default tiers ──────────────────────────────────────────────────────────

export const DEFAULT_TRUST_TIERS: SignalTier[] = [
  { maxScore: 25,  multiplier: 0.02, label: 'severely-untrusted' },
  { maxScore: 50,  multiplier: 0.10, label: 'new-user'           },
  { maxScore: 75,  multiplier: 0.50, label: 'regular'            },
  { maxScore: 90,  multiplier: 1.00, label: 'trusted'            },
  { maxScore: 100, multiplier: 2.00, label: 'vip'                },
];

export const DEFAULT_BOT_TIERS: SignalTier[] = [
  { maxScore: 20,  multiplier: 1.00, label: 'clean'       },
  { maxScore: 50,  multiplier: 0.50, label: 'suspicious'  },
  { maxScore: 70,  multiplier: 0.10, label: 'likely-bot'  },
  { maxScore: 100, multiplier: 0.02, label: 'bot'         },
];

/**
 * Level 3 — Adaptive Rate Limiter Guard
 *
 * Computes the effective rate limit from two independent signals:
 *
 *   effectiveLimit = baseMax × trustMultiplier × botMultiplier
 *
 * ── Trust score (long-term reputation) ────────────────────────────────────
 *
 *   Stored in Redis. Updated over time by AnomalyDetectionGuard.
 *   Unknown users start at score 50. Established users reach 76–90.
 *   Trust decays when anomalies are detected and recovers with clean behavior.
 *
 * ── Bot score (real-time behavior) ────────────────────────────────────────
 *
 *   Computed per-request by BotDetectionGuard and stored in SecurityContext.
 *   If BotDetectionGuard has not run before this guard, bot score = 0 (clean).
 *   The two axes are independent and multiplicative.
 *
 * ── Example with baseMax = 100 req/min ────────────────────────────────────
 *
 *   VIP user    (trust=95, botScore=5)  → 100 × 2.00 × 1.00 = 200 req/min
 *   Trusted     (trust=80, botScore=5)  → 100 × 1.00 × 1.00 = 100 req/min
 *   New user    (trust=50, botScore=5)  → 100 × 0.10 × 1.00 =  10 req/min
 *   Suspicious  (trust=80, botScore=60) → 100 × 1.00 × 0.10 =  10 req/min
 *   Bot         (trust=50, botScore=80) → 100 × 0.10 × 0.02 =   1 req/min (floors to minLimit)
 *
 * ── Response headers ──────────────────────────────────────────────────────
 *
 *   X-RateLimit-Limit:              100   (effective limit)
 *   X-RateLimit-Remaining:           95
 *   X-RateLimit-Reset:               45   (seconds)
 *   X-RateLimit-Base:               100
 *   X-RateLimit-Trust-Score:         80
 *   X-RateLimit-Trust-Tier:      trusted
 *   X-RateLimit-Trust-Multiplier:   1.0
 *   X-RateLimit-Bot-Score:            5
 *   X-RateLimit-Bot-Tier:          clean
 *   X-RateLimit-Bot-Multiplier:     1.0
 *   X-RateLimit-Multiplier:         1.0   (combined = trust × bot)
 *
 * Usage:
 *   @SetMetadata(GUARD_METADATA.ADAPTIVE_RATE_LIMIT_OPTIONS, {
 *     windowMs: 60_000,
 *     baseMax: 100,
 *     keyBy: 'user',
 *   })
 *   @UseGuards(BotDetectionGuard, AdaptiveRateLimitGuard)
 *   @Get('feed')
 *   getFeed() {}
 *
 * Note: place BotDetectionGuard before this guard so botScore is in SecurityContext.
 */
@Injectable()
export class AdaptiveRateLimitGuard implements CanActivate {
  private readonly logger = new Logger(AdaptiveRateLimitGuard.name);

  // Newly seen users start with a cautious trust score, not maximum
  private readonly DEFAULT_TRUST_SCORE = 50;

  constructor(
    private readonly reflector: Reflector,
    private readonly store: RedisStoreService,
    private readonly secCtx: SecurityContextService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const options = this.reflector.getAllAndOverride<AdaptiveRateLimitOptions>(
      GUARD_METADATA.ADAPTIVE_RATE_LIMIT_OPTIONS,
      [context.getHandler(), context.getClass()],
    );

    if (!options) return true;

    const request  = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    const ctx      = this.secCtx.get(request);

    // ── Resolve the two signals ────────────────────────────────────────────

    const trustScore = await this.resolveTrustScore(request, ctx.userId ?? (request as any).user?.sub);
    const botScore   = ctx.botScore ?? 0; // 0 = clean (BotDetectionGuard not applied on this route)

    // Populate context so downstream code can read current trust score
    ctx.trustScore = trustScore;

    // ── Compute effective limit ────────────────────────────────────────────

    const trustTiers = options.trustTiers ?? DEFAULT_TRUST_TIERS;
    const botTiers   = options.botTiers   ?? DEFAULT_BOT_TIERS;

    const trustTier = this.resolveTier(trustScore, trustTiers);
    const botTier   = this.resolveTier(botScore,   botTiers);

    const combinedMultiplier = trustTier.multiplier * botTier.multiplier;
    const minLimit = options.minLimit ?? 1;
    const effectiveMax = Math.max(minLimit, Math.floor(options.baseMax * combinedMultiplier));

    // ── Sliding window count ───────────────────────────────────────────────

    const key         = this.buildKey(request, options, ctx);
    const now         = Date.now();
    const windowStart = now - options.windowMs;

    const raw        = await this.store.lrange(key, 0, -1);
    const timestamps = raw.map(Number).filter((ts) => ts > windowStart);
    const count      = timestamps.length;

    // ── Response headers ──────────────────────────────────────────────────

    const resetIn = timestamps.length > 0
      ? Math.ceil((timestamps[timestamps.length - 1] + options.windowMs - now) / 1000)
      : Math.ceil(options.windowMs / 1000);

    // Standard rate-limit headers — always present
    response.setHeader('X-RateLimit-Limit',     effectiveMax);
    response.setHeader('X-RateLimit-Remaining', Math.max(0, effectiveMax - count - 1));
    response.setHeader('X-RateLimit-Reset',     resetIn);

    // Debug headers — opt-in (exposeDebugHeaders: true).
    // Hidden by default: attackers can use trust/bot score headers to calibrate
    // their requests to stay just below the block threshold.
    if (options.exposeDebugHeaders) {
      response.setHeader('X-RateLimit-Base',             options.baseMax);
      response.setHeader('X-RateLimit-Trust-Score',      trustScore);
      response.setHeader('X-RateLimit-Trust-Tier',       trustTier.label);
      response.setHeader('X-RateLimit-Trust-Multiplier', trustTier.multiplier);
      response.setHeader('X-RateLimit-Bot-Score',        botScore);
      response.setHeader('X-RateLimit-Bot-Tier',         botTier.label);
      response.setHeader('X-RateLimit-Bot-Multiplier',   botTier.multiplier);
      response.setHeader('X-RateLimit-Multiplier',       combinedMultiplier.toFixed(4));
    }

    // ── Enforce limit ──────────────────────────────────────────────────────

    if (count >= effectiveMax) {
      this.logger.warn(
        `Adaptive limit exceeded — ` +
        `trust=${trustScore}(${trustTier.label})×${trustTier.multiplier} ` +
        `bot=${botScore}(${botTier.label})×${botTier.multiplier} ` +
        `→ limit=${effectiveMax} count=${count}`,
      );
      response.setHeader('Retry-After', resetIn);
      throw new RateLimitExceededException(effectiveMax, options.windowMs, resetIn);
    }

    // ── Record this request ────────────────────────────────────────────────

    const validTimestamps = [String(now), ...raw.filter((ts) => Number(ts) > windowStart)];
    await this.store.del(key);
    for (const ts of validTimestamps.reverse()) {
      await this.store.lpush(key, ts);
    }
    await this.store.expire(key, options.windowMs * 2);

    this.logger.debug(
      `Adaptive RL — trust=${trustScore}(×${trustTier.multiplier}) ` +
      `bot=${botScore}(×${botTier.multiplier}) ` +
      `→ ${count + 1}/${effectiveMax}`,
    );

    return true;
  }

  /**
   * Reads trust score from SecurityContext (if already resolved this request)
   * or from Redis (persistent, cross-request). Falls back to DEFAULT_TRUST_SCORE.
   */
  private async resolveTrustScore(
    request: Request,
    userId?: string | number,
  ): Promise<number> {
    const ctx = this.secCtx.get(request);

    // If already computed this request (e.g., by AnomalyDetectionGuard), reuse it
    if (ctx.trustScore !== undefined) return ctx.trustScore;

    if (userId) {
      const stored = await this.store.get(`trustScore:${userId}`);
      return stored !== null ? parseInt(stored, 10) : this.DEFAULT_TRUST_SCORE;
    }

    // Anonymous users — use IP-based trust key (more ephemeral)
    const ip = ctx.ip;
    const ipTrust = await this.store.get(`trustScore:ip:${ip}`);
    return ipTrust !== null ? parseInt(ipTrust, 10) : this.DEFAULT_TRUST_SCORE;
  }

  /**
   * Find the tier for a given score.
   * Tiers should be ordered by maxScore ascending.
   * Returns the last tier if score exceeds all maxScore values.
   */
  private resolveTier(score: number, tiers: SignalTier[]): SignalTier {
    const sorted = [...tiers].sort((a, b) => a.maxScore - b.maxScore);
    return sorted.find((t) => score <= t.maxScore) ?? sorted[sorted.length - 1];
  }

  private buildKey(
    request: Request,
    options: AdaptiveRateLimitOptions,
    ctx: ReturnType<SecurityContextService['get']>,
  ): string {
    if (options.keyBy === 'user') {
      const userId = ctx.userId ?? (request as any).user?.sub ?? 'anon';
      return `adaptiveRL:user:${userId}`;
    }
    return `adaptiveRL:ip:${ctx.ip}`;
  }
}
