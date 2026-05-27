import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { createHash } from 'crypto';
import { GUARD_METADATA } from '../../constants/guard.constants';
import { RedisStoreService } from '../../services/redis-store.service';
import { IpExtractorService } from '../../services/ip-extractor.service';
import { FingerprintChangedException } from '../../exceptions/detection.exception';

export interface DeviceFingerprintOptions {
  sessionKey?: 'userId' | 'sessionToken';
  onMismatch?: 'block' | 'penalize';
  penaltyAmount?: number;
  ttlMs?: number;
}

/**
 * Level 4 — Device Fingerprint Guard
 *
 * Builds a SHA-256 fingerprint from browser-specific request headers
 * and compares it against the stored fingerprint for the current session.
 * A changed fingerprint may indicate session hijacking or a bot switching IPs.
 *
 * Fingerprint components:
 *   • User-Agent
 *   • Accept-Language
 *   • Accept-Encoding
 *   • IP subnet (/24, to tolerate mobile IP changes within same carrier block)
 *
 * On mismatch:
 *   'block'    — throws FingerprintChangedException (default)
 *   'penalize' — reduces trust score in store, allows request through
 *
 * Usage:
 *   @SetMetadata(GUARD_METADATA.DEVICE_FP_OPTIONS, { onMismatch: 'block' })
 *   @UseGuards(DeviceFingerprintGuard)
 *   @Post('transfer')
 *   transfer() {}
 */
@Injectable()
export class DeviceFingerprintGuard implements CanActivate {
  private readonly logger = new Logger(DeviceFingerprintGuard.name);
  private readonly DEFAULT_TTL = 30 * 60 * 1000; // 30 minutes

  constructor(
    private reflector: Reflector,
    private store: RedisStoreService,
    private ipExtractor: IpExtractorService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const options = this.reflector.getAllAndOverride<DeviceFingerprintOptions>(
      GUARD_METADATA.DEVICE_FP_OPTIONS,
      [context.getHandler(), context.getClass()],
    ) ?? {};

    const request = context.switchToHttp().getRequest<Request>();
    const user = (request as any).user;

    if (!user?.sub) return true; // Only check authenticated users

    const sessionKey = `fingerprint:${user.sub}`;
    const currentFp = this.computeFingerprint(request);

    const storedFp = await this.store.get(sessionKey);

    if (!storedFp) {
      // First request — store fingerprint
      await this.store.set(sessionKey, currentFp, options.ttlMs ?? this.DEFAULT_TTL);
      this.logger.debug(`Fingerprint stored for user ${user.sub}`);
      return true;
    }

    if (storedFp !== currentFp) {
      this.logger.warn(`Fingerprint mismatch for user ${user.sub}`);

      if (options.onMismatch === 'penalize') {
        const penalty = options.penaltyAmount ?? 20;
        const trustKey = `trustScore:${user.sub}`;
        const current = parseInt((await this.store.get(trustKey)) ?? '75', 10);
        await this.store.set(trustKey, String(Math.max(0, current - penalty)));
        // Update fingerprint to new one
        await this.store.set(sessionKey, currentFp, options.ttlMs ?? this.DEFAULT_TTL);
        return true;
      }

      throw new FingerprintChangedException();
    }

    // Refresh TTL on valid match
    await this.store.expire(sessionKey, options.ttlMs ?? this.DEFAULT_TTL);
    return true;
  }

  private computeFingerprint(request: Request): string {
    const ip = this.ipExtractor.getClientIp(request);
    const subnet = ip.split('.').slice(0, 3).join('.'); // /24 subnet

    const components = [
      request.headers['user-agent'] ?? '',
      request.headers['accept-language'] ?? '',
      request.headers['accept-encoding'] ?? '',
      subnet,
    ].join('|');

    return createHash('sha256').update(components).digest('hex');
  }
}
