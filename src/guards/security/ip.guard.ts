import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { GUARD_METADATA } from '../../constants/guard.constants';
import { IpGuardOptions } from '../../decorators/ip.decorator';
import { IpExtractorService } from '../../services/ip-extractor.service';
import { IpBlockedException } from '../../exceptions/security.exception';

/**
 * Level 2 — IP Whitelist / Blacklist Guard
 *
 * Allows or denies requests based on the client IP address.
 * Supports exact IPv4, exact IPv6, and CIDR notation (e.g., 192.168.0.0/24).
 *
 * Usage:
 *   @IpFilter({ mode: 'whitelist', list: ['192.168.1.0/24', '10.0.0.1'] })
 *   @UseGuards(IpGuard)
 *   @Get('internal')
 *   internalEndpoint() {}
 *
 *   @IpFilter({ mode: 'blacklist', list: ['1.2.3.4'] })
 *   @UseGuards(IpGuard)
 *   @Get('public')
 *   publicEndpoint() {}
 */
@Injectable()
export class IpGuard implements CanActivate {
  private readonly logger = new Logger(IpGuard.name);

  constructor(
    private reflector: Reflector,
    private ipExtractor: IpExtractorService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const options = this.reflector.getAllAndOverride<IpGuardOptions>(GUARD_METADATA.IP_OPTIONS, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!options) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const clientIp = this.ipExtractor.getClientIp(request);

    const matched = this.isIpInList(clientIp, options.list);

    if (options.mode === 'whitelist' && !matched) {
      this.logger.warn(`IP ${clientIp} not in whitelist`);
      throw new IpBlockedException(clientIp);
    }

    if (options.mode === 'blacklist' && matched) {
      this.logger.warn(`IP ${clientIp} is blacklisted`);
      throw new IpBlockedException(clientIp);
    }

    this.logger.debug(`IP ${clientIp} passed ${options.mode} check`);
    return true;
  }

  private isIpInList(ip: string, list: string[]): boolean {
    return list.some((entry) => {
      if (entry.includes('/')) {
        return this.ipExtractor.isIpInCidr(ip, entry);
      }
      return ip === entry;
    });
  }
}
