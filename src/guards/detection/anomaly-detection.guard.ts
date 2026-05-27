import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { GUARD_METADATA } from '../../constants/guard.constants';
import { AnomalyDetectionService } from '../../services/anomaly-detection.service';

export interface AnomalyDetectionOptions {
  rpmMultiplier?: number;
  errorRateThreshold?: number;
  trustScorePenalty?: number;
  trustScoreTtlMs?: number;
  logOnly?: boolean;
}

/**
 * Level 4 — Anomaly Detection Guard
 *
 * Tracks per-user behavioral baselines using Exponential Moving Average (EMA).
 * Detects statistical deviations (request spikes, error rate surges) and
 * penalizes the user's trust score — which AdaptiveRateLimitGuard then uses.
 *
 * Metrics tracked per user:
 *   • EMA of requests per minute (RPM)
 *   • EMA of error rate (4xx/5xx ratio)
 *
 * When anomaly is detected, the user's trust score in RedisStoreService is reduced.
 * This guard never blocks directly — it only adjusts trust scores.
 *
 * Usage:
 *   Apply globally via APP_GUARD to monitor all users automatically.
 *   Pair with AdaptiveRateLimitGuard for automatic throttling of suspicious users.
 *
 *   @SetMetadata(GUARD_METADATA.ANOMALY_OPTIONS, {
 *     rpmMultiplier: 5.0,
 *     trustScorePenalty: 15,
 *   })
 *   @UseGuards(AnomalyDetectionGuard)
 */
@Injectable()
export class AnomalyDetectionGuard implements CanActivate {
  private readonly logger = new Logger(AnomalyDetectionGuard.name);

  constructor(
    private reflector: Reflector,
    private anomalyService: AnomalyDetectionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const options = this.reflector.getAllAndOverride<AnomalyDetectionOptions>(
      GUARD_METADATA.ANOMALY_OPTIONS,
      [context.getHandler(), context.getClass()],
    ) ?? {};

    const request = context.switchToHttp().getRequest<Request>();
    const user = (request as any).user;

    if (!user?.sub) return true;

    const userId = user.sub;
    const isError = false; // Pre-handler: we don't know if it's an error yet

    await this.anomalyService.recordRequest(userId, request.url, isError);

    const { isAnomalous, reason } = await this.anomalyService.detectAnomaly(
      userId,
      options.rpmMultiplier ?? 3.0,
      options.errorRateThreshold ?? 0.5,
    );

    if (isAnomalous) {
      this.logger.warn(`Anomaly detected for user ${userId}: ${reason}`);
      await this.anomalyService.penalizeTrustScore(
        userId,
        options.trustScorePenalty ?? 10,
        options.trustScoreTtlMs ?? 60 * 60 * 1000,
      );
    }

    return true; // Always allows — penalizes trust score instead of blocking
  }
}
