import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { IpExtractorService } from '../services/ip-extractor.service';

/**
 * SecurityContextMiddleware — initializes request.securityContext on every request
 *
 * Must run before any guard so that guards find the context already initialized.
 * Register it in AppModule:
 *
 *   export class AppModule implements NestModule {
 *     configure(consumer: MiddlewareConsumer) {
 *       consumer.apply(SecurityContextMiddleware).forRoutes('*');
 *     }
 *   }
 *
 * What it sets:
 *   request.securityContext.ip          — real client IP (proxy-aware)
 *   request.securityContext.requestId   — UUID for distributed tracing
 *   request.securityContext.requestedAt — precise timestamp
 */
@Injectable()
export class SecurityContextMiddleware implements NestMiddleware {
  constructor(private readonly ipExtractor: IpExtractorService) {}

  use(request: Request, _response: Response, next: NextFunction): void {
    request.securityContext = {
      ip: this.ipExtractor.getClientIp(request),
      requestId: crypto.randomUUID(),
      requestedAt: new Date(),
    };
    next();
  }
}
