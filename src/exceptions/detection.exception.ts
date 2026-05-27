import { ForbiddenException } from '@nestjs/common';

export class BotDetectedException extends ForbiddenException {
  constructor(score: number) {
    super(`Request blocked: bot activity detected (score: ${score}/100)`);
    this.name = 'BotDetectedException';
  }
}

export class GeoIpBlockedException extends ForbiddenException {
  constructor(country: string) {
    super(`Access from country '${country}' is not allowed`);
    this.name = 'GeoIpBlockedException';
  }
}

export class FingerprintChangedException extends ForbiddenException {
  constructor() {
    super('Device fingerprint mismatch detected. Session may have been compromised.');
    this.name = 'FingerprintChangedException';
  }
}

export class CircuitOpenException extends ForbiddenException {
  constructor(serviceKey: string, retryAfterMs: number) {
    super(
      `Service '${serviceKey}' is temporarily unavailable. Circuit breaker is open. Retry after ${Math.ceil(retryAfterMs / 1000)}s`,
    );
    this.name = 'CircuitOpenException';
  }
}
