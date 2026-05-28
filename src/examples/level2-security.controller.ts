import { Controller, ForbiddenException, Get, Post, Body, Res, UseGuards, UseInterceptors, SetMetadata } from '@nestjs/common';
import { HeaderValidationGuard } from '../guards/security/header-validation.guard';
import { HeaderValidate } from '../decorators/header-validation.decorator';
import { Response } from 'express';
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
import { TimingAttackGuard, TimingAttackInterceptor } from '../guards/security/timing-attack.guard';
import { CsrfGuard, generateCsrfToken } from '../guards/security/csrf.guard';
import { SignatureGuard } from '../guards/basic/signature.guard';
import { ReplayProtectionGuard } from '../guards/basic/replay-protection.guard';
import { ReplayProtect } from '../decorators/replay-protection.decorator';
import { AuditLogInterceptor } from '../guards/basic/audit-log.interceptor';
import { AuditLog } from '../decorators/audit-log.decorator';
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

  // ── Timing Attack — respuesta siempre tarda ≥ 300ms ─────────────────────
  //
  //   Sin protección: path rápido (~5ms) vs. path lento (~200ms con bcrypt) →
  //   el atacante sabe si el usuario existe midiendo el tiempo de respuesta.
  //
  //   Con protección: ambos paths padded a 300ms + jitter(0–100ms) →
  //   el atacante no puede inferir nada del tiempo.
  //
  //   /timing-fast  → handler retorna de inmediato (simula "user not found")
  //   /timing-slow  → handler tarda 200ms (simula bcrypt compare)
  //   Ambos con minResponseMs=300 → el interceptor padea la diferencia
  @Post('timing-fast')
  @SetMetadata(GUARD_METADATA.TIMING_ATTACK_OPTIONS, { minResponseMs: 300, jitterMs: 100 })
  @UseGuards(TimingAttackGuard)
  @UseInterceptors(TimingAttackInterceptor)
  timingFast() {
    // Returns instantly — without protection, attacker sees ~5ms (user not found)
    return { guard: 'TimingAttackGuard', path: 'fast', message: 'Retorna en <5ms internamente, padded a ≥300ms' };
  }

  @Post('timing-slow')
  @SetMetadata(GUARD_METADATA.TIMING_ATTACK_OPTIONS, { minResponseMs: 300, jitterMs: 100 })
  @UseGuards(TimingAttackGuard)
  @UseInterceptors(TimingAttackInterceptor)
  timingSlow() {
    // Simulates 200ms bcrypt comparison — without protection, attacker sees ~200ms (user found)
    return new Promise((resolve) =>
      setTimeout(() => resolve({
        guard: 'TimingAttackGuard',
        path: 'slow',
        message: 'Tarda 200ms internamente (bcrypt simulado), padded a ≥300ms',
      }), 200),
    );
  }

  // ── CSRF — Double Submit Cookie pattern ──────────────────────────────────
  // Paso 1: Obtener un token (GET /csrf-token) → guarda cookie + devuelve token
  // Paso 2: Enviar POST con el token en header x-csrf-token
  //
  // Un atacante en otro origen NO puede leer la cookie (same-origin policy)
  // → no puede construir el header → el guard rechaza la request.
  @Get('csrf-token')
  csrfToken(@Res({ passthrough: true }) res: Response) {
    return { csrfToken: generateCsrfToken(res) };
  }

  @Post('csrf-protected')
  @SetMetadata(GUARD_METADATA.CSRF_OPTIONS, {})
  @UseGuards(CsrfGuard)
  csrfProtected(@Body() body: any) {
    return {
      guard: 'CsrfGuard',
      message: 'CSRF token válido — Double Submit Cookie verificado',
      received: body,
      tip: 'Primero GET /csrf-token, luego POST con x-csrf-token header',
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

  // ── Replay Protection — timestamp + nonce + signature en uno ────────────
  // Secret: 'demo-replay-secret'
  // Headers requeridos:
  //   x-timestamp: <unix seconds>
  //   x-nonce:     <hex aleatorio de 32 chars mínimo>
  //   x-signature: HMAC-SHA256( `${timestamp}.${nonce}.${body}` )
  //
  // Diferencia vs SignatureGuard + NonceGuard separados:
  //   el nonce es PARTE de la firma → no se puede reemplazar por uno fresco
  //   sin romper la verificación de la firma.
  //
  // Ejecuta: npx ts-node scripts/test-replay-protection.ts
  @Post('replay-protection')
  @ReplayProtect({ secret: 'demo-replay-secret', maxAgeSeconds: 300 })
  @UseGuards(ReplayProtectionGuard)
  replayProtection(@Body() body: any) {
    return {
      guard: 'ReplayProtectionGuard',
      message: 'timestamp + nonce + firma HMAC verificados',
      received: body,
      tip: 'Repite la request con el mismo x-nonce para ver el rechazo por replay',
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

  // ── Audit Log — registro de acceso (quién, qué, cuándo, desde dónde) ────
  //
  // AuditLogInterceptor nunca bloquea — siempre pasa la request al handler.
  // Registra: userId, IP, user-agent, action, body (sanitizado), status, ms.
  // Responde con X-Trace-Id para correlacionar logs del cliente con el servidor.
  //
  // Endpoint de éxito — ver logs del servidor para el audit trail
  @Post('audit-success')
  @AuditLog({ action: 'demo:read-sensitive-data', resource: 'demo' })
  @UseInterceptors(AuditLogInterceptor)
  auditSuccess(@Body() body: any) {
    return {
      interceptor: 'AuditLogInterceptor',
      message: 'Acceso registrado en el audit log del servidor',
      tip: 'Revisa la consola del servidor — busca: AUDIT trace=...',
      received: body,
    };
  }

  // Endpoint que falla — el audit log registra el error con el status correcto
  @Post('audit-fail')
  @AuditLog({
    action: 'demo:access-restricted',
    resource: 'demo',
    sensitiveFields: ['password', 'token'],
  })
  @UseInterceptors(AuditLogInterceptor)
  auditFail(@Body() body: any) {
    // Simula acceso denegado — el interceptor lo captura y registra outcome=error
    throw new ForbiddenException('Acceso denegado — sin permisos');
  }

  // ══ HeaderValidationGuard — deterministic header checks ═══════════════════
  //
  // Prueba con: npm run test:header-validation

  // ── Automation blocklist — activado por defecto ───────────────────────────
  // Envía cualquier header que empiece con x-playwright, x-selenium, etc.
  // para ver el rechazo. Headers normales → pasan sin problemas.
  @Get('header-check')
  @HeaderValidate()
  @UseGuards(HeaderValidationGuard)
  headerCheck() {
    return {
      guard:   'HeaderValidationGuard',
      mode:    'automation-blocklist (default)',
      message: 'Ningún header de automatización detectado',
      tip:     'Agrega header "x-playwright: 1" para ser bloqueado',
    };
  }

  // ── Browser headers + Accept wildcard ────────────────────────────────────
  // Requiere Accept, Accept-Language, Accept-Encoding.
  // Bloquea si el UA es de navegador pero el Accept es solo "*/*".
  // Prueba con curl sin headers para ver la cascada de violations.
  @Get('header-browser')
  @HeaderValidate({
    requireBrowserHeaders:  true,
    checkAcceptWildcard:    true,
  })
  @UseGuards(HeaderValidationGuard)
  headerBrowser() {
    return {
      guard:   'HeaderValidationGuard',
      mode:    'browser-headers + accept-wildcard',
      message: 'Headers de navegador válidos — Accept no es */*',
      tip:     'Llama con User-Agent de Chrome y Accept: */* para activar el check',
    };
  }

  // ── sec-ch-ua consistency ─────────────────────────────────────────────────
  // Chrome 90+ DEBE enviar Sec-CH-UA. Si el UA dice "Chrome/124" pero
  // falta el header, o la versión no coincide → 403.
  // Prueba enviando UA de Chrome/124 sin el header Sec-CH-UA.
  @Get('header-sec-ch-ua')
  @HeaderValidate({ checkSecChUa: true, logOnly: false })
  @UseGuards(HeaderValidationGuard)
  headerSecChUa() {
    return {
      guard:   'HeaderValidationGuard',
      mode:    'sec-ch-ua consistency',
      message: 'sec-ch-ua presente y consistente con el User-Agent',
      tip:     'Envía User-Agent: Mozilla/5.0 Chrome/124 sin Sec-CH-UA para ver el rechazo',
    };
  }

  // ── Custom rules — API versioning ─────────────────────────────────────────
  // Demuestra reglas custom: x-api-version requerido con formato vN,
  // y Accept no puede ser */*.
  @Get('header-custom')
  @HeaderValidate({
    rules: [
      { header: 'x-api-version', required: true, pattern: /^v\d+$/ },
      { header: 'accept',        required: true, notPattern: /^\*\/\*$/ },
    ],
  })
  @UseGuards(HeaderValidationGuard)
  headerCustom() {
    return {
      guard:   'HeaderValidationGuard',
      mode:    'custom rules',
      message: 'x-api-version válido y Accept no es */*',
      tip:     'Envía sin x-api-version, o con x-api-version: 2 (sin la v), para ver el rechazo',
    };
  }

  // ── Observación — logOnly: true ────────────────────────────────────────────
  // Todos los checks activos pero sin bloquear. Útil para medir el impacto
  // antes de activar enforcement en producción.
  @Get('header-observe')
  @HeaderValidate({
    requireBrowserHeaders: true,
    checkSecChUa:          true,
    checkAcceptWildcard:   true,
    minHeaderCount:        4,
    logOnly:               true,
  })
  @UseGuards(HeaderValidationGuard)
  headerObserve() {
    return {
      guard:   'HeaderValidationGuard',
      mode:    'logOnly: true — nunca bloquea',
      message: 'Siempre pasa. Mira los logs del servidor para ver X-Header-Violations.',
      tip:     'Envía con curl (sin headers de navegador) para ver las violations en logs',
    };
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
