import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { GUARD_METADATA } from '../../constants/guard.constants';
import { MfaRequiredException } from '../../exceptions/business.exception';

export interface MfaOptions {
  maxAgeSeconds?: number;
  required?: boolean;
}

/**
 * Level 5 — Multi-Factor Authentication (MFA) Guard
 *
 * Verifies that the current user completed MFA recently enough.
 * Reads the mfaVerifiedAt timestamp from the JWT payload (set during login
 * after the user completes their second factor).
 *
 * Throws MfaRequiredException if:
 *   • mfaVerifiedAt is missing (and required === true, which is the default)
 *   • MFA was verified more than maxAgeSeconds ago (session too old)
 *
 * Usage:
 *   // Require MFA verified within the last 15 minutes:
 *   @SetMetadata(GUARD_METADATA.MFA_OPTIONS, { maxAgeSeconds: 900 })
 *   @UseGuards(MfaGuard)
 *   @Post('transfer-funds')
 *   transferFunds() {}
 *
 *   // Soft MFA — skip if user hasn't set up MFA yet:
 *   @SetMetadata(GUARD_METADATA.MFA_OPTIONS, { required: false, maxAgeSeconds: 3600 })
 *   @UseGuards(MfaGuard)
 *   @Get('sensitive-settings')
 *   sensitiveSettings() {}
 */
@Injectable()
export class MfaGuard implements CanActivate {
  private readonly logger = new Logger(MfaGuard.name);

  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const options = this.reflector.getAllAndOverride<MfaOptions>(
      GUARD_METADATA.MFA_OPTIONS,
      [context.getHandler(), context.getClass()],
    );

    if (!options) return true;

    const maxAgeSeconds = options.maxAgeSeconds ?? 3600;
    const required = options.required !== false;

    const request = context.switchToHttp().getRequest<Request>();
    const user = (request as any).user;

    if (!user) throw new MfaRequiredException();

    const mfaVerifiedAt: number | undefined = user.mfaVerifiedAt;

    if (!mfaVerifiedAt) {
      if (required) {
        this.logger.warn(`MFA not verified for user ${user.sub}`);
        throw new MfaRequiredException();
      }
      return true;
    }

    const mfaAgeSeconds = Math.floor(Date.now() / 1000) - mfaVerifiedAt;

    if (mfaAgeSeconds > maxAgeSeconds) {
      this.logger.warn(`MFA expired for user ${user.sub}: verified ${mfaAgeSeconds}s ago (max ${maxAgeSeconds}s)`);
      throw new MfaRequiredException();
    }

    this.logger.debug(`MFA valid for user ${user.sub}: verified ${mfaAgeSeconds}s ago`);
    return true;
  }
}
