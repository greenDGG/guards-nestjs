# JwtAuthGuard

Valida el header `Authorization: Bearer <token>` en todas las rutas. Se registra globalmente via `APP_GUARD` — protege toda la aplicación por defecto. Las rutas que no necesitan auth se marcan con `@Public()`.

---

## Archivos

```
src/guards/basic/jwt-auth.guard.ts
src/services/jwt.service.ts          ← signToken, verifyToken, signRefreshToken
src/decorators/public.decorator.ts   ← @Public()
src/decorators/current-user.decorator.ts  ← @CurrentUser()
src/interfaces/jwt-payload.interface.ts
src/exceptions/auth.exception.ts     ← TokenNotFoundException, InvalidTokenException
scripts/test-jwt.ts
```

---

## Quick start

```bash
npm run start:dev
npm run test:jwt
```

---

## Uso

### Registro global (recomendado)

```typescript
// guard-nest.module.ts — ya configurado en este proyecto
{ provide: APP_GUARD, useClass: JwtAuthGuard }
```

Con esto **todas las rutas requieren JWT**. Para excluir una:

```typescript
@Public()
@Get('health')
health() {}
```

### Por ruta (sin registro global)

```typescript
@UseGuards(JwtAuthGuard)
@Get('profile')
profile() {}
```

### Obtener el usuario actual

```typescript
@Get('me')
me(@CurrentUser() user: JwtPayload) {
  return { id: user.sub, username: user.username, roles: user.roles };
}
```

---

## Flujo de autenticación

```
1. POST /auth/login  { username, password }
        ↓
   { accessToken, refreshToken }
        ↓
2. GET /ruta-protegida
   Authorization: Bearer <accessToken>
        ↓
   JwtAuthGuard.canActivate()
   ├── @Public()? → pasa sin verificar
   ├── Sin Bearer token → 401 TokenNotFoundException
   ├── Token inválido/expirado → 401 InvalidTokenException
   └── Token válido → request.user = payload → handler corre
        ↓
3. POST /auth/refresh  { refreshToken }
        ↓
   { accessToken }  ← nuevo token cuando el anterior expiró
```

---

## JwtPayload

```typescript
interface JwtPayload {
  sub:               number | string;  // user ID
  username:          string;
  email?:            string;
  roles:             string[];
  permissions:       string[];

  // Campos opcionales para guards de nivel 5-6
  tenantId?:         string;
  subscriptionPlan?: string;
  mfaVerifiedAt?:    number;           // unix timestamp
  walletAddress?:    string;
  chainId?:          number;

  iat?:              number;           // issued at
  exp?:              number;           // expires at
}
```

El payload completo queda en `request.user` después de la verificación. Los guards de niveles superiores (Tenant, Subscription, MFA, Web3) leen campos de este mismo objeto.

---

## Endpoints de auth

| Método | Ruta | Descripción |
|--------|------|-------------|
| `POST` | `/auth/login` | Login con username + password → `{ accessToken, refreshToken }` |
| `POST` | `/auth/refresh` | Renueva accessToken usando refreshToken |
| `GET` | `/auth/me` | Devuelve el payload del token actual |
| `GET` | `/auth/health` | Health check público |

---

## Comportamiento del guard

| Situación | Status | Excepción |
|-----------|--------|-----------|
| Ruta `@Public()` | pasa | — |
| Token válido | pasa | — |
| Sin header `Authorization` | `401` | `TokenNotFoundException` |
| Scheme incorrecto (`Basic`, `Digest`) | `401` | `TokenNotFoundException` |
| Token malformado | `401` | `InvalidTokenException` |
| Token expirado | `401` | `InvalidTokenException` |
| Firma inválida (secret incorrecto) | `401` | `InvalidTokenException` |

---

## Variables de entorno

```env
JWT_SECRET=cambia-esto-en-produccion     # secret para firmar/verificar accessTokens
JWT_EXPIRATION=3600                       # segundos — 1 hora por defecto
JWT_REFRESH_SECRET=otro-secret-diferente  # secret para refresh tokens
JWT_REFRESH_EXPIRATION=604800             # segundos — 7 días por defecto
```

---

## Script de prueba

```bash
npm run test:jwt
```

```
✅ [200] @Public() — sin token → PASS
✅ [200] POST /auth/login admin:admin123
         accessToken:  eyJhbGciOiJIUzI1NiIsInR5cCI6Ik...
         refreshToken: eyJhbGciOiJIUzI1NiIsInR5cCI6Ik...
✅ [200] Token válido → PASS
🔐 [401] Sin Authorization header → BLOCKED  —  No token provided in request
🔐 [401] Token malformado → BLOCKED  —  Token verification failed: jwt malformed
🔐 [401] Token expirado / firma inválida → BLOCKED  —  invalid signature
🔐 [401] Authorization: Basic <token> → BLOCKED  —  No token provided in request
✅ [200] GET /auth/me
         id: 1 | username: admin | roles: admin
✅ [200] POST /auth/refresh → nuevo accessToken
```

---

## Copiar a tu proyecto

1. Copia `jwt-auth.guard.ts`, `jwt.service.ts`, `public.decorator.ts`, `current-user.decorator.ts`
2. Copia `TokenNotFoundException` e `InvalidTokenException` de `auth.exception.ts`
3. Copia `jwt-payload.interface.ts`
4. Instala dependencias si no las tienes: `@nestjs/jwt`, `@nestjs/passport`
5. Registra globalmente en tu módulo:

```typescript
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';

@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET,
      signOptions: { expiresIn: 3600 },
    }),
  ],
  providers: [
    JwtService,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule {}
```

6. Agrega `@Public()` a login, health y cualquier ruta que no requiera auth
