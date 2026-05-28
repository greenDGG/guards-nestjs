import { Controller, Get, Param, UseGuards, SetMetadata } from '@nestjs/common';
import { Public } from '../decorators/public.decorator';
import { CurrentUser } from '../decorators/current-user.decorator';
import { RequireSubscription } from '../decorators/subscription.decorator';
import { SubscriptionGuard } from '../guards/business/subscription.guard';
import { TimeBasedAccessGuard } from '../guards/business/time-based-access.guard';
import { TenantGuard } from '../guards/business/tenant.guard';
import { MfaGuard } from '../guards/business/mfa.guard';
import { GUARD_METADATA } from '../constants/guard.constants';
import { JwtPayload } from '../interfaces/jwt-payload.interface';

/**
 * Level 5 — Business Logic Guards Demo
 * Base: http://localhost:3000/demo/level5
 *
 * Nota: SubscriptionGuard y MfaGuard leen del JWT payload.
 * Para probar, genera un token con el campo correspondiente:
 *   subscriptionPlan: 'pro'
 *   mfaVerifiedAt: Math.floor(Date.now() / 1000)
 */
@Controller('demo/level5')
export class Level5BusinessController {

  // ── Subscription — plan free (todos pasan) ────────────────────────────────
  @Get('free-feature')
  @RequireSubscription('free')
  @UseGuards(SubscriptionGuard)
  freeFeature(@CurrentUser() user: JwtPayload) {
    return {
      guard: 'SubscriptionGuard',
      required: 'free',
      message: 'Feature del plan free — todos pasan',
      userPlan: (user as any).subscriptionPlan ?? 'free (default)',
    };
  }

  // ── Subscription — plan pro ────────────────────────────────────────────────
  // El JWT debe contener subscriptionPlan: 'pro' o superior
  @Get('pro-feature')
  @RequireSubscription('pro')
  @UseGuards(SubscriptionGuard)
  proFeature(@CurrentUser() user: JwtPayload) {
    return {
      guard: 'SubscriptionGuard',
      required: 'pro',
      message: 'Feature del plan pro',
      userPlan: (user as any).subscriptionPlan,
    };
  }

  // ── Subscription — enterprise ─────────────────────────────────────────────
  @Get('enterprise-feature')
  @RequireSubscription('enterprise')
  @UseGuards(SubscriptionGuard)
  enterpriseFeature(@CurrentUser() user: JwtPayload) {
    return {
      guard: 'SubscriptionGuard',
      required: 'enterprise',
      message: 'Feature exclusiva enterprise',
      userPlan: (user as any).subscriptionPlan,
    };
  }

  // ── Time Access — siempre abierto (24/7) ──────────────────────────────────
  @Get('always-open')
  @SetMetadata(GUARD_METADATA.TIME_ACCESS_OPTIONS, {
    allowedWindows: [{ start: '00:00', end: '23:59' }],
    timezone: 'UTC',
  })
  @UseGuards(TimeBasedAccessGuard)
  @Public()
  alwaysOpen() {
    return {
      guard: 'TimeBasedAccessGuard',
      message: 'Acceso 24/7',
      currentTime: new Date().toISOString(),
    };
  }

  // ── Time Access — solo horario de oficina México ───────────────────────────
  // Lunes–Viernes 9am–6pm hora México City
  @Get('business-hours')
  @SetMetadata(GUARD_METADATA.TIME_ACCESS_OPTIONS, {
    allowedWindows: [
      { start: '09:00', end: '18:00', days: [1, 2, 3, 4, 5] },
    ],
    timezone: 'America/Mexico_City',
  })
  @UseGuards(TimeBasedAccessGuard)
  @Public()
  businessHours() {
    const now = new Date();
    return {
      guard: 'TimeBasedAccessGuard',
      message: 'Acceso permitido — estás en horario de oficina (MX)',
      serverTime: now.toISOString(),
    };
  }

  // ── Time Access — ventana muy corta para probar bloqueo ───────────────────
  // Solo permite acceso entre :00 y :01 de cada hora (casi siempre bloqueado)
  @Get('narrow-window')
  @SetMetadata(GUARD_METADATA.TIME_ACCESS_OPTIONS, {
    allowedWindows: [{ start: '00:00', end: '00:01' }],
    timezone: 'UTC',
  })
  @UseGuards(TimeBasedAccessGuard)
  @Public()
  narrowWindow() {
    return { guard: 'TimeBasedAccessGuard', message: 'Pasaste la ventana de 1 minuto' };
  }

  // ── Tenant — aislamiento multi-tenant (strict: false) ───────────────────
  // El tenantId del JWT debe coincidir con el :tenantId de la URL.
  // strict: false → si no hay tenantId en el JWT, el guard pasa igual.
  // Ejecuta: npx ts-node scripts/test-tenant.ts
  @Get('tenant/:tenantId/data')
  @SetMetadata(GUARD_METADATA.TENANT_OPTIONS, {
    tenantIdSources: ['param'],
    paramName: 'tenantId',
    strict: false,
  })
  @UseGuards(TenantGuard)
  tenantData(@Param('tenantId') tenantId: string, @CurrentUser() user: JwtPayload) {
    return {
      guard: 'TenantGuard (strict: false)',
      message: 'Acceso al tenant autorizado',
      requestedTenant: tenantId,
      jwtTenant: (user as any).tenantId ?? '(no tenant en JWT)',
    };
  }

  // ── Tenant — strict: true ─────────────────────────────────────────────────
  // Sin tenantId en el JWT → 403 inmediato (no puede determinar el tenant del usuario)
  @Get('tenant/:tenantId/strict-data')
  @SetMetadata(GUARD_METADATA.TENANT_OPTIONS, {
    tenantIdSources: ['param'],
    paramName: 'tenantId',
    strict: true,
  })
  @UseGuards(TenantGuard)
  tenantStrictData(@Param('tenantId') tenantId: string, @CurrentUser() user: JwtPayload) {
    return {
      guard: 'TenantGuard (strict: true)',
      message: 'Acceso al tenant autorizado — modo estricto',
      requestedTenant: tenantId,
      jwtTenant: (user as any).tenantId,
    };
  }

  // ── MFA — verifica que el usuario completó MFA recientemente ─────────────
  // El JWT debe contener mfaVerifiedAt (unix timestamp en segundos)
  // Ejecuta: npx ts-node scripts/test-mfa.ts
  @Get('mfa-required')
  @SetMetadata(GUARD_METADATA.MFA_OPTIONS, { maxAgeSeconds: 3600 })
  @UseGuards(MfaGuard)
  mfaRequired(@CurrentUser() user: JwtPayload) {
    const mfaAge = user.mfaVerifiedAt
      ? Math.floor(Date.now() / 1000) - user.mfaVerifiedAt
      : null;
    return {
      guard: 'MfaGuard',
      message: 'MFA verificado correctamente',
      mfaVerifiedSecondsAgo: mfaAge,
    };
  }

  // ── MFA — soft (required: false) ─────────────────────────────────────────
  // Pasa aunque el usuario no tenga MFA configurado.
  // Útil para endpoints sensibles que quieren aprovechar MFA si está disponible
  // pero no quieren bloquear a usuarios que aún no lo configuraron.
  @Get('mfa-optional')
  @SetMetadata(GUARD_METADATA.MFA_OPTIONS, { maxAgeSeconds: 3600, required: false })
  @UseGuards(MfaGuard)
  mfaOptional(@CurrentUser() user: JwtPayload) {
    const mfaAge = user.mfaVerifiedAt
      ? Math.floor(Date.now() / 1000) - user.mfaVerifiedAt
      : null;
    return {
      guard: 'MfaGuard (required: false)',
      message: mfaAge !== null
        ? `MFA verificado hace ${mfaAge}s — acceso con 2FA`
        : 'Sin MFA en el token — acceso de todas formas (required: false)',
      mfaVerifiedSecondsAgo: mfaAge,
    };
  }
}
