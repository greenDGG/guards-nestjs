# IdempotencyInterceptor

Garantiza que una operación se ejecute **exactamente una vez**, sin importar cuántas veces el cliente envíe el mismo request. Previene doble pago, doble mutación y race abuse en endpoints críticos.

---

## Por qué es un interceptor y no un guard

Un guard solo corre **antes** del handler. Para implementar idempotencia necesitamos dos cosas:

1. **Antes** — verificar si la key ya fue procesada y hacer replay, o adquirir el lock
2. **Después** — capturar la respuesta del handler y cachearla

Los interceptors envuelven ambos lados. Los guards no pueden hacer el paso 2.

---

## Archivos

```
src/guards/basic/idempotency.interceptor.ts
src/decorators/idempotency.decorator.ts
src/exceptions/security.exception.ts  ← IdempotencyKeyMissingException, IdempotencyConflictException
src/services/redis-store.service.ts   ← store de respuestas y locks
scripts/test-idempotency.ts
```

---

## Quick start

```bash
npm run start:dev
npm run test:idempotency
```

---

## Uso

```typescript
import { Idempotent } from '../decorators/idempotency.decorator';
import { IdempotencyInterceptor } from '../guards/basic/idempotency.interceptor';

@Post('payment')
@Idempotent()
@UseInterceptors(IdempotencyInterceptor)
async pay(@Body() dto: PayDto) {
  return this.paymentsService.charge(dto);   // solo ejecuta si la key es nueva
}
```

El cliente envía:
```
POST /payment
Idempotency-Key: 550e8400-e29b-41d4-a716-446655440000
Content-Type: application/json

{ "amount": 100, "currency": "USD" }
```

Segunda request con la misma key → devuelve la misma respuesta sin volver a cobrar.

---

## Opciones `@Idempotent()`

```typescript
export interface IdempotencyOptions {
  header?:      string;   // default: 'idempotency-key'
  ttlMs?:       number;   // default: 86_400_000  (24h)
  lockTtlMs?:   number;   // default: 30_000      (30s)
  optional?:    boolean;  // default: false
  scopeByUser?: boolean;  // default: true
}
```

| Campo | Default | Descripción |
|-------|---------|-------------|
| `header` | `'idempotency-key'` | Nombre del header que el cliente debe enviar |
| `ttlMs` | `86_400_000` | Cuánto tiempo se guarda la respuesta cacheada |
| `lockTtlMs` | `30_000` | TTL del lock para requests en vuelo (safety net) |
| `optional` | `false` | Si `true`, el endpoint funciona sin el header |
| `scopeByUser` | `true` | Scope por JWT sub — previene key hijacking entre usuarios |

---

## Los 4 escenarios

```
Request llega con Idempotency-Key: <uuid>
    │
    ├── KEY YA CACHEADA  → replay respuesta guardada (handler NO corre)
    │                       Idempotency-Replayed: true en headers
    │
    ├── KEY EN LOCK      → 409 Conflict (otro request con esa key está en vuelo)
    │
    ├── KEY NUEVA        → adquiere lock → corre handler → cachea respuesta → libera lock
    │
    └── SIN KEY          → 400 Bad Request (o skip si optional: true)
```

### Si el handler falla

El lock se libera pero la respuesta **no se cachea**. El cliente puede corregir y reintentar con la misma key — esta vez se procesará de nuevo.

---

## Scoping por usuario

Por defecto (`scopeByUser: true`) la key se prefija con el `jwt.sub`:

```
idmp:res:user-42:550e8400-...   ← solo usuario 42 puede hacer replay de esta key
idmp:lock:user-42:550e8400-...
```

Sin esto, un atacante podría enviar la misma key que una víctima y obtener su respuesta. Usa `scopeByUser: false` solo en endpoints públicos (sin JWT).

---

## Response headers

```
Idempotency-Key: 550e8400-e29b-41d4-a716-446655440000
Idempotency-Replayed: true      ← solo en respuestas cacheadas
```

El cliente puede detectar si la respuesta es un replay verificando `Idempotency-Replayed`.

---

## Script de prueba

```bash
npm run test:idempotency
```

```
✅ [201] Primera request
         transactionId=txn_so0rwdna  replayed=false

✅ [201] Replay ✓
         transactionId=txn_so0rwdna  replayed=true  same=true    ← mismo txnId

⚡ [409] Request #2  (paralela con mismo key)
         Conflict — lock held by concurrent request

⚡ [409] Request #3  (paralela con mismo key)
         Conflict — lock held by concurrent request

❌ [400] Sin header → 400 Bad Request

✅ [201] Key diferente → nuevo procesamiento ✓
         transactionId=txn_p0lekhao  diferente=true              ← nuevo txnId
```

El `transactionId` es el mismo en el replay — prueba que el handler no corrió dos veces.

---

## Cuándo usarlo

| Caso | Riesgo sin idempotencia |
|------|------------------------|
| Pagos / cobros | Cobro doble si la red falla y el cliente reintenta |
| Creación de recursos | Recursos duplicados por doble submit |
| Envío de emails/notificaciones | Usuario recibe el mismo email dos veces |
| Transferencias bancarias | Transferencia duplicada |

---

## Copiar a tu proyecto

1. Copia `idempotency.interceptor.ts` y `idempotency.decorator.ts`
2. Copia `IdempotencyKeyMissingException` e `IdempotencyConflictException` de `security.exception.ts`
3. Copia `RedisStoreService` de `services/`
4. Registra en tu módulo:

```typescript
@Module({
  providers: [IdempotencyInterceptor, RedisStoreService],
})
export class TuModulo {}
```

5. Aplica en tu endpoint:

```typescript
@Post('payment')
@Idempotent({ ttlMs: 86_400_000, scopeByUser: true })
@UseInterceptors(IdempotencyInterceptor)
async pay(@Body() dto: PayDto) {}
```
