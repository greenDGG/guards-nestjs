# BotDetectionGuard

Detecta bots y scrapers automatizados mediante un **modelo de scoring multi-señal** (0–100). Cuando el score acumulado supera el `threshold` configurado (default 70), bloquea la request con 403. Bots conocidos como Googlebot siempre se permiten.

```
GET /register  (curl/8.0 sin Accept-Language)
  score = +25 (headless UA) + +5 (falta Accept-Language) = 30 ≥ threshold(30)
  → 403 BotDetectedException

POST /register  (browser real con campo "website" relleno)
  score = +30 (honeypot)
  → 403 BotDetectedException

GET /register  (Chrome con headers completos)
  score = 0
  → 200 ✅
```

---

## Archivos

```
src/guards/detection/bot-detection.guard.ts
src/services/bot-detection.service.ts
src/examples/level4-detection.controller.ts   ← 4 endpoints de demo
scripts/test-bot.ts
```

---

## Quick start

```bash
npm run start:dev
npm run test:bot
```

---

## Uso

### Protección básica de formulario de registro

```typescript
@SetMetadata(GUARD_METADATA.BOT_OPTIONS, {
  threshold: 70,
  honeypotFields: ['_gotcha', 'website'],
})
@UseGuards(BotDetectionGuard)
@Post('register')
register(@Body() dto: RegisterDto) {}
```

### Modo estricto (threshold bajo)

```typescript
@SetMetadata(GUARD_METADATA.BOT_OPTIONS, {
  threshold: 30,
  logOnly: false,
})
@UseGuards(BotDetectionGuard)
@Get('api')
api() {}
// headless UA (+25) + falta Accept-Language (+5) = 30 → bloqueado
```

### Log-only (monitoreo sin bloqueo)

```typescript
@SetMetadata(GUARD_METADATA.BOT_OPTIONS, {
  threshold: 10,
  logOnly: true,
})
@UseGuards(BotDetectionGuard)
@Get('public-data')
publicData() {}
// Nunca bloquea — solo loguea el bot score en consola
```

### Pesos personalizados

```typescript
@SetMetadata(GUARD_METADATA.BOT_OPTIONS, {
  threshold: 70,
  weights: {
    missingUserAgent: 50,    // más severo que el default (30)
    honeypotFilled: 100,     // bloqueo inmediato
  },
})
@UseGuards(BotDetectionGuard)
```

### Bots propios como allowedBots

```typescript
@SetMetadata(GUARD_METADATA.BOT_OPTIONS, {
  threshold: 70,
  allowedBots: ['MyPartnerBot', 'InternalScraper'],
})
@UseGuards(BotDetectionGuard)
```

---

## Opciones

```typescript
export interface BotDetectionOptions {
  threshold?:     number;                     // default: 70
  honeypotFields?: string[];                  // campos a vigilar en POST body
  logOnly?:       boolean;                    // default: false
  allowedBots?:   string[];                   // patrones extra a whitelist
  weights?:       Partial<BotSignalWeights>;  // override pesos individuales
}
```

| Campo | Default | Descripción |
|-------|---------|-------------|
| `threshold` | `70` | Score mínimo para bloquear |
| `honeypotFields` | `[]` | Si alguno de estos campos existe con valor en el body → +30 puntos |
| `logOnly` | `false` | Si `true`, nunca bloquea — solo loguea el score |
| `allowedBots` | `[]` | Patrones adicionales de User-Agent que siempre se permiten |
| `weights` | ver tabla | Override de pesos individuales de cada señal |

---

## Modelo de scoring

El guard acumula puntos de múltiples señales. Si `score >= threshold` → bloquea.

### Señales de User-Agent

| Señal | Peso default | Condición |
|-------|-------------|-----------|
| `missingUserAgent` | **30** | Sin User-Agent o string vacío |
| `headlessUserAgent` | **25** | UA coincide con patrón headless/automation |
| `malformedUserAgent` | **15** | UA < 20 chars o sin paréntesis |

Los checks se evalúan en orden exclusivo (if/else if/else if): si hay headless UA, no se aplica malformed.

**Patrones headless detectados:**
`HeadlessChrome`, `Puppeteer`, `Playwright`, `PhantomJS`, `SlimerJS`, `CasperJS`, `Selenium`, `WebDriver`, `python-requests`, `python-urllib`, `java/`, `curl/`, `wget/`, `Go-http-client`, `libwww-perl`, `ApacheBench`, `okhttp`, `axios`, `node-fetch`, `node.js`

**Bots permitidos por default (siempre score 0):**
`Googlebot`, `Bingbot`, `Slurp (Yahoo)`, `DuckDuckBot`, `Baiduspider`, `YandexBot`, `Facebot`, `ia_archiver`

### Señales de headers HTTP

| Señal | Peso default | Condición |
|-------|-------------|-----------|
| `missingAccept` | **5** | Falta header `Accept` |
| `missingAcceptEncoding` | **5** | Falta header `Accept-Encoding` |
| `missingAcceptLanguage` | **5** | Falta header `Accept-Language` |
| `missingSecFetch` | **5** | UA contiene "chrome" pero falta `sec-fetch-site` |
| `allHeadersMissing` | **5** | Los tres Accept headers faltan simultáneamente (bonus) |

### Señales de timing (inter-request)

Analiza los últimos 10 timestamps del mismo IP. Calcula media y coeficiente de variación (CV) de los intervalos.

| Señal | Peso default | Condición |
|-------|-------------|-----------|
| `requestSpeedVeryFast` | **25** | Intervalo promedio < 200ms |
| `requestSpeedFast` | **15** | Intervalo promedio < 500ms |
| `machinePrecisionTiming` | **20** | CV < 0.05 y promedio < 2000ms (regularidad mecánica) |

Solo aplica una de estas tres señales por request (la primera que se cumpla).

### Señal de honeypot

| Señal | Peso default | Condición |
|-------|-------------|-----------|
| `honeypotFilled` | **30** | Campo de `honeypotFields` presente y no vacío en el body |

Los campos honeypot son campos ocultos en formularios HTML que un usuario real no debería rellenar. Si un bot los llena, suma +30 inmediatamente.

---

## Lógica de evaluación

```
1. ¿UA en la whitelist (Googlebot, Bingbot, etc. o allowedBots)?
        └── SÍ → score = 0, return true ✅

2. Señal UA: ¿sin UA? → +30 / ¿headless? → +25 / ¿malformado? → +15

3. Señales de headers:
        • falta Accept → +5
        • falta Accept-Encoding → +5
        • falta Accept-Language → +5
        • Chrome sin sec-fetch-site → +5
        • todos los tres Accept faltan → +5 bonus

4. Timing: analiza últimos 10 timestamps del IP
        • avg < 200ms → +25
        • avg < 500ms → +15
        • CV < 0.05 y avg < 2000ms → +20

5. Honeypot: ¿algún campo de honeypotFields tiene valor en body?
        → +30

6. score = min(100, suma)
        ├── score >= threshold → BotDetectedException (403) [a menos que logOnly=true]
        └── score < threshold → return true ✅
```

---

## SecurityContext

El guard escribe el bot score al `SecurityContext` de la request, disponible para otros guards y handlers sin recalcular:

```typescript
this.secCtx.merge(request, { botScore: score, isBot: score >= threshold });
```

```typescript
// En tu handler o en otros guards:
@Get('data')
getData(@SecurityCtx() ctx: SecurityContext) {
  console.log(ctx.botScore);  // score calculado por BotDetectionGuard
  console.log(ctx.isBot);     // boolean: score >= threshold
}
```

---

## Comportamiento

| Situación | Status | Log |
|-----------|--------|-----|
| Score < threshold | `200` | `DEBUG Bot score: 15/70 (below threshold)` |
| Score >= threshold, logOnly=false | `403` | `WARN Bot detected — score: 75/70 — POST /register` |
| Score >= threshold, logOnly=true | `200` | (mismo WARN pero permite pasar) |
| Googlebot u otro bot permitido | `200` | — |

---

## Nota sobre clientes HTTP en tests

Los clientes HTTP como `fetch` de Node.js, `axios` o `node-fetch` añaden automáticamente `Accept: */*` y `Accept-Encoding: br, gzip, deflate`. Esto reduce el score comparado con un `curl` real desde terminal (que no envía esos headers).

Para demostrar bloqueo por UA en tests programáticos, usar `threshold=30` (endpoint `/bot-strict`):
- headless UA (+25) + falta Accept-Language (+5) = 30 → bloqueado ✅

---

## Script de prueba

```bash
npm run test:bot
```

```
── /demo/level4/bot-check  (threshold = 70) ──

✅ [ALLOWED [200]] Real Chrome UA + full headers (score ~0) → PASS
✅ [ALLOWED [200]] Googlebot (whitelisted — score always 0) → PASS

── /demo/level4/bot-strict  (threshold = 30) — UA detection ──

✅ [ALLOWED [200]] Real Chrome + full headers → PASS even in strict mode
✅ [BLOCKED] curl/8.0 UA (+25) + no Accept-Language (+5) = 30 → BLOCK
✅ [BLOCKED] HeadlessChrome UA (+25) + no Accept-Language (+5) = 30 → BLOCK
✅ [BLOCKED] Puppeteer UA (+25) + no Accept-Language (+5) = 30 → BLOCK
✅ [BLOCKED] No User-Agent (+30) + no Accept-Language (+5) = 35 → BLOCK
✅ [ALLOWED [200]] Googlebot → PASS (whitelisted, returns score 0)
✅ [BLOCKED] Go-http-client/1.1 — matches headless pattern (+25) + no AcceptLang (+5) = 30 → BLOCK

── /demo/level4/bot-form  (honeypot, threshold = 30) ──

✅ [ALLOWED [201]] Normal POST, no honeypot fields → PASS
✅ [BLOCKED] POST with "website" honeypot filled (+30) → BLOCK
✅ [BLOCKED] POST with "_gotcha" honeypot filled (+30) → BLOCK

── /demo/level4/bot-log-only  (logOnly = true) ──

✅ [ALLOWED [200]] curl UA — PASS (log-only never blocks)
✅ [ALLOWED [200]] No headers at all — PASS (log-only never blocks)
```

---

## Copiar a tu proyecto

1. Copia `bot-detection.guard.ts`
2. Copia `bot-detection.service.ts`
3. Registra en tu módulo:

```typescript
@Module({
  providers: [BotDetectionService, BotDetectionGuard, RedisStoreService],
})
export class TuModulo {}
```

4. Aplica en tus endpoints:

```typescript
@SetMetadata(GUARD_METADATA.BOT_OPTIONS, {
  threshold: 70,
  honeypotFields: ['_gotcha', 'website'],
})
@UseGuards(BotDetectionGuard)
@Post('register')
register() {}
```
