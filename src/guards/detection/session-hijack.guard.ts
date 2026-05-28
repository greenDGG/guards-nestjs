import { createHash } from 'crypto';
import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request, Response } from 'express';
import { GUARD_METADATA } from '../../constants/guard.constants';
import { SessionHijackOptions } from '../../decorators/session-hijack.decorator';
import { JwtPayload } from '../../interfaces/jwt-payload.interface';
import { RedisStoreService } from '../../services/redis-store.service';
import { GeoIpService } from '../../services/geo-ip.service';
import { IpExtractorService } from '../../services/ip-extractor.service';
import { SessionHijackedException } from '../../exceptions/detection.exception';

interface SessionState {
  firstIp:     string;
  firstSubnet: string;
  lastIp:      string;
  lastSubnet:  string;
  lastCountry: string | null;
  uaHash:      string;
  fpHash:      string;   // UA + lang + enc (no subnet — that's tracked separately)
  createdAt:   number;
  requestCount: number;
}

export interface HijackBreakdown {
  subnetChange:  number;
  uaChange:      number;
  concurrent:    number;
  geoChange:     number;
  total:         number;
  signals:       string[];
  [key: string]: unknown;
}

/**
 * SessionHijackGuard — detects stolen session tokens in authenticated APIs
 *
 * Tracks session-bound state per token (userId + iat) and compares each
 * incoming request against the established session baseline.
 *
 * ─── Signals ──────────────────────────────────────────────────────────────
 *
 *   Signal          │ Max pts │ Trigger
 *   ─────────────────────────────────────────────────────────────────────────
 *   Subnet change   │   25    │ /24 IP subnet different from session baseline
 *   UA change       │   35    │ User-Agent hash changed mid-session
 *   Concurrent use  │   25    │ 2+ distinct IPs using same token within 30s
 *   Geo change      │   15    │ Country different from baseline (if geo available)
 *
 * ─── Decisions ────────────────────────────────────────────────────────────
 *
 *   < 30   → allow  — update state, continue
 *   30–59  → warn   — set headers, penalize trust score, continue
 *   ≥ 60   → block  → 401 SessionHijackedException
 *
 * ─── Session key ──────────────────────────────────────────────────────────
 *
 *   Keyed by `sub + iat` — each issued token gets its own session baseline.
 *   If the user re-logs in, `iat` changes → clean baseline.
 *   This makes the guard immune to token fixation: an old captured token
 *   builds up its own baseline separately from the current valid token.
 *
 * ─── What it catches that DeviceFingerprintGuard doesn't ─────────────────
 *
 *   DeviceFingerprintGuard: checks fingerprint per userId (not per token)
 *   SessionHijackGuard:
 *     • Per-token state (keyed by iat) → detects re-login as clean start
 *     • Concurrent use from different IPs → token stolen and used in parallel
 *     • Subnet-level IP change (not fingerprint level)
 *     • Geo change signal
 *     • Scoring → warn before blocking
 *
 * ─── Requires authentication ─────────────────────────────────────────────
 *
 *   Skips unauthenticated requests (no JWT user). Place after JwtAuthGuard.
 *
 * Usage:
 *   @SessionProtect()
 *   @UseGuards(SessionHijackGuard)
 *   @Get('account/transfers')
 *   transfers() {}
 *
 *   // Strict — lower block threshold
 *   @SessionProtect({ thresholds: { warn: 20, block: 45 } })
 *   @UseGuards(SessionHijackGuard)
 *   @Post('withdraw')
 *   withdraw() {}
 */
@Injectable()
export class SessionHijackGuard implements CanActivate {
  private readonly logger = new Logger(SessionHijackGuard.name);

  constructor(
    private readonly reflector:    Reflector,
    private readonly store:        RedisStoreService,
    private readonly geoService:   GeoIpService,
    private readonly ipExtractor:  IpExtractorService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const options = this.reflector.getAllAndOverride<SessionHijackOptions | undefined>(
      GUARD_METADATA.SESSION_HIJACK_OPTIONS,
      [context.getHandler(), context.getClass()],
    );

    if (!options) return true;

    const request  = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    const user     = (request as any).user as JwtPayload | undefined;

    // Only meaningful for authenticated sessions
    if (!user?.sub) return true;

    const ip     = this.ipExtractor.getClientIp(request);
    const subnet = this.toSubnet(ip);
    const uaHash = this.hashString(request.headers['user-agent'] ?? '');
    const fpHash = this.computeFpHash(request);

    const sessionTtlMs = options.sessionTtlMs ?? 24 * 60 * 60 * 1000;
    // Use sub + iat to key per-token (not per-user)
    const tokenId  = `${user.sub}:${user.iat ?? 0}`;
    const stateKey = `hijack:state:${tokenId}`;

    const stored = await this.store.get(stateKey);

    // ── First request with this token → establish baseline ────────────────
    if (!stored) {
      // Resolve country for baseline (non-blocking — failure = null)
      const geo = await this.tryGeoLookup(ip);
      const state: SessionState = {
        firstIp:      ip,
        firstSubnet:  subnet,
        lastIp:       ip,
        lastSubnet:   subnet,
        lastCountry:  geo?.country_code ?? null,
        uaHash,
        fpHash,
        createdAt:    Date.now(),
        requestCount: 1,
      };
      await this.store.set(stateKey, JSON.stringify(state), sessionTtlMs);
      await this.trackConcurrent(tokenId, ip);
      this.logger.debug(`Session baseline set — token=${tokenId.slice(0, 12)}... ip=${subnet}`);
      response.setHeader('X-Session-Risk', '0');
      response.setHeader('X-Session-Action', 'allow');
      return true;
    }

    const state: SessionState = JSON.parse(stored);

    // ── Gather signals in parallel ─────────────────────────────────────────
    const [concurrentIps, currentCountry] = await Promise.all([
      this.getConcurrentIps(tokenId, ip),
      this.tryGeoLookup(ip),
    ]);

    const signals: string[] = [];

    // 1. Subnet change
    const subnetPts = this.scoreSubnetChange(subnet, state, signals, options);

    // 2. User-Agent change
    const uaPts = this.scoreUaChange(uaHash, state, signals, options);

    // 3. Concurrent use from distinct IPs
    const concPts = this.scoreConcurrentUse(concurrentIps, signals);

    // 4. Geo change (country level)
    const geoPts = this.scoreGeoChange(
      currentCountry?.country_code ?? null,
      state,
      signals,
    );

    const total = Math.min(100, Math.round(subnetPts + uaPts + concPts + geoPts));
    const breakdown: HijackBreakdown = {
      subnetChange: Math.round(subnetPts),
      uaChange:     Math.round(uaPts),
      concurrent:   Math.round(concPts),
      geoChange:    Math.round(geoPts),
      total,
      signals,
    };

    const warnAt  = options.thresholds?.warn  ?? 30;
    const blockAt = options.thresholds?.block ?? 60;

    const action =
      total >= blockAt ? 'block' :
      total >= warnAt  ? 'warn'  :
                         'allow';

    response.setHeader('X-Session-Risk',   String(total));
    response.setHeader('X-Session-Action', action);

    // ── Update state (even on warn — track progression) ────────────────────
    const updatedState: SessionState = {
      ...state,
      lastIp:       ip,
      lastSubnet:   subnet,
      lastCountry:  currentCountry?.country_code ?? state.lastCountry,
      requestCount: state.requestCount + 1,
    };
    await this.store.set(stateKey, JSON.stringify(updatedState), sessionTtlMs);
    await this.trackConcurrent(tokenId, ip);

    if (signals.length > 0) {
      this.logger.warn(
        `SessionHijack token=${tokenId.slice(0, 12)}...` +
          `  score=${total}  action=${action}` +
          `  signals=[${signals.join(', ')}]` +
          `  ip=${ip}  subnet=${subnet}`,
      );
    }

    if (action === 'block') {
      if (!options.logOnly) throw new SessionHijackedException(total, breakdown);
    }

    if (action === 'warn' && !options.logOnly) {
      // Penalize trust score — picked up by AdaptiveRateLimitGuard / RiskScoreGuard
      const trustKey = `trustScore:${user.sub}`;
      const current  = parseInt((await this.store.get(trustKey)) ?? '75', 10);
      const penalty  = options.warnPenalty ?? 10;
      await this.store.set(trustKey, String(Math.max(0, current - penalty)));
    }

    return true;
  }

  // ── Signal scorers ──────────────────────────────────────────────────────

  private scoreSubnetChange(
    currentSubnet: string,
    state: SessionState,
    signals: string[],
    options: SessionHijackOptions,
  ): number {
    if (currentSubnet === state.lastSubnet) return 0;

    const maxAllowed = options.maxSubnetChanges ?? 1;
    // Check how many distinct subnets this session has seen
    // (we track via lastSubnet — simplified: any deviation from first subnet scores)
    if (currentSubnet === state.firstSubnet) return 0; // returned to original

    signals.push(`subnet-change(${state.lastSubnet}→${currentSubnet})`);
    // First change: moderate. Repeated changes on same session: higher.
    return state.lastSubnet !== state.firstSubnet ? 25 : 15;
  }

  private scoreUaChange(
    currentUaHash: string,
    state: SessionState,
    signals: string[],
    _options: SessionHijackOptions,
  ): number {
    if (currentUaHash === state.uaHash) return 0;
    signals.push('ua-changed');
    return 35; // Strong hijack signal — legitimate users don't change UA mid-session
  }

  private scoreConcurrentUse(
    distinctIps: string[],
    signals: string[],
  ): number {
    if (distinctIps.length < 2) return 0;
    signals.push(`concurrent-use(${distinctIps.length}-ips)`);
    return distinctIps.length >= 3 ? 25 : 20;
  }

  private scoreGeoChange(
    currentCountry: string | null,
    state: SessionState,
    signals: string[],
  ): number {
    if (!currentCountry || !state.lastCountry) return 0;
    if (currentCountry === state.lastCountry) return 0;
    signals.push(`country-change(${state.lastCountry}→${currentCountry})`);
    return 15;
  }

  // ── Concurrent use tracking ─────────────────────────────────────────────

  private async trackConcurrent(tokenId: string, ip: string): Promise<void> {
    const key = `hijack:conc:${tokenId}`;
    await this.store.lpush(key, JSON.stringify({ ip, ts: Date.now() }));
    await this.store.ltrim(key, 0, 49);
    await this.store.expire(key, 120_000); // 2 minutes
  }

  private async getConcurrentIps(tokenId: string, currentIp: string): Promise<string[]> {
    const key     = `hijack:conc:${tokenId}`;
    const entries = await this.store.lrange(key, 0, -1);
    const cutoff  = Date.now() - 30_000; // 30-second window

    const recentIps = new Set<string>([currentIp]);
    for (const raw of entries) {
      try {
        const { ip, ts } = JSON.parse(raw) as { ip: string; ts: number };
        if (ts >= cutoff) recentIps.add(ip);
      } catch {
        // malformed entry — skip
      }
    }
    return Array.from(recentIps);
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private toSubnet(ip: string): string {
    const parts = ip.split('.');
    // IPv4 /24 subnet
    if (parts.length === 4) return parts.slice(0, 3).join('.');
    // IPv6: return first 4 groups
    if (ip.includes(':')) return ip.split(':').slice(0, 4).join(':');
    return ip;
  }

  private hashString(value: string): string {
    return createHash('sha256').update(value).digest('hex').slice(0, 16);
  }

  private computeFpHash(request: Request): string {
    const ua   = request.headers['user-agent']      ?? '';
    const lang = request.headers['accept-language'] ?? '';
    const enc  = request.headers['accept-encoding'] ?? '';
    return this.hashString(`${ua}|${lang}|${enc}`);
  }

  private async tryGeoLookup(ip: string) {
    try {
      return await this.geoService.lookup(ip);
    } catch {
      return null;
    }
  }
}
