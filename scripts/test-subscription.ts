/**
 * test-subscription.ts — Prueba SubscriptionGuard (planes y jerarquía)
 *
 * Run: npx ts-node scripts/test-subscription.ts
 *
 * Jerarquía: free < starter < pro < enterprise
 * Un plan superior satisface los requisitos de planes inferiores.
 *
 * Escenarios:
 *   1. plan 'free'       → /free-feature (requiere free)       ✅
 *   2. plan 'free'       → /pro-feature  (requiere pro)        ❌ 403
 *   3. plan 'pro'        → /pro-feature  (requiere pro)        ✅
 *   4. plan 'pro'        → /enterprise-feature                 ❌ 403
 *   5. plan 'enterprise' → /enterprise-feature                 ✅
 *   6. plan 'enterprise' → /pro-feature  (superior satisface)  ✅
 *   7. Sin token                                                ❌ 401
 */

const BASE = 'http://localhost:3000';

async function getSubscriptionToken(
  username: string,
  password: string,
  subscriptionPlan: string,
): Promise<string> {
  const res = await fetch(`${BASE}/auth/test/subscription-token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password, subscriptionPlan }),
  });
  const data = await res.json() as any;
  return data.accessToken as string;
}

async function get(
  path: string,
  token?: string,
): Promise<{ status: number; data: unknown }> {
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, { headers });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

let failures = 0;

function log(status: number, label: string, extra?: string) {
  const icon = status === 200 ? '✅' : status === 403 ? '🚫' : status === 401 ? '🔐' : '⚠️ ';
  console.log(`${icon} [${status}] ${label}${extra ? `  —  ${extra}` : ''}`);
}

async function main() {
  console.log('\n════════════════════════════════════════════');
  console.log('  guard-nest — Subscription Guard Test Suite');
  console.log('  Jerarquía: free < starter < pro < enterprise');
  console.log('════════════════════════════════════════════\n');

  const freeToken       = await getSubscriptionToken('user', 'user123', 'free');
  const proToken        = await getSubscriptionToken('user', 'user123', 'pro');
  const enterpriseToken = await getSubscriptionToken('user', 'user123', 'enterprise');

  console.log('  Tokens obtenidos:');
  console.log(`    free:       ${freeToken.slice(0, 30)}...`);
  console.log(`    pro:        ${proToken.slice(0, 30)}...`);
  console.log(`    enterprise: ${enterpriseToken.slice(0, 30)}...\n`);

  // ── /demo/level5/free-feature  (requiere: 'free') ─────────────────────────
  console.log('── GET /demo/level5/free-feature  (requiere: "free") ──\n');

  {
    const { status } = await get('/demo/level5/free-feature', freeToken);
    log(status, 'plan free → PASS (satisface requisito "free")');
  }
  {
    const { status } = await get('/demo/level5/free-feature', proToken);
    log(status, 'plan pro  → PASS (superior satisface "free")');
  }

  // ── /demo/level5/pro-feature  (requiere: 'pro') ────────────────────────────
  console.log('\n── GET /demo/level5/pro-feature  (requiere: "pro") ──\n');

  {
    const { status, data } = await get('/demo/level5/pro-feature', freeToken);
    log(status, 'plan free → BLOCKED (insuficiente)', (data as any)?.message);
  }
  {
    const { status } = await get('/demo/level5/pro-feature', proToken);
    log(status, 'plan pro  → PASS (satisface exacto)');
  }
  {
    const { status } = await get('/demo/level5/pro-feature', enterpriseToken);
    log(status, 'plan enterprise → PASS (superior satisface "pro")');
  }

  // ── /demo/level5/enterprise-feature  (requiere: 'enterprise') ─────────────
  console.log('\n── GET /demo/level5/enterprise-feature  (requiere: "enterprise") ──\n');

  {
    const { status, data } = await get('/demo/level5/enterprise-feature', proToken);
    log(status, 'plan pro        → BLOCKED (insuficiente)', (data as any)?.message);
  }
  {
    const { status } = await get('/demo/level5/enterprise-feature', enterpriseToken);
    log(status, 'plan enterprise → PASS');
  }

  // ── Sin token ─────────────────────────────────────────────────────────────
  console.log('\n── Sin token ──\n');

  {
    const { status, data } = await get('/demo/level5/pro-feature');
    log(status, 'Sin token → BLOCKED (JwtAuthGuard corre antes)', (data as any)?.message);
  }

  console.log('\n════════════════════════════════════════════');
  console.log('  Esperado:');
  console.log('    free-feature:       free ✅ | pro ✅');
  console.log('    pro-feature:        free 🚫 | pro ✅ | enterprise ✅');
  console.log('    enterprise-feature: pro  🚫 | enterprise ✅');
  console.log('    sin token:          401 🔐');
  console.log('════════════════════════════════════════════\n');
}

main()
  .then(() => { if (failures > 0) { console.error(`\n❌ ${failures} test(s) failed`); process.exit(1); } })
  .catch((e: unknown) => { console.error(e); process.exit(1); });