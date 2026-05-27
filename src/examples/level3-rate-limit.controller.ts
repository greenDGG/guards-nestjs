import { Controller, Get, UseGuards, SetMetadata } from '@nestjs/common';
import { Public } from '../decorators/public.decorator';
import { SecurityCtx } from '../decorators/security-context.decorator';
import { SecurityContext } from '../interfaces/security-context.interface';
import { SlidingWindowRateLimitGuard } from '../guards/rate-limit/sliding-window-rate-limit.guard';
import { AdaptiveRateLimitGuard } from '../guards/rate-limit/adaptive-rate-limit.guard';
import { BotDetectionGuard } from '../guards/detection/bot-detection.guard';
import { CircuitBreakerGuard } from '../guards/rate-limit/circuit-breaker.guard';
import { GUARD_METADATA } from '../constants/guard.constants';

/**
 * Level 3 — Rate Limiting Guards Demo
 * Base: http://localhost:3000/demo/level3
 *
 * Para probar: ejecuta scripts/test-rate-limit.ts que dispara N requests rápidas.
 */
@Controller('demo/level3')
@Public()
export class Level3RateLimitController {

  // ── Sliding Window — estricto (5 req / 10 seg por IP) ────────────────────
  @Get('sliding-window')
  @SetMetadata(GUARD_METADATA.RATE_LIMIT_OPTIONS, {
    windowMs: 10_000,    // ventana de 10 segundos
    max: 5,              // máximo 5 requests
    keyBy: 'ip',
  })
  @UseGuards(SlidingWindowRateLimitGuard)
  slidingWindow() {
    return {
      guard: 'SlidingWindowRateLimitGuard',
      message: 'Request contada (5 max / 10s por IP)',
      tip: 'Ejecuta 6+ requests seguidas para ver el bloqueo',
    };
  }

  // ── Sliding Window — por usuario (3 req / 5 seg) ─────────────────────────
  @Get('sliding-window-user')
  @SetMetadata(GUARD_METADATA.RATE_LIMIT_OPTIONS, {
    windowMs: 5_000,
    max: 3,
    keyBy: 'user',
  })
  @UseGuards(SlidingWindowRateLimitGuard)
  slidingWindowUser() {
    return {
      guard: 'SlidingWindowRateLimitGuard (por usuario)',
      message: '3 requests max cada 5 segundos por usuario',
    };
  }

  // ── Adaptive — dos ejes: trust score × bot score ─────────────────────────
  //
  //   effectiveLimit = baseMax × trustMultiplier × botMultiplier
  //
  //   baseMax = 100 req/min
  //
  //   Usuario confiable  (trust=80, botScore=5 ):  100 × 1.00 × 1.00 = 100 req/min
  //   Usuario nuevo      (trust=50, botScore=5 ):  100 × 0.10 × 1.00 =  10 req/min
  //   Bot score alto     (trust=80, botScore=80):  100 × 1.00 × 0.02 =   2 req/min
  //   Bot nuevo          (trust=50, botScore=80):  100 × 0.10 × 0.02 =   1 req/min
  //
  //   Requiere BotDetectionGuard ANTES para que botScore esté en SecurityContext.
  //   Ver todos los multiplicadores en los headers X-RateLimit-*.
  @Get('adaptive')
  @SetMetadata(GUARD_METADATA.BOT_OPTIONS, { threshold: 200, logOnly: true }) // score goes to ctx, never blocks
  @SetMetadata(GUARD_METADATA.ADAPTIVE_RATE_LIMIT_OPTIONS, {
    windowMs: 60_000, // 1 minuto
    baseMax: 100,
    keyBy: 'ip',
  })
  @UseGuards(BotDetectionGuard, AdaptiveRateLimitGuard)
  adaptive(@SecurityCtx() ctx: SecurityContext) {
    return {
      guard: 'AdaptiveRateLimitGuard (trust × bot)',
      message: 'Límite adaptado por dos señales independientes',
      signals: {
        trustScore:  ctx.trustScore,
        botScore:    ctx.botScore,
      },
      tip: 'Mira los headers X-RateLimit-* para ver todos los multiplicadores',
    };
  }

  // ── Circuit Breaker ────────────────────────────────────────────────────────
  // Se abre si detecta 3+ fallos en 30s. Reset después de 15s.
  @Get('circuit-breaker')
  @SetMetadata(GUARD_METADATA.CIRCUIT_BREAKER_OPTIONS, {
    serviceKey: 'demo-service',
    failureThreshold: 3,
    timeout: 15_000,
    rollingWindowMs: 30_000,
  })
  @UseGuards(CircuitBreakerGuard)
  circuitBreaker() {
    // Simular fallo aleatorio (30% de probabilidad) para demostrar el circuit
    if (Math.random() < 0.3) {
      throw new Error('Servicio downstream falló');
    }
    return {
      guard: 'CircuitBreakerGuard',
      message: 'Servicio respondió correctamente',
      tip: 'El circuit se abre si falla 3 veces en 30s',
    };
  }
}
