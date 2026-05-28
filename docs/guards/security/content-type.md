# ContentTypeGuard

Valida que requests con body declaren un `Content-Type` permitido. Los parámetros del header (`charset`, `boundary`, etc.) se eliminan antes de la comparación. Las requests sin body (GET, HEAD, DELETE, OPTIONS) se saltan automáticamente.

---

## Archivos

```
src/guards/security/content-type.guard.ts
src/examples/level2-security.controller.ts   ← endpoint de demo
scripts/test-content-type.ts
```

---

## Quick start

```bash
npm run start:dev
npm run test:content-type
```

---

## Uso

```typescript
@SetMetadata(GUARD_METADATA.CONTENT_TYPE_OPTIONS, {
  allowed: ['application/json'],
})
@UseGuards(ContentTypeGuard)
@Post('create')
create(@Body() body: any) {}
```

Con múltiples tipos permitidos:

```typescript
@SetMetadata(GUARD_METADATA.CONTENT_TYPE_OPTIONS, {
  allowed: ['application/json', 'multipart/form-data'],
})
@UseGuards(ContentTypeGuard)
@Post('upload')
upload() {}
```

---

## Opciones

```typescript
export interface ContentTypeOptions {
  allowed:         string[];    // tipos MIME aceptados
  skipForMethods?: string[];    // métodos HTTP que se saltan (override del default)
}
```

| Campo | Default | Descripción |
|-------|---------|-------------|
| `allowed` | — | Lista de tipos MIME aceptados (case-insensitive) |
| `skipForMethods` | `['GET','HEAD','DELETE','OPTIONS']` | Métodos donde el guard no aplica. Sobreescribe el default completo si se provee |

---

## Strip de parámetros

El guard elimina los parámetros antes de comparar:

```
"application/json; charset=utf-8"  →  "application/json"  ✅
"multipart/form-data; boundary=X"  →  "multipart/form-data" ✅
"text/plain"                        →  "text/plain"          🚫 (si no está en allowed)
```

La comparación se hace en lowercase. `Content-Type: Application/JSON` funciona.

---

## Flujo de decisión

```
1. ¿Hay @SetMetadata con CONTENT_TYPE_OPTIONS?   No → PASS
2. ¿El método está en skipForMethods?             Sí → PASS
3. ¿Tiene header Content-Type?                    No → 403 InvalidContentTypeException
4. Strip parámetros, lowercase
5. ¿Está en allowed?                              No → 403 InvalidContentTypeException
6. PASS
```

---

## Comportamiento

| Situación | Status | Excepción |
|-----------|--------|-----------|
| `application/json` (en allowed) | `200` | — |
| `application/json; charset=utf-8` | `200` | — (parámetros ignorados) |
| `text/plain` (no en allowed) | `403` | `InvalidContentTypeException` |
| Sin `Content-Type` header | `403` | `InvalidContentTypeException` |
| Método GET/HEAD/DELETE | `200` | — (skip automático) |
| Sin `@SetMetadata` | `200` | — (guard no aplica) |

---

## Script de prueba

```bash
npm run test:content-type
```

```
── 1. Content-Type válido ──

  ✅ [201] application/json  — tipo exacto → aceptado

── 2. Content-Type con parámetros (strip) ──

  ✅ [201] application/json; charset=utf-8   — charset ignorado → aceptado
  ✅ [201] application/json; boundary=something  — parámetros ignorados → aceptado

── 3. Content-Type no permitido → 403 ──

  🚫 [403] application/x-www-form-urlencoded  — 403 esperado
  🚫 [403] application/xml  — 403 esperado
  🚫 [403] text/plain  — 403 esperado

── 4. Content-Type ausente → 403 ──

  🚫 [403] (sin Content-Type header)  — 403 esperado
```

---

## Copiar a tu proyecto

1. Copia `content-type.guard.ts`
2. Registra en tu módulo:

```typescript
@Module({
  providers: [ContentTypeGuard],
})
export class TuModulo {}
```

3. Aplica en tus endpoints:

```typescript
@SetMetadata(GUARD_METADATA.CONTENT_TYPE_OPTIONS, {
  allowed: ['application/json'],
})
@UseGuards(ContentTypeGuard)
@Post('action')
action() {}
```
