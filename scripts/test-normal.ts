/**
 * test-normal.ts — Happy-path requests through all guard levels
 *
 * Run: npx ts-node scripts/test-normal.ts
 */

const BASE = 'http://localhost:3000';

// ── Helpers ────────────────────────────────────────────────────────────────

type Headers = Record<string, string>;

async function req(
  method: string,
  path: string,
  opts: { headers?: Headers; body?: unknown } = {},
): Promise<void> {
  const url = `${BASE}${path}`;
  const fetchOpts: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/json', ...opts.headers },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  };
  try {
    const res = await fetch(url, fetchOpts);
    const text = await res.text();
    let data: unknown;
    try { data = JSON.parse(text); } catch { data = text; }
    const icon = res.ok ? '✅' : '❌';
    console.log(`${icon} [${res.status}] ${method} ${path}`);
    if (!res.ok) console.log('   →', JSON.stringify(data));
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log(`💥 ${method} ${path}  →  ${msg}`);
  }
}

async function getAdminToken(): Promise<string> {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  });
  const data = await res.json() as { accessToken: string };
  return data.accessToken;
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n════════════════════════════════════════════');
  console.log('  guard-nest — Happy Path Test Suite');
  console.log('════════════════════════════════════════════\n');

  // Obtain JWT for protected routes
  console.log('🔑 Logging in as admin...');
  const token = await getAdminToken();
  const auth = { Authorization: `Bearer ${token}` };
  console.log('   Token obtained\n');

  // ── Level 1 — Basic ──────────────────────────────────────────────────────
  console.log('── Level 1: Basic Guards ──');
  await req('GET', '/demo/level1/public');
  await req('GET', '/demo/level1/jwt', { headers: auth });
  await req('GET', '/demo/level1/admin-only', { headers: auth });
  await req('GET', '/demo/level1/staff', { headers: auth });
  await req('GET', '/demo/level1/read-users', { headers: auth });
  await req('GET', '/demo/level1/delete-post', { headers: auth });
  await req('GET', '/demo/level1/api-key', { headers: { 'x-api-key': 'demo-key-123' } });
  await req('GET', '/demo/level1/basic-auth', {
    headers: { Authorization: 'Basic YWRtaW46c2VjcmV0MTIz' }, // admin:secret123
  });

  // ── Level 2 — Security ───────────────────────────────────────────────────
  console.log('\n── Level 2: Security Guards ──');
  await req('GET', '/demo/level2/ip-whitelist');       // from localhost — allowed
  await req('GET', '/demo/level2/ip-blacklist');       // our IP is not 1.2.3.4 — allowed
  await req('GET', '/demo/level2/https-only');         // localhost bypass — allowed
  await req('POST', '/demo/level2/request-size', { body: { hello: 'world' } });
  await req('POST', '/demo/level2/content-type', { body: { key: 'value' } });
  await req('GET', '/demo/level2/cors', {
    headers: { Origin: 'http://localhost:3000' },
  });

  // ── Level 3 — Rate Limiting ──────────────────────────────────────────────
  console.log('\n── Level 3: Rate Limiting Guards ──');
  await req('GET', '/demo/level3/sliding-window');
  await req('GET', '/demo/level3/adaptive');
  await req('GET', '/demo/level3/circuit-breaker');

  // ── Level 4 — Detection ──────────────────────────────────────────────────
  console.log('\n── Level 4: Detection Guards ──');
  await req('GET', '/demo/level4/bot-check', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'es-MX,es;q=0.9,en;q=0.8',
      'Accept-Encoding': 'gzip, deflate, br',
      'sec-fetch-site': 'none',
      'sec-fetch-mode': 'navigate',
    },
  });
  await req('GET', '/demo/level4/geo-blacklist');
  await req('GET', '/demo/level4/bot-log-only');
  await req('GET', '/demo/level4/anomaly');

  // ── Level 5 — Business ───────────────────────────────────────────────────
  console.log('\n── Level 5: Business Guards ──');
  await req('GET', '/demo/level5/free-feature', { headers: auth });
  await req('GET', '/demo/level5/always-open');
  await req('GET', '/demo/level5/business-hours');
  await req('GET', '/demo/level5/tenant/tenant-abc/data', { headers: auth });

  // ── Level 6 — Web3 ───────────────────────────────────────────────────────
  console.log('\n── Level 6: Web3 Guards ──');
  await req('GET', '/demo/level6/chain-id', { headers: { 'x-chain-id': '1' } });
  await req('GET', '/demo/level6/testnet-only', { headers: { 'x-chain-id': '11155111' } });
  await req('GET', '/demo/level6/suspicious-tx-log', {
    headers: { 'x-wallet-address': '0xf977814e90da44bfa03b6295a0616a897441acec' },
  });

  console.log('\n════════════════════════════════════════════');
  console.log('  Done');
  console.log('════════════════════════════════════════════\n');
}

main().catch(console.error);
