# ApiKeyGuard

Valida el header `x-api-key` contra una lista de keys permitidas. Sin JWT, sin sesión — ideal para comunicación server-to-server, webhooks y acceso programático.

---

## Archivos

```
src/guards/basic/api-key.guard.ts
src/decorators/api-key.decorator.ts
src/exceptions/security.exception.ts  ← InvalidApiKeyException
scripts/generate-api-key.ts
scripts/test-api-key.ts
```

---

## Quick start

```bash
# 1. Genera tu API key (se escribe automáticamente en .env)
npm run generate:api-key

# 2. Levanta el servidor
npm run start:dev

# 3. Prueba el guard
npm run test:api-key
```

---

## Uso

### Env-only (recomendado)

```typescript
@Get('webhook')
@ApiKey({ keys: [] })        // sin hardcodear — usa process.env.API_KEY
@UseGuards(ApiKeyGuard)
@Public()                    // salta JwtAuthGuard global
webhook() {}
```

El cliente envía:
```
GET /webhook
x-api-key: d564d63779f2c41df289f97018056544836bcea110900a68967fe794a23141c1
```

### Multi-key (rotación sin downtime)

```typescript
@Get('internal')
@ApiKey({ keys: ['key-servicio-a', 'key-servicio-b'] })
@UseGuards(ApiKeyGuard)
@Public()
internal() {}
```

Acepta cualquiera de las keys de la lista **y también** `process.env.API_KEY`. Útil para rotar keys: agregas la nueva al env, los clientes migran, eliminas la vieja de la lista.

---

## Opciones

```typescript
export interface ApiKeyOptions {
  keys?: string[];   // keys adicionales — se suman a process.env.API_KEY
}
```

| Campo | Tipo | Default | Descripción |
|-------|------|---------|-------------|
| `keys` | `string[]` | `[]` | Keys hardcodeadas a aceptar, además del env var |

---

## Comportamiento

| Situación | Status | Log |
|-----------|--------|-----|
| Header presente, key válida | `200` | `DEBUG ApiKeyGuard API key accepted` |
| Header presente, key inválida | `401` | `WARN ApiKeyGuard Invalid API key attempt` |
| Sin header `x-api-key` | `401` | `WARN ApiKeyGuard No x-api-key header` |
| Sin keys configuradas y sin env | `401` | `WARN ApiKeyGuard no keys configured` |

---

## Por qué el env var se lee en `canActivate` y no en el decorator

```typescript
// ❌ Esto NO funciona — API_KEY es undefined cuando el decorator se evalúa
@ApiKey({ keys: [process.env.API_KEY] })

// ✅ Esto SÍ funciona — se lee en cada request, después de dotenv
// (el guard lo hace internamente, no tienes que hacer nada extra)
@ApiKey({ keys: [] })
@UseGuards(ApiKeyGuard)
```

Los decorators de TypeScript se evalúan cuando el módulo se importa — antes de que `dotenv.config()` corra en `main.ts`. Por eso el guard lee `process.env.API_KEY` dentro de `canActivate()`, en tiempo de request.

---

## Generar una key

```bash
npm run generate:api-key
```

Genera 32 bytes aleatorios (256 bits, 64 chars hex) y los escribe en `.env`:

```
API_KEY=d564d63779f2c41df289f97018056544836bcea110900a68967fe794a23141c1
```

Si ya existe `API_KEY` en el `.env`, la sobreescribe con una nueva.

---

## Script de prueba

```bash
npm run test:api-key
```

```
✅ [200] Key válida (d564d637...) → PASS
🔐 [401] Key inválida "key-incorrecta" → BLOCKED
🔐 [401] Sin x-api-key header → BLOCKED
✅ [200] "key-servicio-a" → PASS (key hardcodeada)
✅ [200] "key-servicio-b" → PASS (key hardcodeada)
✅ [200] Key del .env en endpoint multi → PASS (env siempre incluida)
🔐 [401] "key-fantasma" en multi → BLOCKED
```

---

## Copiar a tu proyecto

1. Copia `api-key.guard.ts` y `api-key.decorator.ts`
2. Copia `InvalidApiKeyException` de `security.exception.ts`
3. Registra en tu módulo:

```typescript
@Module({
  providers: [ApiKeyGuard],
})
export class TuModulo {}
```

4. Agrega `API_KEY` a tu `.env`
5. Usa `@Public()` si tienes `JwtAuthGuard` global — si no, ignóralo
