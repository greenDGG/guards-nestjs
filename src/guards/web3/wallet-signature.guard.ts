import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { randomBytes } from 'crypto';
import { Request } from 'express';
import { GUARD_METADATA } from '../../constants/guard.constants';
import { RedisStoreService } from '../../services/redis-store.service';
import {
  InvalidWalletSignatureException,
  WalletNonceExpiredException,
} from '../../exceptions/web3.exception';

export interface WalletSignatureOptions {
  messagePrefix?: string;
  nonceRequired?: boolean;
  nonceTtlMs?: number;
}

/**
 * Level 6 — Wallet Signature Guard (EIP-191 personal_sign)
 *
 * Verifies that the request comes from the actual owner of a wallet address
 * by checking a cryptographic signature produced with the wallet's private key.
 *
 * Flow:
 *   1. Client calls GET /auth/wallet/nonce/:address → receives a signed nonce
 *   2. Client signs the nonce with their wallet: eth.personal.sign(nonce, address)
 *   3. Client sends the signature + address + original message in headers
 *   4. This guard verifies the signature and checks the nonce was not reused
 *
 * Required headers:
 *   x-wallet-address   — claimed Ethereum address (0x...)
 *   x-wallet-signature — hex signature from personal_sign
 *   x-wallet-message   — the exact message that was signed (must contain the nonce)
 *
 * IMPORTANT: Requires 'ethers' as a peer dependency:
 *   npm install ethers
 *
 * Usage:
 *   @SetMetadata(GUARD_METADATA.WALLET_OPTIONS, { nonceRequired: true, nonceTtlMs: 300_000 })
 *   @UseGuards(WalletSignatureGuard)
 *   @Post('web3-action')
 *   web3Action() {}
 */
@Injectable()
export class WalletSignatureGuard implements CanActivate {
  private readonly logger = new Logger(WalletSignatureGuard.name);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private ethers: any = null;

  constructor(
    private reflector: Reflector,
    private store: RedisStoreService,
  ) {
    this.loadEthers();
  }

  private async loadEthers(): Promise<void> {
    try {
      // require() rather than await import(): TypeScript resolves dynamic import()
      // paths at compile time, so `import('ethers')` fails tsc when ethers is not
      // installed. require() bypasses that check and is fine here — Node.js caches
      // the module after the first call so there is no repeated I/O cost.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      this.ethers = require('ethers');
    } catch {
      this.logger.warn('ethers package not installed. WalletSignatureGuard will reject all requests. Install with: npm install ethers');
    }
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const options = this.reflector.getAllAndOverride<WalletSignatureOptions>(
      GUARD_METADATA.WALLET_OPTIONS,
      [context.getHandler(), context.getClass()],
    ) ?? {};

    if (!this.ethers) {
      this.logger.error('ethers is not installed — cannot verify wallet signatures');
      throw new InvalidWalletSignatureException();
    }

    const request = context.switchToHttp().getRequest<Request>();
    const walletAddress = (request.headers['x-wallet-address'] as string)?.toLowerCase();
    const signature = request.headers['x-wallet-signature'] as string;
    const message = request.headers['x-wallet-message'] as string;

    if (!walletAddress || !signature || !message) {
      this.logger.warn('Missing wallet auth headers');
      throw new InvalidWalletSignatureException();
    }

    // Nonce validation — prevents replay attacks
    const nonceRequired = options.nonceRequired !== false;
    if (nonceRequired) {
      const nonceKey = `walletNonce:${walletAddress}`;
      const storedNonce = await this.store.get(nonceKey);

      if (!storedNonce) {
        this.logger.warn(`Nonce not found or expired for ${walletAddress}`);
        throw new WalletNonceExpiredException();
      }

      if (!message.includes(storedNonce)) {
        this.logger.warn(`Message does not contain valid nonce for ${walletAddress}`);
        throw new WalletNonceExpiredException();
      }

      // Consume nonce — single use only
      await this.store.del(nonceKey);
    }

    // Verify signature recovers the expected address
    try {
      const recovered = (this.ethers.verifyMessage(message, signature) as string).toLowerCase();

      if (recovered !== walletAddress) {
        this.logger.warn(`Signature mismatch: claimed ${walletAddress}, recovered ${recovered}`);
        throw new InvalidWalletSignatureException();
      }

      // Attach verified wallet to request user
      if (!(request as any).user) (request as any).user = {};
      (request as any).user.walletAddress = walletAddress;

      this.logger.debug(`Wallet signature verified for ${walletAddress}`);
      return true;
    } catch (error) {
      if (error instanceof InvalidWalletSignatureException) throw error;
      this.logger.warn(`Signature verification failed: ${error instanceof Error ? error.message : error}`);
      throw new InvalidWalletSignatureException();
    }
  }
}

/**
 * Utility: Issue a one-time nonce for wallet authentication.
 * Call this from a controller endpoint: GET /auth/wallet/nonce/:address
 */
export async function issueWalletNonce(
  address: string,
  store: RedisStoreService,
  ttlMs: number = 300_000,
): Promise<string> {
  const nonce = randomBytes(16).toString('hex');
  const message = `Sign this message to authenticate your wallet.\n\nNonce: ${nonce}\nTimestamp: ${new Date().toISOString()}`;
  await store.set(`walletNonce:${address.toLowerCase()}`, nonce, ttlMs);
  return message;
}
