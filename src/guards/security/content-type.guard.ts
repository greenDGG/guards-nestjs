import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { GUARD_METADATA } from '../../constants/guard.constants';
import { InvalidContentTypeException } from '../../exceptions/security.exception';

export interface ContentTypeOptions {
  allowed: string[];
  skipForMethods?: string[];
}

/**
 * Level 2 — Content-Type Enforcement Guard
 *
 * Ensures requests with a body declare an accepted Content-Type.
 * Parameters (e.g., charset) are stripped before comparison.
 *
 * Usage:
 *   @SetMetadata(GUARD_METADATA.CONTENT_TYPE_OPTIONS, {
 *     allowed: ['application/json', 'multipart/form-data']
 *   })
 *   @UseGuards(ContentTypeGuard)
 *   @Post()
 *   create() {}
 */
@Injectable()
export class ContentTypeGuard implements CanActivate {
  private readonly logger = new Logger(ContentTypeGuard.name);
  private readonly SKIP_METHODS = ['GET', 'HEAD', 'DELETE', 'OPTIONS'];

  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const options = this.reflector.getAllAndOverride<ContentTypeOptions>(
      GUARD_METADATA.CONTENT_TYPE_OPTIONS,
      [context.getHandler(), context.getClass()],
    );

    if (!options) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const method = request.method.toUpperCase();
    const skipMethods = options.skipForMethods ?? this.SKIP_METHODS;

    if (skipMethods.includes(method)) return true;

    const rawContentType = request.headers['content-type'];

    if (!rawContentType) {
      this.logger.warn(`Missing Content-Type — ${method} ${request.url}`);
      throw new InvalidContentTypeException('(none)', options.allowed);
    }

    // Strip parameters: "application/json; charset=utf-8" → "application/json"
    const contentType = rawContentType.split(';')[0].trim().toLowerCase();
    const allowed = options.allowed.map((t) => t.toLowerCase());

    if (!allowed.includes(contentType)) {
      this.logger.warn(`Blocked Content-Type '${contentType}' — ${method} ${request.url}`);
      throw new InvalidContentTypeException(contentType, options.allowed);
    }

    return true;
  }
}
