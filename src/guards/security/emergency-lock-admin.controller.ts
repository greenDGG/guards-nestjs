import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { Public } from '../../decorators/public.decorator';
import { EmergencyLockService } from '../../services/emergency-lock.service';

interface LockDto {
  key:           string;
  reason?:       string;
  ttlSeconds?:   number;
  allowedIps?:   string[];
  allowedRoles?: string[];
}

/**
 * Admin controller for EmergencyLockGuard.
 *
 * Register in your AppModule (or DemoModule) to enable the admin endpoints:
 *   @Module({ controllers: [EmergencyLockAdminController] })
 *
 * All endpoints require:
 *   x-admin-key: <EMERGENCY_LOCK_ADMIN_KEY env var>
 *
 * If EMERGENCY_LOCK_ADMIN_KEY is not set, all requests return 403.
 */
@Controller('emergency')
@Public()
export class EmergencyLockAdminController {
  constructor(private readonly lockService: EmergencyLockService) {}

  private check(adminKey: string | undefined): void {
    const expected = process.env.EMERGENCY_LOCK_ADMIN_KEY;
    if (!expected) {
      throw new ForbiddenException(
        'Emergency lock admin is disabled — set EMERGENCY_LOCK_ADMIN_KEY to enable',
      );
    }
    if (!adminKey || adminKey !== expected) {
      throw new UnauthorizedException('Invalid x-admin-key');
    }
  }

  /**
   * Lock an endpoint key. All requests to endpoints decorated with
   * @EmergencyLock({ key }) will return 503 until unlocked.
   *
   * POST /emergency/lock
   * { "key": "withdrawals", "reason": "Under attack", "ttlSeconds": 3600 }
   */
  @Post('lock')
  @HttpCode(HttpStatus.OK)
  lock(
    @Body() body: LockDto,
    @Headers('x-admin-key') adminKey: string,
  ) {
    this.check(adminKey);
    if (!body?.key) throw new BadRequestException('body.key is required');
    const state = this.lockService.lock(
      body.key,
      body.reason,
      body.ttlSeconds,
      body.allowedIps,
      body.allowedRoles,
    );
    return {
      locked:      true,
      key:         state.key,
      reason:      state.reason,
      lockedAt:    new Date(state.lockedAt).toISOString(),
      expiresAt:   state.expiresAt ? new Date(state.expiresAt).toISOString() : null,
      ttlSeconds:  body.ttlSeconds ?? null,
    };
  }

  /**
   * Unlock a specific endpoint key.
   *
   * POST /emergency/unlock
   * { "key": "withdrawals" }
   */
  @Post('unlock')
  @HttpCode(HttpStatus.OK)
  unlock(
    @Body() body: { key: string },
    @Headers('x-admin-key') adminKey: string,
  ) {
    this.check(adminKey);
    if (!body?.key) throw new BadRequestException('body.key is required');
    const was = this.lockService.unlock(body.key);
    return { unlocked: was, key: body.key };
  }

  /**
   * Unlock all active locks in one call.
   *
   * POST /emergency/unlock-all
   */
  @Post('unlock-all')
  @HttpCode(HttpStatus.OK)
  unlockAll(@Headers('x-admin-key') adminKey: string) {
    this.check(adminKey);
    const keys = this.lockService.unlockAll();
    return { unlockedAll: true, count: keys.length, keys };
  }

  /**
   * Return all active locks with their current state.
   *
   * GET /emergency/status
   */
  @Get('status')
  status(@Headers('x-admin-key') adminKey: string) {
    this.check(adminKey);
    const locks = this.lockService.getAllLocks();
    const now   = Date.now();
    return {
      activeLocks: locks.length,
      locks: locks.map(l => ({
        key:              l.key,
        reason:           l.reason,
        lockedAt:         new Date(l.lockedAt).toISOString(),
        expiresAt:        l.expiresAt ? new Date(l.expiresAt).toISOString() : null,
        expiresInSeconds: l.expiresAt ? Math.max(0, Math.ceil((l.expiresAt - now) / 1000)) : null,
        allowedIps:       l.allowedIps   ?? [],
        allowedRoles:     l.allowedRoles ?? [],
      })),
    };
  }
}
