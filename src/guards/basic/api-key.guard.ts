import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { GUARD_METADATA } from '../../constants/guard.constants';
import { ApiKeyOptions } from '../../decorators/api-key.decorator';
import { InvalidApiKeyException } from '../../exceptions/security.exception';

/**
 * Level 1 — API Key Guard
 *
 * Validates the x-api-key header against:
 *   1. Keys defined per-route via @ApiKey({ keys: [...] })
 *   2. process.env.API_KEY — always included, read at request time
 *
 * Why read process.env.API_KEY in canActivate and not in a @ApiKey() decorator?
 * TypeScript decorators are evaluated when the class is defined, which happens
 * during the module import phase — before dotenv.config() runs in main.ts.
 * Reading the env var at request time (inside canActivate) guarantees it's available.
 *
 * Usage:
 *   // Env-only (no hardcoded keys — recommended):
 *   @ApiKey({ keys: [] })
 *   @UseGuards(ApiKeyGuard)
 *   @Get('webhook')
 *   webhook() {}
 *
 *   // Multi-key (hardcoded list + env — useful for key rotation):
 *   @ApiKey({ keys: ['old-key', 'new-key'] })
 *   @UseGuards(ApiKeyGuard)
 *   @Get('internal')
 *   internal() {}
 *
 * Generate a key: npx ts-node scripts/generate-api-key.ts
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly logger = new Logger(ApiKeyGuard.name);

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const options = this.reflector.getAllAndOverride<ApiKeyOptions>(GUARD_METADATA.API_KEY_OPTIONS, [
      context.getHandler(),
      context.getClass(),
    ]);

    const request = context.switchToHttp().getRequest<Request>();
    const apiKey  = request.headers['x-api-key'] as string | undefined;

    if (!apiKey) {
      this.logger.warn(`No x-api-key header — ${request.method} ${request.url}`);
      throw new InvalidApiKeyException();
    }

    // Merge route-level keys with the env var key (read at request time).
    // Set deduplicates in case the same key appears in both.
    const routeKeys = options?.keys ?? [];
    const envKey    = process.env.API_KEY ? [process.env.API_KEY] : [];
    const validKeys = [...new Set([...routeKeys, ...envKey])];

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
