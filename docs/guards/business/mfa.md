# MfaGuard

Verifica que el usuario completó el **segundo factor de autenticación** recientemente. Lee el campo `mfaVerifiedAt` (unix timestamp en segundos) del JWT y comprueba que no sea más antiguo que `maxAgeSeconds`.

```
GET /transfer-funds   (maxAgeSeconds: 900)
  → MFA hace 5 min   ✅ 200
  → MFA hace 20 min  ❌ 401  (venció la ventana de 15 min)
  → Sin MFA en JWT   ❌ 401
```

---

## Archivos

```
src/guards/business/mfa.guard.ts
src/examples/level5-business.controller.ts   ← /demo/level5/mfa-required y mfa-optional
src/auth/auth.controller.ts                  ← POST /auth/test/mfa-token (solo para tests)
scripts/test-mfa.ts
```

---

## Quick start

```bash
npm run start:dev
npm run test:mfa
```

---

## Uso

### Operación crítica — ventana corta de 15 min

```typescript
@SetMetadata(GUARD_METADATA.MFA_OPTIONS, { maxAgeSeconds: 900 })
@UseGuards(MfaGuard)
@Post('transfer-funds')
transferFunds() {}
// El usuario debe haber completado MFA en los últimos 15 minutos
```

### Soft MFA — pasa aunque el usuario no tenga MFA configurado

```typescript
@SetMetadata(GUARD_METADATA.MFA_OPTIONS, { maxAgeSeconds: 3600, required: false })
@UseGuards(MfaGuard)
@Get('sensitive-settings')
sensitiveSettings() {}
// Con MFA verificado: acceso confirmado
// Sin MFA en JWT:     acceso igual (no bloquea usuarios que aún no configuraron 2FA)
```

### Combinado con OwnershipGuard

```typescript
@Owner({ param: 'userId' })
@SetMetadata(GUARD_METADATA.MFA_OPTIONS, { maxAgeSeconds: 300 })
@UseGuards(OwnershipGuard, MfaGuard)
@Delete('users/:userId/account')
deleteAccount() {}
// 1. OwnershipGuard verifica que es tu propia cuenta
// 2. MfaGuard verifica que hiciste 2FA hace menos de 5 minutos
```

---

## Opciones

```typescript
export interface MfaOptions {
  maxAgeSeconds?: number;   // default: 3600 (1 hora)
  required?: boolean;       // default: true
}
```

| Campo | Default | Descripción |
|-------|---------|-------------|
| `maxAgeSeconds` | `3600` | Máxima antigüedad del MFA en segundos. Recomienda 300–900s para operaciones críticas |
| `required` | `true` | Si `false`, el guard pasa cuando `mfaVerifiedAt` está ausente (soft MFA) |

---

## Cómo funciona con el JWT

El campo `mfaVerifiedAt` se agrega al JWT durante el flujo de login cuando el usuario completa el segundo factor:

```
1. POST /auth/login  { username, password }
        ↓ credenciales correctas
2. El servidor desafía al usuario (TOTP, SMS, etc.)
        ↓ segundo factor correcto
3. Servidor firma el JWT con  mfaVerifiedAt: Math.floor(Date.now() / 1000)
        ↓
4. Solicitudes posteriores llevan ese timestamp en el JWT
        ↓
5. MfaGuard compara:  now - mfaVerifiedAt <= maxAgeSeconds
```

El guard **no activa el flujo de MFA** — solo verifica que ya fue completado. La lógica de desafío (TOTP, SMS, hardware key) vive en tu propio flujo de autenticación.

---

## Ventanas de tiempo recomendadas

| Operación | `maxAgeSeconds` | Razonamiento |
|-----------|----------------|--------------|
| Ver perfil sensible | `3600` (1h) | Baja sensibilidad |
| Cambiar email/password | `900` (15 min) | Acción de cuenta |
| Transferencia financiera | `300` (5 min) | Alta sensibilidad |
| Revocar tokens / borrar cuenta | `120` (2 min) | Acción irreversible |

---

## Comportamiento

| Situación | Status | Log |
|-----------|--------|-----|
| MFA verificado dentro de `maxAgeSeconds` | `200` | `DEBUG MFA valid for user X: verified Ys ago` |
| `mfaVerifiedAt` más antiguo que `maxAgeSeconds` | `401` | `WARN MFA expired for user X: verified Ys ago (max Zs)` |
| Sin `mfaVerifiedAt` + `required: true` | `401` | `WARN MFA not verified for user X` |
| Sin `mfaVerifiedAt` + `required: false` | `200` | — |
| Sin `request.user` (sin JWT) | `401` | — |

---

## Endpoint de test

El flujo normal de login no incluye `mfaVerifiedAt`. Para tests, el proyecto expone:

```
POST /auth/test/mfa-token
Body: { username, password, mfaAgeSeconds: number | null }
  mfaAgeSeconds: 60   → mfaVerifiedAt = now - 60s   (MFA fresco)
  mfaAgeSeconds: 7200 → mfaVerifiedAt = now - 7200s (MFA expirado)
  mfaAgeSeconds: null → sin mfaVerifiedAt en el token
```

El servidor firma con su propio secret — no hay problemas de key mismatch entre el script y el servidor.

---

## Script de prueba

```bash
npm run test:mfa
```

```
── GET /demo/level5/mfa-required  (maxAgeSeconds: 3600, required: true) ──

✅ [200] MFA fresco (hace 1 min) → PASS  —  verificado hace 60s
🔐 [401] MFA expirado (hace 2h > maxAge 3600s) → BLOCKED
🔐 [401] Sin mfaVerifiedAt (required: true) → BLOCKED

── GET /demo/level5/mfa-optional  (maxAgeSeconds: 3600, required: false) ──

✅ [200] MFA fresco → PASS  —  verificado hace 60s
✅ [200] Sin mfaVerifiedAt (required: false) → PASS (soft MFA)

── Sin token ──

🔐 [401] Sin token → BLOCKED (JwtAuthGuard corre antes)
```

---

## Copiar a tu proyecto

1. Copia `mfa.guard.ts`
2. Copia `MfaRequiredException` de `business.exception.ts`
3. Registra en tu módulo:

```typescript
@Module({
  providers: [MfaGuard],
})
export class TuModulo {}
```

4. Agrega `mfaVerifiedAt` al JWT cuando el usuario complete el segundo factor:

```typescript
// En tu flujo de login, después de verificar TOTP/SMS:
const payload = {
  sub: user.id,
  username: user.username,
  roles: user.roles,
  mfaVerifiedAt: Math.floor(Date.now() / 1000),  // ← aquí
};
return { accessToken: jwt.sign(payload, secret) };
```

5. Aplica en tus endpoints:

```typescript
@SetMetadata(GUARD_METADATA.MFA_OPTIONS, { maxAgeSeconds: 300 })
@UseGuards(MfaGuard)
@Post('operacion-critica')
operacionCritica() {}
```
