import { Injectable, Logger } from '@nestjs/common';
import { RedisStoreService } from './redis-store.service';

export interface EthTx {
  hash: string;
  from: string;
  to: string;
  value: string;
  timeStamp: string;
  isError: string;
  functionName?: string;
}

const BASE_URLS: Record<number, string> = {
  1: 'https://api.etherscan.io/api',
  137: 'https://api.polygonscan.com/api',
  56: 'https://api.bscscan.com/api',
  42161: 'https://api.arbiscan.io/api',
  10: 'https://api-optimistic.etherscan.io/api',
  43114: 'https://api.snowtrace.io/api',
  8453: 'https://api.basescan.org/api',
};

@Injectable()
export class EtherscanService {
  private readonly logger = new Logger(EtherscanService.name);

  constructor(private store: RedisStoreService) {}

  async getTransactions(address: string, chainId: number = 1, apiKey?: string): Promise<EthTx[]> {
    const cacheKey = `etherscan:txs:${chainId}:${address.toLowerCase()}`;
    const cached = await this.store.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const baseUrl = BASE_URLS[chainId] ?? BASE_URLS[1];
    const keyParam = apiKey ? `&apikey=${apiKey}` : '';
    const url = `${baseUrl}?module=account&action=txlist&address=${address}&startblock=0&endblock=99999999&page=1&offset=100&sort=desc${keyParam}`;

    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(10_000),
        headers: { 'User-Agent': 'guard-nest/1.0' },
      });

      if (!response.ok) {
        this.logger.warn(`Etherscan HTTP ${response.status} for ${address}`);
        return [];
      }

      const data: any = await response.json();

      if (data.status !== '1') {
        this.logger.warn(`Etherscan API error for ${address}: ${data.message}`);
        return [];
      }

      const txs: EthTx[] = data.result;
      // Cache for 1 hour
      await this.store.set(cacheKey, JSON.stringify(txs), 60 * 60 * 1000);
      return txs;
    } catch (error) {
      this.logger.warn(`Etherscan fetch failed: ${error instanceof Error ? error.message : error}`);
      return [];
    }
  }
}
