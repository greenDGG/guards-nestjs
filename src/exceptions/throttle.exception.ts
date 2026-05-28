import { HttpException, HttpStatus } from '@nestjs/common';

export class ThrottleException extends HttpException {
  constructor(retryAfter: number = 60, message: string = 'Too many requests') {
    super(
      { message: `${message}. Retry after ${retryAfter} seconds`, retryAfter },
      HttpStatus.TOO_MANY_REQUESTS,
    );
    this.name = 'ThrottleException';
  }
}

export class RateLimitExceededException extends HttpException {
  constructor(limit: number, windowMs: number, retryAfter?: number) {
    super(
      {
        message: `Rate limit exceeded. Max ${limit} requests per ${windowMs}ms`,
        limit,
        windowMs,
        retryAfter,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
    this.name = 'RateLimitExceededException';
  }
}

export class PenaltyBoxException extends HttpException {
  constructor(retryAfterSeconds: number) {
    super(
      {
        message: `Temporarily blocked due to repeated rate limit violations. Retry after ${retryAfterSeconds}s`,
        retryAfter: retryAfterSeconds,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
    this.name = 'PenaltyBoxException';
  }
}
