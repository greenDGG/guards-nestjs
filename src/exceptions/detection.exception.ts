import { ForbiddenException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';

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

export class SessionHijackedException extends UnauthorizedException {
  constructor(score: number, breakdown: Record<string, unknown>) {
    super({
      message: 'Session security violation detected. Please re-authenticate.',
      score,
      breakdown,
    });
    this.name = 'SessionHijackedException';
  }
}

export class RiskScoreBlockedException extends ForbiddenException {
  constructor(score: number, breakdown: Record<string, number>) {
    super({
      message: `Request blocked: risk score ${score}/100 exceeds threshold`,
      score,
      breakdown,
      action: 'block',
    });
    this.name = 'RiskScoreBlockedException';
  }
}

export class RiskScoreChallengeException extends ForbiddenException {
  constructor(score: number, breakdown: Record<string, number>) {
    super({
      message: `Request requires additional verification: risk score ${score}/100`,
      score,
      breakdown,
      action: 'challenge',
    });
    this.name = 'RiskScoreChallengeException';
  }
}

export class CircuitOpenException extends ServiceUnavailableException {
  public readonly retryAfter: number;
  constructor(serviceKey: string, retryAfterMs: number) {
    super(
      `Service '${serviceKey}' is temporarily unavailable. Circuit breaker is open. Retry after ${Math.ceil(retryAfterMs / 1000)}s`,
    );
    this.retryAfter = Math.ceil(retryAfterMs / 1000);
    this.name = 'CircuitOpenException';
  }
}
