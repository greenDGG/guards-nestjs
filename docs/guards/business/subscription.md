# SubscriptionGuard

Controla el acceso a features según el **plan de suscripción** del usuario. Lee `subscriptionPlan` del JWT y lo compara con la jerarquía de planes — un plan superior siempre satisface los requisitos de planes inferiores.

```
Jerarquía: free < starter < pro < enterprise

GET /pro-feature   (requiere: 'pro')
  → plan free       ❌ 403
  → plan pro        ✅ 200
  → plan enterprise ✅ 200  (superior satisface 'pro')
```

---

## Archivos

```
src/guards/business/subscription.guard.ts
src/decorators/subscription.decorator.ts
scripts/test-subscription.ts
```

---

## Quick start

```bash
npm run start:dev
npm run test:subscription
```

---

## Uso

### Plan único requerido

```typescript
@RequireSubscription('pro')
@UseGuards(SubscriptionGuard)
@Get('advanced-analytics')
advancedAnalytics() {}
// free → 403 | starter → 403 | pro → 200 | enterprise → 200
```

### Plan mínimo con jerarquía implícita

```typescript
@RequireSubscription('starter')
@UseGuards(SubscriptionGuard)
@Post('export-csv')
exportCsv() {}
// free → 403 | starter → 200 | pro → 200 | enterprise → 200
```

### Jerarquía personalizada

```typescript
@RequireSubscription('premium', ['basic', 'standard', 'premium', 'unlimited'])
@UseGuards(SubscriptionGuard)
@Get('feature')
feature() {}
// La jerarquía custom reemplaza la default (free/starter/pro/enterprise)
```

### Múltiples planes válidos (OR)

```typescript
@RequireSubscription(['pro', 'legacy-gold'])
@UseGuards(SubscriptionGuard)
@Get('feature')
feature() {}
// Pasa con 'pro' O con 'legacy-gold' — útil durante migraciones de planes
```

---

## `@RequireSubscription()` decorator

```typescript
export const RequireSubscription = (
  requiredPlan: string | string[],
  planHierarchy?: string[],
) => SetMetadata(GUARD_METADATA.SUBSCRIPTION_OPTIONS, {
  requiredPlan,
  planHierarchy: planHierarchy ?? ['free', 'starter', 'pro', 'enterprise'],
});
```

| Parámetro | Descripción |
|-----------|-------------|
| `requiredPlan` | Plan mínimo requerido. String o array de planes válidos (OR) |
| `planHierarchy` | Orden de planes de menor a mayor. Default: `['free','starter','pro','enterprise']` |

---

## Cómo funciona la jerarquía

```
hierarchy = ['free', 'starter', 'pro', 'enterprise']
             index 0   index 1   index 2    index 3

userPlan = 'enterprise'  → index 3
required = 'pro'         → index 2

3 >= 2 → ✅ acceso permitido
```

Si el plan del usuario no está en la jerarquía, se hace comparación exacta de strings. Esto permite planes fuera de la jerarquía (ej: `'legacy-gold'`) que solo pasan si coinciden exactamente.

---

## `subscriptionPlan` en el JWT

El guard lee `user.subscriptionPlan` del JWT. Si el campo está ausente, asume `'free'` como plan por defecto:

```typescript
const userPlan: string = user.subscriptionPlan ?? 'free';
```

Para tokens de prueba, el proyecto expone:

```
POST /auth/test/subscription-token
Body: { username, password, subscriptionPlan: 'free' | 'starter' | 'pro' | 'enterprise' }
```

En producción, `subscriptionPlan` se incluye en el JWT durante el login después de consultar el plan actual del usuario en la DB.

---

## Comportamiento

| Situación | Status | Log |
|-----------|--------|-----|
| Plan satisface el requisito (igual o superior) | `200` | `DEBUG Subscription ok: user plan 'pro' satisfies [pro]` |
| Plan insuficiente | `403` | `WARN User 2 plan 'free' insufficient — requires: [pro]` |
| Sin `subscriptionPlan` en JWT | Usa `'free'` como default | — |
| Sin `@RequireSubscription()` | `200` | — (guard no aplica) |
| Sin `request.user` (sin JWT) | `403` | — |

---

## Script de prueba

```bash
npm run test:subscription
```

```
── GET /demo/level5/free-feature  (requiere: "free") ──

✅ [200] plan free → PASS (satisface requisito "free")
✅ [200] plan pro  → PASS (superior satisface "free")

── GET /demo/level5/pro-feature  (requiere: "pro") ──

🚫 [403] plan free → BLOCKED  —  This feature requires a 'pro' subscription plan
✅ [200] plan pro  → PASS (satisface exacto)
✅ [200] plan enterprise → PASS (superior satisface "pro")

── GET /demo/level5/enterprise-feature  (requiere: "enterprise") ──

🚫 [403] plan pro        → BLOCKED  —  This feature requires a 'enterprise' subscription plan
✅ [200] plan enterprise → PASS

── Sin token ──

🔐 [401] Sin token → BLOCKED (JwtAuthGuard corre antes)
```

---

## Copiar a tu proyecto

1. Copia `subscription.guard.ts` y `subscription.decorator.ts`
2. Copia `SubscriptionRequiredException` de `business.exception.ts`
3. Registra en tu módulo:

```typescript
@Module({
  providers: [SubscriptionGuard],
})
export class TuModulo {}
```

4. Agrega `subscriptionPlan` al JWT durante el login:

```typescript
const plan = await billingService.getUserPlan(user.id);  // 'free' | 'pro' | 'enterprise'
const payload = { sub: user.id, username: user.username, subscriptionPlan: plan, ... };
return { accessToken: jwt.sign(payload, secret) };
```

5. Aplica en tus endpoints:

```typescript
@RequireSubscription('pro')
@UseGuards(SubscriptionGuard)
@Get('pro-feature')
proFeature() {}
```
