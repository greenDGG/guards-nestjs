# CircuitBreakerGuard + CircuitBreakerInterceptor

Protege servicios downstream de **fallos en cascada** usando el patrón circuit breaker. El guard controla si la request llega al handler; el interceptor registra el resultado.

```
Estado CLOSED  → 3 fallos en 30s → Estado OPEN
Estado OPEN    → timeout 15s     → Estado HALF_OPEN
Estado HALF_OPEN → 2 éxitos      → Estado CLOSED
Estado OPEN    → request entrante → 503 ServiceUnavailable
```

---

## Archivos

```
src/guards/rate-limit/circuit-breaker.guard.ts   ← guard + interceptor (mismo archivo)
src/examples/level3-rate-limit.controller.ts     ← 3 endpoints de demo
scripts/test-circuit.ts
```

---

## Quick start

```bash
npm run start:dev
npm run test:circuit
```

---

## Uso

```typescript
@SetMetadata(GUARD_METADATA.CIRCUIT_BREAKER_OPTIONS, {
  serviceKey: 'payment-service',
  failureThreshold: 5,
  timeout: 30_000,
})
@UseGuards(CircuitBreakerGuard)
@UseInterceptors(CircuitBreakerInterceptor)
@Post('pay')
processPayment() {}
```

El interceptor es **obligatorio** — sin él, los fallos del handler nunca se cuentan y el circuit nunca se abre.

---

## Opciones

```typescript
export interface CircuitBreakerOptions {
  serviceKey:         string;   // clave única para este servicio/endpoint
  failureThreshold?:  number;   // default: 5  — fallos para abrir el circuit
  successThreshold?:  number;   // default: 2  — éxitos en HALF_OPEN para cerrarlo
  timeout?:           number;   // default: 30_000 ms — tiempo OPEN antes de HALF_OPEN
  rollingWindowMs?:   number;   // default: 60_000 ms — TTL del estado en el store
}
```

| Campo | Default | Descripción |
|-------|---------|-------------|
| `serviceKey` | — | Identifica el circuit en `RedisStoreService`. Múltiples endpoints pueden compartir el mismo `serviceKey` |
| `failureThreshold` | `5` | Fallos consecutivos necesarios para pasar de CLOSED → OPEN |
| `successThreshold` | `2` | Éxitos en estado HALF_OPEN necesarios para volver a CLOSED |
| `timeout` | `30_000` | Tiempo en ms que el circuit permanece OPEN antes de intentar HALF_OPEN |
| `rollingWindowMs` | `60_000` | TTL del estado del circuit en el store. El estado expira si no hay actividad |

---

## Estados

### CLOSED (normal)

Todas las requests pasan. Cada fallo del handler incrementa el contador. Cuando `failures >= failureThreshold` → transición a **OPEN**.

```
CLOSED: failures = 0/5
request → handler OK  → failures = 0/5  (sin cambio)
request → handler ❌  → failures = 1/5
request → handler ❌  → failures = 2/5
...
request → handler ❌  → failures = 5/5 → OPEN
```

### OPEN (bloqueado)

Todas las requests son rechazadas inmediatamente con `503 ServiceUnavailable` sin llegar al handler. Después de que expire el `timeout`, transiciona a **HALF_OPEN**.

```
OPEN: openedAt = T
request en T+5s   → 503 (circuit aún abierto, retry in 25s)
request en T+29s  → 503 (circuit aún abierto, retry in 1s)
request en T+31s  → HALF_OPEN (timeout expiró)
```

### HALF_OPEN (probando recuperación)

Deja pasar requests para probar si el servicio se recuperó:
- Handler **falla** → vuelve a **OPEN** inmediatamente
- Handler **tiene éxito** → incrementa `successes`. Cuando `successes >= successThreshold` → **CLOSED**

```
HALF_OPEN: successes = 0/2
request → handler OK → successes = 1/2  (sigue HALF_OPEN)
request → handler OK → successes = 2/2  → CLOSED ✅
```

---

## Arquitectura guard + interceptor

El guard y el interceptor se comunican a través de campos en el objeto `request`:

```
Guard (canActivate):
  request._circuitKey     = 'circuit:payment-service'
  request._circuitOptions = { failureThreshold: 5, ... }
  request._circuitState   = { state: 'CLOSED', failures: 2, ... }

Interceptor (intercept):
  Lee request._circuitKey y _circuitOptions
  Handler OK  → guard.recordSuccess(key, cfg)
  Handler ❌  → guard.recordFailure(key, cfg)
```

El interceptor nunca suprime el error del handler — lo re-lanza después de registrar el fallo.

---

## Múltiples endpoints, mismo serviceKey

Varios endpoints pueden compartir el mismo circuit. Útil cuando todos llaman al mismo servicio downstream:

```typescript
const PAYMENT_CIRCUIT = {
  serviceKey: 'stripe',
  failureThreshold: 3,
  timeout: 60_000,
};

@SetMetadata(GUARD_METADATA.CIRCUIT_BREAKER_OPTIONS, PAYMENT_CIRCUIT)
@UseGuards(CircuitBreakerGuard)
@UseInterceptors(CircuitBreakerInterceptor)
@Post('charge')
charge() {}

@SetMetadata(GUARD_METADATA.CIRCUIT_BREAKER_OPTIONS, PAYMENT_CIRCUIT)
@UseGuards(CircuitBreakerGuard)
@UseInterceptors(CircuitBreakerInterceptor)
@Post('refund')
refund() {}
// Si charge falla 3 veces, refund también se bloquea automáticamente
```

---

## Comportamiento

| Situación | Status | Log |
|-----------|--------|-----|
| Circuit CLOSED, handler OK | `200` | — |
| Circuit CLOSED, handler falla | `500` | `WARN Circuit OPEN for 'svc' after 5 failures` |
| Circuit OPEN | `503` | `WARN Circuit OPEN for 'svc' — retry in Xs` |
| Circuit HALF_OPEN, handler OK | `200` | `LOG Circuit CLOSED for 'circuit:svc'` |
| Circuit HALF_OPEN, handler falla | `500` + OPEN | `WARN Circuit OPEN for 'svc' after 1 failures` |

---

## Script de prueba

```bash
npm run test:circuit
```

```
── 1. Circuit CLOSED — 3 requests que siempre fallan ──

  💥 [500] Request #1 a /circuit-faulty  — fallo 1/3 registrado
  💥 [500] Request #2 a /circuit-faulty  — fallo 2/3 registrado
  💥 [500] Request #3 a /circuit-faulty  — fallo 3/3 registrado

── 2. Circuit OPEN — siguiente request bloqueada ──

  ⚡ [503] Request a /circuit-healthy mientras circuit OPEN  — circuit bloqueó → retry in ~6s

── 3. Esperando 7s para que expire el timeout (6s) ──

── 4. Circuit HALF_OPEN — probe request ──

  ✅ [200] Probe request #1 (éxito esperado)  — éxito 1/2 — aún HALF_OPEN

── 5. Segundo éxito → successThreshold=2 → circuit CIERRA ──

  ✅ [200] Probe request #2  — éxito 2/2 → circuit CLOSED ✅

── 6. Circuit CLOSED — operación normal restaurada ──

  ✅ [200] Request normal post-recovery  — circuit funcionando ✅
  💥 [500] Fallo pasa (circuit CLOSED, fallo #1/3)  — fallo registrado pero circuit sigue CLOSED
```

---

## Copiar a tu proyecto

1. Copia `circuit-breaker.guard.ts` (contiene el guard y el interceptor)
2. Registra en tu módulo:

```typescript
@Module({
  providers: [CircuitBreakerGuard, CircuitBreakerInterceptor, RedisStoreService],
})
export class TuModulo {}
```

3. Aplica en tus endpoints — **ambos son obligatorios**:

```typescript
@SetMetadata(GUARD_METADATA.CIRCUIT_BREAKER_OPTIONS, {
  serviceKey: 'mi-servicio',
  failureThreshold: 5,
  timeout: 30_000,
})
@UseGuards(CircuitBreakerGuard)
@UseInterceptors(CircuitBreakerInterceptor)
@Get('endpoint')
endpoint() {}
```
