# HeaderValidationGuard

Validación determinística de headers HTTP. Bloquea en la primera violation — sin acumulación de score, sin umbral. Diferente de `BotDetectionGuard` (probabilístico): este guard aplica reglas exactas que la mayoría de bots no pasan.

```
BotDetectionGuard:      score = 25 + 5 + 5 = 35 → bajo threshold 70 → pasa
HeaderValidationGuard:  sec-ch-ua ausente → BLOCK inmediato (sin importar el score)
```

---

## Archivos

```
src/guards/security/header-validation.guard.ts
src/decorators/header-validation.decorator.ts
src/examples/level2-security.controller.ts
scripts/test-header-validation.ts
```

---

## Quick start

```bash
npm run start:dev
npm run test:header-validation
```

---

## Checks disponibles

| Check | Opción | Por defecto |
|-------|--------|-------------|
| Automation header blocklist | `blockAutomationHeaders` | `true` |
| Accept + Accept-Language + Accept-Encoding requeridos | `requireBrowserHeaders` | `false` |
| Browser UA con `Accept: */*` | `checkAcceptWildcard` | `false` |
| Chrome 90+ sin `Sec-CH-UA` / versión incorrecta | `checkSecChUa` | `false` |
| Mínimo N headers en la request | `minHeaderCount` | desactivado |
| Reglas custom por header | `rules` | `[]` |
| Log sin bloquear | `logOnly` | `false` |

---

## Uso

```typescript
// Default — automation blocklist, costo cero de configuración
@HeaderValidate()
@UseGuards(HeaderValidationGuard)
@Post('login')
login() {}

// Browser-facing endpoint — checks completos
@HeaderValidate({
  requireBrowserHeaders: true,
  checkSecChUa:          true,
  checkAcceptWildcard:   true,
})
@UseGuards(HeaderValidationGuard)
@Get('home')
home() {}

// API — versión requerida + Accept no wildcard
@HeaderValidate({
  rules: [
    { header: 'x-api-version', required: true, pattern: /^v\d+$/ },
    { header: 'accept',        required: true, notPattern: /^\*\/\*$/ },
  ],
})
@UseGuards(HeaderValidationGuard)
@Get('data')
data() {}

// Observar sin bloquear (ramp)
@HeaderValidate({ checkSecChUa: true, logOnly: true })
@UseGuards(HeaderValidationGuard)
@Get('feed')
feed() {}
```

---

## Opciones

```typescript
export interface HeaderValidationOptions {
  blockAutomationHeaders?: boolean;   // default: true
  requireBrowserHeaders?:  boolean;   // default: false
  checkSecChUa?:           boolean;   // default: false
  checkAcceptWildcard?:    boolean;   // default: false
  minHeaderCount?:         number;    // default: disabled
  rules?:                  HeaderRule[];
  logOnly?:                boolean;   // default: false
}

export interface HeaderRule {
  header:      string;          // nombre del header (case-insensitive)
  required?:   boolean;
  forbidden?:  boolean;
  pattern?:    string | RegExp; // valor debe coincidir
  notPattern?: string | RegExp; // valor NO debe coincidir
}
```

---

## Check 1 — Automation header blocklist

Patrones bloqueados:
```
x-playwright-*          Playwright injection
x-selenium-*            Selenium/WebDriver
x-webdriver-*           WebDriver variants
x-automation            generic test marker
__selenium-*            Selenium internal
__webdriver-*           WebDriver internal
__driver-*              driver frameworks
x-test-*                generic test headers
```

Estos headers son inyectados por frameworks de testing y **nunca** aparecen en tráfico real de usuarios.

```bash
# Bloqueado
curl http://localhost:3000/demo/level2/header-check -H "x-playwright: 1"
# 403 Invalid header 'x-playwright': automation/testing framework header detected

# Pasa
curl http://localhost:3000/demo/level2/header-check -H "accept: text/html"
# 200
```

---

## Check 2 — Browser required headers

`requireBrowserHeaders: true` requiere los tres headers que todos los navegadores envían:
- `Accept`
- `Accept-Language`
- `Accept-Encoding`

`curl`, `httpie`, y la mayoría de clientes HTTP no los envían por defecto.

```bash
# Bloqueado — curl no envía Accept-Language ni Accept-Encoding
curl http://localhost:3000/demo/level2/header-browser
# 400 Missing required header: 'accept-language'
```

---

## Check 3 — Accept wildcard

`checkAcceptWildcard: true` bloquea requests donde:
- User-Agent contiene `Mozilla`, `Chrome`, `Firefox`, `Safari`, o `Edg/`
- **Y** el header `Accept` es exactamente `*/*`

Los navegadores reales nunca envían `Accept: */*` — generan un accept header detallado. Un scraper que copia el UA pero usa un cliente HTTP básico sí lo hace.

```
Usuario real:   Accept: text/html,application/xhtml+xml,...,*/*;q=0.8
Scraper típico: Accept: */*   ← con UA de Chrome copiado
```

---

## Check 4 — Sec-CH-UA consistency

`checkSecChUa: true` verifica que Chrome 90+ envíe `Sec-CH-UA` y que la versión coincida con el User-Agent.

**Por qué funciona:**
Chrome agrega `Sec-CH-UA` automáticamente en todas las requests HTTPS. Un script que copia el UA de Chrome pero usa `requests`, `axios`, `curl`, etc. no enviará este header.

```
UA:         Mozilla/5.0 … Chrome/124.0.0.0 …
Requerido:  Sec-CH-UA: "Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"
```

**Caso A — missing:** UA dice Chrome/124 pero no hay `Sec-CH-UA` → `403`
**Caso B — version mismatch:** `Sec-CH-UA: "Chromium";v="110"` pero UA dice Chrome/124 → `403`
**Caso C — Firefox:** no aplica (solo Chrome/Chromium)

```bash
# Bloqueado (spoofed UA)
curl http://localhost:3000/demo/level2/header-sec-ch-ua \
  -H 'User-Agent: Mozilla/5.0 (Windows) Chrome/124.0.0.0 Safari/537.36'
# 403 UA claims Chrome/124 but Sec-CH-UA header is absent

# Pasa
curl http://localhost:3000/demo/level2/header-sec-ch-ua \
  -H 'User-Agent: Mozilla/5.0 (Windows) Chrome/124.0.0.0 Safari/537.36' \
  -H 'Sec-CH-UA: "Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"'
# 200
```

---

## Check 5 — Custom rules

```typescript
rules: [
  // Header requerido con formato específico
  { header: 'x-api-version', required: true, pattern: /^v\d+$/ },

  // Header que no puede tener un valor
  { header: 'accept', required: true, notPattern: /^\*\/\*$/ },

  // Header que no debe estar presente
  { header: 'x-debug-mode', forbidden: true },
]
```

Las reglas se evalúan en orden. En la primera violation se lanza la excepción.

---

## Response header

Siempre presente cuando el guard detecta violations (incluso en `logOnly`):

```
X-Header-Violations: 2
```

Útil para monitoreo sin bloquear.

---

## Excepciones

| Violation | Excepción | HTTP |
|-----------|-----------|------|
| Header required ausente | `MissingRequiredHeaderException` | 400 |
| Automation/invalid header | `InvalidHeaderException` | 403 |

---

## Diferencia con BotDetectionGuard

| | `BotDetectionGuard` | `HeaderValidationGuard` |
|---|---|---|
| Modelo | Score acumulado (0–100) | Reglas determinísticas |
| Bloqueo | Score ≥ threshold (default 70) | Primera violation |
| sec-ch-ua | No verifica | Versión + presencia |
| Automation headers | UA pattern (+25 pts) | Blocklist exacta |
| Custom rules | No | Sí (required/forbidden/pattern) |
| logOnly | Sí | Sí |

**Stack recomendado** — los dos juntos cubren capas diferentes:

```typescript
@HeaderValidate({ checkSecChUa: true, requireBrowserHeaders: true })
@SetMetadata(GUARD_METADATA.BOT_OPTIONS, { threshold: 60 })
@UseGuards(HeaderValidationGuard, BotDetectionGuard)
@Post('register')
register() {}
```

`HeaderValidationGuard` bloquea los bots con headers incorrectos antes de que lleguen al scoring de `BotDetectionGuard`.

---

## Script de prueba

```bash
npm run test:header-validation
```

```
── Check 1: Automation header blocklist ──

  🟢  Normal request — sin headers de automatización           HTTP 200  OK
  🔴  Con x-playwright: 1 → 403 automation detected            HTTP 403  Invalid header 'x-playwright'
  🔴  Con x-selenium-id → 403 automation detected              HTTP 403  Invalid header 'x-selenium-id'

── Check 3: Sec-CH-UA version consistency (Chrome 90+) ──

  🟢  Chrome/124 + Sec-CH-UA v="124" → 200 OK                 HTTP 200  OK
  🔴  Chrome/124 UA sin Sec-CH-UA → 403 spoofed UA             HTTP 403  UA claims Chrome/124 but…
  🔴  Chrome/124 UA con Sec-CH-UA v="110" → 403 mismatch       HTTP 403  Sec-CH-UA versions [110]…
  🟢  Firefox UA (no Chrome) → 200 OK (check no aplica)        HTTP 200  OK
```

---

## Copiar a tu proyecto

1. Copia `header-validation.guard.ts` y `header-validation.decorator.ts`
2. Necesita: `Reflector` (de `@nestjs/core` — ya disponible)
3. Registra:

```typescript
@Module({
  providers: [HeaderValidationGuard],
})
export class TuModulo {}
```
