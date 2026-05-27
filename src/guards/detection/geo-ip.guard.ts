import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { GUARD_METADATA } from '../../constants/guard.constants';
import { GeoIpService } from '../../services/geo-ip.service';
import { IpExtractorService } from '../../services/ip-extractor.service';
import { SecurityContextService } from '../../services/security-context.service';
import { GeoIpBlockedException } from '../../exceptions/detection.exception';

export interface GeoIpGuardOptions {
  mode: 'whitelist' | 'blacklist';
  countries: string[];
  apiKey?: string;
  fallbackAllow?: boolean;
}

/**
 * Level 4 — Geographic IP Guard
 *
 * Blocks or allows requests based on the country of origin.
 * Uses the ipapi.co free API (1000 req/day). Results cached 24h.
 * On API failure, defaults to allowing unless fallbackAllow is false.
 *
 * Usage:
 *   // Block specific high-risk countries:
 *   @SetMetadata(GUARD_METADATA.GEO_IP_OPTIONS, {
 *     mode: 'blacklist',
 *     countries: ['KP', 'IR', 'SY'],
 *   })
 *   @UseGuards(GeoIpGuard)
 *   @Get('sensitive-data')
 *   getData() {}
 *
 *   // Allow only specific countries:
 *   @SetMetadata(GUARD_METADATA.GEO_IP_OPTIONS, {
 *     mode: 'whitelist',
 *     countries: ['US', 'CA', 'GB', 'AU'],
 *   })
 *   @UseGuards(GeoIpGuard)
 *   @Get('us-only')
 *   getUsData() {}
 */
@Injectable()
export class GeoIpGuard implements CanActivate {
  private readonly logger = new Logger(GeoIpGuard.name);

  constructor(
    private reflector: Reflector,
    private geoIpService: GeoIpService,
    private ipExtractor: IpExtractorService,
    private secCtx: SecurityContextService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const options = this.reflector.getAllAndOverride<GeoIpGuardOptions>(
      GUARD_METADATA.GEO_IP_OPTIONS,
      [context.getHandler(), context.getClass()],
    );

    if (!options) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const ctx = this.secCtx.get(request);
    const ip = ctx.ip; // already resolved by SecurityContextMiddleware

    // If another guard on this same request already fetched geo, reuse it
    let countryCode: string;
    if (ctx.geo) {
      countryCode = ctx.geo.countryCode;
      this.logger.debug(`GeoIP from SecurityContext (no API call) — ${countryCode}`);
    } else {
      const geoData = await this.geoIpService.lookup(ip, options.apiKey);

      if (!geoData) {
        const fallback = options.fallbackAllow !== false;
        this.logger.warn(`GeoIP lookup failed for ${ip} — ${fallback ? 'allowing' : 'blocking'}`);
        if (!fallback) throw new GeoIpBlockedException('unknown');
        return true;
      }

      countryCode = geoData.country_code?.toUpperCase();

      // Write to context so any subsequent guard on this request skips the API call
      ctx.geo = {
        countryCode,
        country: geoData.country_name ?? countryCode,
        city: geoData.city,
        region: geoData.region,
      };
    }

    const inList = options.countries.map((c) => c.toUpperCase()).includes(countryCode);

    if (options.mode === 'whitelist' && !inList) {
      this.logger.warn(`GeoIP blocked country '${countryCode}' (not in whitelist)`);
      throw new GeoIpBlockedException(countryCode);
    }

    if (options.mode === 'blacklist' && inList) {
      this.logger.warn(`GeoIP blocked country '${countryCode}' (blacklisted)`);
      throw new GeoIpBlockedException(countryCode);
    }

    this.logger.debug(`GeoIP passed for ${countryCode} (${ip})`);
    return true;
  }
}
