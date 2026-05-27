import { Controller, Get, Post, Body, UseGuards, UseInterceptors, SetMetadata } from '@nestjs/common';
import { Public } from '../decorators/public.decorator';
import { IpFilter } from '../decorators/ip.decorator';
import { Signature } from '../decorators/signature.decorator';
import { Idempotent } from '../decorators/idempotency.decorator';
import { Nonce } from '../decorators/nonce.decorator';
import { Concurrent } from '../decorators/concurrent.decorator';
import { IpGuard } from '../guards/security/ip.guard';
import { HttpsOnlyGuard } from '../guards/security/https-only.guard';
import { RequestSizeGuard } from '../guards/security/request-size.guard';
import { ContentTypeGuard } from '../guards/security/content-type.guard';
import { CorsGuard } from '../guards/security/cors.guard';
import { SignatureGuard } from '../guards/basic/signature.guard';
import { IdempotencyInterceptor } from '../guards/basic/idempotency.interceptor';
import { NonceGuard } from '../guards/basic/nonce.guard';
import { ConcurrencyInterceptor } from '../guards/basic/concurrency.interceptor';
import { GUARD_METADATA } from '../constants/guard.constants';

/**
 * Level 2 — Network Security Guards Demo
 * Base: http://localhost:3000/demo/level2
 */
@Controller('demo/level2')
@Public()
export class Level2SecurityController {

  // ── IP Whitelist ──────────────────────────────────────────────────────────
  // Solo permite localhost
  @Get('ip-whitelist')
  @IpFilter({ mode: 'whitelist', list: ['127.0.0.1', '::1', '::ffff:127.0.0.1'] })
  @UseGuards(IpGuard)
  ipWhitelist() {
    return {
      guard: 'IpGuard (whitelist)',
      message: 'Solo localhost puede acceder',
      tip: 'Prueba desde otro IP y será bloqueado',
    };
  }

  // ── IP Blacklist ───────────────────────────────────────────────────────────
  // Bloquea una IP específica y un rango CIDR
  @Get('ip-blacklist')
  @IpFilter({ mode: 'blacklist', list: ['1.2.3.4', '10.10.0.0/16'] })
  @UseGuards(IpGuard)
  ipBlacklist() {
    return {
      guard: 'IpGuard (blacklist)',
      message: 'IP no está bloqueada — acceso permitido',
      tip: 'Prueba con x-forwarded-for: 1.2.3.4 para simular IP bloqueada',
    };
  }

  // ── HTTPS Only ────────────────────────────────────────────────────────────
  // En localhost pasa (excepción), en producción requiere HTTPS
  @Get('https-only')
  @UseGuards(HttpsOnlyGuard)
  httpsOnly() {
    return {
      guard: 'HttpsOnlyGuard',
      message: 'Conexión segura verificada (localhost bypassa en desarrollo)',
      tip: 'En producción, sin HTTPS retorna 403',
    };
  }

  // ── Request Size ──────────────────────────────────────────────────────────
  // Máximo 100 bytes en el body
  @Post('request-size')
  @SetMetadata(GUARD_METADATA.REQUEST_SIZE_OPTIONS, { maxBytes: 100 })
  @UseGuards(RequestSizeGuard)
  requestSize(@Body() body: any) {
    return {
      guard: 'RequestSizeGuard',
      message: 'Body dentro del límite de 100 bytes',
      received: JSON.stringify(body).length + ' bytes',
    };
  }

  // ── Content-Type ──────────────────────────────────────────────────────────
  // Solo acepta application/json
  @Post('content-type')
  @SetMetadata(GUARD_METADATA.CONTENT_TYPE_OPTIONS, { allowed: ['application/json'] })
  @UseGuards(ContentTypeGuard)
  contentType(@Body() body: any) {
    return {
      guard: 'ContentTypeGuard',
      message: 'Content-Type: application/json aceptado',
      body,
    };
  }

  // ── CORS ──────────────────────────────────────────────────────────────────
  // Solo permite origen localhost o *.example.com
  @Get('cors')
  @SetMetadata(GUARD_METADATA.CORS_OPTIONS, {
    allowedOrigins: ['http://localhost:3000', 'http://localhost:4200', /\.example\.com$/],
    allowCredentials: true,
  })
  @UseGuards(CorsGuard)
  cors() {
    return {
      guard: 'CorsGuard',
      message: 'Origen permitido por política CORS',
      tip: 'Envía Origin: http://blocked.com para ver el rechazo',
    };
  }

  // ── HMAC Signature — Stripe style (timestamp.body) ───────────────────────
  // Secret: 'demo-webhook-secret'
  // Headers requeridos:
  //   x-timestamp: <unix seconds>
  //   x-signature: HMAC-SHA256( `${timestamp}.${body}` )
  // Ejecuta: npx ts-node scripts/test-signature.ts para ver el flujo completo
  @Post('webhook/stripe-style')
  @Signature({ secret: 'demo-webhook-secret' })
  @UseGuards(SignatureGuard)
  webhookStripe(@Body() body: any) {
    return {
      guard: 'SignatureGuard (Stripe style)',
      message: 'Firma HMAC-SHA256 válida — timestamp.body',
      received: body,
      tip: 'Ejecuta: npx ts-node scripts/test-signature.ts',
    };
  }

  // ── HMAC Signature — GitHub style (sha256=body, sin timestamp) ───────────
  // Secret: 'demo-github-secret'
  // Header: x-hub-signature-256: sha256=<HMAC-SHA256(body)>
  @Post('webhook/github-style')
  @Signature({
    secret: 'demo-github-secret',
    signaturePayload: 'body',
    signatureHeader: 'x-hub-signature-256',
    signaturePrefix: 'sha256=',
    maxTimestampAgeSeconds: 0,
  })
  @UseGuards(SignatureGuard)
  webhookGithub(@Body() body: any) {
    return {
      guard: 'SignatureGuard (GitHub style)',
      message: 'Firma HMAC-SHA256 válida — sha256=body',
      received: body,
    };
  }

  // ── Nonce — prevención de replay attacks ─────────────────────────────────
  // Header: x-nonce: <uuid o string único de mínimo 16 chars>
  //
  // Primera request con nonce "abc123..."  → ✅ procesada
  // Segunda request con el mismo nonce    → ❌ 401 Replay attack detected
  // Request sin nonce                     → ❌ 401 Missing nonce header
  //
  // Combinado con SignatureGuard da protección completa:
  //   Signature = integridad (nadie modificó el request)
  //   Nonce     = frescura   (nadie lo está repitiendo)
  @Post('nonce-check')
  @Nonce({ ttlMs: 300_000, scope: 'global' }) // global porque @Public()
  @UseGuards(NonceGuard)
  nonceCheck(@Body() body: any) {
    return {
      guard: 'NonceGuard',
      message: 'Nonce válido — request es único y no es un replay',
      received: body,
      tip: 'Repite la request con el mismo x-nonce para ver el rechazo',
    };
  }

  // ── Nonce + Signature — protección completa ───────────────────────────────
  // Signature: integridad del body
  // Nonce:     garantía de que no es un replay
  // Juntos bloquean: tampering + replay + MitM
  @Post('secure-transfer')
  @Signature({ secret: 'demo-webhook-secret' })
  @Nonce({ ttlMs: 300_000, scope: 'global' })
  @UseGuards(SignatureGuard, NonceGuard)
  secureTransfer(@Body() body: any) {
    return {
      guards: ['SignatureGuard', 'NonceGuard'],
      message: 'Request verificado: firma válida + nonce no usado',
      tip: 'Ejecuta: npx ts-node scripts/test-nonce.ts',
      received: body,
    };
  }

  // ── Idempotency — simula un pago (requiere Idempotency-Key) ──────────────
  // Header requerido: Idempotency-Key: <uuid>
  //
  // Primera request  → procesa el pago, cachea la respuesta, retorna 201
  // Segunda request  → NO reprocesa, retorna la misma respuesta cacheada + Idempotency-Replayed: true
  // Request paralela → si la primera aún no terminó, retorna 409 Conflict
  //
  // Ejecuta: npx ts-node scripts/test-idempotency.ts
  @Post('payment')
  @Idempotent({ ttlMs: 86_400_000, scopeByUser: false }) // scopeByUser: false porque @Public()
  @UseInterceptors(IdempotencyInterceptor)
  payment(@Body() body: any) {
    // Simula latencia de procesamiento de pago (300ms)
    return new Promise((resolve) =>
      setTimeout(() => {
        resolve({
          guard: 'IdempotencyInterceptor',
          message: 'Pago procesado',
          transactionId: `txn_${Math.random().toString(36).slice(2, 10)}`,
          amount: body?.amount ?? 0,
          processedAt: new Date().toISOString(),
          tip: 'Segunda request con mismo Idempotency-Key retorna esta misma respuesta sin reprocesar',
        });
      }, 300),
    );
  }

  // ── Concurrency — máximo 2 requests simultáneas por IP ───────────────────
  // Simula una operación pesada (1 segundo)
  //
  // 1 request  → ✅ procesada (slot 1/2)
  // 2 requests → ✅ procesadas en paralelo (slot 1/2 y 2/2)
  // 3 requests → ❌ 429 — la tercera queda bloqueada mientras las dos anteriores terminan
  //
  // Ejecuta: npx ts-node scripts/test-concurrency.ts
  @Post('heavy-job')
  @Concurrent({ maxConcurrent: 2, keyBy: 'ip', ttlMs: 10_000 })
  @UseInterceptors(ConcurrencyInterceptor)
  heavyJob(@Body() body: any) {
    // Simula operación costosa: generación de PDF, inferencia ML, etc.
    return new Promise((resolve) =>
      setTimeout(() => {
        resolve({
          guard: 'ConcurrencyInterceptor',
          message: 'Operación pesada completada',
          jobId: `job_${Math.random().toString(36).slice(2, 8)}`,
          input: body,
          completedAt: new Date().toISOString(),
          tip: 'Envía 3+ requests en paralelo — la tercera en adelante recibe 429',
        });
      }, 1000),
    );
  }

  // ── Concurrency global — endpoint de recurso único ────────────────────────
  // keyBy: 'global' → solo 1 request a la vez para TODOS los clientes
  // Útil para endpoints que acceden a recursos que no soportan concurrencia
  // (e.g., escribir un archivo, modificar un estado singleton)
  @Post('exclusive-resource')
  @Concurrent({ maxConcurrent: 1, keyBy: 'global', ttlMs: 5_000 })
  @UseInterceptors(ConcurrencyInterceptor)
  exclusiveResource(@Body() body: any) {
    return new Promise((resolve) =>
      setTimeout(() => {
        resolve({
          guard: 'ConcurrencyInterceptor (global)',
          message: 'Recurso exclusivo accedido — solo 1 request simultánea para todos los clientes',
          input: body,
          tip: 'keyBy: "global" es útil para operaciones que no soportan concurrencia',
        });
      }, 500),
    );
  }
}
