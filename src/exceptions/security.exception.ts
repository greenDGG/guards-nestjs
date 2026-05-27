import { ForbiddenException, UnauthorizedException, HttpException, HttpStatus } from '@nestjs/common';

export class IpBlockedException extends ForbiddenException {
  constructor(ip: string) {
    super(`Request from IP ${ip} is not allowed`);
    this.name = 'IpBlockedException';
  }
}

export class HttpsRequiredException extends ForbiddenException {
  constructor() {
    super('HTTPS is required. Please use a secure connection.');
    this.name = 'HttpsRequiredException';
  }
}

export class RequestTooLargeException extends HttpException {
  constructor(maxBytes: number) {
    super(
      { message: `Request body exceeds maximum allowed size of ${maxBytes} bytes`, maxBytes },
      HttpStatus.PAYLOAD_TOO_LARGE,
    );
    this.name = 'RequestTooLargeException';
  }
}

export class InvalidContentTypeException extends ForbiddenException {
  constructor(received: string, allowed: string[]) {
    super(`Content-Type '${received}' is not allowed. Allowed: ${allowed.join(', ')}`);
    this.name = 'InvalidContentTypeException';
  }
}

export class CorsOriginBlockedException extends ForbiddenException {
  constructor(origin: string) {
    super(`Origin '${origin}' is not allowed by CORS policy`);
    this.name = 'CorsOriginBlockedException';
  }
}

export class InvalidApiKeyException extends UnauthorizedException {
  constructor() {
    super('Invalid or missing API key');
    this.name = 'InvalidApiKeyException';
  }
}

export class InvalidBasicAuthException extends UnauthorizedException {
  constructor(realm: string = 'API') {
    super(`Invalid credentials for realm '${realm}'`);
    this.name = 'InvalidBasicAuthException';
  }
}

export class InvalidSignatureException extends UnauthorizedException {
  constructor() {
    super('Invalid request signature');
    this.name = 'InvalidSignatureException';
  }
}

export class SignatureExpiredException extends UnauthorizedException {
  constructor(maxAgeSeconds: number) {
    super(`Request timestamp too old (max ${maxAgeSeconds}s) — possible replay attack`);
    this.name = 'SignatureExpiredException';
  }
}

export class SignatureMissingException extends UnauthorizedException {
  constructor(header: string) {
    super(`Missing required header: ${header}`);
    this.name = 'SignatureMissingException';
  }
}

export class IdempotencyKeyMissingException extends HttpException {
  constructor(header: string) {
    super(
      { message: `Missing required idempotency header: ${header}`, header },
      HttpStatus.BAD_REQUEST,
    );
    this.name = 'IdempotencyKeyMissingException';
  }
}

export class ConcurrencyLimitException extends HttpException {
  constructor(current: number, max: number) {
    super(
      {
        message: `Too many concurrent requests: ${current} active, limit is ${max}`,
        current,
        max,
        retryable: true,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
    this.name = 'ConcurrencyLimitException';
  }
}

export class ReplayAttackException extends UnauthorizedException {
  constructor() {
    super('Replay attack detected: this nonce has already been used');
    this.name = 'ReplayAttackException';
  }
}

export class NonceMissingException extends UnauthorizedException {
  constructor(header: string) {
    super(`Missing required nonce header: ${header}`);
    this.name = 'NonceMissingException';
  }
}

export class NonceInvalidException extends UnauthorizedException {
  constructor(reason: string) {
    super(`Invalid nonce: ${reason}`);
    this.name = 'NonceInvalidException';
  }
}

export class IdempotencyConflictException extends HttpException {
  constructor() {
    super(
      {
        message: 'A request with this Idempotency-Key is already being processed. Retry after it completes.',
        retryable: true,
      },
      HttpStatus.CONFLICT,
    );
    this.name = 'IdempotencyConflictException';
  }
}
