import { ForbiddenException, UnauthorizedException } from '@nestjs/common';

export class SubscriptionRequiredException extends ForbiddenException {
  constructor(requiredPlan: string | string[]) {
    const plans = Array.isArray(requiredPlan) ? requiredPlan.join(' or ') : requiredPlan;
    super(`This feature requires a '${plans}' subscription plan`);
    this.name = 'SubscriptionRequiredException';
  }
}

export class AccessOutsideAllowedHoursException extends ForbiddenException {
  constructor() {
    super('Access is only allowed during designated time windows');
    this.name = 'AccessOutsideAllowedHoursException';
  }
}

export class TenantMismatchException extends ForbiddenException {
  constructor() {
    super('You do not have permission to access resources from a different tenant');
    this.name = 'TenantMismatchException';
  }
}

export class MfaRequiredException extends UnauthorizedException {
  constructor() {
    super('Multi-factor authentication is required or has expired for this action');
    this.name = 'MfaRequiredException';
  }
}
