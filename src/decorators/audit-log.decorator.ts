import { SetMetadata } from '@nestjs/common';
import { GUARD_METADATA } from '../constants/guard.constants';

export interface AuditEntry {
  /** Random 8-byte hex — unique per request. Set as X-Trace-Id response header. */
  traceId:    string;
  /** ISO 8601 timestamp of when the response was sent. */
  timestamp:  string;
  /** JWT `sub` field, or null for unauthenticated requests. */
  userId:     string | null;
  /** JWT `email` field if present, or null. */
  userEmail:  string | null;
  /** JWT `roles` array if present. */
  roles:      string[];
  /** Client IP — reads x-forwarded-for first, falls back to socket.remoteAddress. */
  ip:         string;
  userAgent:  string;
  /** HTTP method (GET, POST, etc.) */
  method:     string;
  /** Full URL with query string. */
  url:        string;
  /** Parametric route template: /users/:id (not the actual URL). */
  route:      string;
  /** Human-readable action label. Default: `${method} ${route}`. */
  action:     string;
  /** Resource being accessed. Default: last segment of route. */
  resource:   string;
  /** Sanitized request body (sensitive fields replaced with [REDACTED]). Null if logBody: false. */
  body:       Record<string, unknown> | null;
  statusCode: number;
  durationMs: number;
  outcome:    'success' | 'error';
  /** Error message if outcome === 'error'. */
  error?:     string;
}

export interface AuditLogOptions {
  /**
   * Human-readable label for the action being audited.
   * @default `${method} ${route}` — e.g. "POST /transfer"
   */
  action?: string;

  /**
   * Resource being accessed — useful for grouping audit entries.
   * @default last path segment of the route
   * @example 'transfer', 'user-profile', 'api-key'
   */
  resource?: string;

  /**
   * Body fields to replace with "[REDACTED]" before logging.
   * @default ['password','token','secret','authorization','cvv','pin','privateKey','mnemonic','seedPhrase']
   */
  sensitiveFields?: string[];

  /**
   * Whether to include the sanitized request body in the audit entry.
   * Set to false for endpoints that handle large payloads (file uploads, bulk operations).
   * @default true
   */
  logBody?: boolean;

  /**
   * Custom async logger function.
   * When provided, the default NestJS Logger output is skipped entirely.
   * Use this to send audit entries to a database, CloudWatch, DataDog, etc.
   * If the function throws, the error is caught and logged — the response is NOT affected.
   */
  logger?: (entry: AuditEntry) => void | Promise<void>;
}

/**
 * Attach audit logging to a handler or controller.
 *
 * @example
 * // Default — logs to NestJS Logger
 * @AuditLog({ resource: 'transfer' })
 * @UseInterceptors(AuditLogInterceptor)
 * @Post('transfer')
 * transfer() {}
 *
 * @example
 * // Custom sink — send to database
 * @AuditLog({
 *   resource: 'transfer',
 *   logger: async (entry) => db.auditLogs.insert(entry),
 * })
 * @UseInterceptors(AuditLogInterceptor)
 * @Post('transfer')
 * transfer() {}
 */
export const AuditLog = (options: AuditLogOptions = {}) =>
  SetMetadata(GUARD_METADATA.AUDIT_LOG_OPTIONS, options);
