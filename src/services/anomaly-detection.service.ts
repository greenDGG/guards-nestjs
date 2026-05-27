import { Injectable, Logger } from '@nestjs/common';
import { RedisStoreService } from './redis-store.service';

export interface AnomalyMetrics {
  ema_rpm: number;
  ema_errorRate: number;
  lastUpdated: number;
}

const EMA_ALPHA = 0.3;
const TRUST_PENALTY_KEY_PREFIX = 'trustScore:';
const ANOMALY_EMA_PREFIX = 'anomaly:ema:';
const DEFAULT_TRUST_SCORE = 75;

@Injectable()
export class AnomalyDetectionService {
  private readonly logger = new Logger(AnomalyDetectionService.name);

  constructor(private store: RedisStoreService) {}

  async recordRequest(userId: string | number, endpoint: string, isError: boolean): Promise<void> {
    const now = Date.now();
    const key = `${ANOMALY_EMA_PREFIX}${userId}`;

    const raw = await this.store.get(key);
    const metrics: AnomalyMetrics = raw
      ? JSON.parse(raw)
      : { ema_rpm: 0, ema_errorRate: 0, lastUpdated: now };

    const secondsElapsed = Math.max(1, (now - metrics.lastUpdated) / 1000);
    const currentRpm = 60 / secondsElapsed;
    const currentErrorRate = isError ? 1 : 0;

    metrics.ema_rpm = EMA_ALPHA * currentRpm + (1 - EMA_ALPHA) * metrics.ema_rpm;
    metrics.ema_errorRate = EMA_ALPHA * currentErrorRate + (1 - EMA_ALPHA) * metrics.ema_errorRate;
    metrics.lastUpdated = now;

    await this.store.set(key, JSON.stringify(metrics), 10 * 60 * 1000);
  }

  async detectAnomaly(
    userId: string | number,
    rpmMultiplier: number = 3.0,
    errorRateThreshold: number = 0.5,
  ): Promise<{ isAnomalous: boolean; reason?: string }> {
    const key = `${ANOMALY_EMA_PREFIX}${userId}`;
    const raw = await this.store.get(key);
    if (!raw) return { isAnomalous: false };

    const metrics: AnomalyMetrics = JSON.parse(raw);

    // Check current rpm vs baseline EMA
    const now = Date.now();
    const secondsElapsed = Math.max(1, (now - metrics.lastUpdated) / 1000);
    const currentRpm = 60 / secondsElapsed;

    if (metrics.ema_rpm > 0 && currentRpm > metrics.ema_rpm * rpmMultiplier) {
      return { isAnomalous: true, reason: `RPM spike: ${currentRpm.toFixed(1)} vs baseline ${metrics.ema_rpm.toFixed(1)}` };
    }

    if (metrics.ema_errorRate > errorRateThreshold) {
      return { isAnomalous: true, reason: `High error rate: ${(metrics.ema_errorRate * 100).toFixed(1)}%` };
    }

    return { isAnomalous: false };
  }

  async penalizeTrustScore(userId: string | number, penalty: number = 10, ttlMs: number = 60 * 60 * 1000): Promise<void> {
    const key = `${TRUST_PENALTY_KEY_PREFIX}${userId}`;
    const current = parseInt((await this.store.get(key)) ?? String(DEFAULT_TRUST_SCORE), 10);
    const updated = Math.max(0, current - penalty);
    await this.store.set(key, String(updated), ttlMs);
    this.logger.warn(`Trust score penalized: user ${userId} — ${current} → ${updated}`);
  }

  async getTrustScore(userId: string | number): Promise<number> {
    const raw = await this.store.get(`${TRUST_PENALTY_KEY_PREFIX}${userId}`);
    return raw !== null ? parseInt(raw, 10) : DEFAULT_TRUST_SCORE;
  }
}
