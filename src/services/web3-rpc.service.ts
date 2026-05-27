import { Injectable, Logger } from '@nestjs/common';

export interface EthCallParams {
  to: string;
  data: string;
}

/**
 * Minimal JSON-RPC client for read-only Ethereum calls.
 * No web3.js or ethers dependency required for simple eth_call operations.
 */
@Injectable()
export class Web3RpcService {
  private readonly logger = new Logger(Web3RpcService.name);

  async call(params: EthCallParams, rpcUrl: string): Promise<string> {
    const body = {
      jsonrpc: '2.0',
      method: 'eth_call',
      params: [{ to: params.to, data: params.data }, 'latest'],
      id: 1,
    };

    try {
      const response = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const json: any = await response.json();
      if (json.error) throw new Error(json.error.message ?? 'RPC error');
      return json.result ?? '0x0';
    } catch (error) {
      this.logger.warn(`RPC call failed: ${error instanceof Error ? error.message : error}`);
      throw error;
    }
  }

  // ABI-encode balanceOf(address) call
  encodeBalanceOf(walletAddress: string): string {
    // keccak256('balanceOf(address)') first 4 bytes = 0x70a08231
    const selector = '70a08231';
    const paddedAddress = walletAddress.replace(/^0x/, '').toLowerCase().padStart(64, '0');
    return `0x${selector}${paddedAddress}`;
  }

  hexToBigInt(hex: string): bigint {
    if (!hex || hex === '0x') return 0n;
    return BigInt(hex);
  }
}
