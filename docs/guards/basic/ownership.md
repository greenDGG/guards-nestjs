# OwnershipGuard

Previene **IDOR** (Insecure Direct Object Reference) — uno de los bugs de autorización más comunes y más fáciles de explotar. Garantiza que el usuario autenticado solo puede acceder a sus propios recursos.

```
GET /users/42/profile  → token de user 42  ✅
GET /users/99/profile  → token de user 42  ❌ 403
```

---

## Archivos

```
src/guards/basic/ownership.guard.ts
src/decorators/owner.decorator.ts
scripts/test-ownership.ts
```

---

## Quick start

```bash
npm run start:dev
npm run test:ownership
```

---

## Uso

### Param (el más común)

```typescript
@Owner({ param: 'userId' })
@UseGuards(OwnershipGuard)
@Get(':userId/profile')
getProfile(@Param('userId') id: string) {}
// user 2 → GET /users/2/profile  ✅
// user 2 → GET /users/99/profile ❌ 403
```

### Body field

```typescript
@Owner({ body: 'authorId' })
@UseGuards(OwnershipGuard)
@Post('posts')
createPost(@Body() dto: CreatePostDto) {}
// Evita que alguien cree un post en nombre de otro usuario
```

### Header

```typescript
@Owner({ header: 'x-user-id' })
@UseGuards(OwnershipGuard)
@Get('data')
getData() {}
```

### Resolver async — cuando la URL tiene el ID del recurso, no del usuario

```typescript
@Owner({
  resolver: async (req) => {
    const post = await postRepo.findOne(req.params.postId);
    return post?.authorId ?? null;  // null → 403
  },
})
@UseGuards(OwnershipGuard)
@Delete('posts/:postId')
deletePost() {}
// Busca quién es el dueño del post y lo compara con el JWT
```

### Campo custom del JWT

```typescript
// Comparar req.params.tenantId contra jwt.tenantId (no jwt.sub)
@Owner({ param: 'tenantId', jwtField: 'tenantId' })
@UseGuards(OwnershipGuard)
@Get(':tenantId/data')
getData() {}
```

---

## Opciones `@Owner()`

```typescript
export interface OwnershipOptions {
  param?:       string;
  body?:        string;
  header?:      string;
  resolver?:    (req: Request) => Promise<string | number | null> | string | number | null;
  jwtField?:    keyof JwtPayload;   // default: 'sub'
  bypassRoles?: string[];           // default: ['admin']
}
```

| Campo | Default | Descripción |
|-------|---------|-------------|
| `param` | — | Nombre del route param a comparar contra `jwt.sub` |
| `body` | — | Campo del body request a comparar |
| `header` | — | Nombre del header a comparar |
| `resolver` | — | Función async que devuelve el ID del dueño |
| `jwtField` | `'sub'` | Qué campo del JWT usar como referencia del usuario |
| `bypassRoles` | `['admin']` | Roles que saltean el check. `[]` para deshabilitar bypass |

Solo se usa uno de `param`, `body`, `header` o `resolver` — en ese orden de prioridad si se definen múltiples.

---

## Admin bypass y cómo deshabilitarlo

```typescript
// Default: admin puede acceder a cualquier recurso
@Owner({ param: 'userId' })   // bypassRoles: ['admin'] implícito

// Deshabilitar bypass — ni admin puede ver este dato
@Owner({ param: 'userId', bypassRoles: [] })
@Get('users/:userId/secret')
getUserSecret() {}
```

Úsalo en recursos extremadamente sensibles: claves 2FA, datos financieros, historiales médicos.

---

## Comportamiento

| Situación | Status | Log |
|-----------|--------|-----|
| Usuario accede a su recurso | `200` | `DEBUG Ownership verified` |
| Usuario accede al recurso de otro | `403` | `WARN IDOR blocked — user X attempted to access resource owned by Y` |
| Rol en `bypassRoles` | `200` | `DEBUG Ownership bypassed — user X has privileged role` |
| Sin token (sin `request.user`) | `401` | — |
| `resolver` devuelve `null` | `403` | `WARN could not resolve owner ID` |

La comparación se hace como strings (`String(ownerId) !== String(jwtValue)`) para evitar falsos positivos por type mismatch — param `'42'` vs JWT sub `42`.

---

## Script de prueba

```bash
npm run test:ownership
```

```
── /users/:userId/profile  (bypassRoles: ["admin"]) ──

✅ [200] user (sub=2) → GET /users/2/profile  (propio recurso)
🚫 [403] user (sub=2) → GET /users/1/profile  (IDOR bloqueado)
✅ [200] admin (sub=1) → GET /users/99/profile (bypass por rol)
✅ [200] admin (sub=1) → GET /users/1/profile  (propio recurso)

── /users/:userId/secret  (bypassRoles: [] — sin bypass) ──

✅ [200] user (sub=2) → GET /users/2/secret   (propio secreto)
🚫 [403] admin (sub=1) → GET /users/2/secret  (ni admin entra)
✅ [200] admin (sub=1) → GET /users/1/secret  (propio secreto)

── Sin token ──

🔐 [401] Sin token → BLOCKED  (JwtAuthGuard corre antes)
```

---

## Copiar a tu proyecto

1. Copia `ownership.guard.ts` y `owner.decorator.ts`
2. No requiere servicios adicionales
3. Registra en tu módulo:

```typescript
@Module({
  providers: [OwnershipGuard],
})
export class TuModulo {}
```

4. `JwtAuthGuard` debe correr antes — `request.user` tiene que estar disponible cuando `OwnershipGuard` ejecuta. Si usas `APP_GUARD` global ya está garantizado.
