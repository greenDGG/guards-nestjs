# CorsGuard

Valida el header `Origin` contra una allowlist **por ruta**. Complementa (no reemplaza) el CORS global de NestJS cuando se necesitan políticas distintas por endpoint — por ejemplo, exponer un endpoint público a `*.partner.com` mientras el resto de la API solo acepta `app.mycompany.com`.

---

## Archivos

```
src/guards/security/cors.guard.ts
src/examples/level2-security.controller.ts   ← endpoint de demo
scripts/test-cors.ts
```

---

## Quick start

```bash
npm run start:dev
npm run test:cors
```

---

## Uso

```typescript
@SetMetadata(GUARD_METADATA.CORS_OPTIONS, {
  allowedOrigins: ['https://myapp.com', /\.myapp\.com$/],
  allowCredentials: true,
})
@UseGuards(CorsGuard)
@Get('user-data')
userData() {}
```

---

## Opciones

```typescript
export interface CorsGuardOptions {
  allowedOrigins:      Array<string | RegExp>;  // exacto o RegExp
  allowCredentials?:   boolean;                  // default: false
  allowPrivateNetwork?: boolean;                 // default: false
}
```

| Campo | Default | Descripción |
|-------|---------|-------------|
| `allowedOrigins` | — | Lista de strings exactos o RegExp contra el que se compara `Origin` |
| `allowCredentials` | `false` | Si `true`, añade `Access-Control-Allow-Credentials: true` |
| `allowPrivateNetwork` | `false` | Si `true`, añade `Access-Control-Allow-Private-Network: true` (Chrome Private Network Access) |

---

## Comparación de orígenes

```typescript
allowedOrigins: [
  'https://myapp.com',          // string — coincidencia exacta
  /\.myapp\.com$/,              // RegExp — cualquier subdominio
  'http://localhost:3000',      // string — puerto es parte del origen
]
```

- **String**: `origin === pattern` — el puerto, esquema y host deben coincidir exactamente.
- **RegExp**: `pattern.test(origin)` — permite wildcards y subdominios.

```
'https://myapp.com'     → ✅ (exacto)
'https://api.myapp.com' → ✅ (RegExp /.myapp.com$/)
'https://notmyapp.com'  → 🚫 (no termina en .myapp.com)
'http://myapp.com'      → 🚫 (esquema distinto — http vs https)
'https://myapp.com:8080'→ 🚫 (puerto distinto)
```

---

## Headers de respuesta

Cuando el origen es permitido, el guard añade:

| Header | Valor |
|--------|-------|
| `Access-Control-Allow-Origin` | El `Origin` de la request (reflejo dinámico) |
| `Access-Control-Allow-Credentials` | `true` (solo si `allowCredentials: true`) |
| `Access-Control-Allow-Private-Network` | `true` (solo si `allowPrivateNetwork: true`) |

En preflight (OPTIONS), se añaden además:

| Header | Valor |
|--------|-------|
| `Access-Control-Allow-Methods` | `GET,POST,PUT,PATCH,DELETE,OPTIONS` |
| `Access-Control-Allow-Headers` | `Content-Type,Authorization,x-api-key` |

---

## Flujo de decisión

```
1. ¿Hay @SetMetadata con CORS_OPTIONS?        No → PASS
2. ¿Tiene header Origin?                      No → PASS (same-origin / server-to-server)
3. ¿Origin en allowedOrigins?                 No → 403 CorsOriginBlockedException
4. Sí → setHeader(ACAO, origin)
5. ¿allowCredentials?                         Sí → setHeader(ACAC, true)
6. ¿Método OPTIONS (preflight)?               Sí → 204 + headers de preflight + return false
7. PASS
```

---

## Preflight (OPTIONS)

El guard tiene lógica de preflight integrada (responde 204 + headers), pero **solo se activa si NestJS enruta la request OPTIONS al handler**. Con `@Get` o `@Post`, NestJS devuelve 404 antes de que el guard corra.

Para que el preflight funcione a través del guard, usa `@All()` o `@Options()`:

```typescript
@All('resource')
@SetMetadata(GUARD_METADATA.CORS_OPTIONS, {
  allowedOrigins: ['https://myapp.com'],
})
@UseGuards(CorsGuard)
resource() { ... }
// OPTIONS desde myapp.com → guard intercept → 204 + CORS headers
```

En la mayoría de proyectos NestJS el preflight ya está cubierto por el CORS global (`app.enableCors()`). Este guard es para validación adicional en la request real, no para reemplazar el middleware de preflight.

---

## Comportamiento

| Situación | Status | Headers |
|-----------|--------|---------|
| Sin `Origin` header | `200` | ninguno |
| `Origin` en allowlist (string) | `200` | `ACAO` + `ACAC` (si aplica) |
| `Origin` en allowlist (RegExp) | `200` | `ACAO` + `ACAC` (si aplica) |
| `Origin` fuera de allowlist | `403` | ninguno |
| OPTIONS en ruta `@All`/`@Options` | `204` | headers de preflight |
| OPTIONS en ruta `@Get` | `404` | (NestJS no enruta — guard no corre) |

---

## Script de prueba

```bash
npm run test:cors
```

```
── 1. Sin header Origin → PASS (same-origin / server-to-server) ──

  ✅ [200] (sin Origin header)  — (sin headers CORS)

── 2. Orígenes exactos en allowlist → PASS ──

  ✅ [200] Origin: http://localhost:3000  — ACAO=http://localhost:3000  ACAC=true
  ✅ [200] Origin: http://localhost:4200  — ACAO=http://localhost:4200  ACAC=true

── 3. Orígenes vía RegExp (/\.example\.com$/) → PASS ──

  ✅ [200] Origin: http://api.example.com   — ACAO=http://api.example.com  ACAC=true
  ✅ [200] Origin: https://app.example.com  — ACAO=https://app.example.com ACAC=true

── 4. Orígenes fuera de la allowlist → 403 ──

  🚫 [403] Origin: http://evil.com
  🚫 [403] Origin: http://notexample.com
  🚫 [403] Origin: http://localhost:9999

── 5. Preflight OPTIONS — nota de comportamiento ──

  ⚠️  [404] OPTIONS preflight a ruta @Get  — @Get no enruta OPTIONS
  ℹ️  La lógica preflight aplica cuando la ruta usa @All() o @Options()
```

---

## Copiar a tu proyecto

1. Copia `cors.guard.ts`
2. Registra en tu módulo:

```typescript
@Module({
  providers: [CorsGuard],
})
export class TuModulo {}
```

3. Aplica en tus endpoints:

```typescript
@SetMetadata(GUARD_METADATA.CORS_OPTIONS, {
  allowedOrigins: ['https://myapp.com', /\.partner\.com$/],
  allowCredentials: true,
})
@UseGuards(CorsGuard)
@Get('data')
data() {}
```
