import { SetMetadata } from '@nestjs/common';
import { GUARD_METADATA } from '../constants/guard.constants';

export interface ApiKeyOptions {
  keys?: string[];
}

export const ApiKey = (options: ApiKeyOptions) =>
  SetMetadata(GUARD_METADATA.API_KEY_OPTIONS, options);
