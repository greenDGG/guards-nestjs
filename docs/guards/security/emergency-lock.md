# EmergencyLockGuard

Kill switch de endpoints. Bloquea cualquier ruta en caliente — sin reiniciar el servidor, sin redesplegar. Responde 503 Service Unavailable en la primera request después de un lock.

```
POST /emergency/lock { key: "withdrawals", reason: "Draining attack" }
→ todos los @EmergencyLock({ key: "withdrawals" }) devuelven 503 de inmediato
```

---

## Archivos

```
src/guards/security/emergency-lock.guard.ts
src/guards/security/emergency-lock-admin.controller.ts
src/services/emergency-lock.service.ts
src/decorators/emergency-lock.decorator.ts
src/examples/level2-security.controller.ts
scripts/test-emergency-lock.ts
```

---

## Quick start

```bash
npm run start:dev
npm run test:emergency-lock
```

---

## Uso

```typescript
// Endpoint que puede ser apagado de emergencia por key
@EmergencyLock({ key: 'withdrawals' })
@UseGuards(EmergencyLockGuard)
@Post('withdraw')
withdraw() {}

// Con bypass estático para admins (siempre pasan aunque esté locked)
@EmergencyLock({ key: 'login', allowedRoles: ['superadmin'] })
@UseGuards(EmergencyLockGuard)
@Post('login')
login() {}

// Sin key explícita — usa la ruta como key
@EmergencyLock()
@UseGuards(EmergencyLockGuard)
@Get('api/data')
data() {}

// Observación previa a enforcement
@EmergencyLock({ key: 'new-feature', logOnly: true })
@UseGuards(EmergencyLockGuard)
@Get('beta')
beta() {}
```

---

## Admin API

Requiere el header `x-admin-key: <EMERGENCY_LOCK_ADMIN_KEY>`.
Si la env var no está definida, todos los endpoints devuelven 403.

### Registrar el controller

```typescript
// En tu AppModule (opt-in):
@Module({
  controllers: [EmergencyLockAdminController],
})
export class AppModule {}
```

El `DemoModule` ya lo incluye para las pruebas.

### Endpoints

```
POST /emergency/lock
POST /emergency/unlock
POST /emergency/unlock-all
GET  /emergency/status
```

### Ejemplos

```bash
# Lock inmediato — sin TTL
curl -X POST http://localhost:3000/emergency/lock \
  -H "Content-Type: application/json" \
  -H "x-admin-key: emergency-admin-key" \
  -d '{"key":"withdrawals","reason":"Draining attack detected"}'

# Lock con auto-unlock en 1 hora
curl -X POST http://localhost:3000/emergency/lock \
  -H "Content-Type: application/json" \
  -H "x-admin-key: emergency-admin-key" \
  -d '{"key":"login","reason":"Brute force","ttlSeconds":3600}'

# Lock con bypass por IP específica (tu oficina puede seguir entrando)
curl -X POST http://localhost:3000/emergency/lock \
  -H "Content-Type: application/json" \
  -H "x-admin-key: emergency-admin-key" \
  -d '{"key":"api","reason":"Attack","allowedIps":["203.0.113.5"]}'

# Unlock
curl -X POST http://localhost:3000/emergency/unlock \
  -H "Content-Type: application/json" \
  -H "x-admin-key: emergency-admin-key" \
  -d '{"key":"withdrawals"}'

# Unlock todo de una vez
curl -X POST http://localhost:3000/emergency/unlock-all \
  -H "x-admin-key: emergency-admin-key"

# Ver estado actual
curl http://localhost:3000/emergency/status \
  -H "x-admin-key: emergency-admin-key"
```

---

## Opciones del decorator

```typescript
export interface EmergencyLockOptions {
  key?:          string;    // clave del lock (default: ruta del endpoint)
  allowedRoles?: string[];  // roles que siempre pasan (compilado en el endpoint)
  allowedIps?:   string[];  // IPs que siempre pasan (compilado en el endpoint)
  logOnly?:      boolean;   // registrar sin bloquear (default: false)
}
```

---

## Body del admin lock

```typescript
{
  key:           string;    // requerido
  reason?:       string;    // descripción para logs y 503 response
  ttlSeconds?:   number;    // auto-unlock después de N segundos
  allowedIps?:   string[];  // bypass dinámico — IPs exentas
  allowedRoles?: string[];  // bypass dinámico — roles exentos
}
```

---

## Respuesta cuando está locked

```
HTTP 503 Service Unavailable
Retry-After: 3600   ← solo si el lock tiene TTL

{
  "message": "Service temporarily unavailable: Draining attack detected",
  "key": "withdrawals",
  "retryAfter": 3600
}
```

---

## Startup lock via env var

Sin API, sin código — solo variables de entorno:

```env
# .env
EMERGENCY_LOCK_KEYS=withdrawals,login
```

Al arrancar el servidor, esas keys quedan locked inmediatamente.
Para desbloquear: admin API o reinicio sin la variable.

---

## Bypass de acceso

Orden de evaluación (primer match gana):

| Prioridad | Bypass | Configurado en |
|-----------|--------|----------------|
| 1 | `allowedRoles` del decorator | Código (estático) |
| 2 | `allowedIps` del decorator | Código (estático) |
| 3 | `allowedRoles` del lock state | Admin API (dinámico) |
| 4 | `allowedIps` del lock state | Admin API (dinámico) |

El bypass estático (decorator) es útil cuando hay roles que nunca deben ser bloqueados.
El bypass dinámico (lock state) es útil para eximir una IP de confianza en tiempo real.

---

## Registrar `EmergencyLockAdminController`

El controller es opt-in — no se registra automáticamente en el módulo global.
En producción aplica tu propia autenticación encima:

```typescript
// Opción A: directo (protegido solo por x-admin-key)
@Module({
  controllers: [EmergencyLockAdminController],
})

// Opción B: con JWT + roles de admin encima
// Desactiva @Public() en EmergencyLockAdminController y agrega:
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('superadmin')
@Controller('emergency')
export class SecureEmergencyLockAdminController extends EmergencyLockAdminController {}
```

---

## Casos de uso reales

| Escenario | Key sugerida | Acción |
|-----------|-------------|--------|
| Draining de fondos cripto | `withdrawals` | Lock inmediato, investigar, unlock manual |
| Credential stuffing activo | `login` | Lock con TTL 1h, revisar logs |
| API key comprometida | `public-api` | Lock con bypass de IPs internas |
| Deploying con downtime | `checkout` | Lock con TTL = ventana de despliegue |
| Feature con bugs críticos | `new-feature` | `logOnly: true` → enforce cuando confirmado |

---

## Diferencia con otros guards

| | `EmergencyLockGuard` | `RateLimitByRouteGuard` | `CircuitBreakerGuard` |
|---|---|---|---|
| Trigger | Manual (admin API o env var) | Automático (volumen) | Automático (tasa de errores) |
| Granularidad | Por key (cualquier string) | Por ruta + perfil | Por ruta |
| Tiempo de respuesta | Inmediato | Inmediato al superar límite | Inmediato cuando circuito abre |
| Auto-recuperación | TTL opcional | Ventana deslizante | Half-open automático |
| Bypass | Roles + IPs (estático y dinámico) | No | No |
| Caso de uso | Ataque en curso, mantenimiento | Protección de tasa | Degradación de servicio |

---

## Script de prueba

```bash
npm run test:emergency-lock
```

```
── Check 1: Sin locks — todos los endpoints operativos ──

  🟢  GET /emergency-check → 200 (sin lock)           HTTP 200  {"guard":"EmergencyLockGuard"...}
  🟢  POST /emergency-login → 200 (sin lock)           HTTP 200  {"guard":"EmergencyLockGuard"...}

── Check 2: Lock "demo-check" → 503 inmediato ──

  Admin: LOCK "demo-check" → {"locked":true,"key":"demo-check"...}

  🔴  GET /emergency-check → 503 (locked)              HTTP 503  Service temporarily unavailable

── Check 3: Unlock → vuelve a 200 ──

  🟢  GET /emergency-check → 200 (desbloqueado)        HTTP 200  {"guard":"EmergencyLockGuard"...}

── Check 5: Lock con TTL 3s → auto-unlock ──

  🔴  POST /emergency-withdraw → 503 (Retry-After: 3s) HTTP 503  (Retry-After: 3s)
  Esperando 3.5s para auto-unlock...
  🟢  POST /emergency-withdraw → 200 (TTL expirado)    HTTP 200  {"guard":"EmergencyLockGuard"...}
```

---

## Copiar a tu proyecto

1. Copia `emergency-lock.guard.ts`, `emergency-lock.service.ts`, `emergency-lock-admin.controller.ts`, `emergency-lock.decorator.ts`
2. Registra en tu módulo:

```typescript
@Module({
  providers:   [EmergencyLockService, EmergencyLockGuard],
  controllers: [EmergencyLockAdminController],  // opt-in
})
export class TuModulo {}
```

3. Set env var:
```env
EMERGENCY_LOCK_ADMIN_KEY=tu-key-secreta-aqui
```
