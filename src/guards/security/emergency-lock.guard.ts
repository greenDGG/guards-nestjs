import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { GUARD_METADATA } from '../../constants/guard.constants';
import { IpExtractorService } from '../../services/ip-extractor.service';
import { EmergencyLockService } from '../../services/emergency-lock.service';
import { EmergencyLockException } from '../../exceptions/security.exception';
import type { EmergencyLockOptions } from '../../decorators/emergency-lock.decorator';

/**
 * EmergencyLockGuard — kill switch for any endpoint.
 *
 * Usage:
 *   @EmergencyLock({ key: 'withdrawals' })
 *   @UseGuards(EmergencyLockGuard)
 *   @Post('withdraw')
 *   withdraw() {}
 *
 * Lock/unlock via admin API:
 *   POST /emergency/lock      { key, reason, ttlSeconds? }
 *   POST /emergency/unlock    { key }
 *   POST /emergency/unlock-all
 *   GET  /emergency/status
 *   Header: x-admin-key: <EMERGENCY_LOCK_ADMIN_KEY env var>
 *
 * Startup lock (no restart needed for unlock):
 *   EMERGENCY_LOCK_KEYS=withdrawals,login   (comma-separated)
 *
 * Bypass order (first match wins):
 *   1. Decorator allowedRoles — static, compiled into endpoint
 *   2. Decorator allowedIps   — static, compiled into endpoint
 *   3. Lock-state allowedRoles — dynamic, set at lock time via admin API
 *   4. Lock-state allowedIps   — dynamic, set at lock time via admin API
 */
@Injectable()
export class EmergencyLockGuard implements CanActivate {
  private readonly logger = new Logger(EmergencyLockGuard.name);

  constructor(
    private readonly reflector:    Reflector,
    private readonly lockService:  EmergencyLockService,
    private readonly ipExtractor:  IpExtractorService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const options = this.reflector.getAllAndOverride<EmergencyLockOptions | undefined>(
      GUARD_METADATA.EMERGENCY_LOCK_OPTIONS,
      [context.getHandler(), context.getClass()],
    );

    if (options === undefined) return true;

    const request = context.switchToHttp().getRequest<any>();
    const key     = options.key ?? (request.route?.path ?? request.url ?? 'unknown');
    const state   = this.lockService.isLocked(key);

    if (!state) return true;

    // ── Bypass checks (first match wins) ─────────────────────────────────────

    const userRoles: string[] = request.user?.roles ?? [];

    // Static role bypass (decorator) — e.g. admins can always withdraw even during lockdown
    if (options.allowedRoles?.length && options.allowedRoles.some(r => userRoles.includes(r))) {
      this.logger.log(`[EMERGENCY-LOCK] "${key}" — static role bypass (${userRoles.join(',')})`);
      return true;
    }

    // Static IP bypass (decorator) — e.g. internal tooling always gets through
    if (options.allowedIps?.length) {
      const ip = this.ipExtractor.getClientIp(request);
      if (options.allowedIps.includes(ip)) {
        this.logger.log(`[EMERGENCY-LOCK] "${key}" — static IP bypass (${ip})`);
        return true;
      }
    }

    // Dynamic role bypass (set at lock time via admin API)
    if (state.allowedRoles?.length && state.allowedRoles.some(r => userRoles.includes(r))) {
      this.logger.log(`[EMERGENCY-LOCK] "${key}" — dynamic role bypass (${userRoles.join(',')})`);
      return true;
    }

    // Dynamic IP bypass (set at lock time via admin API)
    if (state.allowedIps?.length) {
      const ip = this.ipExtractor.getClientIp(request);
      if (state.allowedIps.includes(ip)) {
        this.logger.log(`[EMERGENCY-LOCK] "${key}" — dynamic IP bypass (${ip})`);
        return true;
      }
    }

    // ── Lock is active ────────────────────────────────────────────────────────

    if (options.logOnly) {
      this.logger.warn(`[EMERGENCY-LOCK] [OBSERVE] "${key}" would be blocked — ${state.reason}`);
      return true;
    }

    const retryAfter = state.expiresAt
      ? Math.max(1, Math.ceil((state.expiresAt - Date.now()) / 1000))
      : undefined;

    if (retryAfter !== undefined) {
      context.switchToHttp().getResponse<any>().setHeader('Retry-After', String(retryAfter));
    }

    throw new EmergencyLockException(key, state.reason, retryAfter);
  }
}
