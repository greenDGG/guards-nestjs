import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, from, of, throwError } from 'rxjs';
import { catchError, switchMap, tap } from 'rxjs/operators';
import { Request, Response } from 'express';
import { GUARD_METADATA } from '../../constants/guard.constants';
import { IdempotencyOptions } from '../../decorators/idempotency.decorator';
import { JwtPayload } from '../../interfaces/jwt-payload.interface';
import { RedisStoreService } from '../../services/redis-store.service';
import {
  IdempotencyConflictException,
  IdempotencyKeyMissingException,
} from '../../exceptions/security.exception';

/**
 * Idempotency Interceptor — prevents double payments, duplicate mutations, and race abuse
 *
 * Why an interceptor and not a guard?
 * Guards only run BEFORE the handler. To replay a cached response we also need to run
 * AFTER the handler to capture and store it. Interceptors wrap both sides — they are
 * the correct NestJS primitive for response caching and short-circuiting.
 *
 * ─── What it does ─────────────────────────────────────────────────────────────
 *
 *  Request arrives with Idempotency-Key: <uuid>
 *
 *  1. KEY NOT SEEN before → acquire processing lock → run handler → cache response
 *  2. KEY SEEN (cached)   → replay cached response instantly, handler never runs
 *  3. KEY SEEN (locked)   → another request is in-flight → 409 Conflict
 *  4. HANDLER THROWS      → release lock (client can retry safely)
 *
 * ─── Usage ────────────────────────────────────────────────────────────────────
 *
 *   @Idempotent()
 *   @UseInterceptors(IdempotencyInterceptor)
 *   @Post('payment')
 *   async pay(@Body() dto: PayDto) {
 *     return this.paymentsService.charge(dto);
 *   }
 *
 *   // Client sends:
 *   // Idempotency-Key: 550e8400-e29b-41d4-a716-446655440000
 *   // Second request with same key → gets the same response without charging again
 *
 * ─── Scoping by user (prevents key hijacking) ─────────────────────────────────
 *
 *   By default (scopeByUser: true), the store key is prefixed with the JWT sub.
 *   User A's key "abc" and user B's key "abc" are treated as different keys.
 *   This prevents an attacker from sending the same key as a victim to get their result.
 *
 * ─── Headers on response ──────────────────────────────────────────────────────
 *
 *   Idempotency-Key: <the key that was used>
 *   Idempotency-Replayed: true    ← only present on replayed responses
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly logger = new Logger(IdempotencyInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly store: RedisStoreService,
  ) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const options = this.reflector.getAllAndOverride<IdempotencyOptions | undefined>(
      GUARD_METADATA.IDEMPOTENCY_OPTIONS,
      [context.getHandler(), context.getClass()],
    );

    if (!options) return next.handle();

    const request  = context.switchToHttp().getRequest<Request & { user?: JwtPayload }>();
    const response = context.switchToHttp().getResponse<Response>();

    const headerName = options.header ?? 'idempotency-key';
    const idempKey   = request.headers[headerName] as string | undefined;

    // ── Missing key ─────────────────────────────────────────────────────────
    if (!idempKey) {
      if (!options.optional) throw new IdempotencyKeyMissingException(headerName);
      return next.handle(); // optional — skip idempotency
    }

    // ── Build scoped store keys ──────────────────────────────────────────────
    // Scope per user so key "abc" from user 1 ≠ key "abc" from user 2
    const userId      = options.scopeByUser !== false ? (request.user?.sub ?? 'anon') : 'global';
    const responseKey = `idmp:res:${userId}:${idempKey}`;
    const lockKey     = `idmp:lock:${userId}:${idempKey}`;

    // ── 1. Replay cached response ────────────────────────────────────────────
    const cached = await this.store.get(responseKey);
    if (cached) {
      const { status, body } = JSON.parse(cached) as { status: number; body: unknown };
      this.logger.debug(`Idempotency replay — key=${idempKey} user=${userId}`);
      response.status(status);
      response.setHeader('Idempotency-Key', idempKey);
      response.setHeader('Idempotency-Replayed', 'true');
      return of(body);
    }

    // ── 2. Acquire processing lock (race condition prevention) ───────────────
    const lockTtl  = options.lockTtlMs ?? 30_000;
    const acquired = await this.store.setnx(lockKey, '1', lockTtl);

    if (!acquired) {
      // Another request with the same key is in-flight
      this.logger.warn(`Idempotency conflict — key=${idempKey} user=${userId} is being processed`);
      throw new IdempotencyConflictException();
    }

    this.logger.debug(`Idempotency new request — key=${idempKey} user=${userId}`);

    // ── 3. Process request, cache response, release lock ─────────────────────
    const ttl = options.ttlMs ?? 86_400_000; // 24h

    return next.handle().pipe(
      tap(async (body: unknown) => {
        const status = response.statusCode ?? 200;
        await this.store.set(responseKey, JSON.stringify({ status, body }), ttl);
        await this.store.del(lockKey);
        response.setHeader('Idempotency-Key', idempKey);
        this.logger.debug(`Idempotency cached — key=${idempKey} status=${status} ttl=${ttl}ms`);
      }),
      catchError((err: unknown) => {
        // On error: release lock but don't cache — the client should fix and retry
        return from(this.store.del(lockKey)).pipe(
          switchMap(() => throwError(() => err)),
        );
      }),
    );
  }
}
