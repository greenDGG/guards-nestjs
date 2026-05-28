# AuditLogInterceptor

Registra un trail de auditoría completo para cada request: **quién accedió, qué hizo, cuándo, desde dónde y cuál fue el resultado**. Nunca bloquea — siempre pasa el request al handler.

```
Evento registrado:
  trace=a1b2c3d4  userId=usr_42  action="POST /transfer"  resource=transfer
  ip=192.168.1.5  status=201  ms=87  outcome=success
  body={"amount":100,"to":"alice","password":"[REDACTED]"}

Evento de error:
  trace=b3c4d5e6  userId=null  action="POST /transfer"  resource=transfer
  ip=1.2.3.4  status=401  ms=12  outcome=error  error="Invalid request signature"
```

---

## Archivos

```
src/guards/basic/audit-log.interceptor.ts
src/decorators/audit-log.decorator.ts
src/examples/level2-security.controller.ts
scripts/test-audit-log.ts
```

---

## Quick start

```bash
npm run start:dev
npm run test:audit-log    # envía requests — revisa la consola del servidor
```

---

## Por qué un interceptor, no un guard

Los guards solo corren **antes** del handler — no pueden capturar el status code de la respuesta ni la duración. Los interceptores envuelven ambos lados del handler:

```
Interceptor (antes) → extraer contexto, generar traceId
  → Handler (negocio)
Interceptor (después) → capturar status, duración, outcome → emit
```

Si el handler lanza una excepción, el interceptor la captura, registra el error con el status correcto, y la re-lanza — el cliente recibe la respuesta original sin modificar.

---

## Uso

```typescript
@AuditLog({ resource: 'transfer' })
@UseInterceptors(AuditLogInterceptor)
@Post('transfer')
transfer(@Body() dto: TransferDto) {}
```

---

## Opciones

```typescript
export interface AuditLogOptions {
  action?:          string;
  resource?:        string;
  sensitiveFields?: string[];
  logBody?:         boolean;
  logger?:          (entry: AuditEntry) => void | Promise<void>;
}
```

| Campo | Default | Descripción |
|-------|---------|-------------|
| `action` | `"POST /route"` | Label del evento. Default: `${method} ${route}` |
| `resource` | último segmento del route | Recurso accedido. Útil para agrupar entries |
| `sensitiveFields` | `['password','token','secret','cvv','pin',...]` | Campos del body que se enmascaran como `[REDACTED]` |
| `logBody` | `true` | Incluir body sanitizado en el log. `false` para uploads grandes |
| `logger` | NestJS Logger | Función custom async. Úsala para enviar a DB, CloudWatch, DataDog, etc. |

---

## AuditEntry — estructura completa

```typescript
export interface AuditEntry {
  traceId:    string;          // random hex 8-byte, único por request
  timestamp:  string;          // ISO 8601
  userId:     string | null;   // JWT sub
  userEmail:  string | null;   // JWT email
  roles:      string[];        // JWT roles
  ip:         string;          // x-forwarded-for → socket.remoteAddress
  userAgent:  string;
  method:     string;          // GET, POST, ...
  url:        string;          // URL completa con query params
  route:      string;          // template: /users/:id (no el valor real)
  action:     string;
  resource:   string;
  body:       Record<string, unknown> | null;  // sanitizado
  statusCode: number;
  durationMs: number;
  outcome:    'success' | 'error';
  error?:     string;          // mensaje de error si outcome === 'error'
}
```

---

## X-Trace-Id

El interceptor fija `X-Trace-Id: <traceId>` en cada respuesta. El cliente puede incluirlo en reportes de bugs o soporte — el equipo de backend lo busca en los logs para encontrar el evento exacto.

```bash
curl -i -X POST http://localhost:3000/api/transfer ...
# Response headers:
# X-Trace-Id: a1b2c3d4e5f6a7b8
```

---

## Custom logger — integración enterprise

El `logger` por defecto usa NestJS Logger. Para enviar a sistemas externos, pasa una función async:

```typescript
// Guardar en base de datos
@AuditLog({
  resource: 'transfer',
  logger: async (entry) => {
    await db.auditLogs.insert({
      ...entry,
      appVersion: process.env.APP_VERSION,
      environment: process.env.NODE_ENV,
    });
  },
})

// Enviar a CloudWatch (AWS SDK v3)
@AuditLog({
  resource: 'payment',
  logger: async (entry) => {
    await cloudwatch.send(new PutLogEventsCommand({
      logGroupName:  '/app/audit',
      logStreamName: new Date().toISOString().slice(0, 10),
      logEvents: [{ timestamp: Date.now(), message: JSON.stringify(entry) }],
    }));
  },
})

// DataDog / Splunk — HTTP event
@AuditLog({
  resource: 'order',
  logger: async (entry) => {
    await fetch('https://http-intake.logs.datadoghq.com/v1/input', {
      method: 'POST',
      headers: { 'DD-API-KEY': process.env.DD_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...entry, ddsource: 'nestjs', service: 'api' }),
    });
  },
})
```

Si la función custom lanza, el error es capturado y logueado internamente — **la respuesta al cliente no se afecta**.

---

## Comportamiento

| Situación | Outcome | Status logueado |
|-----------|---------|-----------------|
| Handler retorna normalmente | `success` | `response.statusCode` (200/201/...) |
| Handler lanza `HttpException` | `error` | `exception.getStatus()` (400/401/403/...) |
| Handler lanza `Error` genérico | `error` | `500` |
| Sin `@AuditLog` metadata | no loguea | — |
| Custom logger lanza | error interno (no afecta response) | — |

---

## Combinación con otros guards

```typescript
// Stack completo para endpoint financiero
@AuditLog({ resource: 'transfer', sensitiveFields: ['pin', 'accountNumber'] })
@ReplayProtect({ secret: process.env.API_SECRET })
@UseGuards(ReplayProtectionGuard)
@UseInterceptors(AuditLogInterceptor)
@Post('transfer')
transfer(@Body() dto: TransferDto) {}
```

Orden de ejecución:
```
ReplayProtectionGuard.canActivate()   → timestamp + nonce + firma
AuditLogInterceptor (before handler)  → genera traceId, captura contexto
  → Handler ejecuta la transferencia
AuditLogInterceptor (after handler)   → registra outcome + ms
```

---

## Script de prueba

```bash
npm run test:audit-log
```

```
── Requests enviadas ──

  success ✅  POST /audit-success (body normal)         HTTP 201  trace=a1b2c3d4
  success ✅  POST /audit-success (body con password)   HTTP 201  trace=b2c3d4e5
  error   ⚠️   POST /audit-fail   (handler lanza 403)   HTTP 403  trace=c3d4e5f6

── En consola del servidor ──

  [AuditLogInterceptor] AUDIT  trace=a1b2c3d4  userId=null  action="demo:read-sensitive-data"
    resource=demo  ip=127.0.0.1  status=201  ms=3  outcome=success
    body={"userId":"usr_42","amount":100,"to":"alice"}

  [AuditLogInterceptor] AUDIT  trace=b2c3d4e5  userId=null  action="demo:read-sensitive-data"
    resource=demo  ip=127.0.0.1  status=201  ms=2  outcome=success
    body={"username":"admin","password":"[REDACTED]","token":"[REDACTED]"}

  [AuditLogInterceptor] AUDIT  trace=c3d4e5f6  userId=null  action="demo:access-restricted"
    resource=demo  ip=127.0.0.1  status=403  ms=1  outcome=error
    error="Acceso denegado — sin permisos"
```

---

## Copiar a tu proyecto

1. Copia `audit-log.interceptor.ts` y `audit-log.decorator.ts`
2. Registra en tu módulo:

```typescript
@Module({
  providers: [AuditLogInterceptor],
})
export class TuModulo {}
```

3. Aplica en los endpoints que requieran audit trail:

```typescript
@AuditLog({ resource: 'transfer', logger: async (e) => db.audit.insert(e) })
@UseInterceptors(AuditLogInterceptor)
@Post('transfer')
transfer() {}
```

> **Compliance note**: Para cumplir con SOC 2, PCI-DSS, o ISO 27001, el audit log debe ser inmutable y con retención mínima garantizada (típicamente 1 año). Usar un custom `logger` que escriba a un sistema de logs append-only (CloudWatch, Splunk, un S3 bucket con Object Lock) es la práctica estándar.
