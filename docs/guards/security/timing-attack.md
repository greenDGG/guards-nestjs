# TimingAttackGuard + TimingAttackInterceptor

Garantiza que todas las respuestas tarden **al menos `minResponseMs`** milisegundos, independientemente de si la operación fue exitosa o falló. Elimina el canal lateral de timing que permite a un atacante inferir información midiendo la latencia de respuesta.

```
Sin protección:
  "usuario no existe"  → responde en ~5ms   ← atacante deduce que el usuario NO existe
  "contraseña inválida" → responde en ~200ms ← atacante deduce que el usuario SÍ existe

Con TimingAttackGuard (minResponseMs=300):
  "usuario no existe"  → padded → ~300ms   ← indistinguible
  "contraseña inválida" → padded → ~300ms   ← indistinguible
```

---

## Archivos

```
src/guards/security/timing-attack.guard.ts   ← guard + interceptor (mismo archivo)
src/examples/level2-security.controller.ts   ← dos endpoints de demo
scripts/test-timing-attack.ts
```

---

## Quick start

```bash
npm run start:dev
npm run test:timing-attack
```

---

## Uso

Ambos son obligatorios — el guard registra el tiempo de inicio, el interceptor garantiza el tiempo mínimo:

```typescript
@SetMetadata(GUARD_METADATA.TIMING_ATTACK_OPTIONS, {
  minResponseMs: 300,
  jitterMs: 100,    // opcional
})
@UseGuards(TimingAttackGuard)
@UseInterceptors(TimingAttackInterceptor)
@Post('login')
login(@Body() dto: LoginDto) {}
```

---

## Opciones

```typescript
export interface TimingAttackOptions {
  minResponseMs: number;   // tiempo mínimo garantizado en ms
  jitterMs?:     number;   // jitter aleatorio adicional (default: 0)
}
```

| Campo | Default | Descripción |
|-------|---------|-------------|
| `minResponseMs` | — | Tiempo mínimo que tomará la respuesta. Si el handler termina antes, el interceptor duerme la diferencia |
| `jitterMs` | `0` | Añade un delay extra aleatorio entre 0 y `jitterMs` ms. Evita que un atacante con conocimiento del floor fijo pueda analizar patrones |

### ¿Cuánto `minResponseMs` elegir?

Debe ser mayor que el **path más lento** en condiciones normales. Si bcrypt tarda ~200ms:

```typescript
minResponseMs: 300   // margen de 100ms sobre el path más lento
jitterMs: 50         // añade entre 0 y 50ms de ruido
// respuestas: 300–350ms siempre
```

---

## Arquitectura guard + interceptor

El guard y el interceptor se comunican vía campos en el objeto `request`:

```
Guard (canActivate):
  request._timingStart   = Date.now()
  request._timingOptions = { minResponseMs: 300, jitterMs: 100 }

Interceptor (intercept):
  target  = minResponseMs + random(0, jitterMs)
  elapsed = Date.now() - _timingStart
  wait    = max(0, target - elapsed)
  await sleep(wait)
  → retorna valor  O  re-lanza el error original
```

El interceptor **nunca suprime errores** — los re-lanza después del padding. Un `401 Unauthorized` sigue llegando al cliente, solo que después de `minResponseMs`.

---

## Jitter — por qué importa

Sin jitter, el timing fijo es detectable:

```
Todas las respuestas exactamente 300ms → atacante confirma el floor, puede buscar patrones
```

Con `jitterMs: 50`:

```
Respuestas: 300ms, 327ms, 312ms, 341ms, 305ms → no hay patrón explotable
```

El jitter también protege contra ataques estadísticos con muchas muestras.

---

## Casos de uso

| Endpoint | `minResponseMs` | Justificación |
|----------|----------------|---------------|
| Login / autenticación | 300–500ms | Esconde si el usuario existe |
| Reset de contraseña | 300–500ms | Esconde si el email está registrado |
| 2FA / OTP check | 200–300ms | Esconde si el código es correcto antes del incremento de intentos |
| API key validation | 100–200ms | Esconde velocidad de lookup |
| Cualquier lookup con resultado binario | variable | Si la diferencia "existe/no existe" es observable |

---

## Comportamiento

| Situación | Tiempo de respuesta | Status |
|-----------|--------------------|----|
| Handler rápido (<5ms), sin error | padded a `minResponseMs + jitter` | `200` |
| Handler lento (< minResponseMs), sin error | padded a `minResponseMs + jitter` | `200` |
| Handler lento (> minResponseMs) | sin padding (`wait = 0`) | `200` |
| Handler lanza error | padded a `minResponseMs + jitter`, luego re-lanza | `4xx`/`5xx` |
| Sin `@SetMetadata` | sin padding | cualquiera |

---

## Script de prueba

```bash
npm run test:timing-attack
```

```
── Midiendo 5 muestras por path ──

  Path         ms     barra (0 ─────────────── 500ms)
  ─────────────────────────────────────────────────────
  timing-fast  312ms  ██████████████████░░░░░░░░░░░░
  timing-slow  334ms  ████████████████████░░░░░░░░░░

  timing-fast  305ms  ██████████████████░░░░░░░░░░░░
  timing-slow  310ms  ██████████████████░░░░░░░░░░░░
  ...

── Resumen ──

  timing-fast  promedio: 309ms  (handler: <5ms   + padding)
  timing-slow  promedio: 318ms  (handler: ~200ms + padding)
  diferencia observable: 9ms  ✅ indistinguibles

  Sin protección:
    timing-fast → ~5ms   ← atacante deduce "usuario no existe"
    timing-slow → ~200ms ← atacante deduce "usuario existe, contraseña incorrecta"

  Con TimingAttackGuard + Interceptor:
    timing-fast → ~309ms  ← sin información de timing
    timing-slow → ~318ms  ← sin información de timing
```

---

## Copiar a tu proyecto

1. Copia `timing-attack.guard.ts` (contiene el guard y el interceptor)
2. Registra en tu módulo:

```typescript
@Module({
  providers: [TimingAttackGuard, TimingAttackInterceptor],
})
export class TuModulo {}
```

3. Aplica en tus endpoints — **ambos son obligatorios**:

```typescript
@SetMetadata(GUARD_METADATA.TIMING_ATTACK_OPTIONS, {
  minResponseMs: 300,
  jitterMs: 50,
})
@UseGuards(TimingAttackGuard)
@UseInterceptors(TimingAttackInterceptor)
@Post('login')
login(@Body() dto: LoginDto) {}
```
