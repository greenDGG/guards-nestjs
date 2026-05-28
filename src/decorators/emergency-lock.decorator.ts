import { SetMetadata } from '@nestjs/common';
import { GUARD_METADATA } from '../constants/guard.constants';

export interface EmergencyLockOptions {
  /** Custom lock key. Defaults to the route path (e.g. /demo/level2/withdraw). */
  key?:          string;
  /** Roles that always bypass the lock — baked into the endpoint at compile time. */
  allowedRoles?: string[];
  /** IPs that always bypass the lock — baked into the endpoint at compile time. */
  allowedIps?:   string[];
  /** Log violations without blocking. Useful for testing the key before enforcing. */
  logOnly?:      boolean;
}

export const EmergencyLock = (options: EmergencyLockOptions = {}) =>
  SetMetadata(GUARD_METADATA.EMERGENCY_LOCK_OPTIONS, options);
