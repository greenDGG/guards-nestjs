# IpGuard

Permite o deniega requests según la IP del cliente. Soporta **whitelist**, **blacklist**, IPs exactas (IPv4 e IPv6) y **rangos CIDR** (notación `192.168.0.0/24`). La IP se extrae via `IpExtractorService` que respeta `x-forwarded-for` para setups detrás de reverse proxy.

---

## Archivos

```
src/guards/security/ip.guard.ts
src/decorators/ip.decorator.ts          ← @IpFilter shorthand
src/services/ip-extractor.service.ts    ← extrae la IP del cliente
src/examples/level2-security.controller.ts
scripts/test-ip.ts
```

---

## Quick start

```bash
npm run start:dev
npm run test:ip
```

---

## Uso

Con el decorator `@IpFilter`:

```typescript
@IpFilter({ mode: 'whitelist', list: ['10.0.0.0/8', '192.168.1.5'] })
@UseGuards(IpGuard)
@Get('internal')
internalEndpoint() {}
```

O directamente con `@SetMetadata`:

```typescript
@SetMetadata(GUARD_METADATA.IP_OPTIONS, {
  mode: 'blacklist',
  list: ['1.2.3.4', '10.10.0.0/16'],
})
@UseGuards(IpGuard)
@Get('public')
publicEndpoint() {}
```

---

## Opciones

```typescript
export interface IpGuardOptions {
  mode: 'whitelist' | 'blacklist';
  list: string[];   // IPs exactas o rangos CIDR
}
```

| Campo | Descripción |
|-------|-------------|
| `mode` | `'whitelist'` bloquea todo lo que NO esté en la lista. `'blacklist'` bloquea todo lo que SÍ esté en la lista |
| `list` | Array de IPs (`1.2.3.4`, `::1`) o rangos CIDR IPv4 (`10.0.0.0/8`, `192.168.0.0/24`) |

---

## Extracción de IP

`IpExtractorService.getClientIp()` lee en este orden:

```
1. request.securityContext.ip   (si SecurityContextMiddleware ya corrió)
2. x-forwarded-for              (primer valor de la lista)
3. x-real-ip
4. socket.remoteAddress         (strips ::ffff: prefix automáticamente)
```

En producción detrás de nginx/ALB, configura el header:

```nginx
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
```

---

## CIDR — rangos IPv4

El guard implementa la comparación bitwise sin dependencias externas:

```
10.10.0.0/16   →  IPs 10.10.0.0 hasta 10.10.255.255
192.168.1.0/24 →  IPs 192.168.1.0 hasta 192.168.1.255
0.0.0.0/0      →  todas las IPs IPv4
```

Solo IPv4 soporta CIDR. IPv6 usa exact-match.

```typescript
// Bloquear una red completa de datacenter:
list: ['45.33.0.0/16', '104.21.0.0/16']

// Whitelist de red corporativa:
list: ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16']
```

---

## Comportamiento

| Situación | `whitelist` | `blacklist` |
|-----------|-------------|-------------|
| IP en la lista | `200` ✅ | `403` 🚫 |
| IP fuera de la lista | `403` 🚫 | `200` ✅ |
| IP en rango CIDR de la lista | `200` ✅ | `403` 🚫 |
| IP fuera de rango CIDR | `403` 🚫 | `200` ✅ |
| Sin `@SetMetadata` | `200` (guard no aplica) | — |

---

## Script de prueba

```bash
npm run test:ip
```

```
── 1. Whitelist — IP local (127.0.0.1) ──

  ✅ [200] (sin override — socket IP = 127.0.0.1)  — en whitelist → PASS

── 2. Whitelist — IP externa vía x-forwarded-for → 403 ──

  🚫 [403] x-forwarded-for: 5.5.5.5           — no está en whitelist → 403
  🚫 [403] x-forwarded-for: 192.168.1.100     — IP privada fuera de lista → 403

── 3. Blacklist — IP no bloqueada → PASS ──

  ✅ [200] (sin override — socket IP = 127.0.0.1)  — no está en blacklist → PASS
  ✅ [200] x-forwarded-for: 8.8.8.8           — no está en blacklist → PASS

── 4. Blacklist — IP exacta (1.2.3.4) → 403 ──

  🚫 [403] x-forwarded-for: 1.2.3.4           — match exacto → 403

── 5. Blacklist — CIDR 10.10.0.0/16 ──

  🚫 [403] x-forwarded-for: 10.10.0.1         — en rango → 403
  🚫 [403] x-forwarded-for: 10.10.128.5       — en rango → 403
  🚫 [403] x-forwarded-for: 10.10.255.255     — en rango → 403
  ✅ [200] x-forwarded-for: 10.11.0.1         — fuera del rango → PASS
  ✅ [200] x-forwarded-for: 10.9.255.255      — fuera del rango → PASS
```

---

## Copiar a tu proyecto

1. Copia `ip.guard.ts`, `ip.decorator.ts` e `ip-extractor.service.ts`
2. Registra en tu módulo:

```typescript
@Module({
  providers: [IpGuard, IpExtractorService],
})
export class TuModulo {}
```

3. Aplica en tus endpoints:

```typescript
@IpFilter({ mode: 'whitelist', list: ['10.0.0.0/8'] })
@UseGuards(IpGuard)
@Get('internal')
internal() {}
```
