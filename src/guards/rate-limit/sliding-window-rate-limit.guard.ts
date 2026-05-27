import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request, Response } from 'express';
import { GUARD_METADATA } from '../../constants/guard.constants';
import { RedisStoreService } from '../../services/redis-store.service';
import { IpExtractorService } from '../../services/ip-extractor.service';
import { RateLimitExceededException } from '../../exceptions/throttle.exception';

export interface SlidingWindowOptions {
  windowMs: number;
  max: number;
  keyBy?: 'ip' | 'user' | 'custom';
  keyGenerator?: (req: Request) => string;
  skipIf?: (req: Request) => boolean;
}

/**
 * Level 3 — Sliding Window Rate Limiter Guard
 *
 * Counts requests within a rolling time window using timestamp lists.
 * More accurate than fixed-window rate limiters — avoids boundary bursts.
 * Backed by RedisStoreService (in-memory or Redis, no config change needed).
 *
 * Sets standard rate limit headers:
 *   X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset
 *
 * Usage:
 *   @SetMetadata(GUARD_METADATA.RATE_LIMIT_OPTIONS, { windowMs: 60_000, max: 10, keyBy: 'user' })
 *   @UseGuards(SlidingWindowRateLimitGuard)
 *   @Post('login')
 *   login() {}
 */
@Injectable()
export class SlidingWindowRateLimitGuard implements CanActivate {
  private readonly logger = new Logger(SlidingWindowRateLimitGuard.name);

  constructor(
    private reflector: Reflector,
    private store: RedisStoreService,
    private ipExtractor: IpExtractorService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const options = this.reflector.getAllAndOverride<SlidingWindowOptions>(
      GUARD_METADATA.RATE_LIMIT_OPTIONS,
      [context.getHandler(), context.getClass()],
    );

    if (!options) return true;

    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();

    if (options.skipIf?.(request)) return true;

    const key = this.buildKey(request, options);
    const now = Date.now();
    const windowStart = now - options.windowMs;

    // Fetch existing timestamps
    const raw = await this.store.lrange(key, 0, -1);
    const timestamps = raw
      .map(Number)
      .filter((ts) => ts > windowStart);

    // Check limit before adding new timestamp
    const count = timestamps.length;
    const remaining = Math.max(0, options.max - count - 1);
    const resetAt = timestamps.length > 0
      ? Math.ceil((timestamps[timestamps.length - 1] + options.windowMs) / 1000)
      : Math.ceil((now + options.windowMs) / 1000);

    response.setHeader('X-RateLimit-Limit', options.max);
    response.setHeader('X-RateLimit-Remaining', remaining);
    response.setHeader('X-RateLimit-Reset', resetAt);

    if (count >= options.max) {
      const retryAfter = Math.ceil((timestamps[timestamps.length - 1] + options.windowMs - now) / 1000);
      response.setHeader('Retry-After', retryAfter);
      this.logger.warn(`Rate limit exceeded for key: ${key}`);
      throw new RateLimitExceededException(options.max, options.windowMs, retryAfter);
    }

    // Record this request
    await this.store.lpush(key, String(now));
    // Keep only timestamps within the window (prune old ones)
    const validTimestamps = [String(now), ...raw.filter((ts) => Number(ts) > windowStart)];
    // Rebuild the list in the store with only valid timestamps
    await this.store.del(key);
    for (const ts of validTimestamps.reverse()) {
      await this.store.lpush(key, ts);
    }
    await this.store.expire(key, options.windowMs * 2);

    return true;
  }

  protected buildKey(request: Request, options: SlidingWindowOptions): string {
    if (options.keyGenerator) return `rateLimit:${options.keyGenerator(request)}`;
    if (options.keyBy === 'user') {
      const user = (request as any).user;
      return `rateLimit:user:${user?.sub ?? 'anonymous'}`;
    }
    const ip = this.ipExtractor.getClientIp(request);
    return `rateLimit:ip:${ip}`;
  }
}
