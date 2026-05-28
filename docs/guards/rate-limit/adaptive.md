# AdaptiveRateLimitGuard

Calcula el límite efectivo de requests multiplicando dos señales independientes:

```
effectiveLimit = baseMax × trustMultiplier × botMultiplier
```

- **trustMultiplier** — reputación a largo plazo del usuario/IP. Empieza conservador (×0.10) y sube con buen comportamiento. `AnomalyDetectionGuard` lo penaliza cuando detecta picos o comportamiento anómalo.
- **botMultiplier** — comportamiento en tiempo real de esta request. Lo calcula `BotDetectionGuard` y lo pone en `SecurityContext`. Si `BotDetectionGuard` no corrió antes, se asume botScore=0 (limpio).

```
VIP user    (trust=95, bot=0 )  → 100 × 2.00 × 1.00 = 200 req/min
Trusted     (trust=80, bot=0 )  → 100 × 1.00 × 1.00 = 100 req/min
New user    (trust=50, bot=0 )  → 100 × 0.10 × 1.00 =  10 req/min
Suspicious  (trust=80, bot=30)  → 100 × 1.00 × 0.50 =  50 req/min
Bot         (trust=50, bot=80)  → 100 × 0.10 × 0.02 =   1 req/min (minLimit)
```

---

## Archivos

```
src/guards/rate-limit/adaptive-rate-limit.guard.ts
src/examples/level3-rate-limit.controller.ts   ← endpoint de demo
scripts/test-adaptive.ts
```

---

## Quick start

```bash
npm run start:dev
npm run test:adaptive
```

---

## Uso

### Standalone (solo trust score)

```typescript
@SetMetadata(GUARD_METADATA.ADAPTIVE_RATE_LIMIT_OPTIONS, {
  windowMs: 60_000,
  baseMax: 100,
  keyBy: 'user',
})
@UseGuards(AdaptiveRateLimitGuard)
@Get('feed')
getFeed() {}
// Nuevos usuarios → 10 req/min. Usuarios VIP → 200 req/min.
```

### Con BotDetectionGuard (ambos ejes activos)

```typescript
@SetMetadata(GUARD_METADATA.BOT_OPTIONS, { threshold: 200, logOnly: true })
@SetMetadata(GUARD_METADATA.ADAPTIVE_RATE_LIMIT_OPTIONS, {
  windowMs: 60_000,
  baseMax: 100,
  keyBy: 'ip',
})
@UseGuards(BotDetectionGuard, AdaptiveRateLimitGuard)
@Get('api')
api() {}
// BotDetectionGuard calcula botScore y lo pone en SecurityContext.
// AdaptiveRateLimitGuard lo lee y multiplica.
// threshold: 200 = nunca bloquea, solo computa el score.
```

### Con AnomalyDetectionGuard (trust score actualizado en tiempo real)

```typescript
@SetMetadata(GUARD_METADATA.ANOMALY_OPTIONS, { rpmMultiplier: 2.0, trustScorePenalty: 15 })
@SetMetadata(GUARD_METADATA.ADAPTIVE_RATE_LIMIT_OPTIONS, {
  windowMs: 60_000,
  baseMax: 30,
  keyBy: 'user',
})
@UseGuards(AnomalyDetectionGuard, AdaptiveRateLimitGuard)
@Get('endpoint')
endpoint() {}
// AnomalyDetectionGuard detecta spike → penaliza trustScore
// AdaptiveRateLimitGuard lee el score ya actualizado en este ciclo
```

### Tiers personalizados

```typescript
@SetMetadata(GUARD_METADATA.ADAPTIVE_RATE_LIMIT_OPTIONS, {
  windowMs: 60_000,
  baseMax: 200,
  trustTiers: [
    { maxScore: 30,  multiplier: 0.05, label: 'blocked'  },
    { maxScore: 60,  multiplier: 0.25, label: 'limited'  },
    { maxScore: 100, multiplier: 1.00, label: 'normal'   },
  ],
})
@UseGuards(AdaptiveRateLimitGuard)
```

---

## Opciones

```typescript
export interface AdaptiveRateLimitOptions {
  windowMs:   number;              // ventana de tiempo en ms
  baseMax:    number;              // límite para usuario de máxima confianza
  keyBy?:     'ip' | 'user';      // default: 'ip'
  trustTiers?: SignalTier[];       // default: ver tabla abajo
  botTiers?:   SignalTier[];       // default: ver tabla abajo
  minLimit?:   number;             // default: 1 (mínimo absoluto, evita limit=0)
}
```

| Campo | Default | Descripción |
|-------|---------|-------------|
| `windowMs` | — | Ventana deslizante en ms (ej: `60_000` = 1 minuto) |
| `baseMax` | — | Requests máximos para un usuario 100% confiable y limpio |
| `keyBy` | `'ip'` | `'user'` usa JWT sub (requiere JWT); `'ip'` funciona sin auth |
| `trustTiers` | ver tabla | Define los rangos de trust score y sus multiplicadores |
| `botTiers` | ver tabla | Define los rangos de bot score y sus multiplicadores |
| `minLimit` | `1` | Límite mínimo absoluto — evita que la combinación de multiplicadores llegue a 0 |

---

## Trust tiers (default)

El trust score se almacena en `RedisStoreService` bajo `trustScore:<userId>` (autenticados) o `trustScore:ip:<ip>` (anónimos). Usuarios nuevos comienzan con score 50.

| Rango | Tier | Multiplicador | Efectivo (baseMax=100) |
|-------|------|---------------|------------------------|
| 0–25 | `severely-untrusted` | ×0.02 | 2 req/min |
| 26–50 | `new-user` | ×0.10 | 10 req/min |
| 51–75 | `regular` | ×0.50 | 50 req/min |
| 76–90 | `trusted` | ×1.00 | 100 req/min |
| 91–100 | `vip` | ×2.00 | 200 req/min |

---

## Bot tiers (default)

El bot score lo calcula `BotDetectionGuard` en tiempo real y lo escribe en `SecurityContext`. Si ese guard no corrió en esta request, bot score = 0 (clean).

| Rango | Tier | Multiplicador |
|-------|------|---------------|
| 0–20 | `clean` | ×1.00 |
| 21–50 | `suspicious` | ×0.50 |
| 51–70 | `likely-bot` | ×0.10 |
| 71–100 | `bot` | ×0.02 |

---

## Response headers

Todos los factores del cálculo se exponen en headers para total transparencia:

```
X-RateLimit-Limit:              10    (effective limit)
X-RateLimit-Remaining:           9
X-RateLimit-Reset:              60    (seconds)
X-RateLimit-Base:              100
X-RateLimit-Trust-Score:        50
X-RateLimit-Trust-Tier:    new-user
X-RateLimit-Trust-Multiplier:  0.1
X-RateLimit-Bot-Score:           0
X-RateLimit-Bot-Tier:        clean
X-RateLimit-Bot-Multiplier:    1.0
X-RateLimit-Multiplier:     0.1000   (combined = trust × bot)
```

---

## Lógica de evaluación

```
1. ¿Hay opciones configuradas (metadata)?
        ├── NO  → return true
        └── SÍ  ↓

2. Resolver trust score:
        ├── ctx.trustScore ya calculado en esta request → reusar
        ├── keyBy='user' + userId → leer trustScore:<userId> de Redis
        └── anónimo → leer trustScore:ip:<ip> de Redis (default: 50)

3. Resolver bot score:
        └── ctx.botScore del SecurityContext (default: 0 si BotDetectionGuard no corrió)

4. Calcular efectiveLimit:
        trustTier = tiers[score ≤ maxScore] (sorted ascending)
        botTier   = tiers[score ≤ maxScore]
        effectiveLimit = max(minLimit, floor(baseMax × trustMult × botMult))

5. Sliding window — contar timestamps recientes:
        count = timestamps en el store dentro de windowMs
        
6. ¿count >= effectiveLimit?
        ├── SÍ → set Retry-After, throw RateLimitExceededException (429)
        └── NO → registrar timestamp, return true ✅

7. Escribir todos los X-RateLimit-* headers en la response
```

---

## Script de prueba

```bash
npm run test:adaptive
```

```
── 1. Request limpia (Chrome UA) — trust × bot = límite efectivo ──

  ✅ [200] GET /adaptive

  Trust Score:      50   Tier: new-user   Multiplier: ×0.1
  Bot Score:         0   Tier: clean      Multiplier: ×1
  Combined:         ×0.1000
  Base Max:         100
  Effective Limit:  10
  Remaining:         9
  Reset:            60s

── 2. Request con curl UA — bot score eleva × límite baja ──

  ✅ [200] GET /adaptive  (curl/8.0 UA)

  Trust Score:      50   Tier: new-user    Multiplier: ×0.1
  Bot Score:        25   Tier: suspicious  Multiplier: ×0.5
  Combined:         ×0.0500
  Base Max:         100
  Effective Limit:   5
  Remaining:         3
  Reset:            60s

  → Límite bajó de 10 a 5 por bot score más alto

── 3. Burst (6 requests) — debe llegar a 429 ──

  ✅ [200] #1   remaining=2/5
  ✅ [200] #2   remaining=1/5
  ✅ [200] #3   remaining=0/5
  🚦 [429] #4 — RATE LIMIT exceeded  limit=5  reset=60s
```

---

## Copiar a tu proyecto

1. Copia `adaptive-rate-limit.guard.ts`
2. Registra en tu módulo:

```typescript
@Module({
  providers: [
    AdaptiveRateLimitGuard,
    RedisStoreService,
    IpExtractorService,
    SecurityContextService,
  ],
})
export class TuModulo {}
```

3. Aplica en tus endpoints:

```typescript
@SetMetadata(GUARD_METADATA.ADAPTIVE_RATE_LIMIT_OPTIONS, {
  windowMs: 60_000,
  baseMax: 100,
  keyBy: 'user',
})
@UseGuards(BotDetectionGuard, AdaptiveRateLimitGuard)
@Get('api')
api() {}
```

4. Opcional: coloca `BotDetectionGuard` antes para activar el eje de bot score. Coloca `AnomalyDetectionGuard` antes para que el trust score refleje el comportamiento de esta misma request.
