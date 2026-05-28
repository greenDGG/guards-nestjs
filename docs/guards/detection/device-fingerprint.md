# DeviceFingerprintGuard

Construye un **hash SHA-256** con headers específicos del navegador del usuario y lo compara contra el fingerprint almacenado en la sesión. Un cambio de fingerprint puede indicar **session hijacking** o un bot que rota su User-Agent.

```
GET /transfer  (Chrome, primera vez)
  → fingerprint calculado y almacenado ✅

GET /transfer  (mismo Chrome)
  → fingerprint coincide ✅

GET /transfer  (Firefox UA inesperado)
  → fingerprint MISMATCH
    onMismatch: 'block'    → 403 FingerprintChangedException
    onMismatch: 'penalize' → 200 + trust score baja 20 puntos
```

---

## Archivos

```
src/guards/detection/device-fingerprint.guard.ts
src/examples/level4-detection.controller.ts   ← 2 endpoints de demo
scripts/test-fingerprint.ts
```

---

## Quick start

```bash
npm run start:dev
npm run test:fingerprint
```

---

## Uso

### Block on mismatch (operaciones sensibles)

```typescript
@SetMetadata(GUARD_METADATA.DEVICE_FP_OPTIONS, { onMismatch: 'block' })
@UseGuards(DeviceFingerprintGuard)
@Post('transfer')
transfer() {}
// Primer request: almacena el fingerprint
// Requests siguientes: compara — si cambia → 403
```

### Penalize on mismatch (monitoreo suave)

```typescript
@SetMetadata(GUARD_METADATA.DEVICE_FP_OPTIONS, {
  onMismatch: 'penalize',
  penaltyAmount: 20,
})
@UseGuards(DeviceFingerprintGuard)
@Get('dashboard')
dashboard() {}
// Mismatch: permite pasar pero baja el trust score en 20 puntos
// AdaptiveRateLimitGuard leerá ese score y ajustará los límites
```

### TTL personalizado

```typescript
@SetMetadata(GUARD_METADATA.DEVICE_FP_OPTIONS, {
  onMismatch: 'block',
  ttlMs: 8 * 60 * 60 * 1000,  // 8 horas
})
@UseGuards(DeviceFingerprintGuard)
```

---

## Opciones

```typescript
export interface DeviceFingerprintOptions {
  onMismatch?:    'block' | 'penalize';  // default: 'block'
  penaltyAmount?: number;                // default: 20 (solo si onMismatch='penalize')
  ttlMs?:         number;                // default: 1_800_000 (30 minutos)
}
```

| Campo | Default | Descripción |
|-------|---------|-------------|
| `onMismatch` | `'block'` | Qué hacer cuando el fingerprint cambia |
| `penaltyAmount` | `20` | Puntos a restar al trust score en modo penalize |
| `ttlMs` | `1_800_000` | Tiempo de vida del fingerprint en el store (ms) |

---

## Cómo se calcula el fingerprint

```typescript
const components = [
  request.headers['user-agent']        ?? '',
  request.headers['accept-language']   ?? '',
  request.headers['accept-encoding']   ?? '',
  ip.split('.').slice(0, 3).join('.'),  // subnet /24
].join('|');

return createHash('sha256').update(components).digest('hex');
```

Los cuatro componentes se concatenan con `|` como separador y se hashean con SHA-256.

### Por qué subnet /24 y no IP exacta

Los dispositivos móviles pueden cambiar de IP dentro del mismo bloque de red del operador. Usar `/24` tolera esos cambios sin generar falsos positivos.

---

## Lógica de evaluación

```
1. ¿Hay user.sub en request?
        ├── NO  → return true (solo monitorea usuarios autenticados)
        └── SÍ  ↓

2. Calcular fingerprint actual (SHA-256 de UA + AcceptLang + AcceptEnc + subnet)
        ↓

3. ¿Existe fingerprint almacenado para este usuario?
        ├── NO  → almacenar fingerprint, return true ✅ (primera request)
        └── SÍ  ↓

4. ¿Fingerprints coinciden?
        ├── SÍ  → refrescar TTL, return true ✅
        └── NO  ↓  (mismatch)

5. onMismatch:
        ├── 'block'    → throw FingerprintChangedException (403)
        └── 'penalize' → restar penaltyAmount al trust score
                         actualizar fingerprint al nuevo valor
                         return true ✅
```

---

## Comportamiento

| Situación | Status | Log |
|-----------|--------|-----|
| Primera request (sin fingerprint guardado) | `200` | `DEBUG Fingerprint stored for user X` |
| Fingerprint coincide | `200` | — |
| Mismatch, `onMismatch: 'block'` | `403` | `WARN Fingerprint mismatch for user X` |
| Mismatch, `onMismatch: 'penalize'` | `200` | `WARN Fingerprint mismatch for user X` |
| Usuario sin JWT | `200` | — (guard no aplica) |

---

## Script de prueba

```bash
npm run test:fingerprint
```

```
── Scenario: onMismatch = "block"  (user) ──

✅ [200] Primera request (Chrome UA) → fingerprint almacenado
✅ [200] Segunda request (mismo Chrome UA) → fingerprint coincide
🚫 [403] Tercera request (Firefox UA) → fingerprint MISMATCH → bloqueado

  Error: Device fingerprint mismatch detected. Session may have been compromised.

── Scenario: onMismatch = "penalize"  (admin) ──

  Trust score inicial: 75
✅ [200] Primera request (Chrome UA) → fingerprint almacenado
  Trust score después del primer request: 75
✅ [200] Segunda request (Firefox UA) → fingerprint MISMATCH → penaliza pero pasa ✅

  Trust score después del mismatch: 55  (↓ bajó 20 puntos)
✅ [200] Tercera request (Firefox UA) → nuevo fingerprint guardado → coincide
```

---

## Copiar a tu proyecto

1. Copia `device-fingerprint.guard.ts`
2. Registra en tu módulo:

```typescript
@Module({
  providers: [DeviceFingerprintGuard, RedisStoreService, IpExtractorService],
})
export class TuModulo {}
```

3. Aplica en tus endpoints sensibles:

```typescript
@SetMetadata(GUARD_METADATA.DEVICE_FP_OPTIONS, { onMismatch: 'block' })
@UseGuards(DeviceFingerprintGuard)
@Post('transfer')
transfer() {}
```
