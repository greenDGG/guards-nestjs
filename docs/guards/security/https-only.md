# HttpsOnlyGuard

Rechaza cualquier request que no llegue por una conexión segura (HTTPS). Soporta setups de reverse proxy inspeccionando el header `x-forwarded-proto`. En desarrollo, localhost pasa automáticamente sin necesitar certificado.

---

## Archivos

```
src/guards/security/https-only.guard.ts
src/examples/level2-security.controller.ts   ← endpoint de demo
scripts/test-https-only.ts
```

---

## Quick start

```bash
npm run start:dev
npm run test:https-only
```

---

## Uso

```typescript
@UseGuards(HttpsOnlyGuard)
@Post('payment')
processPayment() {}
```

Sin `@SetMetadata` — el guard no tiene opciones configurables. Se aplica directamente con `@UseGuards`.

Global (toda la API):

```typescript
// app.module.ts
providers: [
  { provide: APP_GUARD, useClass: HttpsOnlyGuard },
]
```

---

## Orden de evaluación

```
1. request.secure === true          → PASS  (TLS directo a Node.js)
2. request.protocol === 'https'     → PASS  (Express detecta HTTPS)
3. x-forwarded-proto header existe  → evalúa SOLO el primer valor:
     primer valor = 'https'         → PASS
     primer valor = 'http'          → 403   (aunque sea localhost)
4. hostname ∈ {localhost, 127.0.0.1, ::1} → PASS  (dev bypass)
5. ninguna condición cumplida       → 403
```

**El header `x-forwarded-proto` tiene prioridad sobre el localhost bypass.** Si el proxy envía `x-forwarded-proto: http`, la request es bloqueada incluso en desarrollo. Esto evita false positives cuando el proxy está mal configurado.

---

## Comportamiento con múltiples valores

El header puede llegar con múltiples valores cuando hay varios proxies encadenados:

```
x-forwarded-proto: https, http
```

El guard usa solo el **primer valor** (el del cliente original):

```
x-forwarded-proto: https, http  →  'https' → PASS ✅
x-forwarded-proto: http, https  →  'http'  → 403  🚫
```

---

## Reverse proxy (producción)

En producción detrás de nginx/ALB/Cloudflare:

```nginx
# nginx
proxy_set_header X-Forwarded-Proto $scheme;
```

```
cliente → HTTPS → nginx → HTTP → Node.js
  x-forwarded-proto: https → guard ve 'https' → PASS ✅
```

Sin el header (nginx no configurado):

```
cliente → HTTPS → nginx → HTTP → Node.js
  sin x-forwarded-proto → request.secure=false → hostname=no-localhost → 403 🚫
```

---

## Comportamiento

| Situación | Status |
|-----------|--------|
| Conexión HTTPS directa a Node.js | `200` |
| `x-forwarded-proto: https` | `200` |
| `x-forwarded-proto: https, http` | `200` (primer valor) |
| `x-forwarded-proto: http` | `403` |
| `x-forwarded-proto: http, https` | `403` (primer valor) |
| Sin header, hostname = localhost | `200` (dev bypass) |
| Sin header, hostname ≠ localhost | `403` |

---

## Script de prueba

```bash
npm run test:https-only
```

```
── 1. Sin x-forwarded-proto → dev bypass (localhost) ──

  ✅ [200] (sin headers)  — localhost bypass → PASS

── 2. x-forwarded-proto: https → simula reverse proxy HTTPS ──

  ✅ [200] x-forwarded-proto: https         — primer valor = https → PASS
  ✅ [200] x-forwarded-proto: https, http   — primer valor = https → PASS (http ignorado)

── 3. x-forwarded-proto: http → 403 (proxy header tiene prioridad) ──

  🚫 [403] x-forwarded-proto: http          — proxy dice HTTP, localhost bypass no aplica
  🚫 [403] x-forwarded-proto: http, https   — primer valor = http (segundo ignorado)
```

---

## Copiar a tu proyecto

1. Copia `https-only.guard.ts`
2. Registra en tu módulo:

```typescript
@Module({
  providers: [HttpsOnlyGuard],
})
export class TuModulo {}
```

3. Aplica en los endpoints que requieren HTTPS:

```typescript
@UseGuards(HttpsOnlyGuard)
@Post('sensitive-action')
sensitiveAction() {}
```
