# RequestSizeGuard

Bloquea requests cuyo body supera un límite de bytes configurado. Lee el header `Content-Length` **sin bufferizar el body** — costo O(1) independiente del tamaño del payload. Por defecto solo aplica a métodos con body (POST, PUT, PATCH); GET y DELETE se saltan.

---

## Archivos

```
src/guards/security/request-size.guard.ts
src/examples/level2-security.controller.ts   ← endpoint de demo
scripts/test-request-size.ts
```

---

## Quick start

```bash
npm run start:dev
npm run test:request-size
```

---

## Uso

```typescript
@SetMetadata(GUARD_METADATA.REQUEST_SIZE_OPTIONS, { maxBytes: 5_242_880 }) // 5 MB
@UseGuards(RequestSizeGuard)
@Post('upload')
upload() {}
```

---

## Opciones

```typescript
export interface RequestSizeOptions {
  maxBytes:                    number;    // límite en bytes
  rejectMissingContentLength?: boolean;  // default: false
  allowedMethods?:             string[];  // default: ['POST','PUT','PATCH']
}
```

| Campo | Default | Descripción |
|-------|---------|-------------|
| `maxBytes` | `1_048_576` (1 MB) | Límite máximo del body en bytes. La condición es estricta: `size > maxBytes`, así que exactamente `maxBytes` bytes es permitido |
| `rejectMissingContentLength` | `false` | Si `true`, bloquea requests sin `Content-Length` header. Útil para APIs que exigen que el cliente declare el tamaño |
| `allowedMethods` | `['POST','PUT','PATCH']` | Métodos HTTP donde el guard aplica. Sobreescribe el default completo si se provee |

---

## Límite inclusivo

```
maxBytes = 100

  99 bytes → size > 100?  NO  → PASS ✅
 100 bytes → size > 100?  NO  → PASS ✅
 101 bytes → size > 100?  SÍ  → 413 📦
```

---

## Sin bufferización

El guard lee únicamente el header `Content-Length` — nunca bufferiza el stream del body. Esto significa:

- Costo constante O(1) sin importar si el body mide 1 KB o 1 GB
- El body no se consume, el handler lo recibe intacto
- Si el cliente no envía `Content-Length` (chunked transfer encoding), el guard no puede verificar el tamaño a menos que `rejectMissingContentLength: true`

---

## rejectMissingContentLength

```typescript
@SetMetadata(GUARD_METADATA.REQUEST_SIZE_OPTIONS, {
  maxBytes: 10_000,
  rejectMissingContentLength: true,  // ← rechaza chunked / sin Content-Length
})
@UseGuards(RequestSizeGuard)
@Post('strict-upload')
strictUpload() {}
```

Con `false` (default): si no hay `Content-Length` → PASS (el guard no puede saber el tamaño).  
Con `true`: si no hay `Content-Length` → 413.

---

## allowedMethods — override

```typescript
@SetMetadata(GUARD_METADATA.REQUEST_SIZE_OPTIONS, {
  maxBytes: 1_000,
  allowedMethods: ['POST', 'PUT', 'PATCH', 'DELETE'], // añade DELETE
})
@UseGuards(RequestSizeGuard)
@Delete('resource')
deleteWithBody() {}
```

---

## Comportamiento

| Situación | Status |
|-----------|--------|
| `size <= maxBytes` | `200` ✅ |
| `size > maxBytes` | `413` Payload Too Large |
| Sin `Content-Length` (`rejectMissingContentLength: false`) | `200` ✅ |
| Sin `Content-Length` (`rejectMissingContentLength: true`) | `413` |
| Método GET/HEAD/DELETE (default) | `200` (skip) |
| Sin `@SetMetadata` | `200` (default: 1 MB) |

---

## Script de prueba

```bash
npm run test:request-size
```

```
── 1. Body dentro del límite ──

  ✅ [201] 11 bytes   — dentro del límite → PASS
  ✅ [201] 50 bytes   — dentro del límite → PASS
  ✅ [201] 99 bytes   — dentro del límite → PASS

── 2. Body = 100 bytes exactos (límite inclusivo) ──

  ✅ [201] 100 bytes  — 100 bytes = maxBytes → PASS (size > maxBytes es estricto)

── 3. Body > 100 bytes → 413 Payload Too Large ──

  📦 [413] 101 bytes  — > maxBytes → 413
  📦 [413] 200 bytes  — > maxBytes → 413
  📦 [413] 500 bytes  — > maxBytes → 413
```

---

## Copiar a tu proyecto

1. Copia `request-size.guard.ts`
2. Registra en tu módulo:

```typescript
@Module({
  providers: [RequestSizeGuard],
})
export class TuModulo {}
```

3. Aplica en tus endpoints:

```typescript
@SetMetadata(GUARD_METADATA.REQUEST_SIZE_OPTIONS, { maxBytes: 5_242_880 })
@UseGuards(RequestSizeGuard)
@Post('upload')
upload() {}
```
