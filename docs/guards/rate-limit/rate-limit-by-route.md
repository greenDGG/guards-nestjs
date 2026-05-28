# RateLimitByRouteGuard

Rate limiting por endpoint con tres features que `SlidingWindowRateLimitGuard` no tiene: **perfiles**, **ventana doble de burst**, y **penalty box**.

```
SlidingWindowRateLimitGuard:
  una ventana, sin penalty, configuración manual en cada endpoint

RateLimitByRouteGuard:
  @RateLimit('login')     → 5/min + burst 2/5s + penalty 5min tras 3 violations
  @RateLimit('payment')   → 10/min + burst 2/10s + penalty 15min tras 2 violations
  @RateLimit('search')    → 60/min + burst 15/5s (sin penalty)
```

---

## Archivos

```
src/guards/rate-limit/rate-limit-by-route.guard.ts
src/decorators/rate-limit-by-route.decorator.ts
src/examples/level3-rate-limit.controller.ts
scripts/test-rate-limit-by-route.ts
```

---

## Quick start

```bash
npm run start:dev
npm run test:rate-limit-by-route
```

---

## Feature 1: Profiles

Presets con valores probados en producción. Un solo decorador reemplaza configurar `max`, `windowMs`, `burstMax`, `burstWindowMs`, `penaltyMs`, `violationsBeforePenalty` y `keyBy` manualmente.

| Profile | max | windowMs | burstMax | burstWindowMs | keyBy | penalty | violations |
|---------|-----|----------|----------|---------------|-------|---------|-----------|
| `login` | 5 | 60s | 2 | 5s | ip | 5 min | 3 |
| `payment` | 10 | 60s | 2 | 10s | user | 15 min | 2 |
| `search` | 60 | 60s | 15 | 5s | user | — | — |
| `api` | 100 | 60s | 20 | 5s | user | — | — |
| `public` | 30 | 60s | 10 | 5s | ip | — | — |

Los campos individuales sobreescriben el perfil cuando se especifican:

```typescript
@RateLimit({ profile: 'login', max: 3 })  // más estricto que el default de login
@UseGuards(RateLimitByRouteGuard)
@Post('login')
login() {}
```

---

## Feature 2: Dual-window burst detection

Dos ventanas independientes por request. Ambas deben pasar.

```
Burst:     ventana corta  → bloquea ataques concentrados
Sustained: ventana larga  → límite general por minuto
```

**Por qué importa:** Un bot enviando 5 requests de login en 60 segundos está dentro del límite sostenido (5/min). Pero si las manda todas en 4 segundos, el burst window (2/5s) lo bloquea en la tercera request.

```
Timeline del ataque:
  t=0s   login #1 → burst=1/2  OK
  t=1s   login #2 → burst=2/2  OK  ← límite alcanzado
  t=2s   login #3 → burst=3/2  429 ← burst excedido
  t=2s   login #4 → burst=4/2  429
  t=6s   (burst window reseteada)
  t=6s   login #5 → burst=1/2  OK  ← nuevo burst window
```

Sin burst detection, los 5 intentos pasarían todos (uno por minuto = dentro del límite).

---

## Feature 3: Penalty box

Después de `violationsBeforePenalty` eventos de límite excedido, el IP/usuario queda bloqueado durante `penaltyMs` milisegundos. El bloqueo se verifica **antes** de cualquier cómputo de ventana — requests de clientes en penalty box son rechazadas sin tocar el store.

```
login profile: violationsBeforePenalty=3, penaltyMs=300_000 (5min)

Intento 1 → violation 1/3
Intento 2 → violation 2/3
Intento 3 → violation 3/3 → PENALTY BOX ACTIVADO
Intento 4 → 429 "Temporarily blocked" Retry-After=300s
...todos los requests durante 5 min → 429
```

**Diferencia vs solo rate limit:** Un attacker normal espera que la ventana se resetee (60 segundos) y vuelve a intentar. Con penalty box, cada ciclo de violaciones resetea el timer — si sigue intentando, el lockout se renueva.

---

## Uso

```typescript
// Perfil shorthand — todo configurado
@RateLimit('login')
@UseGuards(RateLimitByRouteGuard)
@Post('auth/login')
login() {}

// Perfil con override
@RateLimit({ profile: 'payment', max: 5 })
@UseGuards(RateLimitByRouteGuard)
@Post('checkout')
checkout() {}

// Config manual completa
@RateLimit({
  max: 3, windowMs: 60_000,
  burstMax: 1, burstWindowMs: 5_000,
  penaltyMs: 600_000, violationsBeforePenalty: 2,
  keyBy: 'ip',
})
@UseGuards(RateLimitByRouteGuard)
@Post('otp/verify')
verifyOtp() {}

// A nivel de controller — aplica a todos los endpoints
@RateLimit('api')
@UseGuards(RateLimitByRouteGuard)
@Controller('api/v1')
export class ApiV1Controller {
  @RateLimit('search')  // sobreescribe 'api' solo para este handler
  @Get('search')
  search() {}

  @Get('orders')  // hereda 'api' del controller
  orders() {}
}
```

---

## Opciones

```typescript
export type RateLimitProfile = 'login' | 'payment' | 'search' | 'api' | 'public';

export interface RateLimitByRouteOptions {
  profile?: RateLimitProfile;     // preset — valores individuales lo sobreescriben

  max?: number;                   // requests máximos en ventana sostenida
  windowMs?: number;              // ventana sostenida en ms        (default: 60_000)

  burstMax?: number;              // requests máximos en ventana burst
  burstWindowMs?: number;         // ventana burst en ms

  penaltyMs?: number;             // duración del lockout en ms     (default: 0 = off)
  violationsBeforePenalty?: number; // violations antes de lockout  (default: 3)

  keyBy?: 'ip' | 'user';          // clave del contador             (default: 'ip')
  skipIf?: (req: Request) => boolean; // bypass condicional
}
```

---

## Response headers

Siempre presentes:

```
X-RateLimit-Profile:         login
X-RateLimit-Limit:           5
X-RateLimit-Remaining:       3
X-RateLimit-Reset:           60
```

Cuando burst está configurado:

```
X-RateLimit-Burst-Limit:     2
X-RateLimit-Burst-Remaining: 1
```

En 429:

```
Retry-After: 5       ← burst violation
Retry-After: 60      ← sustained violation
Retry-After: 300     ← penalty box
```

---

## Diferencia con los otros guards de rate limit

| | `SlidingWindowRateLimitGuard` | `AdaptiveRateLimitGuard` | `RateLimitByRouteGuard` |
|---|---|---|---|
| Ventanas | 1 | 1 | 2 (burst + sustained) |
| Profiles | — | — | ✅ |
| Penalty box | — | — | ✅ |
| Ajuste por trust/bot | — | ✅ | — |
| Configuración | `@SetMetadata` manual | `@SetMetadata` manual | `@RateLimit('profile')` |

Pueden combinarse. Ejemplo recomendado para login:

```typescript
@RateLimit('login')
@SetMetadata(GUARD_METADATA.BOT_OPTIONS, { threshold: 50 })
@UseGuards(BotDetectionGuard, RateLimitByRouteGuard)
@Post('auth/login')
login() {}
```

`BotDetectionGuard` bloquea bots obvios (UA de headless browser, sin headers). `RateLimitByRouteGuard` limita el rate con burst y penalty para los que pasan.

---

## Script de prueba

```bash
npm run test:rate-limit-by-route
```

```
── Feature 2: Burst detection — profile 'login' (burst: 2 req / 5s) ──

  🟢  Login #1 — dentro del burst              HTTP 200  burst=1/2 sust=4/5
  🟢  Login #2 — burst limit alcanzado         HTTP 200  burst=0/2 sust=3/5
  🟡  Login #3 — burst excedido → 429          HTTP 429  Retry-After=5s
  🟡  Login #4 — burst excedido → 429          HTTP 429  Retry-After=5s

── Feature 3: Penalty box — custom-burst (3 violations → 60s lockout) ──

  Round 1:
  🟢  req 1 — OK                               HTTP 200
  🟢  req 2 — OK                               HTTP 200
  🟢  req 3 — OK                               HTTP 200
  🟡  Violation #1 — límite excedido           HTTP 429
  Round 2:
  🔴  Penalty box activo (round 2, req 4)      HTTP 429  Retry-After=60s
       "Temporarily blocked due to repeated..."
```

---

## Copiar a tu proyecto

1. Copia `rate-limit-by-route.guard.ts` y `rate-limit-by-route.decorator.ts`
2. Necesita: `RedisStoreService`, `IpExtractorService`
3. Registra:

```typescript
@Module({
  providers: [
    RateLimitByRouteGuard,
    RedisStoreService,
    IpExtractorService,
  ],
})
export class TuModulo {}
```
