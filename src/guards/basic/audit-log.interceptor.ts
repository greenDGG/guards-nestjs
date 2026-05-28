import { randomBytes } from 'crypto';
import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, throwError } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';
import { Request, Response } from 'express';
import { GUARD_METADATA } from '../../constants/guard.constants';
import { AuditLogOptions, AuditEntry } from '../../decorators/audit-log.decorator';
import { JwtPayload } from '../../interfaces/jwt-payload.interface';

/**
 * AuditLogInterceptor — enterprise-grade access audit trail
 *
 * Records every request that reaches a decorated endpoint:
 *   WHO    — userId, email, roles (from JWT)
 *   WHAT   — action, resource, sanitized body
 *   WHEN   — ISO timestamp, duration
 *   WHERE  — IP, User-Agent
 *   RESULT — status code, outcome (success / error), error message
 *
 * Never blocks — always passes the request through. If the handler throws,
 * the audit log records the error and re-throws unchanged.
 *
 * Sets X-Trace-Id on the response: lets the client correlate their request
 * with the server-side audit log.
 *
 * ─── Why an interceptor? ──────────────────────────────────────────────────
 *
 *   Guards run BEFORE the handler only — they can't capture the response
 *   status or duration. Interceptors wrap both sides of the handler, so
 *   we can log outcome, status code, and elapsed time.
 *
 * ─── Default output (NestJS Logger) ──────────────────────────────────────
 *
 *   [AuditLogInterceptor] AUDIT  trace=a1b2c3d4  userId=usr_42
 *     action="POST /transfer"  resource=transfer  ip=192.168.1.5
 *     status=201  ms=87  outcome=success
 *
 *   [AuditLogInterceptor] AUDIT  trace=b3c4d5e6  userId=null
 *     action="POST /transfer"  resource=transfer  ip=1.2.3.4
 *     status=401  ms=12  outcome=error  error="Invalid request signature"
 *
 * ─── Custom logger (send to DB / CloudWatch / DataDog) ───────────────────
 *
 *   @AuditLog({
 *     resource: 'transfer',
 *     logger: async (entry) => {
 *       await db.auditLogs.insert(entry);
 *       // or: await cloudwatch.putLogEvents(...)
 *     },
 *   })
 *
 * ─── Usage ────────────────────────────────────────────────────────────────
 *
 *   @AuditLog({ resource: 'transfer' })
 *   @UseInterceptors(AuditLogInterceptor)
 *   @Post('transfer')
 *   transfer(@Body() dto: TransferDto) {}
 *
 *   // Complement with ReplayProtectionGuard for full fintech stack:
 *   @AuditLog({ resource: 'transfer' })
 *   @ReplayProtect({ secret: process.env.API_SECRET })
 *   @UseGuards(ReplayProtectionGuard)
 *   @UseInterceptors(AuditLogInterceptor)
 *   @Post('transfer')
 *   transfer() {}
 */
@Injectable()
export class AuditLogInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditLogInterceptor.name);

  private readonly DEFAULT_SENSITIVE_FIELDS = [
    'password', 'token', 'secret', 'authorization',
    'cvv', 'pin', 'privateKey', 'mnemonic', 'seedPhrase',
  ];

  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const options = this.reflector.getAllAndOverride<AuditLogOptions | undefined>(
      GUARD_METADATA.AUDIT_LOG_OPTIONS,
      [context.getHandler(), context.getClass()],
    );

    if (!options) return next.handle();

    const request  = context.switchToHttp().getRequest<Request & { user?: JwtPayload }>();
    const response = context.switchToHttp().getResponse<Response>();

    const traceId = randomBytes(8).toString('hex');
    const startMs = Date.now();

    // ── Attach traceId to response so clients can correlate with logs ───────
    response.setHeader('X-Trace-Id', traceId);

    // ── Extract request context ───────────────────────────────────────────────
    const user      = request.user;
    const userId    = user?.sub    ?? null;
    const userEmail = (user as any)?.email ?? null;
    const roles     = user?.roles  ?? [];

    const ip = (
      (request.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ??
      request.socket?.remoteAddress ??
      'unknown'
    );
    const userAgent = request.headers['user-agent'] ?? 'unknown';

    const method = request.method.toUpperCase();
    const url    = request.url;
    const route  = (request as any).route?.path ?? url;

    const action   = options.action   ?? `${method} ${route}`;
    const resource = options.resource ?? route.split('/').filter(Boolean).pop() ?? 'unknown';

    const sensitiveFields = options.sensitiveFields ?? this.DEFAULT_SENSITIVE_FIELDS;
    const body = options.logBody !== false
      ? this.sanitizeBody(request.body, sensitiveFields)
      : null;

    // ── Handler ───────────────────────────────────────────────────────────────
    return next.handle().pipe(
      tap(() => {
        const entry: AuditEntry = {
          traceId,
          timestamp:  new Date().toISOString(),
          userId,
          userEmail,
          roles,
          ip,
          userAgent:  String(userAgent),
          method,
          url,
          route,
          action,
          resource,
          body,
          statusCode: response.statusCode,
          durationMs: Date.now() - startMs,
          outcome:    'success',
        };
        this.emit(entry, options.logger);
      }),
      catchError((err: unknown) => {
        const statusCode =
          err instanceof HttpException ? err.getStatus() : 500;
        const errorMessage =
          err instanceof HttpException
            ? (err.getResponse() as any)?.message ?? err.message
            : err instanceof Error
              ? err.message
              : String(err);

        const entry: AuditEntry = {
          traceId,
          timestamp:  new Date().toISOString(),
          userId,
          userEmail,
          roles,
          ip,
          userAgent:  String(userAgent),
          method,
          url,
          route,
          action,
          resource,
          body,
          statusCode,
          durationMs: Date.now() - startMs,
          outcome:    'error',
          error:      String(errorMessage),
        };
        this.emit(entry, options.logger);

        return throwError(() => err);
      }),
    );
  }

  private emit(
    entry: AuditEntry,
    customLogger?: (e: AuditEntry) => void | Promise<void>,
  ): void {
    if (customLogger) {
      try {
        const result = customLogger(entry);
        if (result instanceof Promise) {
          result.catch((err: unknown) =>
            this.logger.error(`Custom audit logger threw: ${String(err)}`),
          );
        }
      } catch (err) {
        this.logger.error(`Custom audit logger threw: ${String(err)}`);
      }
      return;
    }

    // Default: structured single-line log
    const bodyStr = entry.body ? `  body=${JSON.stringify(entry.body)}` : '';
    const errorStr = entry.error ? `  error="${entry.error}"` : '';
    const msg =
      `AUDIT  trace=${entry.traceId}` +
      `  userId=${entry.userId ?? 'null'}` +
      `  action="${entry.action}"` +
      `  resource=${entry.resource}` +
      `  ip=${entry.ip}` +
      `  status=${entry.statusCode}` +
      `  ms=${entry.durationMs}` +
      `  outcome=${entry.outcome}` +
      bodyStr +
      errorStr;

    if (entry.outcome === 'success') {
      this.logger.log(msg);
    } else {
      this.logger.warn(msg);
    }
  }

  private sanitizeBody(
    body: unknown,
    sensitiveFields: string[],
  ): Record<string, unknown> | null {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
    const result: Record<string, unknown> = { ...(body as Record<string, unknown>) };
    for (const field of sensitiveFields) {
      if (field in result) result[field] = '[REDACTED]';
    }
    return result;
  }
}
