import { SetMetadata } from '@nestjs/common';
import { GUARD_METADATA } from '../constants/guard.constants';

export interface TokenHolderOptions {
  contractAddress: string;
  minBalance: string;
  decimals?: number;
  chainId?: number;
  rpcUrl?: string;
  cacheResultsTtlMs?: number;
}

export const RequireTokenBalance = (options: TokenHolderOptions) =>
  SetMetadata(GUARD_METADATA.TOKEN_HOLDER_OPTIONS, options);
