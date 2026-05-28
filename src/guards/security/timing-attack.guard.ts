import {
  CanActivate,
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, from, throwError } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';
import { GUARD_METADATA } from '../../constants/guard.constants';

export interface TimingAttackOptions {
  minResponseMs: number;  // minimum guaranteed response time
  jitterMs?:     number;  // random extra delay added on top (default: 0)
}

/**
 * Level 2 — Timing Attack Protection Guard + Interceptor
 *
 * Ensures all responses take at least `minResponseMs` regardless of whether
 * the operation succeeded or failed. Prevents timing side-channels where an
 * attacker measures response latency to infer information (e.g. "user not
 * found" is faster than "wrong password" after bcrypt comparison).
 *
 * Usage (both are required):
 *   @SetMetadata(GUARD_METADATA.TIMING_ATTACK_OPTIONS, { minResponseMs: 300 })
 *   @UseGuards(TimingAttackGuard)
 *   @UseInterceptors(TimingAttackInterceptor)
 *   @Post('login')
 *   login() {}
 *
 * Optional jitter adds a random extra delay on top of minResponseMs to prevent
 * pattern analysis even when the fixed floor is known to the attacker.
 */
@Injectable()
export class TimingAttackGuard implements CanActivate {
  private readonly logger = new Logger(TimingAttackGuard.name);

  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const options = this.reflector.getAllAndOverride<TimingAttackOptions>(
      GUARD_METADATA.TIMING_ATTACK_OPTIONS,
      [context.getHandler(), context.getClass()],
    );

    if (!options) return true;

    const request = context.switchToHttp().getRequest();
    request._timingStart   = Date.now();
    request._timingOptions = options;

    this.logger.debug(
      `Timing protection active — min ${options.minResponseMs}ms` +
      (options.jitterMs ? ` + up to ${options.jitterMs}ms jitter` : ''),
    );

    return true;
  }
}

@Injectable()
export class TimingAttackInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest();
    const start:   number | undefined              = request._timingStart;
    const options: TimingAttackOptions | undefined = request._timingOptions;

    if (start === undefined || !options) return next.handle();

    const buildDelay = (): Promise<void> => {
      const jitter  = options.jitterMs ? Math.random() * options.jitterMs : 0;
      const target  = options.minResponseMs + jitter;
      const elapsed = Date.now() - start;
      const wait    = Math.max(0, target - elapsed);
      return new Promise<void>((resolve) => setTimeout(resolve, wait));
    };

    return next.handle().pipe(
      // Success path — pad to minResponseMs then return the value
      switchMap((value) => from(buildDelay()).pipe(map(() => value))),
      // Error path — pad to minResponseMs then re-throw original error
      catchError((err: unknown) =>
        from(buildDelay()).pipe(switchMap(() => throwError(() => err))),
      ),
    );
  }
}
