import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request, Response } from 'express';
import { GUARD_METADATA } from '../../constants/guard.constants';
import { RateLimitByRouteOptions } from '../../decorators/rate-limit-by-route.decorator';
import { RedisStoreService } from '../../services/redis-store.service';
import { IpExtractorService } from '../../services/ip-extractor.service';
import { RateLimitExceededException, PenaltyBoxException } from '../../exceptions/throttle.exception';

// ── Built-in profiles ──────────────────────────────────────────────────────

interface ResolvedOptions {
  max:                     number;
  windowMs:                number;
  burstMax:                number | undefined;
  burstWindowMs:           number | undefined;
  penaltyMs:               number;
  violationsBeforePenalty: number;
  keyBy:                   'ip' | 'user';
}

type ProfileMap = Record<string, Omit<ResolvedOptions, never>>;

const PROFILES: ProfileMap = {
  /**
   * login — strict IP-keyed limit with penalty box.
   * Stops credential-stuffing: 5 attempts/min, at most 2 in any 5-second burst,
   * then 5-minute lockout after 3 violations.
   */
  login: {
    max:                     5,
    windowMs:                60_000,
    burstMax:                2,
    burstWindowMs:           5_000,
    penaltyMs:               300_000,   // 5 min lockout
    violationsBeforePenalty: 3,
    keyBy:                   'ip',
  },

  /**
   * payment — conservative user-keyed limit with penalty box.
   * Prevents enumeration / rapid charge attacks.
   */
  payment: {
    max:                     10,
    windowMs:                60_000,
    burstMax:                2,
    burstWindowMs:           10_000,
    penaltyMs:               900_000,   // 15 min lockout
    violationsBeforePenalty: 2,
    keyBy:                   'user',
  },

  /**
   * search — generous user-keyed limit, burst check prevents hammering.
   * No penalty — search abuse is low-risk.
   */
  search: {
    max:                     60,
    windowMs:                60_000,
    burstMax:                15,
    burstWindowMs:           5_000,
    penaltyMs:               0,
    violationsBeforePenalty: 10,
    keyBy:                   'user',
  },

  /**
   * api — standard authenticated endpoint limit.
   */
  api: {
    max:                     100,
    windowMs:                60_000,
    burstMax:                20,
    burstWindowMs:           5_000,
    penaltyMs:               0,
    violationsBeforePenalty: 10,
    keyBy:                   'user',
  },

  /**
   * public — anonymous endpoints, IP-keyed, no penalty.
   */
  public: {
    max:                     30,
    windowMs:                60_000,
    burstMax:                10,
    burstWindowMs:           5_000,
    penaltyMs:               0,
    violationsBeforePenalty: 10,
    keyBy:                   'ip',
  },
};

/**
 * Level 3 — Rate Limit By Route Guard
 *
 * Per-endpoint rate limiting with three features the basic SlidingWindowRateLimitGuard
 * does not provide:
 *
 * ── 1. Profiles ──────────────────────────────────────────────────────────────
 *
 *   Named presets encode proven production defaults.
 *   @RateLimit('login')   → 5/min, burst 2/5s, penalty 5min after 3 violations
 *   @RateLimit('payment') → 10/min, burst 2/10s, penalty 15min after 2 violations
 *   @RateLimit('search')  → 60/min, burst 15/5s, no penalty
 *   @RateLimit('api')     → 100/min, burst 20/5s, no penalty
 *   @RateLimit('public')  → 30/min, burst 10/5s, no penalty
 *
 * ── 2. Dual-window burst detection ────────────────────────────────────────────
 *
 *   Two independent sliding windows per request:
 *     Burst:     short window catches concentrated attacks  (e.g. 2 req / 5s)
 *     Sustained: long window enforces the overall rate      (e.g. 5 req / 60s)
 *
 *   Why both? A bot hitting 5 login attempts spread across 60 seconds stays
 *   within the sustained limit. The burst window (2/5s) blocks it immediately.
 *
 * ── 3. Penalty box ────────────────────────────────────────────────────────────
 *
 *   After violationsBeforePenalty limit-exceeded events, the IP/user is locked
 *   out for penaltyMs milliseconds. The lockout is checked before any window
 *   count — no computation wasted on blocked clients.
 *
 *   login (3 violations → 5min):
 *     normal: each violation rejects the request and resets after the window.
 *     attacker: after the 3rd violation, all requests → 429 for 5 minutes,
 *     regardless of how spread-out they are.
 *
 * ── Response headers ─────────────────────────────────────────────────────────
 *
 *   X-RateLimit-Limit            — sustained max
 *   X-RateLimit-Remaining        — remaining sustained requests
 *   X-RateLimit-Reset            — seconds until sustained window resets
 *   X-RateLimit-Profile          — active profile name or 'custom'
 *   X-RateLimit-Burst-Limit      — burst max (if configured)
 *   X-RateLimit-Burst-Remaining  — remaining burst requests
 *   Retry-After                  — seconds (on 429)
 *
 * Usage:
 *   @RateLimit('login')
 *   @UseGuards(RateLimitByRouteGuard)
 *   @Post('login')
 *   login() {}
 *
 *   // Profile + override
 *   @RateLimit({ profile: 'login', max: 3 })
 *   @UseGuards(RateLimitByRouteGuard)
 *   @Post('login-strict')
 *   loginStrict() {}
 *
 *   // Custom config with burst
 *   @RateLimit({ max: 5, windowMs: 60_000, burstMax: 1, burstWindowMs: 3_000 })
 *   @UseGuards(RateLimitByRouteGuard)
 *   @Post('otp')
 *   otp() {}
 */
@Injectable()
export class RateLimitByRouteGuard implements CanActivate {
  private readonly logger = new Logger(RateLimitByRouteGuard.name);

  constructor(
    private readonly reflector:    Reflector,
    private readonly store:        RedisStoreService,
    private readonly ipExtractor:  IpExtractorService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const raw = this.reflector.getAllAndOverride<RateLimitByRouteOptions | undefined>(
      GUARD_METADATA.RATE_LIMIT_BY_ROUTE_OPTIONS,
      [context.getHandler(), context.getClass()],
    );

    if (!raw) return true;

    const request  = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();

    if (raw.skipIf?.(request)) return true;

    const opts     = this.resolveOptions(raw);
    const id       = this.resolveId(request, opts);
    const route    = (request as any).route?.path ?? request.url.split('?')[0];
    const keyBase  = `rlRoute:${opts.keyBy}:${id}:${route}`;
    const profile  = raw.profile ?? 'custom';

    response.setHeader('X-RateLimit-Profile', profile);

    // ── 1. Penalty box ─────────────────────────────────────────────────────
    const penaltyRaw = await this.store.get(`${keyBase}:penalty`);
    if (penaltyRaw) {
      const retryAfter = Math.max(1, Math.ceil((parseInt(penaltyRaw, 10) - Date.now()) / 1000));
      response.setHeader('Retry-After', retryAfter);
      this.logger.warn(`Penalty box hit — ${opts.keyBy}=${id} route=${route} retryAfter=${retryAfter}s`);
      throw new PenaltyBoxException(retryAfter);
    }

    const now = Date.now();

    // ── 2. Burst window check ──────────────────────────────────────────────
    if (opts.burstMax !== undefined && opts.burstWindowMs !== undefined) {
      const burstKey   = `${keyBase}:burst`;
      const burstCount = await this.countInWindow(burstKey, now, opts.burstWindowMs);

      response.setHeader('X-RateLimit-Burst-Limit',     opts.burstMax);
      response.setHeader('X-RateLimit-Burst-Remaining', Math.max(0, opts.burstMax - burstCount - 1));

      if (burstCount >= opts.burstMax) {
        const retryAfter = Math.ceil(opts.burstWindowMs / 1000);
        response.setHeader('Retry-After', retryAfter);
        await this.recordViolation(keyBase, opts, id, route, 'burst');
        this.logger.warn(`Burst limit — ${opts.keyBy}=${id} route=${route} count=${burstCount}/${opts.burstMax}`);
        throw new RateLimitExceededException(opts.burstMax, opts.burstWindowMs, retryAfter);
      }
    }

    // ── 3. Sustained window check ──────────────────────────────────────────
    const sustainedKey   = `${keyBase}:sustained`;
    const sustainedCount = await this.countInWindow(sustainedKey, now, opts.windowMs);

    const resetIn = Math.ceil(opts.windowMs / 1000);
    response.setHeader('X-RateLimit-Limit',     opts.max);
    response.setHeader('X-RateLimit-Remaining', Math.max(0, opts.max - sustainedCount - 1));
    response.setHeader('X-RateLimit-Reset',     resetIn);

    if (sustainedCount >= opts.max) {
      const retryAfter = resetIn;
      response.setHeader('Retry-After', retryAfter);
      await this.recordViolation(keyBase, opts, id, route, 'sustained');
      this.logger.warn(`Sustained limit — ${opts.keyBy}=${id} route=${route} count=${sustainedCount}/${opts.max}`);
      throw new RateLimitExceededException(opts.max, opts.windowMs, retryAfter);
    }

    // ── 4. Record this request ─────────────────────────────────────────────
    await this.recordTimestamp(sustainedKey, now, opts.windowMs);

    if (opts.burstMax !== undefined && opts.burstWindowMs !== undefined) {
      await this.recordTimestamp(`${keyBase}:burst`, now, opts.burstWindowMs);
    }

    return true;
  }

  // ── Sliding window helpers ─────────────────────────────────────────────────

  private async countInWindow(key: string, now: number, windowMs: number): Promise<number> {
    const raw = await this.store.lrange(key, 0, -1);
    return raw.map(Number).filter((ts) => ts > now - windowMs).length;
  }

  private async recordTimestamp(key: string, now: number, windowMs: number): Promise<void> {
    const raw   = await this.store.lrange(key, 0, -1);
    const valid = [String(now), ...raw.filter((ts) => Number(ts) > now - windowMs)];
    await this.store.del(key);
    for (const ts of valid.slice(0, 500).reverse()) {
      await this.store.lpush(key, ts);
    }
    await this.store.expire(key, windowMs * 2);
  }

  // ── Penalty box ────────────────────────────────────────────────────────────

  private async recordViolation(
    keyBase:  string,
    opts:     ResolvedOptions,
    id:       string,
    route:    string,
    window:   'burst' | 'sustained',
  ): Promise<void> {
    if (!opts.penaltyMs) return;

    const violKey   = `${keyBase}:violations`;
    const violations = await this.store.incr(violKey);

    // Set 24h reset window on first violation
    if (violations === 1) {
      await this.store.expire(violKey, 24 * 60 * 60 * 1000);
    }

    if (violations >= opts.violationsBeforePenalty) {
      const expiresAt = Date.now() + opts.penaltyMs;
      await this.store.set(`${keyBase}:penalty`, String(expiresAt), opts.penaltyMs);
      await this.store.del(violKey);
      this.logger.warn(
        `Penalty box entered — ${opts.keyBy}=${id} route=${route}` +
          ` window=${window} violations=${violations} lockout=${opts.penaltyMs / 1000}s`,
      );
    } else {
      this.logger.debug(
        `Violation ${violations}/${opts.violationsBeforePenalty} — ${opts.keyBy}=${id} route=${route}`,
      );
    }
  }

  // ── Options resolution ────────────────────────────────────────────────────

  private resolveOptions(raw: RateLimitByRouteOptions): ResolvedOptions {
    const profile = raw.profile ? (PROFILES[raw.profile] ?? {}) : {};
    return {
      max:                     raw.max                     ?? (profile as any).max                     ?? 60,
      windowMs:                raw.windowMs                ?? (profile as any).windowMs                ?? 60_000,
      burstMax:                raw.burstMax                ?? (profile as any).burstMax,
      burstWindowMs:           raw.burstWindowMs           ?? (profile as any).burstWindowMs,
      penaltyMs:               raw.penaltyMs               ?? (profile as any).penaltyMs               ?? 0,
      violationsBeforePenalty: raw.violationsBeforePenalty ?? (profile as any).violationsBeforePenalty ?? 3,
      keyBy:                   raw.keyBy                   ?? (profile as any).keyBy                   ?? 'ip',
    };
  }

  private resolveId(request: Request, opts: ResolvedOptions): string {
    if (opts.keyBy === 'user') {
      const sub = (request as any).user?.sub;
      if (sub != null) return String(sub);
      // No JWT user — fall back to IP so anonymous traffic is still limited
    }
    return this.ipExtractor.getClientIp(request);
  }
}
