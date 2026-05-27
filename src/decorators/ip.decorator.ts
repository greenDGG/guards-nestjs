import { SetMetadata } from '@nestjs/common';
import { GUARD_METADATA } from '../constants/guard.constants';

export interface IpGuardOptions {
  mode: 'whitelist' | 'blacklist';
  list: string[];
  trustProxy?: boolean;
}

export const IpFilter = (options: IpGuardOptions) =>
  SetMetadata(GUARD_METADATA.IP_OPTIONS, options);
