import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Request } from 'express';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('RESPONSE');

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest<Request>();
    const startTime = Date.now();

    return next.handle().pipe(
      tap(
        (response) => {
          const duration = Date.now() - startTime;
          const user = (request as any).user;

          this.logger.debug(
            `Response for ${request.method} ${request.url} - Duration: ${duration}ms - User: ${user?.username || 'anonymous'}`,
          );
        },
        (error) => {
          const duration = Date.now() - startTime;
          const user = (request as any).user;

          this.logger.error(
            `Error in ${request.method} ${request.url} - Duration: ${duration}ms - User: ${user?.username || 'anonymous'} - Error: ${error.message}`,
          );
        },
      ),
    );
  }
}
