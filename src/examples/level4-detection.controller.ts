import { Controller, Get, Post, Body, UseGuards, SetMetadata } from '@nestjs/common';
import { Public, IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { CurrentUser } from '../decorators/current-user.decorator';
import { SecurityCtx } from '../decorators/security-context.decorator';
import { SecurityContext } from '../interfaces/security-context.interface';
import { JwtPayload } from '../interfaces/jwt-payload.interface';
import { BotDetectionGuard } from '../guards/detection/bot-detection.guard';
import { GeoIpGuard } from '../guards/detection/geo-ip.guard';
import { DeviceFingerprintGuard } from '../guards/detection/device-fingerprint.guard';
import { AnomalyDetectionGuard } from '../guards/detection/anomaly-detection.guard';
import { AdaptiveRateLimitGuard } from '../guards/rate-limit/adaptive-rate-limit.guard';
import { AnomalyDetectionService } from '../services/anomaly-detection.service';
import { GUARD_METADATA } from '../constants/guard.constants';

/**
 * Level 4 — Detection Guards Demo
 * Base: http://localhost:3000/demo/level4
 *
 * Para probar bots: ejecuta scripts/test-bot.ts
 * Para probar anomaly: ejecuta scripts/test-anomaly.ts
 */
@Controller('demo/level4')
@Public()
export class Level4DetectionController {
  constructor(private anomalyService: AnomalyDetectionService) {}

  // ── Bot Detection — umbral normal (70) ────────────────────────────────────
  // Prueba con User-Agent de curl/Puppeteer para ser bloqueado
  @Get('bot-check')
  @SetMetadata(GUARD_METADATA.BOT_OPTIONS, {
    threshold: 70,
    honeypotFields: ['_gotcha', 'website', 'url'],
    logOnly: false,
  })
  @UseGuards(BotDetectionGuard)
  botCheck() {
    return {
      guard: 'BotDetectionGuard',
      message: 'Pasaste la detección de bots (score < 70)',
      tip: 'Usa User-Agent: curl/8.0 para ser bloqueado',
    };
  }

  // ── Bot Detection — modo estricto (score >= 30 bloquea) ───────────────────
  @Get('bot-strict')
  @SetMetadata(GUARD_METADATA.BOT_OPTIONS, {
    threshold: 30,
    logOnly: false,
  })
  @UseGuards(BotDetectionGuard)
  botStrict() {
    return {
      guard: 'BotDetectionGuard (estricto, threshold=30)',
      message: 'Pasaste incluso el modo estricto',
    };
  }

  // ── Bot Detection — con honeypot en formulario ────────────────────────────
  // POST con campo "website" relleno activa el honeypot (+30 puntos)
  @Post('bot-form')
  @SetMetadata(GUARD_METADATA.BOT_OPTIONS, {
    threshold: 25,
    honeypotFields: ['website', '_gotcha'],
    logOnly: false,
  })
  @UseGuards(BotDetectionGuard)
  botForm(@Body() body: any) {
    return {
      guard: 'BotDetectionGuard (honeypot)',
      message: 'Formulario procesado — campo honeypot vacío',
      received: body,
      tip: 'Envía {"nombre":"test","website":"http://spam.com"} para activar el honeypot',
    };
  }

  // ── Bot Detection — log only (no bloquea, solo registra) ─────────────────
  @Get('bot-log-only')
  @SetMetadata(GUARD_METADATA.BOT_OPTIONS, {
    threshold: 10,
    logOnly: true,
  })
  @UseGuards(BotDetectionGuard)
  botLogOnly() {
    return {
      guard: 'BotDetectionGuard (logOnly)',
      message: 'Nunca bloquea — solo loguea el bot score en consola',
    };
  }

  // ── GeoIP — blacklist de países ────────────────────────────────────────────
  // Bloquea solo si la IP viene de los países en la lista
  @Get('geo-blacklist')
  @SetMetadata(GUARD_METADATA.GEO_IP_OPTIONS, {
    mode: 'blacklist',
    countries: ['KP', 'SY'],
    fallbackAllow: true,
  })
  @UseGuards(GeoIpGuard)
  geoBlacklist() {
    return {
      guard: 'GeoIpGuard (blacklist)',
      message: 'Tu país no está bloqueado',
      tip: 'KP (Corea del Norte) y SY (Siria) están bloqueados',
    };
  }

  // ── GeoIP — whitelist de países ────────────────────────────────────────────
  @Get('geo-whitelist')
  @SetMetadata(GUARD_METADATA.GEO_IP_OPTIONS, {
    mode: 'whitelist',
    countries: ['MX', 'US', 'ES', 'AR', 'CO', 'CL'],
    fallbackAllow: true,
  })
  @UseGuards(GeoIpGuard)
  geoWhitelist() {
    return {
      guard: 'GeoIpGuard (whitelist)',
      message: 'Tu país está en la lista blanca',
      allowed: ['MX', 'US', 'ES', 'AR', 'CO', 'CL'],
    };
  }

  // ── Device Fingerprint ────────────────────────────────────────────────────
  // Compara fingerprint de headers entre requests del mismo usuario
  @Get('fingerprint')
  @SetMetadata(GUARD_METADATA.DEVICE_FP_OPTIONS, { onMismatch: 'block' })
  @UseGuards(DeviceFingerprintGuard)
  fingerprint() {
    return {
      guard: 'DeviceFingerprintGuard',
      message: 'Fingerprint de dispositivo registrado/verificado',
      tip: 'Cambia el User-Agent entre requests para simular un cambio de dispositivo',
    };
  }

  // ── Anomaly Detection ─────────────────────────────────────────────────────
  // No bloquea — solo penaliza el trust score si detecta comportamiento anormal.
  // Ejecuta: npx ts-node scripts/test-anomaly.ts
  @SetMetadata(IS_PUBLIC_KEY, false)
  @Get('anomaly')
  @SetMetadata(GUARD_METADATA.ANOMALY_OPTIONS, {
    rpmMultiplier: 2.0,
    trustScorePenalty: 15,
  })
  @UseGuards(AnomalyDetectionGuard)
  anomaly() {
    return {
      guard: 'AnomalyDetectionGuard',
      message: 'Comportamiento registrado y analizado',
      tip: 'Dispara muchas requests rápidas para ver cómo baja el trust score',
    };
  }

  // ── Trust Score — muestra el score actual del usuario ────────────────────
  // Requiere JWT. Útil para observar el efecto de AnomalyDetectionGuard.
  // @SetMetadata(IS_PUBLIC_KEY, false) overrides the class-level @Public() so JWT runs.
  @SetMetadata(IS_PUBLIC_KEY, false)
  @Get('trust-score')
  async trustScore(@CurrentUser() user: JwtPayload) {
    const score = await this.anomalyService.getTrustScore(user.sub);
    return {
      userId: user.sub,
      trustScore: score,
      tier: score <= 25 ? 'severely-untrusted (×0.02)'
          : score <= 50 ? 'new-user (×0.10)'
          : score <= 75 ? 'regular (×0.50)'
          : score <= 90 ? 'trusted (×1.00)'
          : 'vip (×2.00)',
      tip: 'Dispara muchas requests rápidas a /anomaly para ver cómo baja',
    };
  }

  // ── Anomaly + Adaptive Rate Limit juntos ──────────────────────────────────
  // Demuestra el pipeline completo: AnomalyDetection penaliza → Adaptive ajusta límites.
  // Headers de respuesta: X-RateLimit-Trust-Score, X-RateLimit-Trust-Tier, etc.
  @SetMetadata(IS_PUBLIC_KEY, false)
  @Get('anomaly-adaptive')
  @SetMetadata(GUARD_METADATA.ANOMALY_OPTIONS, { rpmMultiplier: 2.0, trustScorePenalty: 15 })
  @SetMetadata(GUARD_METADATA.ADAPTIVE_RATE_LIMIT_OPTIONS, {
    windowMs: 60_000,
    baseMax: 30,
    keyBy: 'user',
  })
  @UseGuards(AnomalyDetectionGuard, AdaptiveRateLimitGuard)
  anomalyAdaptive() {
    return {
      guards: ['AnomalyDetectionGuard', 'AdaptiveRateLimitGuard'],
      message: 'Request registrada — revisa los headers X-RateLimit-* para ver tu trust score',
      tip: 'Después de disparar muchas requests a /anomaly, los límites aquí bajarán automáticamente',
    };
  }

  // ── SecurityContext — muestra todo lo acumulado en esta request ───────────
  // Combina BotDetectionGuard + GeoIpGuard para poblar el contexto
  // y lo expone completo en la respuesta para demostración.
  // En producción NO expongas el securityContext al cliente — es solo para debug.
  @Get('security-context')
  @SetMetadata(GUARD_METADATA.BOT_OPTIONS, { threshold: 70, logOnly: true })
  @SetMetadata(GUARD_METADATA.GEO_IP_OPTIONS, { mode: 'blacklist', countries: [], fallbackAllow: true })
  @UseGuards(BotDetectionGuard, GeoIpGuard)
  securityContext(@SecurityCtx() ctx: SecurityContext) {
    return {
      message: 'SecurityContext acumulado por los guards de esta request',
      note: 'En producción no expongas esto — usa ctx internamente en los guards',
      securityContext: {
        requestId:         ctx.requestId,
        requestedAt:       ctx.requestedAt,
        ip:                ctx.ip,
        botScore:          ctx.botScore,
        isBot:             ctx.isBot,
        geo:               ctx.geo,
        trustScore:        ctx.trustScore,
        deviceFingerprint: ctx.deviceFingerprint,
        userId:            ctx.userId,
        roles:             ctx.roles,
      },
    };
  }
}
