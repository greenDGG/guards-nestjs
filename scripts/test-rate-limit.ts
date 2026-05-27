/**
 * test-rate-limit.ts — Fires rapid requests to trigger rate-limiting guards
 *
 * Run: npx ts-node scripts/test-rate-limit.ts
 *
 * What this tests:
 *   1. SlidingWindowRateLimitGuard  (5 req / 10s by IP)
 *   2. AdaptiveRateLimitGuard       (10 req / 30s, adjusted by trust score)
 *   3. CircuitBreakerGuard          (3 failures / 30s → circuit opens)
 */

const BASE = 'http://localhost:3000';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Fire N requests and report each result ────────────────────────────────

async function fireN(
  path: string,
  count: number,
  delayMs = 0,
  headers: Record<string, string> = {},
): Promise<void> {
  for (let i = 1; i <= count; i++) {
    const res = await fetch(`${BASE}${path}`, { headers }).catch(() => null);
    if (!res) { console.log(`  #${i} 💥 network error`); break; }

    const remaining = res.headers.get('x-ratelimit-remaining') ?? '?';
    const reset = res.headers.get('x-ratelimit-reset') ?? '?';

    if (res.status === 429) {
      console.log(`  #${i} ❌ 429 BLOCKED  remaining=${remaining}  reset=${reset}s`);
    } else if (res.ok) {
      console.log(`  #${i} ✅ ${res.status} ok       remaining=${remaining}  reset=${reset}s`);
    } else {
      const body = await res.json().catch(() => ({})) as Record<string, unknown>;
      console.log(`  #${i} ⚠️  ${res.status}           ${JSON.stringify(body).slice(0, 80)}`);
    }

    if (delayMs > 0) await sleep(delayMs);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n════════════════════════════════════════════');
  console.log('  guard-nest — Rate Limit Test Suite');
  console.log('════════════════════════════════════════════\n');

  // ── 1. Sliding Window (5 req / 10s by IP) ─────────────────────────────
  console.log('── SlidingWindowRateLimitGuard  (max=5 / 10s) ──');
  console.log('   Firing 8 requests back-to-back...\n');
  await fireN('/demo/level3/sliding-window', 8, 50);

  console.log('\n   Waiting 11s for window to reset...');
  await sleep(11_000);
  console.log('   Window reset — 1 more request should succeed:\n');
  await fireN('/demo/level3/sliding-window', 1);

  // ── 2. Adaptive Rate Limit (10 req / 30s, trust-score-adjusted) ────────
  console.log('\n── AdaptiveRateLimitGuard  (baseMax=10 / 30s, trust=75 → 10 req) ──');
  console.log('   Firing 13 requests (first 10 should pass)...\n');
  await fireN('/demo/level3/adaptive', 13, 30);

  // ── 3. Circuit Breaker ─────────────────────────────────────────────────
  console.log('\n── CircuitBreakerGuard  (threshold=3 failures, timeout=15s) ──');
  console.log('   The handler has 30% random failure rate.');
  console.log('   Firing 20 requests — circuit should open after ~3 failures...\n');

  let circuitOpened = false;
  for (let i = 1; i <= 20; i++) {
    const res = await fetch(`${BASE}/demo/level3/circuit-breaker`).catch(() => null);
    if (!res) { console.log(`  #${i} 💥 network error`); break; }

    if (res.status === 503) {
      console.log(`  #${i} ⚡ 503 CIRCUIT OPEN — requests short-circuited`);
      if (!circuitOpened) {
        circuitOpened = true;
        console.log('\n   Circuit is open! Waiting 16s for half-open state...');
        await sleep(16_000);
        console.log('   Testing recovery (half-open probe):\n');
      }
    } else if (res.status === 500) {
      const body = await res.json().catch(() => ({})) as Record<string, unknown>;
      console.log(`  #${i} 💥 500 handler threw — ${JSON.stringify(body).slice(0, 60)}`);
    } else {
      console.log(`  #${i} ✅ ${res.status} ok`);
    }

    await sleep(200);
  }

  console.log('\n════════════════════════════════════════════');
  console.log('  Done');
  console.log('════════════════════════════════════════════\n');
}

main().catch(console.error);
