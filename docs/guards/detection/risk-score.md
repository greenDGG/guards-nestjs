# RiskScoreGuard

Agrega cinco señales de seguridad en un score único (0–100) y toma una decisión de tres vías: **allow → challenge → block**. El equivalente open-source de la capa de riesgo de Stripe o Cloudflare Bot Management.

```
Sin RiskScoreGuard: cada guard decide por su cuenta
  BotDetectionGuard: score 35 → pasa (bajo el umbral 70)
  GeoIpGuard: país permitido → pasa
  RateLimitGuard: 15 requests/min → dentro del límite

  Resultado: request pasa con score combinado real de 65 → debería challengear

Con RiskScoreGuard: todos los datos juntos
  bot=35 + geo=10 + trust=10 + velocity=8 + fingerprint=0 = 63 → challenge
```

---

## Archivos

```
src/guards/detection/risk-score.guard.ts
src/decorators/risk-score.decorator.ts
src/examples/level4-detection.controller.ts
scripts/test-risk-score.ts
```

---

## Quick start

```bash
npm run start:dev
npm run test:risk-score
```

---

## Señales agregadas

| Señal | Fuente | Max pts | Descripción |
|-------|--------|---------|-------------|
| Bot | `securityContext.botScore` ó `BotDetectionService` | 40 | UA, headers, timing, honeypot |
| Geo riesgo | `securityContext.geo` ó `GeoIpService` | 15 | País clasificado en tier 0–3 |
| Trust inverso | `securityContext.trustScore` | 15 | `(1 - trustScore/100) × 15` |
| Velocity | sliding window `lpush/lrange` por IP | 15 | Requests en último minuto |
| Fingerprint | hash UA+lang+enc vs. stored | 15 | Cambio de entorno detectado |

**Total máximo: 100** (capped)

---

## Decisiones

| Rango | Acción | Comportamiento |
|-------|--------|----------------|
| 0–39 | `allow` | Pasa sin modificar la request |
| 40–69 | `challenge` | `onChallenge: 'throw'` → 403; `'header'` → `X-Risk-Challenge: true` + pasa |
| 70–100 | `block` | 403 `RiskScoreBlockedException` siempre |

---

## Uso

```typescript
// Standalone — llama los servicios internamente
@RiskScore()
@UseGuards(RiskScoreGuard)
@Post('transfer')
transfer() {}

// Compuesto — reutiliza scores de guards previos (sin re-computar)
@RiskScore({ thresholds: { challenge: 30, block: 60 } })
@UseGuards(BotDetectionGuard, GeoIpGuard, RiskScoreGuard)
@Post('transfer')
transfer() {}

// Observar sin bloquear (ramp a producción)
@RiskScore({ logOnly: true })
@UseGuards(RiskScoreGuard)
@Get('orders')
orders() {}
```

---

## Opciones

```typescript
export interface RiskScoreOptions {
  thresholds?: {
    challenge?: number;  // default: 40
    block?:     number;  // default: 70
  };
  weights?: {
    bot?:         number;  // default: 40
    geo?:         number;  // default: 15
    trust?:       number;  // default: 15
    velocity?:    number;  // default: 15
    fingerprint?: number;  // default: 15
  };
  velocity?: {
    windowMs?:    number;  // default: 60_000 (1 min)
    maxRequests?: number;  // default: 30
  };
  onChallenge?: 'throw' | 'header';  // default: 'throw'
  logOnly?:     boolean;             // default: false
}
```

---

## Headers de respuesta

Siempre presentes:

```
X-Risk-Score:  65
X-Risk-Action: challenge
```

En modo `onChallenge: 'header'`:

```
X-Risk-Challenge: true
```

---

## SecurityContext escrito

Accesible con `@SecurityCtx()` en el handler:

```typescript
ctx.riskScore     // 65
ctx.riskAction    // 'challenge'
ctx.riskBreakdown // { bot: 35, geo: 10, trust: 10, velocity: 8, fingerprint: 2, total: 65 }
```

---

## Cómo funciona cada señal

### Bot (0–40 pts)
Lee `securityContext.botScore` si `BotDetectionGuard` ya corrió. Si no, llama `BotDetectionService.computeBotScore()` directamente. Score normalizado: `(botScore / 100) × weight`.

### Geo riesgo (0–15 pts)
Lee `securityContext.geo` o llama `GeoIpService.lookup()`. Clasifica el país en 3 tiers:

```
Tier 3 (alto):   KP, IR, SY, CU, SD              → 15 pts
Tier 2 (medio):  RU, BY, VE, MM, AF, SO, LY, YE  → 10 pts
Tier 1 (bajo):   resto de países                  → 5 pts
Tier 0:          IP privada / sin geo              → 0 pts
```

### Trust inverso (0–15 pts)
`(1 - trustScore / 100) × weight`. `trustScore` es reducido por `AnomalyDetectionGuard` cuando detecta patrones anómalos. Si no hay trustScore → neutral 75.

### Velocity (0–15 pts)
Sliding window de timestamps por IP usando `lpush/lrange` en RedisStoreService. Cuenta requests dentro de `windowMs`. Score sube linealmente hasta `maxRequests`, donde alcanza el máximo.

```
0 requests  → 0 pts
15 requests → ~7.5 pts (mitad)
30 requests → 15 pts (máximo)
```

### Fingerprint (0–9 pts)
Hash SHA-256 de `User-Agent + Accept-Language + Accept-Encoding` comparado contra el valor almacenado para esta IP (TTL 7 días). Si cambia para una IP establecida → `weight × 0.6`. Primera vez vista → 0 pts.

---

## Modo logOnly — ramp a producción

```typescript
@RiskScore({ logOnly: true })
@UseGuards(RiskScoreGuard)
@Get('orders')
orders() {}
```

Nunca bloquea. Loguea scores y escribe en securityContext. Úsalo en producción durante 24–48h para calibrar thresholds antes de activar enforcement.

---

## Geo risk tiers

Los países de alto riesgo son principalmente jurisdicciones sancionadas con historial de alto fraude. Puedes reemplazar con tu propia lógica ajustando los mapas en `risk-score.guard.ts`.

Para geo más granular (score por ISP, por ASN, IP reputation databases), integra con servicios como MaxMind GeoIP2 vía el `logger` custom o un servicio propio inyectado.

---

## Script de prueba

```bash
npm run test:risk-score
```

```
── Perfil 1: Navegador humano normal ──

  🟢  Chrome humano (UA completo)           score= 8  [░░░░░░░·············]  allow
       ↳ bot=0  geo=5  trust=3  vel=0  fp=0

── Perfil 2: Herramientas de automatización ──

  🟡  curl (sin Accept, sin lang)           score=44  [▓▓▓▓▓▓▓▓▓·········]  challenge
  🟡  python-requests                        score=51  [▓▓▓▓▓▓▓▓▓▓·········]  challenge
  🔴  HeadlessChrome / Puppeteer            score=75  [████████████████····]  block
  🔴  Sin User-Agent (máximo bot score)     score=82  [█████████████████···]  block

── Perfil 3: Velocity — 10 requests rápidas ──

  🟡  Tras 10 requests rápidas (velocity)  score=48  [▓▓▓▓▓▓▓▓▓▓·········]  challenge
```

---

## Stack fintech completo

```typescript
@AuditLog({ resource: 'transfer' })
@RiskScore({ thresholds: { challenge: 30, block: 60 } })
@ReplayProtect({ secret: process.env.API_SECRET })
@UseGuards(BotDetectionGuard, GeoIpGuard, ReplayProtectionGuard, RiskScoreGuard)
@UseInterceptors(AuditLogInterceptor)
@Post('transfer')
transfer(@Body() dto: TransferDto) {}
```

Orden de ejecución:
```
BotDetectionGuard   → bot score en securityContext
GeoIpGuard          → geo en securityContext
ReplayProtectionGuard → timestamp + nonce + firma
RiskScoreGuard      → lee los scores ya computados + velocity + fingerprint → decisión
Handler             → ejecuta la transferencia
AuditLogInterceptor → registra quién/qué/cuándo/resultado
```

---

## Copiar a tu proyecto

1. Copia `risk-score.guard.ts` y `risk-score.decorator.ts`
2. Necesita: `BotDetectionService`, `GeoIpService`, `RedisStoreService`, `SecurityContextService`
3. Registra:

```typescript
@Module({
  providers: [
    RiskScoreGuard,
    BotDetectionService,
    GeoIpService,
    RedisStoreService,
    SecurityContextService,
  ],
})
export class TuModulo {}
```
