# BasicAuthGuard

Valida el header `Authorization: Basic <base64>` — el estándar HTTP más antiguo de autenticación. Sin tokens, sin cookies, sin sesión. El navegador muestra un popup nativo de usuario/password si el servidor responde con `WWW-Authenticate`.

---

## Archivos

```
src/guards/basic/basic-auth.guard.ts
src/exceptions/security.exception.ts  ← InvalidBasicAuthException
scripts/test-basic-auth.ts
```

---

## Quick start

```bash
npm run start:dev
npm run test:basic-auth
```

---

## Uso

### Credenciales hardcodeadas

```typescript
@Get('admin')
@UseGuards(new BasicAuthGuard({ credentials: { admin: 'secret123', dev: 'dev456' }, realm: 'MyApp' }))
@Public()
admin() {}
```

### Validator async (base de datos, bcrypt, etc.)

```typescript
@Get('panel')
@UseGuards(new BasicAuthGuard({
  validator: async (username, password) => {
    const user = await usersService.findByUsername(username);
    if (!user) return false;
    return bcrypt.compare(password, user.passwordHash);
  },
  realm: 'Panel',
}))
@Public()
panel() {}
```

---

## Opciones

```typescript
export interface BasicAuthOptions {
  credentials?: Record<string, string>;
  validator?:   (username: string, password: string) => Promise<boolean>;
  realm?:       string;
}
```

| Campo | Tipo | Default | Descripción |
|-------|------|---------|-------------|
| `credentials` | `Record<string, string>` | — | Mapa `{ username: password }` en texto plano |
| `validator` | `async fn` | — | Validador custom — tiene prioridad sobre `credentials` |
| `realm` | `string` | `'API'` | Nombre del realm que aparece en el popup del navegador |

> Si defines ambos, `validator` tiene prioridad sobre `credentials`.

---

## Cómo construir el header

```typescript
// username:password → base64
const encoded = Buffer.from('admin:secret123').toString('base64');
// → YWRtaW46c2VjcmV0MTIz

// Header resultante
Authorization: Basic YWRtaW46c2VjcmV0MTIz
```

**Password con colon:** válido según RFC 7617. Solo se hace split en el primer colon — `admin:se:cret` se parsea como `user=admin`, `pass=se:cret`.

---

## Comportamiento

| Situación | Status | Header en respuesta |
|-----------|--------|---------------------|
| Credenciales válidas | `200` | — |
| Password incorrecta | `401` | `WWW-Authenticate: Basic realm="..."` |
| Usuario inexistente | `401` | `WWW-Authenticate: Basic realm="..."` |
| Sin `Authorization` header | `401` | `WWW-Authenticate: Basic realm="..."` |
| Header no empieza con `Basic ` | `401` | `WWW-Authenticate: Basic realm="..."` |
| Base64 sin colon (malformado) | `401` | `WWW-Authenticate: Basic realm="..."` |

El header `WWW-Authenticate` hace que el navegador muestre el popup nativo de autenticación.

---

## Script de prueba

```bash
npm run test:basic-auth
```

```
✅ [200] admin:secret123 → PASS
✅ [200] dev:dev456 → PASS
🔐 [401] admin:wrong → BLOCKED  —  Invalid credentials for realm 'Demo'
          WWW-Authenticate: Basic realm="Demo"
🔐 [401] ghost:ghost123 (usuario inexistente) → BLOCKED
🔐 [401] Sin Authorization header → BLOCKED
          WWW-Authenticate: Basic realm="Demo"
🔐 [401] Authorization: Bearer ... (no Basic) → BLOCKED
🔐 [401] Base64 sin colon "sincolon" → BLOCKED
🔐 [401] admin:se:cret (pass con colon) → BLOCKED (pass no coincide, parsing OK)
```

---

## Cuándo usarlo

| Caso | Recomendado |
|------|-------------|
| Panel de admin interno | ✅ Simple, sin tokens |
| Health endpoint para monitoring (Uptime Robot, etc.) | ✅ Fácil de configurar |
| API pública con muchos usuarios | ❌ Usa JWT o API Keys |
| Passwords en texto plano en producción | ❌ Usa `validator` con bcrypt |

---

## Copiar a tu proyecto

1. Copia `basic-auth.guard.ts`
2. Copia `InvalidBasicAuthException` de `security.exception.ts`
3. Instancia el guard directamente — **no uses DI**, usa `new`:

```typescript
// ✅ Correcto — instancia directa con opciones
@UseGuards(new BasicAuthGuard({ credentials: { admin: 'pass' } }))

// ❌ No funciona — DI no sabe cómo inyectar las opciones
@UseGuards(BasicAuthGuard)
```

4. Agrega `@Public()` si tienes `JwtAuthGuard` como guard global
