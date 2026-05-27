import { Controller, Get, Post, Param, UseGuards, SetMetadata } from '@nestjs/common';
import { Public } from '../decorators/public.decorator';
import { RequireChain } from '../decorators/chain-id.decorator';
import { RequireTokenBalance } from '../decorators/token-holder.decorator';
import { ChainIdGuard } from '../guards/web3/chain-id.guard';
import { WalletSignatureGuard, issueWalletNonce } from '../guards/web3/wallet-signature.guard';
import { SuspiciousTransactionGuard } from '../guards/web3/suspicious-transaction.guard';
import { TokenHolderGuard } from '../guards/web3/token-holder.guard';
import { RedisStoreService } from '../services/redis-store.service';
import { GUARD_METADATA } from '../constants/guard.constants';
import { CHAIN_IDS } from '../constants/web3.constants';

/**
 * Level 6 — Web3 Guards Demo
 * Base: http://localhost:3000/demo/level6
 *
 * Para probar firma de wallet necesitas ethers instalado:
 *   npm install ethers
 * y ejecutar scripts/test-web3.ts
 */
@Controller('demo/level6')
@Public()
export class Level6Web3Controller {
  constructor(private store: RedisStoreService) {}

  // ── Chain ID — Ethereum mainnet o Polygon ──────────────────────────────────
  // Header: x-chain-id: 1  (Ethereum) o x-chain-id: 137 (Polygon)
  @Get('chain-id')
  @RequireChain([CHAIN_IDS.ETHEREUM_MAINNET, CHAIN_IDS.POLYGON_MAINNET], 'header')
  @UseGuards(ChainIdGuard)
  chainId() {
    return {
      guard: 'ChainIdGuard',
      message: 'Chain ID válido (Ethereum o Polygon)',
      allowed: [
        { id: 1, name: 'Ethereum Mainnet' },
        { id: 137, name: 'Polygon' },
      ],
      tip: 'Envía header x-chain-id: 1 o x-chain-id: 137',
    };
  }

  // ── Chain ID — solo testnet ────────────────────────────────────────────────
  @Get('testnet-only')
  @RequireChain([CHAIN_IDS.ETHEREUM_SEPOLIA, CHAIN_IDS.POLYGON_MUMBAI], 'header')
  @UseGuards(ChainIdGuard)
  testnetOnly() {
    return {
      guard: 'ChainIdGuard (testnets)',
      message: 'Testnet válida',
      allowed: [
        { id: 11155111, name: 'Sepolia' },
        { id: 80001, name: 'Mumbai' },
      ],
    };
  }

  // ── Nonce — emitir nonce para firmar ──────────────────────────────────────
  // Paso 1 del flujo de autenticación con wallet
  @Get('wallet/nonce/:address')
  async getNonce(@Param('address') address: string) {
    const message = await issueWalletNonce(address, this.store, 300_000);
    return {
      message,
      tip: 'Firma este mensaje con tu wallet y envíalo a POST /demo/level6/wallet-action',
      headers: {
        'x-wallet-address': address,
        'x-wallet-signature': '<firma del mensaje>',
        'x-wallet-message': message,
      },
    };
  }

  // ── Wallet Signature ───────────────────────────────────────────────────────
  // Requiere: ethers instalado + firma EIP-191 válida
  @Post('wallet-action')
  @SetMetadata(GUARD_METADATA.WALLET_OPTIONS, { nonceRequired: true, nonceTtlMs: 300_000 })
  @UseGuards(WalletSignatureGuard)
  walletAction() {
    return {
      guard: 'WalletSignatureGuard',
      message: 'Firma de wallet EIP-191 verificada correctamente',
    };
  }

  // ── Suspicious Transactions — modo log only ────────────────────────────────
  // No bloquea, solo analiza y loguea el score de suspicion
  @Get('suspicious-tx-log')
  @SetMetadata(GUARD_METADATA.SUSPICIOUS_TX_OPTIONS, {
    threshold: 50,
    chainId: 1,
    logOnly: true,
    cacheResultsTtlMs: 60_000,
  })
  @UseGuards(SuspiciousTransactionGuard)
  suspiciousTxLog() {
    return {
      guard: 'SuspiciousTransactionGuard (logOnly)',
      message: 'Wallet analizada — revisar consola para ver el score',
      tip: 'Envía header x-wallet-address: 0xd90e2f925... (Tornado Cash) para ver score alto',
    };
  }

  // ── Suspicious Transactions — modo bloqueante ─────────────────────────────
  @Get('suspicious-tx-block')
  @SetMetadata(GUARD_METADATA.SUSPICIOUS_TX_OPTIONS, {
    threshold: 30,
    chainId: 1,
    logOnly: false,
    etherscanApiKey: process.env.ETHERSCAN_API_KEY,
  })
  @UseGuards(SuspiciousTransactionGuard)
  suspiciousTxBlock() {
    return {
      guard: 'SuspiciousTransactionGuard (bloqueante, threshold=30)',
      message: 'Wallet pasó la verificación de transacciones sospechosas',
    };
  }

  // ── Token Holder — USDC mínimo 1 (Cloudflare public RPC) ─────────────────
  @Get('token-holder')
  @RequireTokenBalance({
    contractAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
    minBalance: '1',
    decimals: 6,
    rpcUrl: 'https://cloudflare-eth.com',
    cacheResultsTtlMs: 60_000,
  })
  @UseGuards(TokenHolderGuard)
  tokenHolder() {
    return {
      guard: 'TokenHolderGuard',
      message: 'Wallet tiene saldo mínimo de USDC requerido',
      token: 'USDC (0xA0b8...)',
      minBalance: '1 USDC',
    };
  }
}
