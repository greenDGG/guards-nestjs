import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { GUARD_METADATA } from '../../constants/guard.constants';
import { RequestTooLargeException } from '../../exceptions/security.exception';

export interface RequestSizeOptions {
  maxBytes: number;
  rejectMissingContentLength?: boolean;
  allowedMethods?: string[];
}

/**
 * Level 2 — Request Size Guard
 *
 * Blocks requests whose body exceeds a configured byte limit.
 * Reads the Content-Length header — does not buffer the full body.
 *
 * Usage:
 *   @SetMetadata(GUARD_METADATA.REQUEST_SIZE_OPTIONS, { maxBytes: 5_242_880 }) // 5 MB
 *   @UseGuards(RequestSizeGuard)
 *   @Post('upload')
 *   upload() {}
 */
@Injectable()
export class RequestSizeGuard implements CanActivate {
  private readonly logger = new Logger(RequestSizeGuard.name);
  private readonly DEFAULT_MAX = 1_048_576; // 1 MB
  private readonly BODY_METHODS = ['POST', 'PUT', 'PATCH'];

  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const options = this.reflector.getAllAndOverride<RequestSizeOptions>(
      GUARD_METADATA.REQUEST_SIZE_OPTIONS,
      [context.getHandler(), context.getClass()],
    );

    const request = context.switchToHttp().getRequest<Request>();
    const method = request.method.toUpperCase();

    const allowedMethods = options?.allowedMethods ?? this.BODY_METHODS;
    if (!allowedMethods.includes(method)) return true;

    const maxBytes = options?.maxBytes ?? this.DEFAULT_MAX;
    const contentLength = request.headers['content-length'];

    if (!contentLength) {
      if (options?.rejectMissingContentLength) {
        this.logger.warn(`Missing Content-Length — ${request.method} ${request.url}`);
        throw new RequestTooLargeException(maxBytes);
      }
      return true;
    }

    const size = parseInt(contentLength, 10);

    if (isNaN(size)) return true;

    if (size > maxBytes) {
      this.logger.warn(`Request too large: ${size} bytes > ${maxBytes} bytes — ${request.method} ${request.url}`);
      throw new RequestTooLargeException(maxBytes);
    }

    return true;
  }
}
