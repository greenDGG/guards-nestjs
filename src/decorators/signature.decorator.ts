import { SetMetadata } from '@nestjs/common';
import { GUARD_METADATA } from '../constants/guard.constants';

export interface SignatureOptions {
  /**
   * Shared secret used to compute the HMAC.
   * Can be a static string or an async factory (e.g., to load from a secrets manager).
   */
  secret: string | (() => string | Promise<string>);

  /**
   * Header that carries the signature value.
   * @default 'x-signature'
   */
  signatureHeader?: string;

  /**
   * Header that carries the Unix timestamp (seconds).
   * Used to prevent replay attacks.
   * @default 'x-timestamp'
   */
  timestampHeader?: string;

  /**
   * How to build the message that gets signed:
   *
   *   'body'            → HMAC(body)                     — simple, no replay protection
   *   'timestamp.body'  → HMAC(timestamp + '.' + body)   — Stripe style ⭐
   *   'timestamp+body'  → HMAC(timestamp + body)          — GitHub-like alternative
   *
   * @default 'timestamp.body'
   */
  signaturePayload?: 'body' | 'timestamp.body' | 'timestamp+body';

  /**
   * HMAC algorithm.
   * @default 'sha256'
   */
  algorithm?: 'sha256' | 'sha512' | 'sha1';

  /**
   * Prefix to strip from the received signature before comparing.
   * GitHub webhooks prefix with 'sha256=', so set this to 'sha256='.
   * @default ''
   */
  signaturePrefix?: string;

  /**
   * Digest encoding of the expected signature.
   * @default 'hex'
   */
  encoding?: 'hex' | 'base64';

  /**
   * Maximum age of the timestamp in seconds before rejecting the request.
   * Set to 0 to disable timestamp validation (only if signaturePayload is 'body').
   * @default 300 (5 minutes)
   */
  maxTimestampAgeSeconds?: number;
}

export const Signature = (options: SignatureOptions) =>
  SetMetadata(GUARD_METADATA.SIGNATURE_OPTIONS, options);
