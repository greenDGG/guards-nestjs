import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { GUARD_METADATA } from '../../constants/guard.constants';
import { ChainIdOptions } from '../../decorators/chain-id.decorator';
import { InvalidChainIdException } from '../../exceptions/web3.exception';

/**
 * Level 6 — Chain ID Guard
 *
 * Ensures the request targets a supported blockchain network.
 * Reads chainId from the JWT payload (user.chainId), x-chain-id header, or both.
 *
 * Use CHAIN_IDS constants for readable chain references:
 *   import { CHAIN_IDS } from '../../constants/web3.constants';
 *   @RequireChain([CHAIN_IDS.ETHEREUM_MAINNET, CHAIN_IDS.POLYGON_MAINNET])
 *
 * Usage:
 *   @RequireChain([1, 137])   // Ethereum mainnet or Polygon
 *   @UseGuards(ChainIdGuard)
 *   @Post('swap')
 *   swap() {}
 */
@Injectable()
export class ChainIdGuard implements CanActivate {
  private readonly logger = new Logger(ChainIdGuard.name);

  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const options = this.reflector.getAllAndOverride<ChainIdOptions>(
      GUARD_METADATA.CHAIN_ID_OPTIONS,
      [context.getHandler(), context.getClass()],
    );

    if (!options) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const user = (request as any).user;

    const source = options.source ?? 'both';
    let chainId: number | undefined;

    if (source === 'jwt' || source === 'both') {
      chainId = user?.chainId;
    }

    if (!chainId && (source === 'header' || source === 'both')) {
      const headerValue = request.headers['x-chain-id'];
      if (typeof headerValue === 'string') {
        chainId = parseInt(headerValue, 10);
      }
    }

    if (!chainId || isNaN(chainId)) {
      this.logger.warn(`Missing or invalid chain ID — ${request.method} ${request.url}`);
      throw new InvalidChainIdException('(none)', options.allowedChainIds);
    }

    if (!options.allowedChainIds.includes(chainId)) {
      this.logger.warn(`Chain ID ${chainId} not allowed — ${request.method} ${request.url}`);
      throw new InvalidChainIdException(chainId, options.allowedChainIds);
    }

    this.logger.debug(`Chain ID ${chainId} accepted`);
    return true;
  }
}
