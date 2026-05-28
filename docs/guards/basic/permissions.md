# PermissionsGuard

Control de acceso basado en permisos (**PBAC**). Verifica que el usuario tenga **todos** los permisos requeridos — lógica **AND**. Los resultados se cachean para evitar consultas repetidas a base de datos.

```
GET /delete-post  (permisos: ['posts:update', 'posts:delete'])
  → admin (tiene ambos)                  ✅ 200
  → user  (tiene posts:create, no delete) ❌ 403
  → guest (solo posts:read)              ❌ 403
```

---

## Archivos

```
src/guards/basic/permissions.guard.ts
src/decorators/permissions.decorator.ts
src/services/permissions.service.ts
src/services/permissions-cache.service.ts
scripts/test-permissions.ts
```

---

## Quick start

```bash
npm run start:dev
npm run test:permissions
```

---

## Uso

### Permiso único

```typescript
@Permissions(['users:read'])
@Get('users')
listUsers() {}
// Solo usuarios con 'users:read' pueden entrar
```

### Múltiples permisos (AND)

```typescript
@Permissions(['posts:update', 'posts:delete'])
@Delete('posts/:id')
deletePost() {}
// El usuario necesita AMBOS permisos: posts:update Y posts:delete
// Si tiene uno pero no el otro → 403
```

### Convención de nombres recomendada

```typescript
// recurso:accion
'users:read'    // leer usuarios
'users:create'  // crear usuarios
'posts:update'  // editar posts
'admin:panel'   // acceso al panel de administración
```

---

## Permisos en el JWT

Los permisos viajan en el payload del JWT — el guard los lee de `request.user.permissions`:

```typescript
// JWT payload
{
  sub: 2,
  username: 'user',
  roles: ['user'],
  permissions: ['users:read', 'posts:read', 'posts:create'],
}
```

> En producción los permisos no suelen ir en el JWT (el token crece y expira tarde). `PermissionsService` está diseñado para cargarlos desde base de datos y cachearlos.

---

## PermissionsService — carga y caché

```typescript
// services/permissions.service.ts
async getUserPermissions(userId: number): Promise<string[]> {
  const cached = this.cacheService.get(userId);
  if (cached) return cached;                   // cache hit — sin DB

  const perms = await this.fetchFromDatabase(userId);
  this.cacheService.set(userId, perms);         // guarda con TTL
  return perms;
}
```

La primera request por usuario consulta la DB (50ms simulado). Las siguientes sirven desde memoria hasta que el TTL expira (default 5 min). Invalida el caché cuando cambias permisos:

```typescript
permissionsService.invalidateUserCache(userId);
```

---

## Comportamiento

| Situación | Status | Log |
|-----------|--------|-----|
| Usuario tiene todos los permisos | `200` | `DEBUG username — permissions ok: [posts:delete]` |
| Falta al menos un permiso | `403` | `WARN username missing permissions: [posts:delete]` |
| Sin `@Permissions()` en el handler | `200` | — (guard no aplica) |
| Sin `request.user` (guard mal ordenado) | `403` | `ERROR User not found in request` |

El error 403 indica exactamente qué permisos faltan:
```
Insufficient permissions. Required: posts:update, posts:delete
```

---

## RBAC vs PBAC — cuándo usar cada uno

| | `RolesGuard` (RBAC) | `PermissionsGuard` (PBAC) |
|---|---|---|
| Modelo | Roles de alto nivel | Permisos granulares |
| Ejemplo | `admin`, `moderator` | `posts:delete`, `users:create` |
| Lógica | OR (cualquier rol) | AND (todos los permisos) |
| Recomendado para | Secciones grandes | Acciones específicas |

Pueden combinarse en el mismo handler:

```typescript
@Roles(['admin', 'editor'])       // primero filtro grueso (rol)
@Permissions(['posts:publish'])   // luego filtro fino (permiso)
@Post('publish')
publish() {}
```

---

## Script de prueba

```bash
npm run test:permissions
```

```
── GET /demo/level1/read-users  (permisos: ["users:read"]) ──

✅ [200] admin (tiene users:read) → PASS
✅ [200] user  (tiene users:read) → PASS
🚫 [403] guest (sin users:read) → BLOCKED  —  Insufficient permissions. Required: users:read

── GET /demo/level1/delete-post  (permisos: ["posts:update", "posts:delete"] — AND) ──

✅ [200] admin (tiene posts:update AND posts:delete) → PASS
🚫 [403] user  (tiene posts:create pero NO posts:update/delete) → BLOCKED  —  Insufficient permissions. Required: posts:update, posts:delete
🚫 [403] guest (solo posts:read) → BLOCKED  —  Insufficient permissions. Required: posts:update, posts:delete

── Sin token ──

🔐 [401] Sin token → BLOCKED (JwtAuthGuard corre antes)  —  No token provided in request
```

---

## Copiar a tu proyecto

1. Copia `permissions.guard.ts`, `permissions.decorator.ts`
2. Copia `PermissionsService` y `PermissionsCacheService` de `services/`
3. Copia `InsufficientPermissionsException` de `permissions.exception.ts`
4. Conecta `PermissionsService.fetchFromDatabase()` a tu DB real
5. Registra en tu módulo:

```typescript
@Module({
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    PermissionsService,
    PermissionsCacheService,
  ],
})
export class AppModule {}
```

6. Invalida el caché cuando cambies permisos de un usuario:

```typescript
// Al actualizar permisos en DB
await db.updateUserPermissions(userId, newPermissions);
permissionsService.invalidateUserCache(userId);
```
