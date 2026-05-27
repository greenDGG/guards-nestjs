import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { Request } from 'express';
import { HttpsRequiredException } from '../../exceptions/security.exception';

/**
 * Level 2 — HTTPS-Only Guard
 *
 * Rejects any request that does not arrive over a secure (HTTPS) connection.
 * Handles reverse proxy setups by checking x-forwarded-proto header.
 *
 * Usage:
 *   @UseGuards(HttpsOnlyGuard)
 *   @Post('payment')
 *   processPayment() {}
 *
 *   // Or globally in app.module.ts for the entire API.
 */
@Injectable()
export class HttpsOnlyGuard implements CanActivate {
  private readonly logger = new Logger(HttpsOnlyGuard.name);

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const isSecure = this.isSecureRequest(request);

    if (!isSecure) {
      this.logger.warn(`Non-HTTPS request rejected — ${request.method} ${request.url}`);
      throw new HttpsRequiredException();
    }

    return true;
  }

  private isSecureRequest(request: Request): boolean {
    // Direct HTTPS connection
    if (request.secure) return true;
    if (request.protocol === 'https') return true;

    // Behind reverse proxy (nginx, load balancer)
    const forwardedProto = request.headers['x-forwarded-proto'];
    if (typeof forwardedProto === 'string') {
      return forwardedProto.split(',')[0].trim() === 'https';
    }

    // Development: allow localhost without HTTPS
    const host = request.hostname ?? '';
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') {
      return true;
    }

    return false;
  }
}
