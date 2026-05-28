# GeoIpGuard

Bloquea o permite requests según el **país de origen** de la IP. Usa la API gratuita de `ipapi.co` (1000 req/día). Resultados cacheados 24 horas en `RedisStoreService`. En caso de fallo del API, el comportamiento se controla con `fallbackAllow`.

```
GET /sensitive-data  (IP de KP — Corea del Norte)
  mode: 'blacklist', countries: ['KP', 'IR']
  → 403 GeoIpBlockedException

GET /us-only  (IP de MX — México)
  mode: 'whitelist', countries: ['US', 'CA']
  → 403 GeoIpBlockedException

GET /us-only  (IP de US)
  → 200 ✅
```

---

## Archivos

```
src/guards/detection/geo-ip.guard.ts
src/services/geo-ip.service.ts
src/examples/level4-detection.controller.ts   ← 3 endpoints de demo
scripts/test-geo.ts
```

---

## Quick start

```bash
npm run start:dev
npm run test:geo
```

---

## Uso

### Blacklist — bloquear países de alto riesgo

```typescript
@SetMetadata(GUARD_METADATA.GEO_IP_OPTIONS, {
  mode: 'blacklist',
  countries: ['KP', 'IR', 'SY'],
  fallbackAllow: true,
})
@UseGuards(GeoIpGuard)
@Get('sensitive-data')
sensitiveData() {}
// Bloquea KP, IR, SY — todos los demás países pasan
// Si el API falla → permite (fallback)
```

### Whitelist — solo países permitidos

```typescript
@SetMetadata(GUARD_METADATA.GEO_IP_OPTIONS, {
  mode: 'whitelist',
  countries: ['US', 'CA', 'GB', 'AU'],
  fallbackAllow: true,
})
@UseGuards(GeoIpGuard)
@Get('us-only')
usOnly() {}
// Solo pasan US, CA, GB, AU — todos los demás son bloqueados
```

### Strict — sin fallback (IP desconocida = bloqueo)

```typescript
@SetMetadata(GUARD_METADATA.GEO_IP_OPTIONS, {
  mode: 'whitelist',
  countries: ['MX', 'US', 'ES'],
  fallbackAllow: false,
})
@UseGuards(GeoIpGuard)
@Get('strict')
strict() {}
// Si el API falla o la IP es privada/desconocida → 403
// Más seguro pero puede bloquear tráfico legítimo si el API tiene downtime
```

### Con API key (más límite de requests)

```typescript
@SetMetadata(GUARD_METADATA.GEO_IP_OPTIONS, {
  mode: 'blacklist',
  countries: ['KP'],
  apiKey: 'tu-api-key-de-ipapi.co',
})
@UseGuards(GeoIpGuard)
```

---

## Opciones

```typescript
export interface GeoIpGuardOptions {
  mode:          'whitelist' | 'blacklist';
  countries:     string[];      // códigos ISO 3166-1 alpha-2 (ej: 'MX', 'US', 'KP')
  apiKey?:       string;        // ipapi.co API key (opcional — free tier: 1000 req/día)
  fallbackAllow?: boolean;      // default: true
}
```

| Campo | Default | Descripción |
|-------|---------|-------------|
| `mode` | — | `'whitelist'`: solo pasan los países listados. `'blacklist'`: se bloquean los países listados |
| `countries` | — | Array de códigos ISO 3166-1 alpha-2 (mayúsculas recomendadas, se normaliza internamente) |
| `apiKey` | — | API key de ipapi.co para superar el límite de 1000 req/día del free tier |
| `fallbackAllow` | `true` | Qué hacer cuando el lookup falla: `true` permite, `false` bloquea |

---

## Lógica de evaluación

```
1. ¿Hay opciones configuradas (metadata)?
        ├── NO  → return true (guard no aplica)
        └── SÍ  ↓

2. ¿ctx.geo ya populado por otro guard en esta misma request?
        ├── SÍ  → reutilizar countryCode (sin llamar al API)
        └── NO  → llamar GeoIpService.lookup(ip)

3. ¿Lookup exitoso?
        ├── NO  → fallbackAllow === false → GeoIpBlockedException('unknown')
        │         fallbackAllow !== false → return true ✅
        └── SÍ  → guardar resultado en ctx.geo (SecurityContext)

4. ¿El país está en la lista?
        mode 'whitelist' + NO está → GeoIpBlockedException(countryCode)
        mode 'blacklist' + SÍ está → GeoIpBlockedException(countryCode)
        caso contrario               → return true ✅
```

---

## IPs privadas y localhost

El servicio detecta IPs privadas/locales y omite el lookup (evita llamadas al API que siempre fallarían):

| Rango | Ejemplo |
|-------|---------|
| `127.x.x.x` | localhost IPv4 |
| `::1` | localhost IPv6 |
| `10.x.x.x` | red privada clase A |
| `172.16–31.x.x` | red privada clase B |
| `192.168.x.x` | red privada clase C |
| `unknown` | IP no resuelta |

Para estas IPs, `lookup()` devuelve `null` → se aplica el `fallbackAllow`.

**En tests locales:** todas las requests van por `127.0.0.1` / `::1`, así que:
- `fallbackAllow: true` → 200 siempre (útil para demo/dev)
- `fallbackAllow: false` → 403 siempre (simula IP de país desconocido)

---

## Cache 24 horas

El resultado del lookup se almacena en `RedisStoreService` bajo `geoip:<ip>` con TTL de 24 horas. Esto evita agotar el límite diario del API en producción.

```typescript
const cacheKey = `geoip:${ip}`;
const cached = await this.store.get(cacheKey);
if (cached) return JSON.parse(cached);
// ...
await this.store.set(cacheKey, JSON.stringify(data), CACHE_TTL_MS);
```

---

## SecurityContext — evitar llamadas duplicadas

Si en la misma request corren múltiples guards que necesiten el país (por ejemplo `BotDetectionGuard` + `GeoIpGuard`), el segundo guard reutiliza `ctx.geo` del `SecurityContext` sin hacer otra llamada al API:

```typescript
if (ctx.geo) {
  countryCode = ctx.geo.countryCode;
  // no API call
} else {
  const geoData = await this.geoIpService.lookup(ip, options.apiKey);
  ctx.geo = { countryCode, country, city, region };
}
```

El resultado queda disponible para el handler también:

```typescript
@Get('data')
getData(@SecurityCtx() ctx: SecurityContext) {
  console.log(ctx.geo?.countryCode);  // 'MX', 'US', etc.
}
```

---

## Comportamiento

| Situación | Status | Log |
|-----------|--------|-----|
| País en blacklist | `403` | `WARN GeoIP blocked country 'KP' (blacklisted)` |
| País no en whitelist | `403` | `WARN GeoIP blocked country 'FR' (not in whitelist)` |
| País permitido | `200` | `DEBUG GeoIP passed for MX (203.0.113.1)` |
| Lookup falla, `fallbackAllow: true` | `200` | `WARN GeoIP lookup failed for X — allowing` |
| Lookup falla, `fallbackAllow: false` | `403` | `WARN GeoIP lookup failed for X — blocking` |
| IP local/privada | `200` o `403` | — (lookup omitido, aplica fallback) |
| `ctx.geo` ya disponible | `200` o `403` | `DEBUG GeoIP from SecurityContext (no API call)` |

---

## Script de prueba

```bash
npm run test:geo
```

```
── 1. Blacklist (KP, SY) — fallbackAllow: true ──

✅ [200] GET /geo-blacklist  ← IP local → lookup omitido → fallback permite

── 2. Whitelist (MX, US, ES, AR, CO, CL) — fallbackAllow: true ──

✅ [200] GET /geo-whitelist  ← IP local → lookup omitido → fallback permite

── 3. Whitelist (MX, US, ES) — fallbackAllow: false ──

   IP local = país desconocido → sin fallback → debe bloquearse

🚫 [403] GET /geo-strict  ← IP local → lookup omitido → sin fallback → 403

  Error: Access from country 'unknown' is not allowed

── 4. SecurityContext — GeoIP se cachea entre guards ──

  ctx.geo: null (IP local sin lookup)
  ctx.ip:  ::1

✅ [200] GET /security-context  ← ambos guards leen del mismo SecurityContext
```

---

## Copiar a tu proyecto

1. Copia `geo-ip.guard.ts`
2. Copia `geo-ip.service.ts`
3. Registra en tu módulo:

```typescript
@Module({
  providers: [GeoIpGuard, GeoIpService, RedisStoreService, IpExtractorService, SecurityContextService],
})
export class TuModulo {}
```

4. Aplica en tus endpoints:

```typescript
@SetMetadata(GUARD_METADATA.GEO_IP_OPTIONS, {
  mode: 'blacklist',
  countries: ['KP', 'IR', 'SY'],
  fallbackAllow: true,
})
@UseGuards(GeoIpGuard)
@Get('data')
getData() {}
```
