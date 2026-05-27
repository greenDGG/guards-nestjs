import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

interface ErrorResponse {
  statusCode: number;
  message: string;
  timestamp: string;
  path: string;
  method: string;
  user?: number | string;
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('EXCEPTION');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const user = (request as any).user;

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let errorName = 'UnknownException';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      message = exception.message;
      errorName = exception.constructor.name;
    } else if (exception instanceof Error) {
      errorName = exception.name;
      message = exception.message;
    }

    const errorResponse: ErrorResponse = {
      statusCode: status,
      message,
      timestamp: new Date().toISOString(),
      path: request.url,
      method: request.method,
      user: user?.sub || user?.username || undefined,
    };

    // Log error based on status code
    if (status === HttpStatus.UNAUTHORIZED) {
      this.logger.warn(
        `🔐 UNAUTHORIZED - ${request.method} ${request.url} | ${errorName}: ${message} | User: ${user?.username || 'anonymous'}`,
      );
    } else if (status === HttpStatus.FORBIDDEN) {
      this.logger.warn(
        `🚫 FORBIDDEN - ${request.method} ${request.url} | ${errorName}: ${message} | User: ${user?.username || 'anonymous'}`,
      );
    } else if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `❌ ${status} - ${request.method} ${request.url} | ${errorName}: ${message} | User: ${user?.username || 'anonymous'}`,
      );
    } else if (status >= HttpStatus.BAD_REQUEST) {
      this.logger.warn(
        `⚠️  ${status} - ${request.method} ${request.url} | ${errorName}: ${message}`,
      );
    }

    response.status(status).json(errorResponse);
  }
}
