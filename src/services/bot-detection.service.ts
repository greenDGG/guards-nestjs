import { Injectable } from '@nestjs/common';
import { Request } from 'express';
import { RedisStoreService } from './redis-store.service';

export interface BotDetectionOptions {
  threshold?: number;
  honeypotFields?: string[];
  logOnly?: boolean;
  allowedBots?: string[];
  weights?: Partial<BotSignalWeights>;
}

export interface BotSignalWeights {
  missingUserAgent: number;
  headlessUserAgent: number;
  malformedUserAgent: number;
  missingAccept: number;
  missingAcceptEncoding: number;
  missingAcceptLanguage: number;
  missingSecFetch: number;
  allHeadersMissing: number;
  requestSpeedVeryFast: number;
  requestSpeedFast: number;
  machinePrecisionTiming: number;
  honeypotFilled: number;
}

const DEFAULT_WEIGHTS: BotSignalWeights = {
  missingUserAgent: 30,
  headlessUserAgent: 25,
  malformedUserAgent: 15,
  missingAccept: 5,
  missingAcceptEncoding: 5,
  missingAcceptLanguage: 5,
  missingSecFetch: 5,
  allHeadersMissing: 5,
  requestSpeedVeryFast: 25,
  requestSpeedFast: 15,
  machinePrecisionTiming: 20,
  honeypotFilled: 30,
};

// Known headless/automation UA patterns
const HEADLESS_PATTERNS = [
  /HeadlessChrome/i,
  /Puppeteer/i,
  /Playwright/i,
  /PhantomJS/i,
  /SlimerJS/i,
  /CasperJS/i,
  /Selenium/i,
  /WebDriver/i,
  /selenium/i,
  /python-requests/i,
  /python-urllib/i,
  /java\//i,
  /curl\//i,
  /wget\//i,
  /Go-http-client/i,
  /libwww-perl/i,
  /ApacheBench/i,
  /okhttp/i,
  /axios/i,
  /node-fetch/i,
  /node\.js/i,
];

// Known good bots to whitelist by default
const ALLOWED_GOOD_BOTS = [
  /Googlebot/i,
  /Bingbot/i,
  /Slurp/i, // Yahoo
  /DuckDuckBot/i,
  /Baiduspider/i,
  /YandexBot/i,
  /facebot/i,
  /ia_archiver/i,
];

@Injectable()
export class BotDetectionService {
  constructor(private store: RedisStoreService) {}

  async computeBotScore(request: Request, options: BotDetectionOptions = {}): Promise<number> {
    const weights = { ...DEFAULT_WEIGHTS, ...options.weights };
    const ua = request.headers['user-agent'] ?? '';
    const headers = request.headers;
    let score = 0;

    // Skip known good bots
    const allowedPatterns = [
      ...ALLOWED_GOOD_BOTS,
      ...(options.allowedBots ?? []).map((b) => new RegExp(b, 'i')),
    ];
    if (allowedPatterns.some((p) => p.test(ua))) return 0;

    // Signal 1: User-Agent analysis
    if (!ua) {
      score += weights.missingUserAgent;
    } else if (HEADLESS_PATTERNS.some((p) => p.test(ua))) {
      score += weights.headlessUserAgent;
    } else if (ua.length < 20 || !ua.includes('(')) {
      score += weights.malformedUserAgent;
    }

    // Signal 2: Missing browser headers
    const hasAccept = !!headers['accept'];
    const hasAcceptEncoding = !!headers['accept-encoding'];
    const hasAcceptLanguage = !!headers['accept-language'];
    const hasSecFetch = headers['sec-fetch-site'] !== undefined;

    if (!hasAccept) score += weights.missingAccept;
    if (!hasAcceptEncoding) score += weights.missingAcceptEncoding;
    if (!hasAcceptLanguage) score += weights.missingAcceptLanguage;
    if (!hasSecFetch && ua.toLowerCase().includes('chrome')) score += weights.missingSecFetch;
    if (!hasAccept && !hasAcceptEncoding && !hasAcceptLanguage) score += weights.allHeadersMissing;

    // Signal 3: Request timing — inter-request speed
    const ip = this.extractIp(request);
    const timingScore = await this.analyzeRequestTiming(ip, weights);
    score += timingScore;

    // Signal 4: Honeypot field detection (POST requests with body)
    const honeypotScore = this.checkHoneypotFields(request, options.honeypotFields ?? [], weights);
    score += honeypotScore;

    return Math.min(100, score);
  }

  private async analyzeRequestTiming(ip: string, weights: BotSignalWeights): Promise<number> {
    const key = `botTiming:${ip}`;
    const now = Date.now();

    const raw = await this.store.lrange(key, 0, 9);
    await this.store.lpush(key, String(now));
    await this.store.ltrim(key, 0, 9);
    await this.store.expire(key, 60_000);

    const timestamps = raw.map(Number);
    if (timestamps.length < 2) return 0;

    const intervals: number[] = [];
    for (let i = 0; i < timestamps.length - 1; i++) {
      intervals.push(Math.abs(timestamps[i] - timestamps[i + 1]));
    }

    const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const variance = intervals.reduce((a, b) => a + Math.pow(b - avg, 2), 0) / intervals.length;
    const stdDev = Math.sqrt(variance);
    const cv = avg > 0 ? stdDev / avg : 0;

    if (avg < 200) return weights.requestSpeedVeryFast;
    if (avg < 500) return weights.requestSpeedFast;
    if (cv < 0.05 && avg < 2000) return weights.machinePrecisionTiming;

    return 0;
  }

  private checkHoneypotFields(
    request: Request,
    honeypotFields: string[],
    weights: BotSignalWeights,
  ): number {
    if (!honeypotFields.length) return 0;
    const body = (request as any).body;
    if (!body || typeof body !== 'object') return 0;

    for (const field of honeypotFields) {
      if (body[field] !== undefined && body[field] !== '') {
        return weights.honeypotFilled;
      }
    }
    return 0;
  }

  private extractIp(request: Request): string {
    const xff = request.headers['x-forwarded-for'];
    if (typeof xff === 'string') return xff.split(',')[0].trim();
    return request.socket?.remoteAddress ?? request.ip ?? 'unknown';
  }
}
