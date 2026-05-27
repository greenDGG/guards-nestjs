import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { GUARD_METADATA } from '../../constants/guard.constants';
import { SubscriptionOptions } from '../../decorators/subscription.decorator';
import { SubscriptionRequiredException } from '../../exceptions/business.exception';

const DEFAULT_HIERARCHY = ['free', 'starter', 'pro', 'enterprise'];

/**
 * Level 5 — Subscription Plan Guard
 *
 * Ensures the authenticated user has a required subscription plan.
 * Reads the subscriptionPlan claim from the JWT payload.
 * Supports plan hierarchy (e.g., 'enterprise' satisfies 'pro' requirement).
 *
 * Usage:
 *   @RequireSubscription('pro')
 *   @UseGuards(SubscriptionGuard)
 *   @Get('advanced-feature')
 *   advancedFeature() {}
 *
 *   // With custom hierarchy:
 *   @RequireSubscription('pro', ['basic', 'pro', 'premium', 'enterprise'])
 *   @UseGuards(SubscriptionGuard)
 *   @Get('feature')
 *   feature() {}
 */
@Injectable()
export class SubscriptionGuard implements CanActivate {
  private readonly logger = new Logger(SubscriptionGuard.name);

  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const options = this.reflector.getAllAndOverride<SubscriptionOptions>(
      GUARD_METADATA.SUBSCRIPTION_OPTIONS,
      [context.getHandler(), context.getClass()],
    );

    if (!options) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const user = (request as any).user;

    if (!user) {
      throw new SubscriptionRequiredException(options.requiredPlan);
    }

    const userPlan: string = user.subscriptionPlan ?? 'free';
    const hierarchy = options.planHierarchy ?? DEFAULT_HIERARCHY;

    const required = Array.isArray(options.requiredPlan)
      ? options.requiredPlan
      : [options.requiredPlan];

    const userIndex = hierarchy.indexOf(userPlan.toLowerCase());
    const hasAccess = required.some((plan) => {
      const requiredIndex = hierarchy.indexOf(plan.toLowerCase());
      if (requiredIndex === -1) return userPlan.toLowerCase() === plan.toLowerCase();
      return userIndex >= requiredIndex;
    });

    if (!hasAccess) {
      this.logger.warn(`User ${user.sub} plan '${userPlan}' insufficient — requires: [${required.join(' or ')}]`);
      throw new SubscriptionRequiredException(options.requiredPlan);
    }

    this.logger.debug(`Subscription ok: user plan '${userPlan}' satisfies [${required.join(', ')}]`);
    return true;
  }
}
