import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, from, throwError } from 'rxjs';
import { catchError, switchMap, tap } from 'rxjs/operators';
import { Request } from 'express';
import { GUARD_METADATA } from '../../constants/guard.constants';
import { ConcurrencyOptions } from '../../decorators/concurrent.decorator';
import { JwtPayload } from '../../interfaces/jwt-payload.interface';
import { IpExtractorService } from '../../services/ip-extractor.service';
import { RedisStoreService } from '../../services/redis-store.service';
import { ConcurrencyLimitException } from '../../exceptions/security.exception';

/**
 * Concurrency Interceptor — limits simultaneous in-flight requests
 *
 * Why an interceptor and not a guard?
 * A guard only runs before the handler and has no mechanism to run cleanup
 * code afterward. To release a concurrency slot after the response is sent
 * (success OR error), we need to wrap the handler — that is what interceptors
 * do via RxJS observables. The same pattern used by IdempotencyInterceptor.
 *
 * ─── What it does ─────────────────────────────────────────────────────────────
 *
 *   @Concurrent({ maxConcurrent: 3 }) → only 3 requests handled at the same time
 *
 *   1. Request arrives → incr counter → if > max → decr + throw 429
 *   2. Request arrives → incr → counter ≤ max → handler runs
 *   3. Handler finishes (success) → decr counter
 *   4. Handler throws (error)     → decr counter + rethrow
 *   5. Safety TTL auto-resets the key if a slot leaks (crash, kill, etc.)
 *
 * ─── Use cases ────────────────────────────────────────────────────────────────
 *
 *   • Double-submit prevention: user clicks "Pay" twice simultaneously
 *   • Expensive endpoints: AI inference, image processing, PDF generation
 *   • Race condition protection: two requests trying to modify the same resource
 *   • Spam prevention: bots hammering an endpoint without waiting for a response
 *
 * ─── Usage ────────────────────────────────────────────────────────────────────
 *
 *   @Concurrent({ maxConcurrent: 2, keyBy: 'user' })
 *   @UseInterceptors(ConcurrencyInterceptor)
 *   @Post('generate-report')
 *   async generateReport() { ... }
 *
 *   // User with 2 in-flight → 3rd request gets 429 Too Many Requests
 *   // When one finishes → next request goes through immediately
 *
 * ─── Response headers ─────────────────────────────────────────────────────────
 *
 *   X-Concurrency-Limit:   <maxConcurrent>
 *   X-Concurrency-Current: <current count at time of request>
 */
@Injectable()
export class ConcurrencyInterceptor implements NestInterceptor {
  private readonly logger = new Logger(ConcurrencyInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly store: RedisStoreService,
    private readonly ipExtractor: IpExtractorService,
  ) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const options = this.reflector.getAllAndOverride<ConcurrencyOptions | undefined>(
      GUARD_METADATA.CONCURRENCY_OPTIONS,
      [context.getHandler(), context.getClass()],
    );

    if (!options) return next.handle();

    const request  = context.switchToHttp().getRequest<Request & { user?: JwtPayload }>();
    const response = context.switchToHttp().getResponse();

    const { maxConcurrent, keyBy = 'ip', ttlMs = 30_000 } = options;

    // ── Build scoped counter key ─────────────────────────────────────────────
    const storeKey = this.buildKey(request, context, keyBy);

    // ── Increment counter atomically ─────────────────────────────────────────
    const current = await this.store.incr(storeKey);

    // Set safety TTL on first increment so the key self-heals on process crash
    if (current === 1) {
      await this.store.expire(storeKey, ttlMs);
    }

    response.setHeader('X-Concurrency-Limit', maxConcurrent);
    response.setHeader('X-Concurrency-Current', current);

    // ── Over limit: release slot and reject ──────────────────────────────────
    if (current > maxConcurrent) {
      await this.store.decr(storeKey);
      this.logger.warn(
        `Concurrency limit exceeded — key=${storeKey} current=${current} max=${maxConcurrent}`,
      );
      throw new ConcurrencyLimitException(current - 1, maxConcurrent);
    }

    this.logger.debug(`Concurrency slot acquired — key=${storeKey} current=${current}/${maxConcurrent}`);

    // ── Process request, always release slot ─────────────────────────────────
    return next.handle().pipe(
      tap(async () => {
        await this.store.decr(storeKey);
        this.logger.debug(`Concurrency slot released (success) — key=${storeKey}`);
      }),
      catchError((err: unknown) => {
        return from(this.store.decr(storeKey)).pipe(
          tap(() => this.logger.debug(`Concurrency slot released (error) — key=${storeKey}`)),
          switchMap(() => throwError(() => err)),
        );
      }),
    );
  }

  private buildKey(
    request: Request & { user?: JwtPayload },
    context: ExecutionContext,
    keyBy: ConcurrencyOptions['keyBy'],
  ): string {
    const ip    = this.ipExtractor.getClientIp(request);
    const userId = request.user?.sub ?? 'anon';

    switch (keyBy) {
      case 'user':
        return `concurrency:user:${userId}`;
      case 'user+route': {
        const handler = context.getHandler().name;
        const cls     = context.getClass().name;
        return `concurrency:user+route:${userId}:${cls}.${handler}`;
      }
      case 'global': {
        const handler = context.getHandler().name;
        const cls     = context.getClass().name;
        return `concurrency:global:${cls}.${handler}`;
      }
      case 'ip':
      default:
        return `concurrency:ip:${ip}`;
    }
  }
}
