# SignatureGuard

Verifica firmas **HMAC-SHA256** en webhooks y APIs internas. Garantiza que el request fue enviado por quien tiene el secreto compartido y que el body no fue modificado en tránsito. Usa comparación timing-safe para prevenir timing attacks.

```
POST /webhook   x-timestamp: 1748394000
                x-signature: HMAC-SHA256("1748394000.{body}")
  → firma válida      ✅ 201
  → firma incorrecta  ❌ 401
  → timestamp viejo   ❌ 401 (replay attack)
  → body modificado   ❌ 401 (integridad)
```

---

## Archivos

```
src/guards/basic/signature.guard.ts
src/decorators/signature.decorator.ts
src/exceptions/security.exception.ts  ← InvalidSignatureException, SignatureMissingException, SignatureExpiredException
scripts/test-signature.ts
```

> **Prerequisito:** `NestFactory.create(AppModule, { rawBody: true })` en `main.ts` — el guard necesita el body crudo (sin parsear) para computar el HMAC.

---

## Quick start

```bash
npm run start:dev
npm run test:signature
```

---

## Uso

### Stripe-style (default — recomendado)

```typescript
@Post('webhook/stripe')
@Signature({ secret: process.env.WEBHOOK_SECRET })
@UseGuards(SignatureGuard)
stripeWebhook(@RawBody() body: Buffer) {}
```

El cliente calcula la firma así:
```typescript
const timestamp = Math.floor(Date.now() / 1000).toString();
const message   = `${timestamp}.${rawBodyString}`;
const sig       = createHmac('sha256', secret).update(message).digest('hex');
// Headers: x-timestamp: timestamp, x-signature: sig
```

### GitHub-style (sha256= prefix, sin timestamp)

```typescript
@Post('webhook/github')
@Signature({
  secret: process.env.GITHUB_SECRET,
  signaturePayload: 'body',
  signatureHeader: 'x-hub-signature-256',
  signaturePrefix: 'sha256=',
  maxTimestampAgeSeconds: 0,  // GitHub no envía timestamp
})
@UseGuards(SignatureGuard)
githubWebhook() {}
```

GitHub calcula: `sha256=` + `HMAC-SHA256(body)`. El guard quita el prefijo antes de comparar.

### Servicio interno (ventana de tiempo estricta)

```typescript
@Post('internal/sync')
@Signature({ secret: process.env.INTERNAL_SECRET, maxTimestampAgeSeconds: 30 })
@UseGuards(SignatureGuard)
sync() {}
// Rechaza requests con más de 30 segundos de antigüedad
```

### Combinado con NonceGuard (protección completa)

```typescript
@Post('transfer')
@Signature({ secret: process.env.WEBHOOK_SECRET })
@Nonce({ ttlMs: 600_000 })
@UseGuards(SignatureGuard, NonceGuard)
transfer() {}
```

```
x-timestamp: 1748394000
x-nonce:     550e8400-e29b-41d4-a716-446655440000
x-signature: HMAC-SHA256("1748394000.{body}.{nonce}")
```

Signature verifica integridad. Nonce garantiza que no es un replay. Juntos cierran los tres vectores: tampering + replay + MitM.

---

## Opciones `@Signature()`

```typescript
export interface SignatureOptions {
  secret:                  string | (() => string | Promise<string>);
  signatureHeader?:        string;   // default: 'x-signature'
  timestampHeader?:        string;   // default: 'x-timestamp'
  signaturePayload?:       'body' | 'timestamp.body' | 'timestamp+body';  // default: 'timestamp.body'
  algorithm?:              'sha256' | 'sha512' | 'sha1';  // default: 'sha256'
  signaturePrefix?:        string;   // default: ''
  encoding?:               'hex' | 'base64';  // default: 'hex'
  maxTimestampAgeSeconds?: number;   // default: 300 (5 min). 0 = sin validación
}
```

| Campo | Default | Descripción |
|-------|---------|-------------|
| `secret` | — | Secreto compartido. Puede ser string o async factory |
| `signatureHeader` | `'x-signature'` | Header que lleva la firma |
| `timestampHeader` | `'x-timestamp'` | Header con el Unix timestamp en segundos |
| `signaturePayload` | `'timestamp.body'` | Qué se firma: solo el body, o timestamp + body |
| `algorithm` | `'sha256'` | Algoritmo HMAC |
| `signaturePrefix` | `''` | Prefijo a quitar de la firma recibida (ej: `'sha256='`) |
| `encoding` | `'hex'` | Codificación del digest |
| `maxTimestampAgeSeconds` | `300` | Ventana de tiempo. `0` desactiva la validación de timestamp |

---

## Por qué `rawBody: true`

NestJS parsea el body como JSON antes de que el guard lo vea. Para calcular el HMAC hay que usar **exactamente los bytes que viajaron por la red** — incluyendo espacios y orden de campos. Si se firma el objeto parseado y re-serializado, los resultados difieren.

```typescript
// main.ts
const app = await NestFactory.create(AppModule, { rawBody: true });
```

Con esto `request.rawBody` es el `Buffer` original. El guard lo convierte a string con `rawBody.toString('utf-8')` antes de calcular el HMAC.

---

## Timing-safe comparison

El guard usa `timingSafeEqual` de Node.js crypto en lugar de `===`:

```typescript
// ❌ Vulnerable — el tiempo de respuesta varía según cuántos bytes coinciden
if (expected === received) { ... }

// ✅ Seguro — tiempo constante sin importar la diferencia
const valid = expectedBuf.length === receivedBuf.length &&
              timingSafeEqual(expectedBuf, receivedBuf);
```

Un atacante que mida el tiempo de respuesta no puede inferir cuánto de su firma era correcta.

---

## Comportamiento

| Situación | Status | Excepción |
|-----------|--------|-----------|
| Firma válida | `2xx` | — |
| Header de firma ausente | `401` | `SignatureMissingException` |
| Timestamp ausente (cuando requerido) | `401` | `SignatureMissingException` |
| Timestamp fuera de ventana | `401` | `SignatureExpiredException` |
| Firma incorrecta | `401` | `InvalidSignatureException` |
| Body modificado | `401` | `InvalidSignatureException` |
| `req.rawBody` undefined | `401` | `InvalidSignatureException` + error en log |

---

## Script de prueba

```bash
npm run test:signature
```

```
── Stripe style  (x-timestamp + x-signature = HMAC(ts.body)) ──

✅ [201] Firma correcta → PASS
🔐 [401] Firma con secret incorrecto → 401
🔐 [401] Replay attack (timestamp 10min viejo) → 401
🔐 [401] Sin header x-signature → 401
🔐 [401] Body modificado tras firmar (integridad) → 401

── GitHub style  (x-hub-signature-256: sha256=HMAC(body)) ──

✅ [201] Firma GitHub correcta → PASS
🔐 [401] Firma GitHub con secret incorrecto → 401
✅ [201] Sin prefijo sha256= → PASS (prefijo es opcional, no obligatorio)
```

> El prefijo `sha256=` se quita si está presente, pero no se exige — GitHub siempre lo envía, por lo que esto no es un problema de seguridad.

---

## Copiar a tu proyecto

1. Copia `signature.guard.ts` y `signature.decorator.ts`
2. Copia `InvalidSignatureException`, `SignatureMissingException`, `SignatureExpiredException` de `security.exception.ts`
3. Habilita `rawBody: true` en `main.ts`:

```typescript
const app = await NestFactory.create(AppModule, { rawBody: true });
```

4. Registra en tu módulo:

```typescript
@Module({
  providers: [SignatureGuard],
})
export class TuModulo {}
```

5. Aplica en tus endpoints:

```typescript
@Post('webhook')
@Signature({ secret: process.env.WEBHOOK_SECRET })
@UseGuards(SignatureGuard)
webhook() {}
```
