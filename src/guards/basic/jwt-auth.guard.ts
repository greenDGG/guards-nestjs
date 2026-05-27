import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { JwtService } from '../../services/jwt.service';
import { IS_PUBLIC_KEY } from '../../decorators/public.decorator';
import { TokenNotFoundException, InvalidTokenException } from '../../exceptions/auth.exception';

/**
 * Level 1 — JWT Authentication Guard
 *
 * Validates a Bearer JWT token on every protected route.
 * Routes decorated with @Public() bypass this guard.
 *
 * Usage:
 *   Apply globally via APP_GUARD in app.module.ts (recommended).
 *   Or per-controller/route: @UseGuards(JwtAuthGuard)
 *
 * @Public() makes any route skip authentication entirely.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly logger = new Logger(JwtAuthGuard.name);

  constructor(
    private jwtService: JwtService,
    private reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      this.logger.debug('Public route — skipping authentication');
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const token = this.extractBearerToken(request);

    if (!token) {
      this.logger.warn(`No token provided — ${request.method} ${request.url}`);
      throw new TokenNotFoundException();
    }

    try {
      const payload = await this.jwtService.verifyToken(token);
      (request as any).user = payload;
      this.logger.debug(`Authenticated: ${payload.username} (sub: ${payload.sub})`);
      return true;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Token verification failed: ${msg} — ${request.method} ${request.url}`);
      throw new InvalidTokenException(msg);
    }
  }

  private extractBearerToken(request: Request): string | null {
    const auth = request.headers.authorization;
    if (!auth) return null;
    const [scheme, token] = auth.split(' ');
    return scheme === 'Bearer' && token ? token : null;
  }
}
