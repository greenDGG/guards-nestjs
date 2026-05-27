/**
 * SecurityContext — shared per-request security state
 *
 * Populated progressively as guards run. Middleware sets the initial fields
 * (ip, requestId, requestedAt). Each guard adds what it computes so the
 * next guard in the chain can read it without recomputing.
 *
 * Access in a controller handler:
 *   @SecurityCtx() ctx: SecurityContext
 *
 * Access in a guard:
 *   const ctx = SecurityContextService.get(request);
 *   ctx.botScore = 42;
 */
export interface SecurityContext {
  // ── Set by SecurityContextMiddleware (always present) ──────────────────
  ip: string;
  requestId: string;
  requestedAt: Date;

  // ── Set by JwtAuthGuard (present on authenticated routes) ──────────────
  userId?: string | number;
  roles?: string[];
  permissions?: string[];
  tenantId?: string;

  // ── Set by BotDetectionGuard ────────────────────────────────────────────
  botScore?: number;     // 0–100
  isBot?: boolean;       // true if score >= threshold

  // ── Set by GeoIpGuard ────────────────────────────────────────────────────
  geo?: {
    countryCode: string; // ISO 3166-1 alpha-2, e.g. 'MX'
    country: string;     // e.g. 'Mexico'
    city?: string;
    region?: string;
  };

  // ── Set by AdaptiveRateLimitGuard / AnomalyDetectionGuard ──────────────
  trustScore?: number;   // 0–100, default 75

  // ── Set by DeviceFingerprintGuard ───────────────────────────────────────
  deviceFingerprint?: string;

  // ── Extensible — guards can add custom properties ───────────────────────
  [key: string]: unknown;
}

// Augment Express Request so TypeScript knows about securityContext
declare module 'express' {
  interface Request {
    securityContext: SecurityContext;
  }
}
