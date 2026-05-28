import { Controller, Get, Post, UseGuards, UseInterceptors, SetMetadata } from '@nestjs/common';
import { Public } from '../decorators/public.decorator';
import { RateLimitByRouteGuard } from '../guards/rate-limit/rate-limit-by-route.guard';
import { RateLimit } from '../decorators/rate-limit-by-route.decorator';
import { SecurityCtx } from '../decorators/security-context.decorator';
import { SecurityContext } from '../interfaces/security-context.interface';
import { SlidingWindowRateLimitGuard } from '../guards/rate-limit/sliding-window-rate-limit.guard';
import { AdaptiveRateLimitGuard } from '../guards/rate-limit/adaptive-rate-limit.guard';
import { BotDetectionGuard } from '../guards/detection/bot-detection.guard';
import { CircuitBreakerGuard, CircuitBreakerInterceptor } from '../guards/rate-limit/circuit-breaker.guard';
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

  // ── Circuit Breaker — fallo aleatorio (30%) para demo interactiva ────────
  @Get('circuit-breaker')
  @SetMetadata(GUARD_METADATA.CIRCUIT_BREAKER_OPTIONS, {
    serviceKey: 'demo-service',
    failureThreshold: 3,
    timeout: 15_000,
    rollingWindowMs: 30_000,
  })
  @UseGuards(CircuitBreakerGuard)
  @UseInterceptors(CircuitBreakerInterceptor)
  circuitBreaker() {
    if (Math.random() < 0.3) {
      throw new Error('Servicio downstream falló');
    }
    return {
      guard: 'CircuitBreakerGuard',
      message: 'Servicio respondió correctamente',
      tip: 'El circuit se abre si falla 3 veces en 30s',
    };
  }

  // ── Circuit Breaker — siempre falla (para test determinista) ─────────────
  @Get('circuit-faulty')
  @SetMetadata(GUARD_METADATA.CIRCUIT_BREAKER_OPTIONS, {
    serviceKey: 'test-service',
    failureThreshold: 3,
    successThreshold: 2,
    timeout: 6_000,
    rollingWindowMs: 30_000,
  })
  @UseGuards(CircuitBreakerGuard)
  @UseInterceptors(CircuitBreakerInterceptor)
  circuitFaulty() {
    throw new Error('Downstream siempre falla');
  }

  // ── Circuit Breaker — siempre tiene éxito (para recuperar el circuit) ────
  @Get('circuit-healthy')
  @SetMetadata(GUARD_METADATA.CIRCUIT_BREAKER_OPTIONS, {
    serviceKey: 'test-service',
    failureThreshold: 3,
    successThreshold: 2,
    timeout: 6_000,
    rollingWindowMs: 30_000,
  })
  @UseGuards(CircuitBreakerGuard)
  @UseInterceptors(CircuitBreakerInterceptor)
  circuitHealthy() {
    return { message: 'Downstream respondió correctamente', state: 'recovered' };
  }

  // ══ RateLimitByRouteGuard — profiles + dual-window + penalty box ═══════════
  //
  // Prueba con: npm run test:rate-limit-by-route

  // ── Perfil 'login' — 5 req/min, burst 2/5s, penalty 5min tras 3 violations ──
  // Simula un endpoint de autenticación. Cambia la IP (header x-forwarded-for)
  // o espera la ventana para ver el comportamiento del penalty box.
  @Get('login-sim')
  @RateLimit('login')
  @UseGuards(RateLimitByRouteGuard)
  loginSim() {
    return {
      guard:   'RateLimitByRouteGuard',
      profile: 'login',
      limits:  { sustained: '5 req / 60s', burst: '2 req / 5s', penalty: '5 min tras 3 violations' },
      tip:     'Dispara 3+ requests en 5s para ver el burst block; repite para activar penalty box',
    };
  }

  // ── Perfil 'payment' — 10 req/min, burst 2/10s, penalty 15min tras 2 violations ─
  @Post('payment-sim')
  @RateLimit('payment')
  @UseGuards(RateLimitByRouteGuard)
  paymentSim() {
    return {
      guard:   'RateLimitByRouteGuard',
      profile: 'payment',
      limits:  { sustained: '10 req / 60s', burst: '2 req / 10s', penalty: '15 min tras 2 violations' },
      tip:     'POST para simular operación financiera. Burst muy agresivo activa penalty rápido.',
    };
  }

  // ── Perfil 'search' — 60 req/min, burst 15/5s, sin penalty ────────────────
  @Get('search-sim')
  @RateLimit('search')
  @UseGuards(RateLimitByRouteGuard)
  searchSim() {
    return {
      guard:   'RateLimitByRouteGuard',
      profile: 'search',
      limits:  { sustained: '60 req / 60s', burst: '15 req / 5s', penalty: 'desactivado' },
      tip:     'Perfil relajado. Requiere muchas requests para alcanzar el límite.',
    };
  }

  // ── Perfil 'api' — 100 req/min, burst 20/5s ───────────────────────────────
  @Get('api-sim')
  @RateLimit('api')
  @UseGuards(RateLimitByRouteGuard)
  apiSim() {
    return {
      guard:   'RateLimitByRouteGuard',
      profile: 'api',
      limits:  { sustained: '100 req / 60s', burst: '20 req / 5s', penalty: 'desactivado' },
    };
  }

  // ── Config custom — profile + override + burst ajustado ───────────────────
  // Demuestra que cada campo del perfil puede ser sobreescrito individualmente.
  @Get('custom-burst')
  @RateLimit({ profile: 'login', max: 10, burstMax: 3, burstWindowMs: 3_000, penaltyMs: 60_000 })
  @UseGuards(RateLimitByRouteGuard)
  customBurst() {
    return {
      guard:   'RateLimitByRouteGuard',
      profile: 'login (override: max=10, burst=3/3s, penalty=60s)',
      tip:     'Muestra cómo sobrescribir campos específicos de un perfil',
    };
  }
}
