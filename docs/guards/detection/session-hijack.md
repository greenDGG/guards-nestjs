# SessionHijackGuard

Detecta tokens JWT robados comparando cada request contra la baseline establecida en la primera request del token. Cubre los ataques que los guards de fingerprint no detectan: uso concurrente del mismo token desde dos IPs distintas y cambios de subnet bruscos.

```
Sin SessionHijackGuard:
  Token robado desde IP 85.12.x.x
  → request llega con JWT válido → pasa (no hay firma rota)

Con SessionHijackGuard:
  Baseline: IP 201.15.x.x, Chrome UA
  Nueva request: IP 85.12.x.x, Firefox UA
  → subnet-change (+15) + ua-change (+35) = 50 → warn (o block en modo strict)
```

---

## Archivos

```
src/guards/detection/session-hijack.guard.ts
src/decorators/session-hijack.decorator.ts
src/examples/level4-detection.controller.ts
scripts/test-session-hijack.ts
```

---

## Quick start

```bash
npm run start:dev
npm run test:session-hijack
```

---

## Señales

| Señal | Max pts | Trigger |
|-------|---------|---------|
| Subnet change | 25 | El /24 de la IP es diferente al registrado en la baseline |
| UA change | 35 | User-Agent hash cambió mid-session |
| Concurrent use | 25 | 2+ IPs distintas usando el mismo token en una ventana de 30s |
| Geo change | 15 | País diferente al registrado en la baseline |

**Total máximo: 100** (capped)

---

## Decisiones

| Rango | Acción | Comportamiento |
|-------|--------|----------------|
| < 30 | `allow` | Continúa normal |
| 30–59 | `warn` | Penaliza trust score, headers de aviso, permite pasar |
| ≥ 60 | `block` | 401 `SessionHijackedException` |

En `logOnly: true`: nunca bloquea ni penaliza — solo registra en logs.

---

## Uso

```typescript
// Modo observación — nunca bloquea (ideal para ramp)
@SessionProtect({ logOnly: true })
@UseGuards(SessionHijackGuard)
@Get('account')
account() {}

// Modo estándar (warn≥30, block≥60)
@SessionProtect()
@UseGuards(SessionHijackGuard)
@Get('transfers')
transfers() {}

// Modo estricto — operaciones sensibles
@SessionProtect({ thresholds: { warn: 15, block: 40 } })
@UseGuards(SessionHijackGuard)
@Post('withdraw')
withdraw() {}

// Mobile-friendly — permite cambio WiFi ↔ celular
@SessionProtect({ maxSubnetChanges: 2, thresholds: { block: 70 } })
@UseGuards(SessionHijackGuard)
@Get('feed')
feed() {}
```

---

## Opciones

```typescript
export interface SessionHijackOptions {
  thresholds?: {
    warn?:  number;  // default: 30 — penaliza trust score, permite pasar
    block?: number;  // default: 60 — lanza SessionHijackedException
  };
  maxSubnetChanges?: number;  // default: 1 — subnets /24 permitidas antes de score máximo
  warnPenalty?:      number;  // default: 10 — puntos que se restan del trust score en warn
  sessionTtlMs?:     number;  // default: 86_400_000 (24h) — TTL del estado en el store
  logOnly?:          boolean; // default: false — solo loguea, nunca bloquea
}
```

---

## Clave de sesión: `sub:iat`

El estado se guarda con clave `hijack:state:<sub>:<iat>` — es decir, **por token emitido**, no por usuario.

Esto garantiza:
- **Re-login limpio**: cada `iat` nuevo genera una baseline nueva. Un token robado tiene su propia baseline separada.
- **Sin colisiones**: si el usuario tiene dos sesiones abiertas (móvil + desktop), cada token establece su propia baseline.
- **Token fixation inmune**: un token capturado hace meses acumula su propia historia sospechosa.

---

## Headers de respuesta

Siempre presentes cuando el guard corre:

```
X-Session-Risk:   45
X-Session-Action: warn
```

En la primera request del token:

```
X-Session-Risk:   0
X-Session-Action: allow
```

---

## Cómo funciona cada señal

### Subnet change (0–25 pts)
Calcula el /24 de la IPv4 (o los primeros 4 grupos de IPv6). Si el subnet actual es diferente al último registrado y diferente al original (volver al subnet inicial = 0 pts), suma 15 pts en el primer cambio y 25 pts si el subnet ya había cambiado antes en esta sesión.

### UA change (35 pts)
Hash SHA-256 del `User-Agent` header. Cualquier cambio = 35 pts. Es la señal más fuerte porque los usuarios legítimos no cambian de navegador mid-session.

### Concurrent use (20–25 pts)
Lista FIFO (`lpush/ltrim`) de pares `{ip, ts}` por token, ventana de 30 segundos. Si hay 2+ IPs distintas activas = 20 pts, 3+ IPs = 25 pts. Detecta el caso clásico: atacante usa el token robado mientras el usuario legítimo sigue activo.

### Geo change (15 pts)
País del IP (vía `GeoIpService`) comparado con el país del baseline. Si el servicio geo falla = 0 pts (fallback seguro). Solo aplica si el baseline tiene país registrado.

---

## Modo logOnly — ramp a producción

```typescript
@SessionProtect({ logOnly: true })
@UseGuards(SessionHijackGuard)
@Get('account')
account() {}
```

Nunca bloquea ni penaliza el trust score. Loguea las señales detectadas en el servidor con `logger.warn(...)`. Úsalo durante 24–48h en producción para observar qué scores reales genera tu tráfico antes de activar enforcement.

---

## Script de prueba

```bash
npm run test:session-hijack
```

```
── Scenario 1: Sesión normal (mismo UA, mismo "IP") ──

  🟢  Primera request — establece baseline         risk=  0  action=allow   HTTP 200
  🟢  Segunda request — mismo UA → allow            risk=  0  action=allow   HTTP 200

── Scenario 2: Cambio de User-Agent (+35 pts) ──

  🟢  Baseline con Chrome                           risk=  0  action=allow   HTTP 200
  🟡  Cambio a Firefox UA → señal ua-changed (+35)  risk= 35  action=warn    HTTP 200

── Scenario 3: Modo strict (block≥45) — UA change → 401 ──

  🟢  Strict — baseline con Chrome                  risk=  0  action=allow   HTTP 200
  🔴  Strict — Firefox UA → HTTP 401 SessionHijackedException
       ↳ breakdown: subnet=0 ua=35 conc=0 geo=0 total=35
```

---

## Integración con AdaptiveRateLimitGuard

La acción `warn` penaliza el `trustScore` en el store (clave `trustScore:<userId>`). `AdaptiveRateLimitGuard` lee ese score para ajustar los límites. Un usuario con sesión sospechosa automáticamente recibe límites más bajos sin intervención manual.

```typescript
// Stack recomendado para endpoint financiero
@SessionProtect({ thresholds: { warn: 20, block: 50 } })
@RiskScore({ thresholds: { block: 60 } })
@AuditLog({ resource: 'transfer', action: 'create' })
@UseGuards(SessionHijackGuard, RiskScoreGuard)
@UseInterceptors(AuditLogInterceptor)
@Post('transfer')
transfer() {}
```

---

## Copiar a tu proyecto

1. Copia `session-hijack.guard.ts` y `session-hijack.decorator.ts`
2. Necesita: `RedisStoreService`, `GeoIpService`, `IpExtractorService`
3. Registra:

```typescript
@Module({
  providers: [
    SessionHijackGuard,
    RedisStoreService,
    GeoIpService,
    IpExtractorService,
  ],
})
export class TuModulo {}
```
