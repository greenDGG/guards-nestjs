import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { GUARD_METADATA } from '../../constants/guard.constants';
import { ApiKeyOptions } from '../../decorators/api-key.decorator';
import { InvalidApiKeyException } from '../../exceptions/security.exception';

/**
 * Level 1 — API Key Guard
 *
 * Validates the x-api-key header against a list of allowed keys.
 * Keys can be defined globally (via module options) or overridden per route.
 *
 * Usage:
 *   // Global key list — set via GuardNestModule.forRoot({ apiKey: { keys: [...] } })
 *   // Per-route override:
 *   @ApiKey({ keys: ['route-specific-key'] })
 *   @UseGuards(ApiKeyGuard)
 *   @Get('webhook')
 *   webhook() {}
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly logger = new Logger(ApiKeyGuard.name);
  private readonly globalKeys: string[];

  constructor(
    private reflector: Reflector,
    globalKeys: string[] = [],
  ) {
    this.globalKeys = globalKeys;
  }

  canActivate(context: ExecutionContext): boolean {
    const options = this.reflector.getAllAndOverride<ApiKeyOptions>(GUARD_METADATA.API_KEY_OPTIONS, [
      context.getHandler(),
      context.getClass(),
    ]);

    const request = context.switchToHttp().getRequest<Request>();
    const apiKey = request.headers['x-api-key'] as string | undefined;

    if (!apiKey) {
      this.logger.warn(`No x-api-key header — ${request.method} ${request.url}`);
      throw new InvalidApiKeyException();
    }

    const validKeys = options?.keys ?? this.globalKeys;

    if (validKeys.length === 0) {
      this.logger.warn('ApiKeyGuard: no keys configured — blocking all requests');
      throw new InvalidApiKeyException();
    }

    if (!validKeys.includes(apiKey)) {
      this.logger.warn(`Invalid API key attempt — ${request.method} ${request.url}`);
      throw new InvalidApiKeyException();
    }

    this.logger.debug(`API key accepted — ${request.method} ${request.url}`);
    return true;
  }
}
