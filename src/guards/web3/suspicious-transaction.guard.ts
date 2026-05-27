import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { GUARD_METADATA } from '../../constants/guard.constants';
import { EtherscanService, EthTx } from '../../services/etherscan.service';
import { RedisStoreService } from '../../services/redis-store.service';
import { KNOWN_MIXER_ADDRESSES, KNOWN_BRIDGE_ADDRESSES, LARGE_TRANSFER_THRESHOLDS } from '../../constants/web3.constants';
import { SuspiciousWalletException } from '../../exceptions/web3.exception';

export interface SuspiciousTransactionOptions {
  threshold?: number;
  chainId?: number;
  etherscanApiKey?: string;
  cacheResultsTtlMs?: number;
  logOnly?: boolean;
  heuristics?: {
    mixerInteraction?: boolean;
    highVelocity?: boolean;
    largeTransfers?: boolean;
    bridgeActivity?: boolean;
    newWallet?: boolean;
  };
}

/**
 * Level 6 — Suspicious Wallet Transaction Guard
 *
 * Analyzes the wallet address making the request for on-chain red flags
 * using a heuristic scoring model (0–100). Blocks when score >= threshold (default 50).
 *
 * Heuristics (all configurable, all enabled by default):
 *
 *   +40 — Interaction with known mixer contracts (Tornado Cash, RenBridge)
 *   +25 — High velocity: >50 transactions in last 24h
 *   +15 — Medium velocity: 20–50 transactions in last 24h
 *   +20 — >5 large transfers (>10 ETH or equivalent)
 *   +10 — >5 transfers (smaller amounts)
 *   +15 — >5 cross-chain bridge interactions
 *   +5  — 1–5 bridge interactions
 *   +10 — Wallet <7 days old with sudden activity
 *
 * Data source: Etherscan API (free tier: 5 req/s, 100k req/day).
 * Results cached per wallet+chain for cacheResultsTtlMs (default 1h).
 *
 * Reads wallet address from:
 *   1. request.user.walletAddress (set by WalletSignatureGuard or JWT)
 *   2. x-wallet-address header
 *
 * Usage:
 *   @SetMetadata(GUARD_METADATA.SUSPICIOUS_TX_OPTIONS, {
 *     threshold: 40,
 *     etherscanApiKey: process.env.ETHERSCAN_API_KEY,
 *     logOnly: false,
 *   })
 *   @UseGuards(SuspiciousTransactionGuard)
 *   @Post('withdraw')
 *   withdraw() {}
 */
@Injectable()
export class SuspiciousTransactionGuard implements CanActivate {
  private readonly logger = new Logger(SuspiciousTransactionGuard.name);

  constructor(
    private reflector: Reflector,
    private etherscanService: EtherscanService,
    private store: RedisStoreService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const options = this.reflector.getAllAndOverride<SuspiciousTransactionOptions>(
      GUARD_METADATA.SUSPICIOUS_TX_OPTIONS,
      [context.getHandler(), context.getClass()],
    ) ?? {};

    const request = context.switchToHttp().getRequest<Request>();
    const walletAddress = this.getWalletAddress(request);

    if (!walletAddress) {
      this.logger.warn('No wallet address found — skipping suspicious transaction check');
      return true;
    }

    const threshold = options.threshold ?? 50;
    const chainId = options.chainId ?? 1;
    const cacheKey = `suspiciousTx:${chainId}:${walletAddress.toLowerCase()}`;
    const cacheTtl = options.cacheResultsTtlMs ?? 60 * 60 * 1000;

    // Check cache first
    const cached = await this.store.get(cacheKey);
    if (cached) {
      const score = parseInt(cached, 10);
      return this.handleScore(score, threshold, walletAddress, options);
    }

    const txList = await this.etherscanService.getTransactions(
      walletAddress,
      chainId,
      options.etherscanApiKey,
    );

    const score = this.computeSuspiciousScore(txList, options);
    await this.store.set(cacheKey, String(score), cacheTtl);

    this.logger.debug(`Wallet ${walletAddress} suspicious score: ${score}/100`);
    return this.handleScore(score, threshold, walletAddress, options);
  }

  private computeSuspiciousScore(txList: EthTx[], options: SuspiciousTransactionOptions): number {
    const h = options.heuristics ?? {};
    const now = Math.floor(Date.now() / 1000);
    const oneDayAgo = now - 86400;
    const sevenDaysAgo = now - 7 * 86400;
    let score = 0;

    // Heuristic 1: Mixer/tumbler interactions (+40)
    if (h.mixerInteraction !== false) {
      const mixerTxs = txList.filter(
        (tx) =>
          KNOWN_MIXER_ADDRESSES.has(tx.to?.toLowerCase()) ||
          KNOWN_MIXER_ADDRESSES.has(tx.from?.toLowerCase()),
      );
      if (mixerTxs.length > 0) {
        score += 40;
        this.logger.debug(`Mixer interactions found: ${mixerTxs.length}`);
      }
    }

    // Heuristic 2: High velocity transfers (+25 or +15)
    if (h.highVelocity !== false) {
      const recentTxs = txList.filter((tx) => parseInt(tx.timeStamp) > oneDayAgo);
      if (recentTxs.length > 50) score += 25;
      else if (recentTxs.length > 20) score += 15;
      else if (recentTxs.length > 10) score += 5;
    }

    // Heuristic 3: Large transfers (+20 or +10)
    if (h.largeTransfers !== false) {
      const ethThreshold = LARGE_TRANSFER_THRESHOLDS.ETH;
      const weiThreshold = BigInt(Math.floor(ethThreshold * 1e18));
      const largeTxs = txList.filter((tx) => {
        try {
          return BigInt(tx.value) > weiThreshold;
        } catch {
          return false;
        }
      });
      if (largeTxs.length > 5) score += 20;
      else if (largeTxs.length > 0) score += 10;
    }

    // Heuristic 4: Cross-chain bridge activity (+15 or +5)
    if (h.bridgeActivity !== false) {
      const bridgeTxs = txList.filter((tx) =>
        KNOWN_BRIDGE_ADDRESSES.has(tx.to?.toLowerCase()),
      );
      if (bridgeTxs.length > 5) score += 15;
      else if (bridgeTxs.length > 0) score += 5;
    }

    // Heuristic 5: New wallet with sudden activity (+10)
    if (h.newWallet !== false && txList.length > 0) {
      const oldestTx = txList[txList.length - 1];
      const walletAge = now - parseInt(oldestTx.timeStamp);
      const recentTxs = txList.filter((tx) => parseInt(tx.timeStamp) > sevenDaysAgo);

      if (walletAge < 7 * 86400 && recentTxs.length > 5) {
        score += 10;
        this.logger.debug(`New wallet with activity: age=${Math.floor(walletAge / 86400)}d, recent=${recentTxs.length}`);
      }
    }

    return Math.min(100, score);
  }

  private handleScore(
    score: number,
    threshold: number,
    address: string,
    options: SuspiciousTransactionOptions,
  ): boolean {
    if (score >= threshold) {
      this.logger.warn(`Suspicious wallet blocked: ${address} — score: ${score}/${threshold}`);
      if (options.logOnly) return true;
      throw new SuspiciousWalletException(score);
    }
    return true;
  }

  private getWalletAddress(request: Request): string | null {
    const user = (request as any).user;
    if (user?.walletAddress) return user.walletAddress;
    const header = request.headers['x-wallet-address'];
    if (typeof header === 'string') return header;
    return null;
  }
}
