import { SetMetadata } from '@nestjs/common';
import { GUARD_METADATA } from '../constants/guard.constants';

export interface ChainIdOptions {
  allowedChainIds: number[];
  source?: 'jwt' | 'header' | 'both';
}

export const RequireChain = (allowedChainIds: number[], source: 'jwt' | 'header' | 'both' = 'both') =>
  SetMetadata(GUARD_METADATA.CHAIN_ID_OPTIONS, { allowedChainIds, source });
