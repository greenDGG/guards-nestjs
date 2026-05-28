import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request, Response } from 'express';
import { randomBytes } from 'crypto';
import { GUARD_METADATA } from '../../constants/guard.constants';
import { CsrfTokenException } from '../../exceptions/security.exception';

export interface CsrfOptions {
  cookieName?:    string;    // default: 'csrf-token'
  headerName?:    string;    // default: 'x-csrf-token'
  ignoreMethods?: string[];  // default: ['GET', 'HEAD', 'OPTIONS']
}

/**
 * Level 2 — CSRF Guard (Double Submit Cookie pattern)
 *
 * Protects cookie-based APIs against Cross-Site Request Forgery.
 * Uses the Double Submit Cookie pattern — stateless, no session required:
 *
 *   1. Client calls GET /csrf-token  →  server sets `csrf-token` cookie
 *                                       + returns token in response body
 *   2. Client reads cookie via JS and includes it in the `x-csrf-token` header
 *   3. Guard compares cookie value vs. header value
 *   4. Attacker cannot read the cookie from a different origin (same-origin policy)
 *      so they cannot forge the matching header
 *
 * Usage:
 *   @UseGuards(CsrfGuard)
 *   @Post('transfer')
 *   transfer() {}
 *
 * Issue tokens via the generateCsrfToken() helper in a GET endpoint:
 *   @Get('csrf-token')
 *   csrfToken(@Res({ passthrough: true }) res: Response) {
 *     return { csrfToken: generateCsrfToken(res) };
 *   }
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  private readonly logger = new Logger(CsrfGuard.name);
  private readonly SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS'];

  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const options = this.reflector.getAllAndOverride<CsrfOptions>(
      GUARD_METADATA.CSRF_OPTIONS,
      [context.getHandler(), context.getClass()],
    ) ?? {};

    const request = context.switchToHttp().getRequest<Request>();
    const method  = request.method.toUpperCase();

    const ignoreMethods = options.ignoreMethods ?? this.SAFE_METHODS;
    if (ignoreMethods.includes(method)) return true;

    const cookieName = options.cookieName ?? 'csrf-token';
    const headerName = options.headerName ?? 'x-csrf-token';

    const cookieToken = this.parseCookies(request.headers['cookie'] ?? '')[cookieName];
    const headerToken = request.headers[headerName] as string | undefined;

    if (!cookieToken || !headerToken) {
      this.logger.warn(`CSRF token missing — ${method} ${request.url}`);
      throw new CsrfTokenException('missing');
    }

    if (cookieToken !== headerToken) {
      this.logger.warn(`CSRF token mismatch — ${method} ${request.url}`);
      throw new CsrfTokenException('mismatch');
    }

    return true;
  }

  private parseCookies(cookieHeader: string): Record<string, string> {
    const cookies: Record<string, string> = {};
    if (!cookieHeader) return cookies;
    for (const part of cookieHeader.split(';')) {
      const eq = part.indexOf('=');
      if (eq < 0) continue;
      cookies[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
    }
    return cookies;
  }
}

/**
 * Generates a CSRF token, sets it as a non-httpOnly cookie (JS must read it),
 * and returns the token string. Call this in a GET endpoint dedicated to
 * token issuance.
 */
export function generateCsrfToken(
  response: Response,
  cookieName = 'csrf-token',
): string {
  const token = randomBytes(32).toString('hex');
  response.cookie(cookieName, token, {
    httpOnly: false,     // JS needs to read this to set the request header
    sameSite: 'strict',
    path: '/',
  });
  return token;
}
