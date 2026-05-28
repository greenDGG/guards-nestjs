# ReplayProtectionGuard

Protección completa contra replay attacks en un solo guard: **timestamp + nonce + firma HMAC-SHA256**, donde el nonce es parte del mensaje firmado.

```
Sin protección:
  Atacante intercepta POST /transfer { amount: 1000 }
  → lo reenvía 10 veces → 10 transferencias procesadas

Con SignatureGuard + NonceGuard por separado:
  Atacante puede reemplazar x-nonce por uno fresco:
  → firma sigue siendo válida (nonce no está en el payload firmado)
  → nonce check pasa con el nonce nuevo → transferencia procesada

Con ReplayProtectionGuard:
  Firma cubre timestamp.nonce.body
  → reemplazar el nonce cambia el mensaje → firma inválida → bloqueado
```

---

## Archivos

```
src/guards/basic/replay-protection.guard.ts
src/decorators/replay-protection.decorator.ts
src/examples/level2-security.controller.ts
scripts/test-replay-protection.ts
```

---

## Quick start

```bash
npm run start:dev
npm run test:replay-protection
```

---

## Cómo funciona

El guard valida tres capas en orden:

```
1. x-timestamp  → debe estar dentro de maxAgeSeconds (5min por defecto)
                   Protege contra ataques deferred (guardar y reenviar después)

2. x-signature  → HMAC-SHA256(secret, `${timestamp}.${nonce}.${body}`)
   ↳ validación ANTES que el nonce para no quemar nonces en requests con firma inválida
   ↳ comparación timing-safe (timingSafeEqual) — inmune a timing attacks

3. x-nonce      → setnx en RedisStoreService con TTL = nonceTtlMs (10min por defecto)
                   Si ya existe → ReplayAttackException
```

---

## Uso

```typescript
@ReplayProtect({ secret: process.env.API_SECRET })
@UseGuards(ReplayProtectionGuard)
@Post('transfer')
transfer(@Body() dto: TransferDto) {}
```

---

## Opciones

```typescript
export interface ReplayProtectionOptions {
  secret:            string | (() => string | Promise<string>);
  maxAgeSeconds?:    number;  // default: 300  (5 min)
  nonceTtlMs?:       number;  // default: 600_000 (10 min)
  timestampHeader?:  string;  // default: 'x-timestamp'
  nonceHeader?:      string;  // default: 'x-nonce'
  signatureHeader?:  string;  // default: 'x-signature'
}
```

| Campo | Default | Descripción |
|-------|---------|-------------|
| `secret` | — | HMAC secret. Function async soportada para secrets managers |
| `maxAgeSeconds` | `300` | Ventana de tiempo máxima. Requests fuera de esta ventana son rechazadas |
| `nonceTtlMs` | `600_000` | TTL del nonce en el store. Debe ser `>= maxAgeSeconds × 1000` |
| `timestampHeader` | `'x-timestamp'` | Header con Unix timestamp en segundos |
| `nonceHeader` | `'x-nonce'` | Header con el nonce único de la request |
| `signatureHeader` | `'x-signature'` | Header con el HMAC hex |

---

## Cliente (Node.js)

```typescript
import { createHmac, randomBytes } from 'crypto';

const secret    = process.env.API_SECRET;
const timestamp = Math.floor(Date.now() / 1000).toString();
const nonce     = randomBytes(16).toString('hex');
const body      = JSON.stringify({ amount: 100, to: 'alice' });

const sig = createHmac('sha256', secret)
  .update(`${timestamp}.${nonce}.${body}`)
  .digest('hex');

await fetch('/api/transfer', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-timestamp':  timestamp,
    'x-nonce':      nonce,
    'x-signature':  sig,
  },
  body,
});
```

---

## Diferencias con otros guards

| Guard | Timestamp | Nonce en firma | Nonce único | Uso |
|-------|-----------|---------------|-------------|-----|
| `NonceGuard` | ❌ | — | ✅ | Prevención básica de replay |
| `SignatureGuard` | ✅ | ❌ | ❌ | Integridad de webhooks |
| `SignatureGuard + NonceGuard` | ✅ | ❌ | ✅ | Bueno, pero nonce es swappable |
| `ReplayProtectionGuard` | ✅ | ✅ | ✅ | Fintech / alta criticidad |

**El nonce-swap attack:**

```
Con SignatureGuard + NonceGuard por separado:
  Firma = HMAC(secret, "timestamp.body")   ← nonce NO está en la firma

  Atacante intercepta:  x-timestamp=T  x-nonce=N1  x-signature=S
  Atacante reenvía con: x-timestamp=T  x-nonce=N2  x-signature=S  ← nonce cambiado
  → La firma sigue siendo válida (no cubre el nonce)
  → N2 es fresco → pasa el nonce check
  → ✅ replay exitoso

Con ReplayProtectionGuard:
  Firma = HMAC(secret, "timestamp.nonce.body")   ← nonce SÍ está en la firma

  Atacante cambia N1 → N2
  → El mensaje firmado cambia → la firma no cuadra → ❌ bloqueado
```

---

## Comportamiento

| Situación | Status |
|-----------|--------|
| Todos los headers presentes, firma válida, nonce fresco | `200` |
| Falta cualquier header | `401` |
| Timestamp fuera de ventana (> maxAgeSeconds) | `401` |
| Firma inválida o body modificado | `401` |
| Nonce ya visto | `401` Replay attack detected |
| Sin `@SetMetadata` / `@ReplayProtect` | pasa sin verificar |

---

## Requiere rawBody

```typescript
// main.ts — ya habilitado en este proyecto
const app = await NestFactory.create(AppModule, { rawBody: true });
```

Sin `rawBody: true`, el guard no puede comparar el body original con la firma y lanzará `InvalidSignatureException`.

---

## Script de prueba

```bash
npm run test:replay-protection
```

```
── Resultados ──

  ✅  Request válida                        →  200  201  timestamp + nonce + firma verificados
  ✅  Replay exacto (mismo nonce)           →  401  Replay attack detected: this nonce...
  ✅  Timestamp vencido (>5min)             →  401  Request timestamp too old (max 300s)...
  ✅  Firma corrupta                        →  401  Invalid request signature
  ✅  Body modificado post-firma            →  401  Invalid request signature
  ✅  Nonce reemplazado (nonce swap attack) →  401  Invalid request signature
  ✅  Falta x-signature header             →  401  Missing required header: x-signature

── Por qué el nonce-swap attack falla ──

  SignatureGuard firma: timestamp.body
  → atacante puede quitar x-nonce y poner uno fresco
  → firma válida + nonce pasa el check → ✅ ataque exitoso

  ReplayProtectionGuard firma: timestamp.nonce.body
  → reemplazar el nonce cambia el mensaje firmado
  → firma ya no cuadra → ❌ ataque bloqueado
```

---

## Copiar a tu proyecto

1. Copia `replay-protection.guard.ts` y `replay-protection.decorator.ts`
2. Necesita `RedisStoreService` — copia también `services/redis-store.service.ts`
3. Registra en tu módulo:

```typescript
@Module({
  providers: [ReplayProtectionGuard, RedisStoreService],
})
export class TuModulo {}
```

4. Aplica en endpoints críticos:

```typescript
@ReplayProtect({ secret: process.env.API_SECRET })
@UseGuards(ReplayProtectionGuard)
@Post('transfer')
transfer() {}
```

> **Nota**: No uses `ReplayProtectionGuard` en endpoints que ya tengan `SignatureGuard + NonceGuard` — sería redundante. Elige uno u otro.
