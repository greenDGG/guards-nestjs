# AnomalyDetectionGuard

Detecta comportamiento anómalo usando **EMA (Exponential Moving Average)** de métricas por usuario. Cuando detecta un pico anómalo, penaliza el **trust score** del usuario — que `AdaptiveRateLimitGuard` lee para ajustar límites automáticamente.

**Este guard nunca bloquea.** Siempre devuelve `true`. Su efecto es indirecto: baja el trust score, y ese score afecta a otros guards (principalmente `AdaptiveRateLimitGuard`).

```
GET /api/endpoint  (20 requests en 2 segundos)
  → EMA detecta RPM spike
  → trust score: 75 → 60
  → AdaptiveRateLimitGuard reduce límites automáticamente
  → request pasa igual ✅ (el usuario no es bloqueado por este guard)
```

---

## Archivos

```
src/guards/detection/anomaly-detection.guard.ts
src/services/anomaly-detection.service.ts
src/examples/level4-detection.controller.ts   ← endpoints de demo
scripts/test-anomaly.ts
```

---

## Quick start

```bash
npm run start:dev
npm run test:anomaly
```

---

## Uso

### Monitoreo básico con penalización

```typescript
@SetMetadata(GUARD_METADATA.ANOMALY_OPTIONS, {
  rpmMultiplier: 3.0,
  trustScorePenalty: 10,
})
@UseGuards(AnomalyDetectionGuard)
@Get('sensitive-data')
sensitiveData() {}
// Si el usuario dispara muchas requests rápidas → trust score baja
// El usuario no es bloqueado — pero AdaptiveRateLimitGuard sí le reducirá los límites
```

### Pipeline completo: Anomaly + Adaptive juntos

```typescript
@SetMetadata(GUARD_METADATA.ANOMALY_OPTIONS, {
  rpmMultiplier: 2.0,
  trustScorePenalty: 15,
})
@SetMetadata(GUARD_METADATA.ADAPTIVE_RATE_LIMIT_OPTIONS, {
  windowMs: 60_000,
  baseMax: 30,
  keyBy: 'user',
})
@UseGuards(AnomalyDetectionGuard, AdaptiveRateLimitGuard)
@Get('api')
api() {}
// AnomalyDetectionGuard detecta → penaliza trust score
// AdaptiveRateLimitGuard lee el score → reduce el límite efectivo
// Headers: X-RateLimit-Trust-Score, X-RateLimit-Trust-Tier, X-RateLimit-Limit
```

### Uso global (monitoreo pasivo de toda la app)

```typescript
// app.module.ts
{ provide: APP_GUARD, useClass: AnomalyDetectionGuard }
// Registra métricas en todos los endpoints autenticados sin configurar nada por ruta
```

---

## Opciones

```typescript
export interface AnomalyDetectionOptions {
  rpmMultiplier?:       number;   // default: 3.0
  errorRateThreshold?:  number;   // default: 0.5  (50%)
  trustScorePenalty?:   number;   // default: 10
  trustScoreTtlMs?:     number;   // default: 3_600_000 (1 hora)
  logOnly?:             boolean;  // default: false (siempre es no-block, este flag no aplica)
}
```

| Campo | Default | Descripción |
|-------|---------|-------------|
| `rpmMultiplier` | `3.0` | Si `currentRpm > ema_rpm × multiplier` → anomalía RPM |
| `errorRateThreshold` | `0.5` | Si `ema_errorRate > threshold` → anomalía de errores |
| `trustScorePenalty` | `10` | Puntos que se restan al trust score por cada anomalía detectada |
| `trustScoreTtlMs` | `3_600_000` | TTL del trust score en el store (ms). Tras expirar, vuelve al default (75) |

---

## Cómo funciona el EMA

El **EMA (Exponential Moving Average)** es un promedio ponderado que da más peso a los valores recientes. Con `alpha = 0.3`:

```
ema_new = 0.3 × current + 0.7 × ema_old
```

Cada request actualiza dos métricas independientes:

### EMA de RPM
```
secondsElapsed = (now - lastUpdated) / 1000
currentRpm     = 60 / secondsElapsed
ema_rpm        = 0.3 × currentRpm + 0.7 × ema_rpm
```

Si el usuario hace requests muy seguidas, `secondsElapsed` es muy pequeño, `currentRpm` dispara, y el EMA empieza a subir. Cuando `currentRpm > ema_rpm × rpmMultiplier` → anomalía.

### EMA de error rate
```
currentErrorRate = isError ? 1 : 0   (pre-handler: siempre 0 por ahora)
ema_errorRate    = 0.3 × currentErrorRate + 0.7 × ema_errorRate
```

Si `ema_errorRate > errorRateThreshold` → anomalía.

### Detección del spike

```
1. ema_rpm > 0           (ya hay baseline)
2. currentRpm > ema_rpm × rpmMultiplier
```

Ambas condiciones deben cumplirse. La condición `ema_rpm > 0` previene false positives en la primera request.

---

## Trust score

El trust score se almacena en `RedisStoreService` bajo la clave `trustScore:<userId>`:

| Rango | Tier | Multiplicador (AdaptiveRateLimit) |
|-------|------|-----------------------------------|
| 91–100 | `vip` | ×2.00 |
| 76–90 | `trusted` | ×1.00 |
| 51–75 | `regular` | ×0.50 |
| 26–50 | `new-user` | ×0.10 |
| 0–25 | `severely-untrusted` | ×0.02 |

- **Default**: 75 (`regular`) — un usuario sin score registrado comienza aquí
- **Mínimo**: 0 (no puede ser negativo)
- **TTL**: configurable vía `trustScoreTtlMs` (default 1 hora) — tras expirar, el usuario vuelve a 75
- **Acumulativo**: cada anomalía resta `trustScorePenalty` sobre el score actual

### Leer el trust score

```typescript
// Endpoint de demo — requiere JWT
GET /demo/level4/trust-score

// Response:
{
  "userId": 2,
  "trustScore": 60,
  "tier": "regular (×0.50)",
  "tip": "Dispara muchas requests rápidas a /anomaly para ver cómo baja"
}
```

---

## Lógica de evaluación

```
1. ¿Hay user.sub en request?
        ├── NO  → return true (anónimo, no se registra nada)
        └── SÍ  ↓
2. recordRequest(userId, url, isError=false)
        → Actualiza EMA de rpm y errorRate en el store
        ↓
3. detectAnomaly(userId, rpmMultiplier, errorRateThreshold)
        ├── RPM spike: currentRpm > ema_rpm × multiplier?
        └── Error surge: ema_errorRate > threshold?
        ↓
4. ¿Anomalía detectada?
        ├── SÍ → penalizeTrustScore (resta penalty, mínimo 0)
        └── NO → nada
        ↓
5. return true  ← SIEMPRE
```

---

## Comportamiento cold-start (EMA sin baseline)

Con `ema_rpm = 0` al inicio, la detección de spike requiere `ema_rpm > 0`, así que la primera request nunca dispara anomalía. A partir de la segunda request, el EMA ya tiene un valor y las comparaciones son válidas.

Con `rpmMultiplier = 2.0` (agresivo), incluso requests a 1/segundo pueden detectarse como spike si el baseline EMA es muy bajo. Para producción, usar `rpmMultiplier = 3.0` o superior reduce false positives durante el warm-up.

---

## Comportamiento

| Situación | Resultado | Log |
|-----------|-----------|-----|
| Usuario sin JWT | Pasa ✅ (no registra nada) | — |
| Request dentro de baseline normal | Pasa ✅ | — |
| RPM spike detectado | Pasa ✅ + penaliza trust score | `WARN Anomaly detected for user X: RPM spike: 120.0 vs baseline 40.0` |
| Error rate alta | Pasa ✅ + penaliza trust score | `WARN Anomaly detected for user X: High error rate: 60.0%` |
| Trust score en 0 (mínimo) | Pasa ✅ (no puede bajar más) | — |

---

## Headers en AdaptiveRateLimitGuard

Cuando se usa junto con `AdaptiveRateLimitGuard`, los headers reflejan el trust score:

```
X-RateLimit-Trust-Score:      60
X-RateLimit-Trust-Tier:       regular
X-RateLimit-Trust-Multiplier: 0.5
X-RateLimit-Limit:            15   (baseMax=30 × 0.5)
X-RateLimit-Remaining:        14
```

---

## Script de prueba

```bash
npm run test:anomaly
```

```
════════════════════════════════════════════
  guard-nest — Anomaly Detection Guard Test Suite
  (EMA-based behavioral analysis)
════════════════════════════════════════════

  Token obtenido: eyJhbGciOiJIUzI1NiIsInR5cCI6Ik...

── 1. Trust score antes de cualquier actividad ──

  Trust score inicial: 75  (default = 75 para usuario conocido)
  Tier: regular (×0.50)

── 2. Requests normales (1 por segundo) — sin anomalía esperada ──

✅ [200] Request normal #1
✅ [200] Request normal #2
✅ [200] Request normal #3

  Trust score después de requests normales: 60

── 3. Burst de 20 requests en ~2 segundos (RPM spike) ──

....................

  Trust score después del burst: 60  (↓ bajó 15 puntos)
  Tier: regular (×0.50)

── 4. Adaptive Rate Limit — headers reflejan el trust score ──

✅ [200] GET /anomaly-adaptive

  X-RateLimit-Trust-Score:      60
  X-RateLimit-Trust-Tier:       regular
  X-RateLimit-Trust-Multiplier: 0.5
  X-RateLimit-Limit:            15  (baseMax=30 × multiplier)
  X-RateLimit-Remaining:        14
```

La penalización ocurre en el paso 2 (durante las requests normales) porque con `rpmMultiplier=2.0` el EMA detecta el spike inicial. El burst en el paso 3 no genera penalización adicional porque el EMA ya tiene un baseline establecido a ese RPM.

---

## Copiar a tu proyecto

1. Copia `anomaly-detection.guard.ts`
2. Copia `anomaly-detection.service.ts`
3. Registra en tu módulo:

```typescript
@Module({
  providers: [
    AnomalyDetectionService,
    AnomalyDetectionGuard,
    RedisStoreService,
  ],
})
export class TuModulo {}
```

4. Aplica en tus endpoints:

```typescript
@SetMetadata(GUARD_METADATA.ANOMALY_OPTIONS, {
  rpmMultiplier: 3.0,
  trustScorePenalty: 10,
})
@UseGuards(AnomalyDetectionGuard)
@Get('api')
api() {}
```

5. Para ver el efecto, combínalo con `AdaptiveRateLimitGuard` y lee los headers `X-RateLimit-*`.
