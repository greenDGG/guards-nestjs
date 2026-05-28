# TenantGuard

Previene el **acceso cross-tenant** — que un usuario del tenant A acceda a datos del tenant B manipulando la URL. Compara `jwt.tenantId` con el `tenantId` que llega en la request (param, header, body o query). Si no coinciden, el request se rechaza con 403.

```
GET /tenant/tenant-a/data   → JWT tenantId='tenant-a'  ✅
GET /tenant/tenant-b/data   → JWT tenantId='tenant-a'  ❌ 403
```

---

## Archivos

```
src/guards/business/tenant.guard.ts
src/examples/level5-business.controller.ts   ← /demo/level5/tenant/:tenantId/data y strict-data
src/auth/auth.controller.ts                  ← POST /auth/test/tenant-token (solo para tests)
scripts/test-tenant.ts
```

---

## Quick start

```bash
npm run start:dev
npm run test:tenant
```

---

## Uso

### Fuente: URL param (más común)

```typescript
@SetMetadata(GUARD_METADATA.TENANT_OPTIONS, {
  tenantIdSources: ['param'],
  paramName: 'tenantId',
})
@UseGuards(TenantGuard)
@Get(':tenantId/users')
getUsers(@Param('tenantId') tid: string) {}
// GET /acme/users     → JWT tenantId='acme'  ✅
// GET /rival/users    → JWT tenantId='acme'  ❌ 403
```

### Fuente: header (APIs internas)

```typescript
@SetMetadata(GUARD_METADATA.TENANT_OPTIONS, {
  tenantIdSources: ['header'],
  headerName: 'x-tenant-id',
})
@UseGuards(TenantGuard)
@Get('data')
getData() {}
// Header: x-tenant-id: acme  + JWT tenantId='acme'  ✅
```

### Múltiples fuentes — busca en orden

```typescript
@SetMetadata(GUARD_METADATA.TENANT_OPTIONS, {
  tenantIdSources: ['header', 'param', 'query'],
  headerName: 'x-tenant-id',
  paramName: 'tenantId',
})
@UseGuards(TenantGuard)
@Get(':tenantId/settings')
settings() {}
// Busca primero en header, luego en :tenantId, luego en ?tenantId=...
// Usa el primer valor que encuentre
```

### strict: false — útil para migración gradual

```typescript
@SetMetadata(GUARD_METADATA.TENANT_OPTIONS, {
  tenantIdSources: ['param'],
  strict: false,   // si no hay tenantId en el JWT, pasa igual
})
@UseGuards(TenantGuard)
@Get(':tenantId/data')
data() {}
// Útil cuando hay usuarios sin tenantId (legacy) que conviven con multi-tenant
```

---

## Opciones

```typescript
export interface TenantOptions {
  tenantIdSources?: Array<'header' | 'param' | 'body' | 'query'>;
  paramName?:   string;   // default: 'tenantId'
  headerName?:  string;   // default: 'x-tenant-id'
  strict?:      boolean;  // default: true
}
```

| Campo | Default | Descripción |
|-------|---------|-------------|
| `tenantIdSources` | `['header','param','query']` | Dónde buscar el tenantId de la request (en orden) |
| `paramName` | `'tenantId'` | Nombre del route param o body/query field |
| `headerName` | `'x-tenant-id'` | Nombre del header |
| `strict` | `true` | Si `false`, el guard pasa cuando no hay `tenantId` en el JWT |

---

## strict: true vs strict: false

| | `strict: true` (default) | `strict: false` |
|---|---|---|
| JWT sin `tenantId` | `403` | pasa |
| Request sin tenantId | `403` | pasa |
| JWT y request tienen tenant diferente | `403` | `403` |
| JWT y request tienen mismo tenant | `200` | `200` |

Usa `strict: false` durante migración: permite que usuarios legacy (sin `tenantId` en su JWT antiguo) sigan funcionando mientras migras gradualmente.

---

## Comportamiento

| Situación | Status | Log |
|-----------|--------|-----|
| `jwt.tenantId` === request tenantId | `200` | `DEBUG Tenant verified: 'acme' for user X` |
| `jwt.tenantId` !== request tenantId | `403` | `WARN Tenant mismatch: JWT 'acme' vs request 'rival'` |
| Sin `tenantId` en JWT, `strict: true` | `403` | `WARN No tenantId in JWT — denying access` |
| Sin `tenantId` en JWT, `strict: false` | `200` | — |
| Sin tenantId en request, `strict: true` | `403` | `WARN No tenantId in request` |
| Sin `request.user` (sin JWT) | `403` | — |

---

## Script de prueba

```bash
npm run test:tenant
```

```
── GET /demo/level5/tenant/:tenantId/data  (strict: false) ──

✅ [200] JWT tenant-a → /tenant/tenant-a/data  → PASS (match)
🚫 [403] JWT tenant-a → /tenant/tenant-b/data  → BLOCKED (mismatch)
✅ [200] Sin tenantId en JWT → PASS (strict: false, pasa sin tenant)

── GET /demo/level5/tenant/:tenantId/strict-data  (strict: true) ──

✅ [200] JWT tenant-a → /tenant/tenant-a/strict-data → PASS (match)
🚫 [403] JWT tenant-a → /tenant/tenant-b/strict-data → BLOCKED (mismatch)
🚫 [403] Sin tenantId en JWT → BLOCKED (strict: true, requiere tenantId)

── Sin token ──

🔐 [401] Sin token → BLOCKED (JwtAuthGuard corre antes)
```

---

## Copiar a tu proyecto

1. Copia `tenant.guard.ts`
2. Copia `TenantMismatchException` de `business.exception.ts`
3. Registra en tu módulo:

```typescript
@Module({
  providers: [TenantGuard],
})
export class TuModulo {}
```

4. Agrega `tenantId` al JWT durante el login:

```typescript
const payload = {
  sub: user.id,
  username: user.username,
  tenantId: user.tenantId,   // ← del registro del usuario en DB
  ...
};
```

5. Aplica en tus endpoints:

```typescript
@SetMetadata(GUARD_METADATA.TENANT_OPTIONS, {
  tenantIdSources: ['param'],
  paramName: 'tenantId',
})
@UseGuards(TenantGuard)
@Get(':tenantId/data')
getData() {}
```
