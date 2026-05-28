# NonceGuard

Un **nonce** (Number used ONCE) garantiza que cada request es único. El servidor almacena el nonce con una TTL — si el mismo nonce llega de nuevo dentro de esa ventana, el request se rechaza como replay attack.

---

## Archivos

```
src/guards/basic/nonce.guard.ts
src/decorators/nonce.decorator.ts
src/exceptions/security.exception.ts  ← ReplayAttackException, NonceMissingException, NonceInvalidException
src/services/redis-store.service.ts   ← setnx atómico para el check-and-set
scripts/test-nonce.ts
```

---

## Quick start

```bash
npm run start:dev
npm run test:nonce
```

---

## Uso

### Solo NonceGuard

```typescript
@Post('payment')
@Nonce()
@UseGuards(NonceGuard)
pay() {}
```

El cliente genera un UUID por cada request:
```
POST /payment
x-nonce: 550e8400-e29b-41d4-a716-446655440000

# Segunda request con el mismo nonce → 401 Replay attack detected
```

### Combinado con SignatureGuard (protección completa)

```typescript
@Post('transfer')
@Signature({ secret: process.env.WEBHOOK_SECRET })
@Nonce({ ttlMs: 600_000 })
@UseGuards(SignatureGuard, NonceGuard)
transfer() {}
```

```
x-timestamp: 1748394000
x-signature: <HMAC-SHA256(timestamp.body.nonce)>
x-nonce:     550e8400-e29b-41d4-a716-446655440000
```

---

## Opciones `@Nonce()`

```typescript
export interface NonceOptions {
  header?:    string;              // default: 'x-nonce'
  ttlMs?:     number;              // default: 600_000 (10 min)
  optional?:  boolean;             // default: false
  minLength?: number;              // default: 16
  scope?:     'user' | 'global';  // default: 'user'
}
```

| Campo | Default | Descripción |
|-------|---------|-------------|
| `header` | `'x-nonce'` | Nombre del header que envía el cliente |
| `ttlMs` | `600_000` | Ventana de tiempo en que el nonce queda bloqueado |
| `optional` | `false` | Si `true`, el endpoint funciona sin el header |
| `minLength` | `16` | Longitud mínima del nonce (protege contra nonces débiles) |
| `scope` | `'user'` | `'user'` — por JWT/IP · `'global'` — todos comparten el mismo espacio |

---

## Cómo funciona el `setnx` atómico

```
Request con nonce "abc123"
    │
    ▼
setnx("nonce:user:42:abc123", "1", ttlMs)
    │
    ├── retorna true  → nonce es nuevo → request pasa
    └── retorna false → nonce ya existe → 401 ReplayAttackException
```

`setnx` (Set if Not eXists) es atómico — si tres requests llegan en paralelo con el mismo nonce, exactamente uno gana. Los otros dos reciben 401, sin importar el orden.

---

## Validación de formato

El guard rechaza nonces malformados antes de consultar el store:

| Condición | Error |
|-----------|-------|
| Header ausente | `NonceMissingException` |
| Longitud < `minLength` (default 16) | `NonceInvalidException` |
| Caracteres no ASCII imprimibles | `NonceInvalidException` |

Un nonce de 5 caracteres podría ser adivinado por fuerza bruta. El mínimo de 16 garantiza suficiente entropía para que sea impráctico.

---

## Nonce vs. Idempotency — la diferencia clave

| | IdempotencyInterceptor | NonceGuard |
|---|---|---|
| Propósito | Evitar doble procesamiento (feature) | Detectar replay attacks (defensa) |
| Mismo request repetido | ✅ Devuelve la misma respuesta cacheada | ❌ 401 Rechazado |
| Quien lo inicia | El cliente a propósito | Un atacante interceptó y repite |
| Qué protege | UX (pagos, mutaciones) | Seguridad (integridad criptográfica) |

---

## Por qué incluir el nonce en la firma HMAC

```typescript
// ❌ Sin nonce en la firma — atacante puede strip el header y reemplazarlo
const sig = hmac(`${timestamp}.${body}`);

// ✅ Nonce incluido en la firma — no puede ser reemplazado sin invalidar la firma
const sig = hmac(`${timestamp}.${body}.${nonce}`);
```

Sin esto, un atacante puede capturar un request válido, quitarle el `x-nonce` y poner uno nuevo — la firma pasa porque no cubre el nonce. Incluyendo el nonce en el payload firmado, los dos headers quedan criptográficamente vinculados.

---

## Script de prueba

```bash
npm run test:nonce
```

```
✅ [201] Nonce nuevo "a108bbd0..." → PASS
🔐 [401] Mismo nonce "a108bbd0..." → REPLAY BLOCKED
🔐 [401] Sin x-nonce header → 401
🔐 [401] Nonce "short" (5 chars < min 16) → 401

── Race condition: 3 paralelas con el mismo nonce ──
✅ [201] Request paralela #1
🔐 [401] Request paralela #2     ← setnx atómico — solo una gana
🔐 [401] Request paralela #3

── Signature + Nonce (combo completo) ──
✅ [201] Firma válida + nonce nuevo → PASS
🔐 [401] Firma válida + mismo nonce → REPLAY BLOCKED
```

---

## Copiar a tu proyecto

1. Copia `nonce.guard.ts` y `nonce.decorator.ts`
2. Copia `ReplayAttackException`, `NonceMissingException`, `NonceInvalidException` de `security.exception.ts`
3. Copia `RedisStoreService` de `services/`
4. Registra en tu módulo:

```typescript
@Module({
  providers: [NonceGuard, RedisStoreService],
})
export class TuModulo {}
```

5. Aplica en tu endpoint:

```typescript
@Post('operacion-critica')
@Nonce({ ttlMs: 600_000, scope: 'user' })
@UseGuards(NonceGuard)
async operacion() {}
```
