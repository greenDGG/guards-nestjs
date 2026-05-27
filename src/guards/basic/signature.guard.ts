import { createHmac, timingSafeEqual } from 'crypto';
import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { GUARD_METADATA } from '../../constants/guard.constants';
import { SignatureOptions } from '../../decorators/signature.decorator';
import {
  InvalidSignatureException,
  SignatureExpiredException,
  SignatureMissingException,
} from '../../exceptions/security.exception';

/**
 * Level 2 — HMAC Signature Guard
 *
 * Verifies that incoming requests carry a valid HMAC-SHA256 signature.
 * Protects webhooks and internal service-to-service APIs.
 * Uses timing-safe comparison to prevent timing attacks.
 *
 * Requires rawBody to be available on the request. Enable it in main.ts:
 *   NestFactory.create(AppModule, { rawBody: true })
 *
 * ─── Stripe-style (default) ──────────────────────────────────────────────────
 *
 *   // Server setup:
 *   @Signature({ secret: process.env.WEBHOOK_SECRET })
 *   @UseGuards(SignatureGuard)
 *   @Post('webhook/stripe')
 *   stripeWebhook(@RawBody() body: Buffer) {}
 *
 *   // Client sends:
 *   const timestamp = Math.floor(Date.now() / 1000).toString();
 *   const message   = `${timestamp}.${rawBody}`;
 *   const sig       = createHmac('sha256', secret).update(message).digest('hex');
 *   headers: { 'x-timestamp': timestamp, 'x-signature': sig }
 *
 * ─── GitHub-style ────────────────────────────────────────────────────────────
 *
 *   @Signature({
 *     secret: process.env.GITHUB_SECRET,
 *     signaturePayload: 'body',
 *     signaturePrefix: 'sha256=',
 *     signatureHeader: 'x-hub-signature-256',
 *     maxTimestampAgeSeconds: 0,   // GitHub does not send a timestamp
 *   })
 *   @UseGuards(SignatureGuard)
 *   @Post('webhook/github')
 *   githubWebhook() {}
 *
 * ─── Internal service-to-service ─────────────────────────────────────────────
 *
 *   @Signature({ secret: process.env.INTERNAL_SECRET, maxTimestampAgeSeconds: 30 })
 *   @UseGuards(SignatureGuard)
 *   @Post('internal/sync')
 *   sync() {}
 */
@Injectable()
export class SignatureGuard implements CanActivate {
  private readonly logger = new Logger(SignatureGuard.name);

  constructor(private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const options = this.reflector.getAllAndOverride<SignatureOptions | undefined>(
      GUARD_METADATA.SIGNATURE_OPTIONS,
      [context.getHandler(), context.getClass()],
    );

    if (!options) return true;

    const request = context.switchToHttp().getRequest<Request & { rawBody?: Buffer }>();

    // rawBody requires NestFactory.create(AppModule, { rawBody: true })
    const rawBody = request.rawBody;
    if (!rawBody) {
      this.logger.error(
        'SignatureGuard: req.rawBody is undefined. ' +
          'Enable it with: NestFactory.create(AppModule, { rawBody: true })',
      );
      throw new InvalidSignatureException();
    }

    const sigHeader = options.signatureHeader ?? 'x-signature';
    const tsHeader  = options.timestampHeader  ?? 'x-timestamp';

    const receivedSig = request.headers[sigHeader] as string | undefined;
    if (!receivedSig) {
      this.logger.warn(`Missing signature header '${sigHeader}' — ${request.method} ${request.url}`);
      throw new SignatureMissingException(sigHeader);
    }

    // ── Timestamp / replay-attack check ────────────────────────────────────
    const maxAge      = options.maxTimestampAgeSeconds ?? 300;
    const needsTs     = maxAge > 0 && options.signaturePayload !== 'body';
    const receivedTs  = request.headers[tsHeader] as string | undefined;

    if (needsTs) {
      if (!receivedTs) {
        this.logger.warn(`Missing timestamp header '${tsHeader}' — ${request.method} ${request.url}`);
        throw new SignatureMissingException(tsHeader);
      }

      const ts  = parseInt(receivedTs, 10);
      const now = Math.floor(Date.now() / 1000);

      if (isNaN(ts) || Math.abs(now - ts) > maxAge) {
        this.logger.warn(
          `Timestamp out of window (received=${receivedTs}, now=${now}, maxAge=${maxAge}s) — ` +
            `${request.method} ${request.url}`,
        );
        throw new SignatureExpiredException(maxAge);
      }
    }

    // ── Build the message to sign ───────────────────────────────────────────
    const body    = rawBody.toString('utf-8');
    const payload = options.signaturePayload ?? 'timestamp.body';

    let message: string;
    if (payload === 'body') {
      message = body;
    } else if (payload === 'timestamp.body') {
      message = `${receivedTs}.${body}`;
    } else {
      // 'timestamp+body'
      message = `${receivedTs}${body}`;
    }

    // ── Compute expected signature ──────────────────────────────────────────
    const secret   = typeof options.secret === 'function' ? await options.secret() : options.secret;
    const algo     = options.algorithm ?? 'sha256';
    const encoding = options.encoding  ?? 'hex';
    const expected = createHmac(algo, secret).update(message).digest(encoding);

    // Strip prefix (GitHub sends 'sha256=abc123...')
    const prefix   = options.signaturePrefix ?? '';
    const received = receivedSig.startsWith(prefix) ? receivedSig.slice(prefix.length) : receivedSig;

    // ── Timing-safe comparison ──────────────────────────────────────────────
    const expectedBuf = Buffer.from(expected);
    const receivedBuf = Buffer.from(received);

    const valid =
      expectedBuf.length === receivedBuf.length &&
      timingSafeEqual(expectedBuf, receivedBuf);

    if (!valid) {
      this.logger.warn(`Invalid signature — ${request.method} ${request.url}`);
      throw new InvalidSignatureException();
    }

    this.logger.debug(`Signature verified — ${request.method} ${request.url}`);
    return true;
  }
}
