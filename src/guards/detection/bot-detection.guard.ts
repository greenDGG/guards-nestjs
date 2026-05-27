import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { GUARD_METADATA } from '../../constants/guard.constants';
import { BotDetectionService, BotDetectionOptions } from '../../services/bot-detection.service';
import { SecurityContextService } from '../../services/security-context.service';
import { BotDetectedException } from '../../exceptions/detection.exception';

/**
 * Level 4 — Bot Detection Guard
 *
 * Uses a multi-signal scoring model to detect automated bots and scrapers.
 * Accumulates a suspicion score (0–100) from multiple behavioral signals:
 *
 *   • User-Agent fingerprinting (headless Chrome, Puppeteer, curl, etc.)
 *   • Missing browser-specific headers (Accept, Accept-Language, sec-fetch-*)
 *   • Request timing analysis (machine-speed regularity via coefficient of variation)
 *   • Honeypot field detection (auto-filled hidden form fields)
 *
 * Score >= threshold (default 70) blocks the request.
 * Known good bots (Googlebot, Bingbot, etc.) are always allowed.
 *
 * Usage:
 *   @SetMetadata(GUARD_METADATA.BOT_OPTIONS, {
 *     threshold: 60,
 *     honeypotFields: ['_gotcha', 'website'],
 *     allowedBots: ['MyPartnerBot'],
 *     logOnly: false,
 *   })
 *   @UseGuards(BotDetectionGuard)
 *   @Post('register')
 *   register() {}
 */
@Injectable()
export class BotDetectionGuard implements CanActivate {
  private readonly logger = new Logger(BotDetectionGuard.name);

  constructor(
    private reflector: Reflector,
    private botService: BotDetectionService,
    private secCtx: SecurityContextService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const options = this.reflector.getAllAndOverride<BotDetectionOptions>(
      GUARD_METADATA.BOT_OPTIONS,
      [context.getHandler(), context.getClass()],
    );

    const threshold = options?.threshold ?? 70;
    const request = context.switchToHttp().getRequest<Request>();

    const score = await this.botService.computeBotScore(request, options ?? {});

    // Write to SecurityContext so other guards / handlers can read without recomputing
    this.secCtx.merge(request, { botScore: score, isBot: score >= threshold });

    if (score >= threshold) {
      this.logger.warn(`Bot detected — score: ${score}/${threshold} — ${request.method} ${request.url}`);
      if (options?.logOnly) return true;
      throw new BotDetectedException(score);
    }

    if (score > 0) {
      this.logger.debug(`Bot score: ${score}/${threshold} (below threshold) — ${request.method} ${request.url}`);
    }

    return true;
  }
}
