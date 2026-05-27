import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { GUARD_METADATA } from '../../constants/guard.constants';
import { NonceOptions } from '../../decorators/nonce.decorator';
import { RedisStoreService } from '../../services/redis-store.service';
import { SecurityContextService } from '../../services/security-context.service';
import {
  ReplayAttackException,
  NonceMissingException,
  NonceInvalidException,
} from '../../exceptions/security.exception';

/**
 * Nonce Guard — replay attack prevention
 *
 * A nonce (Number used ONCE) ensures every request is unique.
 * The server stores each nonce with a TTL; if the same nonce arrives
 * again within that window, the request is rejected as a replay attack.
 *
 * ─── Difference from IdempotencyInterceptor ───────────────────────────────
 *
 *   Idempotency: "Same request? Return the same cached response." (intentional)
 *   Nonce:       "Same request? Rejected. Someone is replaying it." (security)
 *
 *   Idempotency is a feature. Nonce is a defense.
 *
 * ─── How to combine with SignatureGuard ───────────────────────────────────
 *
 *   // Signature proves the request hasn't been tampered with (integrity).
 *   // Nonce proves it hasn't been replayed (freshness).
 *   // Together: full protection against MitM and replay attacks.
 *
 *   @Signature({ secret: process.env.API_SECRET })
 *   @Nonce({ ttlMs: 600_000, scope: 'user' })
 *   @UseGuards(SignatureGuard, NonceGuard)
 *   @Post('transfer')
 *   transfer() {}
 *
 * ─── Client side ──────────────────────────────────────────────────────────
 *
 *   import { randomUUID } from 'crypto';
 *   const nonce = randomUUID();           // or nanoid(), or any unique token
 *   headers['x-nonce'] = nonce;
 *   // Include nonce in the signed payload so it can't be stripped by an attacker
 *   headers['x-signature'] = sign(`${timestamp}.${body}.${nonce}`);
 *
 * ─── Why include the nonce in the signature? ──────────────────────────────
 *
 *   Without it, an attacker can strip the x-nonce header and replace it
 *   with a fresh one — the signature still verifies but the nonce check
 *   passes. Include nonce in the signed string to bind them together.
 *
 * ─── Replay window ────────────────────────────────────────────────────────
 *
 *   ttlMs should be at least as long as the timestamp window in SignatureGuard
 *   (default 5 min). Set to 10 min for safety margin.
 *   After ttlMs the nonce expires — a new request with the same nonce would
 *   be treated as fresh. Keep ttlMs short to limit storage growth.
 *
 * Usage:
 *   @Nonce()
 *   @UseGuards(NonceGuard)
 *   @Post('payment')
 *   pay() {}
 *
 *   // Client sends: x-nonce: 550e8400-e29b-41d4-a716-446655440000
 *   // Second request with same nonce → 401 Replay attack detected
 */
@Injectable()
export class NonceGuard implements CanActivate {
  private readonly logger = new Logger(NonceGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly store: RedisStoreService,
    private readonly secCtx: SecurityContextService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const options = this.reflector.getAllAndOverride<NonceOptions | undefined>(
      GUARD_METADATA.NONCE_OPTIONS,
      [context.getHandler(), context.getClass()],
    );

    if (!options) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const ctx     = this.secCtx.get(request);

    const headerName = options.header ?? 'x-nonce';
    const nonce      = request.headers[headerName] as string | undefined;

    // ── Missing nonce ────────────────────────────────────────────────────────
    if (!nonce) {
      if (options.optional) return true;
      this.logger.warn(`Missing nonce header '${headerName}' — ${request.method} ${request.url}`);
      throw new NonceMissingException(headerName);
    }

    // ── Validate nonce format ────────────────────────────────────────────────
    const minLength = options.minLength ?? 16;
    if (nonce.length < minLength) {
      this.logger.warn(`Nonce too short (${nonce.length} < ${minLength}) — ${request.url}`);
      throw new NonceInvalidException(`minimum length is ${minLength} characters`);
    }

    // Only printable ASCII — no null bytes or control characters
    if (!/^[\x21-\x7E]+$/.test(nonce)) {
      this.logger.warn(`Nonce contains invalid characters — ${request.url}`);
      throw new NonceInvalidException('must contain only printable ASCII characters');
    }

    // ── Build scoped store key ───────────────────────────────────────────────
    // Scoping prevents user A's nonce from colliding with user B's nonce.
    // An attacker cannot reuse a captured nonce by pretending to be a different user.
    let scopePrefix: string;
    if (options.scope === 'global') {
      scopePrefix = 'global';
    } else {
      // 'user' scope (default) — keyed by JWT sub or IP fallback
      scopePrefix = `user:${ctx.userId ?? ctx.ip}`;
    }

    const storeKey = `nonce:${scopePrefix}:${nonce}`;
    const ttlMs    = options.ttlMs ?? 600_000; // 10 minutes

    // ── Atomic check-and-set (prevents race condition) ───────────────────────
    // setnx returns false if the key already exists → replay detected
    const isNew = await this.store.setnx(storeKey, '1', ttlMs);

    if (!isNew) {
      this.logger.warn(
        `Replay attack blocked — nonce "${nonce.slice(0, 8)}..." already used ` +
          `[${request.method} ${request.url}] user=${ctx.userId ?? ctx.ip}`,
      );
      throw new ReplayAttackException();
    }

    this.logger.debug(
      `Nonce accepted — "${nonce.slice(0, 8)}..." stored for ${ttlMs / 1000}s`,
    );

    return true;
  }
}
