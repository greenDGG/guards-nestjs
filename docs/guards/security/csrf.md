# CsrfGuard

Protege endpoints basados en cookies contra Cross-Site Request Forgery usando el patrón **Double Submit Cookie** — sin sesión, sin estado, sin dependencias extra.

```
Sin protección:
  Atacante en evil.com carga <img src="tu-banco.com/transfer?to=atacante&amount=1000">
  → El navegador envía las cookies automáticamente → transferencia procesada

Con CsrfGuard:
  Atacante no puede leer tu cookie csrf-token (same-origin policy)
  → No puede construir el header x-csrf-token correcto → 403 Forbidden
```

---

## Archivos

```
src/guards/security/csrf.guard.ts   ← guard + generateCsrfToken helper
src/examples/level2-security.controller.ts
scripts/test-csrf.ts
```

---

## Quick start

```bash
npm run start:dev
npm run test:csrf
```

---

## Cómo funciona

```
1. Cliente  → GET /csrf-token
             ← servidor fija cookie csrf-token=<hex64> (httpOnly: false)
             ← devuelve { csrfToken: "<hex64>" } en el body

2. Cliente lee document.cookie o el body
3. Cliente → POST /endpoint
              Cookie:          csrf-token=<hex64>    ← el navegador lo envía solo
              x-csrf-token:    <hex64>               ← el cliente lo agrega

4. Guard compara cookie vs header → igual → ✅
   Atacante de otro origen no puede leer la cookie → no puede forjar el header → ❌
```

El `csrf-token` cookie usa `sameSite: 'strict'` para refuerzo adicional, pero la protección real viene del match cookie/header.

---

## Uso

```typescript
// Endpoint para emitir tokens (público, sin guard)
@Get('csrf-token')
csrfToken(@Res({ passthrough: true }) res: Response) {
  return { csrfToken: generateCsrfToken(res) };
}

// Endpoint protegido
@SetMetadata(GUARD_METADATA.CSRF_OPTIONS, {})
@UseGuards(CsrfGuard)
@Post('transfer')
transfer(@Body() dto: TransferDto) {}
```

---

## Opciones

```typescript
export interface CsrfOptions {
  cookieName?:    string;    // default: 'csrf-token'
  headerName?:    string;    // default: 'x-csrf-token'
  ignoreMethods?: string[];  // default: ['GET', 'HEAD', 'OPTIONS']
}
```

| Campo | Default | Descripción |
|-------|---------|-------------|
| `cookieName` | `'csrf-token'` | Nombre de la cookie que el servidor fija |
| `headerName` | `'x-csrf-token'` | Header que el cliente debe incluir |
| `ignoreMethods` | `['GET', 'HEAD', 'OPTIONS']` | Métodos que se saltan la verificación |

---

## Helper `generateCsrfToken`

```typescript
import { generateCsrfToken } from './csrf.guard';

export function generateCsrfToken(
  response: Response,
  cookieName = 'csrf-token',
): string
```

Genera `randomBytes(32).toString('hex')` (64 chars), fija la cookie con `httpOnly: false` (el JS del cliente necesita leerla), y retorna el token para incluirlo en el body.

---

## Comportamiento

| Situación | Status |
|-----------|--------|
| Cookie + header presentes y coinciden | `200` |
| Falta cookie o header | `403` CSRF token missing |
| Cookie ≠ header | `403` CSRF token mismatch |
| Método en `ignoreMethods` (GET/HEAD/OPTIONS) | pasa sin verificar |
| Sin `@SetMetadata` | pasa sin verificar |

---

## Por qué Double Submit Cookie

- **Sin estado**: no necesita sesión ni store/Redis.
- **Sin dependencias**: usa solo `crypto` (stdlib de Node).
- **Compatible con JWT**: el guard es ortogonal al auth — protege el canal de cookie, no la identidad.
- **Copiable**: un archivo, cero configuración global.

La alternativa (Synchronizer Token) requiere sesión para guardar el token server-side — más segura en teoría, pero agrega estado.

---

## Script de prueba

```bash
npm run test:csrf
```

```
── Paso 1: GET /csrf-token ──

  Status : 200
  Token  : a3f8b2c91d7e4f50...
  Cookie : csrf-token=a3f8b2c91d7e4f50...

── Paso 2: Casos de prueba ──

  ✅  Cookie + header correcto          →  200  201
  ✅  Sin header x-csrf-token           →  403  CSRF token missing — ...
  ✅  Sin cookie                        →  403  CSRF token missing — ...
  ✅  Token mal en header (mismatch)    →  403  CSRF token mismatch — ...
  ✅  Token modificado (mismatch)       →  403  CSRF token mismatch — ...
  ✅  Mismo token 2ª vez (sin refresh)  →  200  201
```

---

## Copiar a tu proyecto

1. Copia `csrf.guard.ts` a tu proyecto
2. Registra en tu módulo:

```typescript
@Module({
  providers: [CsrfGuard],
})
export class TuModulo {}
```

3. Agrega un endpoint de emisión de tokens:

```typescript
@Get('csrf-token')
csrfToken(@Res({ passthrough: true }) res: Response) {
  return { csrfToken: generateCsrfToken(res) };
}
```

4. Protege los endpoints que mutated state:

```typescript
@SetMetadata(GUARD_METADATA.CSRF_OPTIONS, {})
@UseGuards(CsrfGuard)
@Post('transfer')
transfer() {}
```

> **Nota**: APIs puramente REST con JWT en `Authorization: Bearer` no necesitan CSRF — el navegador no envía ese header automáticamente. CsrfGuard es relevante cuando usas cookies como mecanismo de autenticación/sesión.
