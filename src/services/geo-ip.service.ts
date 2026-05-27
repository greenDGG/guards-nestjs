import { Injectable, Logger } from '@nestjs/common';
import { RedisStoreService } from './redis-store.service';

export interface GeoIpResponse {
  country_code: string;
  country_name: string;
  city?: string;
  region?: string;
  error?: string;
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

@Injectable()
export class GeoIpService {
  private readonly logger = new Logger(GeoIpService.name);

  constructor(private store: RedisStoreService) {}

  async lookup(ip: string, apiKey?: string): Promise<GeoIpResponse | null> {
    // Skip private/localhost IPs
    if (this.isPrivateIp(ip)) return null;

    const cacheKey = `geoip:${ip}`;
    const cached = await this.store.get(cacheKey);
    if (cached) return JSON.parse(cached);

    try {
      const url = apiKey
        ? `https://ipapi.co/${ip}/json/?key=${apiKey}`
        : `https://ipapi.co/${ip}/json/`;

      const response = await fetch(url, {
        signal: AbortSignal.timeout(5000),
        headers: { 'User-Agent': 'guard-nest/1.0' },
      });

      if (!response.ok) {
        this.logger.warn(`GeoIP lookup failed for ${ip}: HTTP ${response.status}`);
        return null;
      }

      const data = (await response.json()) as GeoIpResponse;

      if (data.error) {
        this.logger.warn(`GeoIP API error for ${ip}: ${data.error}`);
        return null;
      }

      await this.store.set(cacheKey, JSON.stringify(data), CACHE_TTL_MS);
      return data;
    } catch (error) {
      this.logger.warn(`GeoIP lookup exception for ${ip}: ${error instanceof Error ? error.message : error}`);
      return null;
    }
  }

  private isPrivateIp(ip: string): boolean {
    const privateRanges = [
      /^127\./,
      /^10\./,
      /^172\.(1[6-9]|2\d|3[01])\./,
      /^192\.168\./,
      /^::1$/,
      /^localhost$/,
      /^unknown$/,
    ];
    return privateRanges.some((r) => r.test(ip));
  }
}
