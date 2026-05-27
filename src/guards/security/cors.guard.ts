import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request, Response } from 'express';
import { GUARD_METADATA } from '../../constants/guard.constants';
import { CorsOriginBlockedException } from '../../exceptions/security.exception';

export interface CorsGuardOptions {
  allowedOrigins: Array<string | RegExp>;
  allowCredentials?: boolean;
  allowPrivateNetwork?: boolean;
}

/**
 * Level 2 — Per-Route CORS Guard
 *
 * Validates the Origin header against a per-route allowlist.
 * Use this when you need different CORS policies per endpoint,
 * complementing (not replacing) NestJS's global CORS middleware.
 *
 * Usage:
 *   @SetMetadata(GUARD_METADATA.CORS_OPTIONS, {
 *     allowedOrigins: ['https://myapp.com', /\.myapp\.com$/],
 *     allowCredentials: true,
 *   })
 *   @UseGuards(CorsGuard)
 *   @Get('user-data')
 *   userData() {}
 */
@Injectable()
export class CorsGuard implements CanActivate {
  private readonly logger = new Logger(CorsGuard.name);

  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const options = this.reflector.getAllAndOverride<CorsGuardOptions>(GUARD_METADATA.CORS_OPTIONS, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!options) return true;

    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();

    const origin = request.headers.origin;

    // No origin header = same-origin or non-browser request — allow
    if (!origin) return true;

    const allowed = this.isOriginAllowed(origin, options.allowedOrigins);

    if (!allowed) {
      this.logger.warn(`CORS blocked origin '${origin}' — ${request.method} ${request.url}`);
      throw new CorsOriginBlockedException(origin);
    }

    // Set CORS response headers
    response.setHeader('Access-Control-Allow-Origin', origin);
    if (options.allowCredentials) {
      response.setHeader('Access-Control-Allow-Credentials', 'true');
    }
    if (options.allowPrivateNetwork) {
      response.setHeader('Access-Control-Allow-Private-Network', 'true');
    }

    // Handle preflight
    if (request.method === 'OPTIONS') {
      response.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
      response.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,x-api-key');
      response.status(204).send('');
      return false;
    }

    return true;
  }

  private isOriginAllowed(origin: string, allowed: Array<string | RegExp>): boolean {
    return allowed.some((pattern) => {
      if (typeof pattern === 'string') return origin === pattern;
      return pattern.test(origin);
    });
  }
}
