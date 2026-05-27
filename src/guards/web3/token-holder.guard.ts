import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { GUARD_METADATA } from '../../constants/guard.constants';
import { TokenHolderOptions } from '../../decorators/token-holder.decorator';
import { Web3RpcService } from '../../services/web3-rpc.service';
import { RedisStoreService } from '../../services/redis-store.service';
import { InsufficientTokenBalanceException } from '../../exceptions/web3.exception';

const DEFAULT_RPC = 'https://cloudflare-eth.com';
const DEFAULT_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Level 6 — ERC-20 Token Holder Guard
 *
 * Requires the wallet address making the request to hold a minimum balance
 * of a specific ERC-20 token. Useful for gating features behind token ownership.
 *
 * Uses a direct JSON-RPC eth_call to balanceOf(address) on the ERC-20 contract.
 * No web3.js or ethers required — only native fetch.
 *
 * Results are cached for cacheResultsTtlMs (default 5 minutes) to reduce RPC calls.
 *
 * Usage:
 *   @RequireTokenBalance({
 *     contractAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
 *     minBalance: '100',
 *     decimals: 6,
 *     rpcUrl: 'https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY',
 *   })
 *   @UseGuards(TokenHolderGuard)
 *   @Get('premium')
 *   premium() {}
 */
@Injectable()
export class TokenHolderGuard implements CanActivate {
  private readonly logger = new Logger(TokenHolderGuard.name);

  constructor(
    private reflector: Reflector,
    private rpcService: Web3RpcService,
    private store: RedisStoreService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const options = this.reflector.getAllAndOverride<TokenHolderOptions>(
      GUARD_METADATA.TOKEN_HOLDER_OPTIONS,
      [context.getHandler(), context.getClass()],
    );

    if (!options) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const walletAddress = this.getWalletAddress(request);

    if (!walletAddress) {
      this.logger.warn('No wallet address found for TokenHolderGuard');
      throw new InsufficientTokenBalanceException(options.minBalance, options.contractAddress);
    }

    const cacheKey = `tokenBalance:${options.contractAddress.toLowerCase()}:${walletAddress.toLowerCase()}`;
    const cached = await this.store.get(cacheKey);

    let balance: bigint;

    if (cached !== null) {
      balance = BigInt(cached);
    } else {
      balance = await this.fetchTokenBalance(walletAddress, options);
      await this.store.set(cacheKey, balance.toString(), options.cacheResultsTtlMs ?? DEFAULT_CACHE_TTL);
    }

    const decimals = options.decimals ?? 18;
    const multiplier = BigInt(10) ** BigInt(decimals);
    const minBalanceRaw = BigInt(Math.floor(parseFloat(options.minBalance) * Number(multiplier)));

    if (balance < minBalanceRaw) {
      const humanBalance = Number(balance) / Number(multiplier);
      this.logger.warn(
        `Wallet ${walletAddress} has insufficient token balance: ${humanBalance.toFixed(4)} < ${options.minBalance}`,
      );
      throw new InsufficientTokenBalanceException(options.minBalance, options.contractAddress);
    }

    this.logger.debug(`Token balance check passed for ${walletAddress}`);
    return true;
  }

  private async fetchTokenBalance(address: string, options: TokenHolderOptions): Promise<bigint> {
    const data = this.rpcService.encodeBalanceOf(address);
    const rpcUrl = options.rpcUrl ?? DEFAULT_RPC;

    try {
      const result = await this.rpcService.call(
        { to: options.contractAddress, data },
        rpcUrl,
      );
      return this.rpcService.hexToBigInt(result);
    } catch (error) {
      this.logger.warn(`Failed to fetch token balance: ${error instanceof Error ? error.message : error}`);
      return 0n;
    }
  }

  private getWalletAddress(request: Request): string | null {
    const user = (request as any).user;
    if (user?.walletAddress) return user.walletAddress;
    const header = request.headers['x-wallet-address'];
    return typeof header === 'string' ? header : null;
  }
}
