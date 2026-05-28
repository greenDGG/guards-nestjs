/**
 * test-web3.ts — Tests all Web3 guards (ChainId, WalletSignature, TokenHolder, SuspiciousTx)
 *
 * Run: npx ts-node scripts/test-web3.ts
 *
 * Requirements:
 *   npm install ethers          ← for EIP-191 wallet signature test
 *
 * Without ethers installed, wallet-signature tests are skipped automatically.
 */

const BASE = 'http://localhost:3000';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function req(
  method: string,
  path: string,
  opts: { headers?: Record<string, string>; body?: unknown } = {},
): Promise<{ status: number; data: unknown }> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(opts.headers ?? {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

let failures = 0;

function log(status: number, label: string, data?: unknown) {
  const icon = status < 400 ? '✅' : status === 403 ? '🚫' : '❌';
  console.log(`${icon} [${status}] ${label}`);
  if (status >= 400) console.log('   →', JSON.stringify(data).slice(0, 120));
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n════════════════════════════════════════════');
  console.log('  guard-nest — Web3 Guards Test Suite');
  console.log('════════════════════════════════════════════\n');

  // ── 1. Chain ID Guard ───────────────────────────────────────────────────
  console.log('── ChainIdGuard ──\n');

  {
    const { status, data } = await req('GET', '/demo/level6/chain-id', {
      headers: { 'x-chain-id': '1' },
    });
    log(status, 'x-chain-id: 1 (Ethereum Mainnet) → should PASS', data);
  }
  {
    const { status, data } = await req('GET', '/demo/level6/chain-id', {
      headers: { 'x-chain-id': '137' },
    });
    log(status, 'x-chain-id: 137 (Polygon) → should PASS', data);
  }
  {
    const { status, data } = await req('GET', '/demo/level6/chain-id', {
      headers: { 'x-chain-id': '56' },
    });
    log(status, 'x-chain-id: 56 (BSC, not allowed) → should BLOCK', data);
  }
  {
    const { status, data } = await req('GET', '/demo/level6/chain-id');
    log(status, 'No x-chain-id header → should BLOCK', data);
  }

  // ── 2. Testnet-only endpoint ────────────────────────────────────────────
  console.log('\n── ChainIdGuard (testnet-only) ──\n');

  {
    const { status, data } = await req('GET', '/demo/level6/testnet-only', {
      headers: { 'x-chain-id': '11155111' },
    });
    log(status, 'x-chain-id: 11155111 (Sepolia) → should PASS', data);
  }
  {
    const { status, data } = await req('GET', '/demo/level6/testnet-only', {
      headers: { 'x-chain-id': '80001' },
    });
    log(status, 'x-chain-id: 80001 (Mumbai) → should PASS', data);
  }
  {
    const { status, data } = await req('GET', '/demo/level6/testnet-only', {
      headers: { 'x-chain-id': '1' },
    });
    log(status, 'x-chain-id: 1 (mainnet, not allowed here) → should BLOCK', data);
  }

  // ── 3. Wallet Signature Guard ────────────────────────────────────────────
  console.log('\n── WalletSignatureGuard (EIP-191) ──\n');

  let ethers: any = null;
  try {
    ethers = require('ethers');
    console.log('   ethers found — running full signature test\n');
  } catch {
    console.log('   ⚠️  ethers not installed — skipping signature test');
    console.log('   Run: npm install ethers   then re-run this script\n');
  }

  if (ethers) {
    // Use a deterministic test wallet (never use real private keys in scripts!)
    const TEST_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
    const wallet = new ethers.Wallet(TEST_PRIVATE_KEY);
    const address = wallet.address.toLowerCase();

    console.log(`   Test wallet: ${wallet.address}`);

    // Step 1: Get nonce
    const nonceRes = await fetch(`${BASE}/demo/level6/wallet/nonce/${address}`);
    const nonceData = await nonceRes.json() as { message: string };

    if (!nonceRes.ok) {
      console.log('❌ Could not get nonce:', nonceData);
    } else {
      const message = nonceData.message;
      console.log(`   Nonce message: "${message.slice(0, 60)}..."\n`);

      // Step 2: Sign the nonce message
      const signature = await wallet.signMessage(message);
      console.log(`   Signature: ${signature.slice(0, 20)}...\n`);

      // Step 3: POST with signature headers
      const { status, data } = await req('POST', '/demo/level6/wallet-action', {
        headers: {
          'x-wallet-address': address,
          'x-wallet-signature': signature,
          'x-wallet-message': message,
        },
      });
      log(status, 'Valid EIP-191 signature → should PASS', data);

      // Step 4: Replay attack — same signature again (nonce consumed)
      await sleep(500);
      const { status: status2, data: data2 } = await req('POST', '/demo/level6/wallet-action', {
        headers: {
          'x-wallet-address': address,
          'x-wallet-signature': signature,
          'x-wallet-message': message,
        },
      });
      log(status2, 'Replay same signature (nonce consumed) → should BLOCK', data2);

      // Step 5: Wrong signature
      const { status: status3, data: data3 } = await req('POST', '/demo/level6/wallet-action', {
        headers: {
          'x-wallet-address': address,
          'x-wallet-signature': '0x' + 'a'.repeat(130),
          'x-wallet-message': 'wrong message',
        },
      });
      log(status3, 'Invalid signature → should BLOCK', data3);
    }
  }

  // ── 4. Suspicious Transaction Guard ─────────────────────────────────────
  console.log('\n── SuspiciousTransactionGuard ──\n');

  // Clean wallet (random unknown address) — low score
  {
    const cleanWallet = '0x1234567890123456789012345678901234567890';
    const { status, data } = await req('GET', '/demo/level6/suspicious-tx-log', {
      headers: { 'x-wallet-address': cleanWallet },
    });
    log(status, `Clean/unknown wallet (${cleanWallet.slice(0, 10)}...) logOnly → should PASS`, data);
  }

  // Tornado Cash router — should score +40 minimum
  {
    const tornadoCash = '0xd90e2f925da726b50c4ed8d0fb90ad053324f31b';
    const { status, data } = await req('GET', '/demo/level6/suspicious-tx-log', {
      headers: { 'x-wallet-address': tornadoCash },
    });
    log(status, `Tornado Cash address (logOnly, scores +40) → PASS but logged`, data);
  }

  // Blocking mode with threshold=30
  {
    const tornadoCash = '0xd90e2f925da726b50c4ed8d0fb90ad053324f31b';
    const { status, data } = await req('GET', '/demo/level6/suspicious-tx-block', {
      headers: { 'x-wallet-address': tornadoCash },
    });
    log(status, `Tornado Cash on blocking endpoint (threshold=30) → should BLOCK`, data);
  }

  {
    const cleanWallet = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd';
    const { status, data } = await req('GET', '/demo/level6/suspicious-tx-block', {
      headers: { 'x-wallet-address': cleanWallet },
    });
    log(status, `Unknown wallet on blocking endpoint → should PASS`, data);
  }

  // ── 5. Token Holder Guard ────────────────────────────────────────────────
  console.log('\n── TokenHolderGuard (USDC min 1, via Cloudflare RPC) ──\n');
  console.log('   Note: This makes a real eth_call to cloudflare-eth.com');
  console.log('   Results depend on the actual on-chain USDC balance\n');

  // A well-known USDC holder (Binance hot wallet — likely has lots of USDC)
  const bigHolder = '0xf977814e90da44bfa03b6295a0616a897441acec';
  const { status: s1, data: d1 } = await req('GET', '/demo/level6/token-holder', {
    headers: { 'x-wallet-address': bigHolder },
  });
  log(s1, `Binance hot wallet (likely >1 USDC on mainnet) → expect PASS`, d1);

  // A zero-balance address (brand new wallet)
  const emptyWallet = '0x000000000000000000000000000000000000dead';
  const { status: s2, data: d2 } = await req('GET', '/demo/level6/token-holder', {
    headers: { 'x-wallet-address': emptyWallet },
  });
  log(s2, `0xdead (burn address, 0 USDC) → expect BLOCK`, d2);

  // Missing header
  const { status: s3, data: d3 } = await req('GET', '/demo/level6/token-holder');
  log(s3, 'No x-wallet-address header → expect BLOCK', d3);

  console.log('\n════════════════════════════════════════════');
  console.log('  Done');
  console.log('════════════════════════════════════════════\n');
}

main()
  .then(() => { if (failures > 0) { console.error(`\n❌ ${failures} test(s) failed`); process.exit(1); } })
  .catch((e: unknown) => { console.error(e); process.exit(1); });