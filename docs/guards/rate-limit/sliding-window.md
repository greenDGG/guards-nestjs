# SlidingWindowRateLimitGuard

Limita requests usando un **algoritmo de ventana deslizante** basado en timestamps. Más preciso que un rate limiter de ventana fija — elimina el burst de límite que ocurre cuando dos ventanas se solapan.

```
Ventana fija (problema):
  T=0       T=10      T=20
  [███████░] [███████░] ← burst 2×max en T=9~T=11
   5 req       5 req

Ventana deslizante (solución):
  Siempre mira los últimos windowMs milisegundos.
  En cualquier momento: requests en [now-windowMs, now] ≤ max
```

---

## Archivos

```
src/guards/rate-limit/sliding-window-rate-limit.guard.ts
src/examples/level3-rate-limit.controller.ts   ← dos endpoints de demo
scripts/test-sliding-window.ts
```

---

## Quick start

```bash
npm run start:dev
npm run test:sliding-window
```

---

## Uso

```typescript
@SetMetadata(GUARD_METADATA.RATE_LIMIT_OPTIONS, {
  windowMs: 60_000,  // ventana de 1 minuto
  max: 10,           // máximo 10 requests por ventana
  keyBy: 'user',     // scope por usuario autenticado
})
@UseGuards(SlidingWindowRateLimitGuard)
@Post('checkout')
checkout() {}
```

---

## Opciones

```typescript
export interface SlidingWindowOptions {
  windowMs:       number;                             // tamaño de la ventana en ms
  max:            number;                             // máximo de requests en la ventana
  keyBy?:         'ip' | 'user' | 'custom';           // default: 'ip'
  keyGenerator?:  (req: Request) => string;           // solo si keyBy = 'custom'
  skipIf?:        (req: Request) => boolean;          // predicado para saltar el guard
}
```

| Campo | Default | Descripción |
|-------|---------|-------------|
| `windowMs` | — | Tamaño de la ventana deslizante en milisegundos |
| `max` | — | Número máximo de requests permitidas dentro de la ventana |
| `keyBy` | `'ip'` | `'ip'` usa la IP del cliente; `'user'` usa `jwt.sub`; `'custom'` usa `keyGenerator` |
| `keyGenerator` | — | Función personalizada que recibe el `Request` y devuelve el string clave |
| `skipIf` | — | Si devuelve `true`, el guard deja pasar sin contar la request |

---

## Headers de respuesta

El guard siempre añade estos headers (incluso cuando bloquea):

| Header | Descripción |
|--------|-------------|
| `X-RateLimit-Limit` | Límite máximo configurado (`max`) |
| `X-RateLimit-Remaining` | Requests restantes en la ventana actual |
| `X-RateLimit-Reset` | Unix timestamp (segundos) en que expira la request más antigua de la ventana |
| `Retry-After` | Solo en 429 — segundos hasta que la request bloqueada pueda reintentarse |

---

## Algoritmo

```
1. Leer lista de timestamps del store: lrange(key, 0, -1)
2. Filtrar timestamps con ts > now - windowMs  ← ventana deslizante
3. count = timestamps.length
4. Si count >= max:
     → setHeader('Retry-After', ...)
     → throw RateLimitExceededException(429)
5. Registrar timestamp actual: lpush(key, now)
6. Reconstruir la lista sólo con timestamps válidos (poda)
7. expire(key, windowMs * 2)
```

El store key tiene la forma:
- `rateLimit:ip:<ip>` — por IP
- `rateLimit:user:<sub>` — por JWT `sub` (o `anonymous` si no hay usuario)
- `rateLimit:<custom>` — con `keyGenerator`

---

## Diferencia con ventana fija

```
Escenario: max=5 / 10s
          T=8   envías 5 req → 5/5 OK
          T=10  nueva ventana fija → contador a 0
          T=11  envías 5 req más → 5/5 OK  ← 10 req en 3s 🚨

Ventana deslizante:
          T=8   envías 5 req → 5/5 OK
          T=11  la ventana mira [T=1..T=11] → 5 req de T=8 aún dentro → BLOCK 🛑
          T=19  la ventana mira [T=9..T=19] → todas caducaron → 1/5 OK ✅
```

---

## keyBy: 'custom' — ejemplo

```typescript
@SetMetadata(GUARD_METADATA.RATE_LIMIT_OPTIONS, {
  windowMs: 60_000,
  max: 3,
  keyBy: 'custom',
  keyGenerator: (req) => `tenant:${req.headers['x-tenant-id']}`,
})
@UseGuards(SlidingWindowRateLimitGuard)
@Post('webhook')
webhook() {}
// Límite por tenant, no por IP
```

---

## skipIf — ejemplo (excluir IPs internas)

```typescript
@SetMetadata(GUARD_METADATA.RATE_LIMIT_OPTIONS, {
  windowMs: 60_000,
  max: 100,
  skipIf: (req) => req.ip?.startsWith('10.') ?? false,
})
@UseGuards(SlidingWindowRateLimitGuard)
@Get('metrics')
metrics() {}
// Tráfico interno no consume el límite
```

---

## Comportamiento

| Situación | Status | Headers añadidos |
|-----------|--------|-----------------|
| Dentro del límite | `200` | `X-RateLimit-*` |
| Límite exacto alcanzado | `429` | `X-RateLimit-*` + `Retry-After` |
| `skipIf` devuelve `true` | `200` | ninguno |
| Sin `@SetMetadata` | `200` | ninguno (guard no aplica) |

---

## Script de prueba

```bash
npm run test:sliding-window
```

```
── 1. max=5 / 10s por IP — requests que pasan ──

  Request #1  ✅ [200]  limit=5  remaining=4  reset=...s
  Request #2  ✅ [200]  limit=5  remaining=3  reset=...s
  Request #3  ✅ [200]  limit=5  remaining=2  reset=...s
  Request #4  ✅ [200]  limit=5  remaining=1  reset=...s
  Request #5  ✅ [200]  limit=5  remaining=0  reset=...s

── 2. Request #6 — límite excedido (429) ──

  Request #6  ❌ [429]  limit=5  remaining=0  reset=...s  retry-after=10s

── 3. Esperando 11s para que la ventana de 10s expire ──

── 4. Ventana expirada — request pasa de nuevo ──

  Request #7  ✅ [200]  limit=5  remaining=4  reset=...s

── 5. max=3 / 5s por usuario (anónimo) ──

  Request #1  ✅ [200]  limit=3  remaining=2  reset=...s
  Request #2  ✅ [200]  limit=3  remaining=1  reset=...s
  Request #3  ✅ [200]  limit=3  remaining=0  reset=...s
  Request #4  ❌ [429]  limit=3  remaining=0  reset=...s  retry-after=5s
```

---

## Copiar a tu proyecto

1. Copia `sliding-window-rate-limit.guard.ts`
2. Asegúrate de tener `RedisStoreService` e `IpExtractorService` (o copia también `redis-store.service.ts` e `ip-extractor.service.ts`)
3. Registra en tu módulo:

```typescript
@Module({
  providers: [SlidingWindowRateLimitGuard, RedisStoreService, IpExtractorService],
})
export class TuModulo {}
```

4. Aplica en tus endpoints:

```typescript
@SetMetadata(GUARD_METADATA.RATE_LIMIT_OPTIONS, {
  windowMs: 60_000,
  max: 10,
  keyBy: 'user',
})
@UseGuards(SlidingWindowRateLimitGuard)
@Post('action')
action() {}
```
