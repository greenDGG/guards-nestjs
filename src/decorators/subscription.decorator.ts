import { SetMetadata } from '@nestjs/common';
import { GUARD_METADATA } from '../constants/guard.constants';

export interface SubscriptionOptions {
  requiredPlan: string | string[];
  planHierarchy?: string[];
}

export const RequireSubscription = (
  requiredPlan: string | string[],
  planHierarchy?: string[],
) =>
  SetMetadata(GUARD_METADATA.SUBSCRIPTION_OPTIONS, {
    requiredPlan,
    planHierarchy: planHierarchy ?? ['free', 'starter', 'pro', 'enterprise'],
  });
