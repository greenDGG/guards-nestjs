import { CallHandler, CanActivate, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, from, throwError } from 'rxjs';
import { catchError, switchMap, tap } from 'rxjs/operators';
import { RedisStoreService } from '../../services/redis-store.service';
import { GUARD_METADATA } from '../../constants/guard.constants';
import { CircuitOpenException } from '../../exceptions/detection.exception';

export interface CircuitBreakerOptions {
  serviceKey: string;
  failureThreshold?: number;
  successThreshold?: number;
  timeout?: number;
  rollingWindowMs?: number;
}

type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

interface CircuitData {
  state: CircuitState;
  failures: number;
  successes: number;
  openedAt?: number;
  halfOpenAt?: number;
}

// Resolved options used by both guard and interceptor
type ResolvedCircuitOptions = Required<Pick<CircuitBreakerOptions,
  'failureThreshold' | 'successThreshold' | 'timeout' | 'rollingWindowMs'
>>;

// WeakMap eliminates request object mutation — no _circuitKey/_circuitOptions pollution.
// Entries are automatically garbage-collected when the request is done.
type CircuitRequestState = { key: string; options: ResolvedCircuitOptions };
const circuitRequestStates = new WeakMap<object, CircuitRequestState>();

/**
 * Level 3 — Circuit Breaker Guard
 *
 * Protects downstream services from cascading failures using the circuit breaker pattern.
 *
 * States:
 *   CLOSED    — Normal operation. Counts failures.
 *   OPEN      — Too many failures. Rejects all requests immediately.
 *   HALF_OPEN — Testing recovery. Allows one request through.
 *
 * IMPORTANT: This guard only controls whether requests reach the handler.
 * To record failures, use CircuitBreakerInterceptor (companion class below).
 *
 * Usage:
 *   @SetMetadata(GUARD_METADATA.CIRCUIT_BREAKER_OPTIONS, {
 *     serviceKey: 'payment-service',
 *     failureThreshold: 5,
 *     timeout: 30_000,
 *   })
 *   @UseGuards(CircuitBreakerGuard)
 *   @UseInterceptors(CircuitBreakerInterceptor)
 *   @Post('pay')
 *   processPayment() {}
 */
@Injectable()
export class CircuitBreakerGuard implements CanActivate {
  private readonly logger = new Logger(CircuitBreakerGuard.name);

  constructor(
    private reflector: Reflector,
    private store: RedisStoreService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const options = this.reflector.getAllAndOverride<CircuitBreakerOptions>(
      GUARD_METADATA.CIRCUIT_BREAKER_OPTIONS,
      [context.getHandler(), context.getClass()],
    );

    if (!options) return true;

    const cfg = {
      failureThreshold: options.failureThreshold ?? 5,
      successThreshold: options.successThreshold ?? 2,
      timeout: options.timeout ?? 30_000,
      rollingWindowMs: options.rollingWindowMs ?? 60_000,
    };

    const storeKey = `circuit:${options.serviceKey}`;
    const raw = await this.store.get(storeKey);
    const circuit: CircuitData = raw
      ? JSON.parse(raw)
      : { state: 'CLOSED', failures: 0, successes: 0 };

    const now = Date.now();

    if (circuit.state === 'OPEN') {
      const elapsed = now - (circuit.openedAt ?? 0);
      if (elapsed < cfg.timeout) {
        const retryAfter = cfg.timeout - elapsed;
        this.logger.warn(`Circuit OPEN for '${options.serviceKey}' — retry in ${Math.ceil(retryAfter / 1000)}s`);
        throw new CircuitOpenException(options.serviceKey, retryAfter);
      }
      // Timeout elapsed — transition to HALF_OPEN
      circuit.state = 'HALF_OPEN';
      circuit.halfOpenAt = now;
      circuit.successes = 0;
      await this.saveCircuit(storeKey, circuit, cfg.rollingWindowMs);
      this.logger.log(`Circuit HALF_OPEN for '${options.serviceKey}'`);
    }

    // Pass state to the companion interceptor via WeakMap (avoids request mutation)
    const request = context.switchToHttp().getRequest<object>();
    circuitRequestStates.set(request, { key: storeKey, options: cfg });

    return true;
  }

  async recordSuccess(storeKey: string, cfg: ResolvedCircuitOptions): Promise<void> {
    const raw = await this.store.get(storeKey);
    if (!raw) return;
    const circuit: CircuitData = JSON.parse(raw);

    if (circuit.state === 'HALF_OPEN') {
      circuit.successes++;
      if (circuit.successes >= cfg.successThreshold) {
        circuit.state = 'CLOSED';
        circuit.failures = 0;
        circuit.successes = 0;
        this.logger.log(`Circuit CLOSED for '${storeKey}'`);
      }
    } else if (circuit.state === 'CLOSED') {
      circuit.failures = Math.max(0, circuit.failures - 1);
    }

    await this.saveCircuit(storeKey, circuit, cfg.rollingWindowMs);
  }

  async recordFailure(storeKey: string, cfg: ResolvedCircuitOptions): Promise<void> {
    const raw = await this.store.get(storeKey);
    const circuit: CircuitData = raw ? JSON.parse(raw) : { state: 'CLOSED', failures: 0, successes: 0 };

    if (circuit.state === 'HALF_OPEN' || circuit.state === 'CLOSED') {
      circuit.failures++;
      if (circuit.failures >= cfg.failureThreshold) {
        circuit.state = 'OPEN';
        circuit.openedAt = Date.now();
        this.logger.warn(`Circuit OPEN for '${storeKey}' after ${circuit.failures} failures`);
      }
    }

    await this.saveCircuit(storeKey, circuit, cfg.rollingWindowMs);
  }

  private async saveCircuit(key: string, data: CircuitData, ttlMs: number): Promise<void> {
    await this.store.set(key, JSON.stringify(data), ttlMs * 2);
  }
}

/**
 * CircuitBreakerInterceptor — companion to CircuitBreakerGuard.
 *
 * Records the outcome of every handler call so the guard can track
 * the failure/success counters and transition states correctly.
 *
 * Must run on the same route as CircuitBreakerGuard:
 *   @UseGuards(CircuitBreakerGuard)
 *   @UseInterceptors(CircuitBreakerInterceptor)
 */
@Injectable()
export class CircuitBreakerInterceptor implements NestInterceptor {
  constructor(private readonly guard: CircuitBreakerGuard) {}

  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = _context.switchToHttp().getRequest<object>();
    const state = circuitRequestStates.get(request);

    if (!state) return next.handle();

    const { key, options } = state;
    return next.handle().pipe(
      tap(() => from(this.guard.recordSuccess(key, options))),
      catchError((err: unknown) =>
        from(this.guard.recordFailure(key, options)).pipe(
          switchMap(() => throwError(() => err)),
        ),
      ),
    );
  }
}
