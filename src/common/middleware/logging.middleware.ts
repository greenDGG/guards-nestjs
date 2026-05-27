import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

@Injectable()
export class LoggingMiddleware implements NestMiddleware {
  private readonly logger = new Logger('HTTP');

  use(req: Request, res: Response, next: NextFunction) {
    const startTime = Date.now();
    const { method, url, ip } = req;
    const user = (req as any).user;

    // Log incoming request
    this.logger.log(
      `→ [${method}] ${url} | IP: ${ip} | User: ${user?.username || 'anonymous'} (ID: ${user?.sub || 'N/A'})`,
    );

    // Capture response
    const logger = this.logger;
    const originalSend = res.send;
    res.send = function (data: any) {
      const duration = Date.now() - startTime;
      const statusCode = res.statusCode;

      const statusIcon =
        statusCode >= 200 && statusCode < 300
          ? '✅'
          : statusCode >= 300 && statusCode < 400
            ? '📍'
            : statusCode >= 400 && statusCode < 500
              ? '⚠️ '
              : '❌';

      logger.log(
        `← [${method}] ${url} | Status: ${statusIcon} ${statusCode} | Duration: ${duration}ms | User: ${user?.username || 'anonymous'}`,
      );

      return originalSend.call(this, data);
    };

    next();
  }
}
