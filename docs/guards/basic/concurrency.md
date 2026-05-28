# ConcurrencyInterceptor

Limita cuántos requests pueden estar **en vuelo simultáneamente** para un cliente o endpoint. Distinto al rate limiting (que mide velocidad — requests por minuto), la concurrencia mide **profundidad** — cuántos requests están siendo procesados al mismo tiempo.

---

## Por qué es un interceptor y no un guard

Un guard solo corre **antes** del handler — no tiene forma de ejecutar código después. Para liberar el slot de concurrencia cuando el handler termina (éxito **o** error), necesitamos envolver ambos lados. Eso es exactamente lo que hace un interceptor mediante observables RxJS.

```
Request → [interceptor pre] → handler → [interceptor post] → Response
                ↑                              ↑
           incr counter                   decr counter
```

---

## Archivos

```
src/guards/basic/concurrency.interceptor.ts
src/decorators/concurrent.decorator.ts
src/exceptions/security.exception.ts  ← ConcurrencyLimitException
scripts/test-concurrency.ts
```

---

## Quick start

```bash
npm run start:dev
npm run test:concurrency
```

---

## Uso

```typescript
import { Concurrent } from '../decorators/concurrent.decorator';
import { ConcurrencyInterceptor } from '../guards/basic/concurrency.interceptor';

// Máximo 2 requests simultáneas por IP
@Post('generate-report')
@Concurrent({ maxConcurrent: 2, keyBy: 'ip' })
@UseInterceptors(ConcurrencyInterceptor)
async generateReport() { /* operación costosa */ }

// Recurso exclusivo — solo 1 a la vez para todos los clientes
@Post('update-config')
@Concurrent({ maxConcurrent: 1, keyBy: 'global', ttlMs: 5_000 })
@UseInterceptors(ConcurrencyInterceptor)
async updateConfig() {}

// Por usuario autenticado (JWT) y ruta — el más granular
@Post('export')
@Concurrent({ maxConcurrent: 1, keyBy: 'user+route' })
@UseInterceptors(ConcurrencyInterceptor)
async export() {}
```

---

## Opciones `@Concurrent()`

```typescript
export interface ConcurrencyOptions {
  maxConcurrent: number;
  keyBy?:        'ip' | 'user' | 'user+route' | 'global';
  ttlMs?:        number;
}
```

| Campo | Default | Descripción |
|-------|---------|-------------|
| `maxConcurrent` | — | Máximo de requests simultáneas permitidas |
| `keyBy` | `'ip'` | Cómo agrupar el contador (ver tabla abajo) |
| `ttlMs` | `30_000` | Safety TTL — resetea el contador si un proceso crashea |

### Modos `keyBy`

| Modo | Contador | Caso de uso |
|------|----------|-------------|
| `'ip'` | Por IP de cliente | Limitar requests pesadas por visitante |
| `'user'` | Por `jwt.sub` | Por usuario autenticado, cualquier ruta |
| `'user+route'` | Por usuario + handler | Usuario A y usuario B tienen slots independientes |
| `'global'` | Un solo contador global | Recurso que no soporta concurrencia (archivo, singleton) |

---

## Flujo del contador

```
Request llega
    │
    ▼
INCR concurrency:ip:1.2.3.4   → 1
    │
    ├── current > maxConcurrent? → DECR + throw 429 (respuesta inmediata, ~10ms)
    │
    └── current ≤ maxConcurrent → handler corre (1-5 segundos)
              │
              ├── éxito → DECR counter
              └── error → DECR counter + rethrow
```

El `ttlMs` existe como red de seguridad: si el proceso muere mientras tiene slots abiertos, el contador se auto-resetea al expirar la TTL. Sin él, slots "fantasma" bloquearían requests futuras para siempre.

---

## Response headers

```
X-Concurrency-Limit:   2     ← maxConcurrent configurado
X-Concurrency-Current: 2     ← slots ocupados en el momento del request
```

---

## Script de prueba

```bash
npm run test:concurrency
```

```
Test 1: 3 requests secuenciales (todas deben pasar)
✅ [201] Request secuencial #1  —  1086ms
✅ [201] Request secuencial #2  —  1007ms
✅ [201] Request secuencial #3  —  1020ms

Test 2: 2 paralelas (límite exacto — ambas pasan)
✅ [201] Paralela A  —  1013ms
✅ [201] Paralela B  —  1013ms

Test 3: 3 paralelas (3ra bloqueada)
✅ [201] Paralela #1  —  1011ms
✅ [201] Paralela #2  —  1011ms
🚫 [429] Paralela #3  —  12ms     ← rechazada en ~12ms, el handler nunca corrió

Test 5: Recurso exclusivo global (3 paralelas, solo 1 pasa)
✅ [201] Cliente X  —  513ms
🚫 [429] Cliente Y  —  8ms
🚫 [429] Cliente Z  —  10ms

Race condition extrema: 5 paralelas, límite 2
✅ [201] Extrema #1  —  1018ms
✅ [201] Extrema #2  —  1019ms
🚫 [429] Extrema #3  —  7ms
🚫 [429] Extrema #4  —  10ms
🚫 [429] Extrema #5  —  13ms
```

Los requests bloqueados responden en ~10ms — el handler nunca corre, el costo es solo el `incr` + `decr` en el store.

---

## Cuándo usarlo

| Caso | `keyBy` | `maxConcurrent` |
|------|---------|-----------------|
| Usuario hace doble click en "Pagar" | `'user+route'` | `1` |
| Generación de PDF por usuario | `'user'` | `2` |
| Inferencia de ML (GPU limitada) | `'global'` | `4` |
| Escritura a un archivo compartido | `'global'` | `1` |
| Endpoint costoso por visitante anónimo | `'ip'` | `3` |

---

## Copiar a tu proyecto

1. Copia `concurrency.interceptor.ts` y `concurrent.decorator.ts`
2. Copia `ConcurrencyLimitException` de `security.exception.ts`
3. Copia `RedisStoreService` e `IpExtractorService` de `services/`
4. Registra los servicios en tu módulo:

```typescript
@Module({
  providers: [
    ConcurrencyInterceptor,
    RedisStoreService,
    IpExtractorService,
  ],
})
export class TuModulo {}
```

5. Aplica en tu endpoint:

```typescript
@Post('operacion-costosa')
@Concurrent({ maxConcurrent: 2, keyBy: 'user' })
@UseInterceptors(ConcurrencyInterceptor)
async operacionCostosa() {}
```
