import { createHmac, timingSafeEqual } from 'crypto';
import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { GUARD_METADATA } from '../../constants/guard.constants';
import { ReplayProtectionOptions } from '../../decorators/replay-protection.decorator';
import { RedisStoreService } from '../../services/redis-store.service';
import {
  InvalidSignatureException,
  SignatureExpiredException,
  SignatureMissingException,
  ReplayAttackException,
} from '../../exceptions/security.exception';

/**
 * ReplayProtectionGuard — fintech-grade replay attack prevention
 *
 * Combines three layers in a single guard:
 *
 *   1. Timestamp      → request must arrive within maxAgeSeconds (default 5 min)
 *   2. Nonce          → x-nonce stored with TTL; second request with same nonce = blocked
 *   3. HMAC signature → HMAC-SHA256(secret, `${timestamp}.${nonce}.${body}`)
 *                        all three fields are bound — none can be swapped independently
 *
 * ─── Why this is stronger than Nonce + Signature separately ──────────────────
 *
 *   NonceGuard alone:       no timestamp check, no tamper protection
 *   SignatureGuard alone:   timestamp + tamper protection, but nonce is NOT in the payload
 *                           → attacker can strip x-nonce and replace with a fresh one
 *                           → signature still validates, nonce check passes
 *   ReplayProtectionGuard:  signature covers timestamp + nonce + body together
 *                           → stripping or replacing any field breaks the signature
 *
 * ─── Use when ────────────────────────────────────────────────────────────────
 *
 *   - Service-to-service APIs (internal or partner)
 *   - Financial operations (transfers, withdrawals, settlements)
 *   - Any endpoint where a replayed or tampered request causes real harm
 *
 * ─── Don't use when ──────────────────────────────────────────────────────────
 *
 *   - Browser-facing endpoints (use CsrfGuard instead — browsers can't sign)
 *   - Endpoints already using SignatureGuard + NonceGuard (redundant)
 *
 * ─── Requires ────────────────────────────────────────────────────────────────
 *
 *   rawBody: true in NestFactory.create() — already enabled in this project.
 *
 * ─── Client-side (Node.js) ───────────────────────────────────────────────────
 *
 *   import { createHmac, randomBytes } from 'crypto';
 *
 *   const secret    = process.env.API_SECRET;
 *   const timestamp = Math.floor(Date.now() / 1000).toString();
 *   const nonce     = randomBytes(16).toString('hex');
 *   const body      = JSON.stringify({ amount: 100, to: 'alice' });
 *   const sig       = createHmac('sha256', secret)
 *                       .update(`${timestamp}.${nonce}.${body}`)
 *                       .digest('hex');
 *
 *   fetch('/api/transfer', {
 *     method: 'POST',
 *     headers: {
 *       'Content-Type': 'application/json',
 *       'x-timestamp': timestamp,
 *       'x-nonce':     nonce,
 *       'x-signature': sig,
 *     },
 *     body,
 *   });
 *
 * Usage:
 *   @ReplayProtect({ secret: process.env.API_SECRET })
 *   @UseGuards(ReplayProtectionGuard)
 *   @Post('transfer')
 *   transfer(@Body() dto: TransferDto) {}
 */
@Injectable()
export class ReplayProtectionGuard implements CanActivate {
  private readonly logger = new Logger(ReplayProtectionGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly store: RedisStoreService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const options = this.reflector.getAllAndOverride<ReplayProtectionOptions | undefined>(
      GUARD_METADATA.REPLAY_PROTECTION_OPTIONS,
      [context.getHandler(), context.getClass()],
    );

    if (!options) return true;

    const request = context.switchToHttp().getRequest<Request & { rawBody?: Buffer }>();

    const tsHeader  = options.timestampHeader  ?? 'x-timestamp';
    const nonceHdr  = options.nonceHeader      ?? 'x-nonce';
    const sigHeader = options.signatureHeader  ?? 'x-signature';

    const receivedTs  = request.headers[tsHeader]  as string | undefined;
    const receivedNonce = request.headers[nonceHdr] as string | undefined;
    const receivedSig = request.headers[sigHeader]  as string | undefined;

    // ── 1. Require all three headers ────────────────────────────────────────
    if (!receivedTs) {
      this.logger.warn(`Missing '${tsHeader}' — ${request.method} ${request.url}`);
      throw new SignatureMissingException(tsHeader);
    }
    if (!receivedNonce) {
      this.logger.warn(`Missing '${nonceHdr}' — ${request.method} ${request.url}`);
      throw new SignatureMissingException(nonceHdr);
    }
    if (!receivedSig) {
      this.logger.warn(`Missing '${sigHeader}' — ${request.method} ${request.url}`);
      throw new SignatureMissingException(sigHeader);
    }

    // ── 2. Timestamp freshness ───────────────────────────────────────────────
    const maxAge = options.maxAgeSeconds ?? 300;
    const ts     = parseInt(receivedTs, 10);
    const now    = Math.floor(Date.now() / 1000);

    if (isNaN(ts) || Math.abs(now - ts) > maxAge) {
      this.logger.warn(
        `Timestamp out of window (received=${receivedTs}, now=${now}, maxAge=${maxAge}s) — ` +
          `${request.method} ${request.url}`,
      );
      throw new SignatureExpiredException(maxAge);
    }

    // ── 3. HMAC signature — covers timestamp + nonce + body ─────────────────
    const rawBody = request.rawBody;
    if (!rawBody) {
      this.logger.error(
        'ReplayProtectionGuard: req.rawBody is undefined. ' +
          'Enable it with: NestFactory.create(AppModule, { rawBody: true })',
      );
      throw new InvalidSignatureException();
    }

    const body    = rawBody.toString('utf-8');
    const message = `${receivedTs}.${receivedNonce}.${body}`;

    const secret   = typeof options.secret === 'function' ? await options.secret() : options.secret;
    const expected = createHmac('sha256', secret).update(message).digest('hex');

    const expectedBuf = Buffer.from(expected);
    const receivedBuf = Buffer.from(receivedSig);

    const valid =
      expectedBuf.length === receivedBuf.length &&
      timingSafeEqual(expectedBuf, receivedBuf);

    if (!valid) {
      this.logger.warn(
        `Invalid signature — ${request.method} ${request.url} ` +
          `nonce=${receivedNonce.slice(0, 8)}...`,
      );
      throw new InvalidSignatureException();
    }

    // ── 4. Nonce uniqueness — checked AFTER signature so we don't burn nonces
    //       on requests with invalid signatures (potential DoS via nonce exhaustion)
    const nonceTtlMs = options.nonceTtlMs ?? 600_000;
    const storeKey   = `replay:${receivedNonce}`;
    const isNew      = await this.store.setnx(storeKey, '1', nonceTtlMs);

    if (!isNew) {
      this.logger.warn(
        `Replay attack blocked — nonce "${receivedNonce.slice(0, 8)}..." already used ` +
          `[${request.method} ${request.url}]`,
      );
      throw new ReplayAttackException();
    }

    this.logger.debug(
      `ReplayProtection passed — nonce="${receivedNonce.slice(0, 8)}..." ` +
        `ts=${receivedTs} stored for ${nonceTtlMs / 1000}s`,
    );

    return true;
  }
}
