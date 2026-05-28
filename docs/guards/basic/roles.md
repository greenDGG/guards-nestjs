# RolesGuard

Control de acceso basado en roles (**RBAC**). Verifica que el usuario autenticado tenga **al menos uno** de los roles requeridos — lógica **OR**.

```
GET /admin-only  (roles: ['admin'])
  → token admin   ✅ 200
  → token user    ❌ 403
  → token guest   ❌ 403
```

---

## Archivos

```
src/guards/basic/roles.guard.ts
src/decorators/roles.decorator.ts
scripts/test-roles.ts
```

---

## Quick start

```bash
npm run start:dev
npm run test:roles
```

---

## Uso

### Rol único

```typescript
@Roles(['admin'])
@Get('admin-panel')
adminPanel() {}
// Solo usuarios con role 'admin' pueden entrar
```

### Múltiples roles (OR)

```typescript
@Roles(['admin', 'moderator'])
@Get('staff-area')
staffArea() {}
// Pasa si el usuario tiene 'admin' OR 'moderator'
// Un user con roles=['moderator'] también entra
```

### Con `@CurrentUser()` para ver el rol activo

```typescript
@Roles(['admin', 'moderator'])
@Get('dashboard')
dashboard(@CurrentUser() user: JwtPayload) {
  return { username: user.username, roles: user.roles };
}
```

---

## `@Roles()` decorator

```typescript
// decorators/roles.decorator.ts
import { SetMetadata } from '@nestjs/common';

export const Roles = (roles: string[]) => SetMetadata(Roles, roles);
```

La llave de metadata es la propia función `Roles` — patrón que evita colisiones de strings.

---

## Opciones

`RolesGuard` no tiene opciones propias — toda la configuración va en `@Roles()`.

| Comportamiento | Descripción |
|----------------|-------------|
| Lógica | OR — basta con tener **uno** de los roles listados |
| Sin `@Roles()` | El guard pasa (`requiredRoles` vacío → `return true`) |
| Sin token (sin `request.user`) | Error 403 — debe correr **después** de `JwtAuthGuard` |

---

## Comportamiento

| Situación | Status | Log |
|-----------|--------|-----|
| Usuario tiene uno de los roles requeridos | `200` | `DEBUG username — roles ok: [admin]` |
| Usuario no tiene ningún rol requerido | `403` | `WARN username lacks roles [admin]. Has: [user]` |
| Sin `@Roles()` en el handler | `200` | — (guard no aplica) |
| Sin `request.user` (guard mal ordenado) | `403` | `ERROR User not found in request` |

> **Orden de guards:** `JwtAuthGuard` debe ejecutar antes que `RolesGuard` para que `request.user` esté disponible. Con `APP_GUARD` global ya está garantizado.

---

## RBAC vs PBAC — cuándo usar cada uno

| | `RolesGuard` (RBAC) | `PermissionsGuard` (PBAC) |
|---|---|---|
| Modelo | Roles de alto nivel | Permisos granulares |
| Ejemplo | `admin`, `moderator` | `posts:delete`, `users:create` |
| Lógica | OR (cualquier rol) | AND (todos los permisos) |
| Complejidad | Simple | Más flexible |
| Recomendado para | Secciones grandes | Acciones específicas |

Usa RBAC para controlar el acceso a secciones completas (panel admin). Usa PBAC para controlar acciones individuales (quién puede borrar un post).

---

## Script de prueba

```bash
npm run test:roles
```

```
── GET /demo/level1/admin-only  (roles: ["admin"]) ──

✅ [200] admin (roles=[admin]) → PASS
🚫 [403] user  (roles=[user])  → BLOCKED  —  Insufficient roles. Required one of: admin
🚫 [403] guest (roles=[guest]) → BLOCKED  —  Insufficient roles. Required one of: admin

── GET /demo/level1/staff  (roles: ["admin", "moderator"] — OR) ──

✅ [200] admin (tiene "admin") → PASS
🚫 [403] user  (sin "admin" ni "moderator") → BLOCKED  —  Insufficient roles. Required one of: admin, moderator
🚫 [403] guest (sin "admin" ni "moderator") → BLOCKED  —  Insufficient roles. Required one of: admin, moderator

── Sin token ──

🔐 [401] Sin token → BLOCKED (JwtAuthGuard corre antes)  —  No token provided in request
```

---

## Copiar a tu proyecto

1. Copia `roles.guard.ts` y `roles.decorator.ts`
2. Copia `InsufficientRolesException` de `permissions.exception.ts`
3. Registra globalmente o por módulo:

```typescript
@Module({
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
```

4. Úsalo en tus handlers:

```typescript
@Roles(['admin'])
@Get('settings')
settings() {}
```

`JwtAuthGuard` siempre debe ir antes de `RolesGuard` en el array de `APP_GUARD` — NestJS los ejecuta en orden.
