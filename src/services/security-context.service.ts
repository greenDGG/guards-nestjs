import { Injectable } from '@nestjs/common';
import { Request } from 'express';
import { SecurityContext } from '../interfaces/security-context.interface';

/**
 * SecurityContextService — type-safe read/write access to request.securityContext
 *
 * Inject this into any guard or service that needs to share state across guards.
 *
 * Example in a guard:
 *   constructor(private secCtx: SecurityContextService) {}
 *
 *   canActivate(context: ExecutionContext) {
 *     const req = context.switchToHttp().getRequest();
 *     const ctx = this.secCtx.get(req);
 *
 *     // Read what a previous guard computed
 *     if (ctx.geo?.countryCode === 'KP') throw new ForbiddenException();
 *
 *     // Write what this guard computed (for later guards to use)
 *     ctx.botScore = 42;
 *   }
 */
@Injectable()
export class SecurityContextService {
  /**
   * Returns the SecurityContext for the given request.
   * If the middleware did not run (e.g., test environment), initializes a minimal context.
   */
  get(request: Request): SecurityContext {
    if (!request.securityContext) {
      // Fallback: middleware should have run, but guard against missing it
      request.securityContext = {
        ip: (request.socket?.remoteAddress ?? '127.0.0.1'),
        requestId: crypto.randomUUID(),
        requestedAt: new Date(),
      };
    }
    return request.securityContext;
  }

  set<K extends keyof SecurityContext>(
    request: Request,
    key: K,
    value: SecurityContext[K],
  ): void {
    this.get(request)[key] = value;
  }

  merge(request: Request, partial: Partial<SecurityContext>): void {
    Object.assign(this.get(request), partial);
  }
}
