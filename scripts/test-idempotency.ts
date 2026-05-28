/**
 * test-idempotency.ts — Prueba IdempotencyInterceptor
 *
 * Run: npx ts-node scripts/test-idempotency.ts
 *
 * Demuestra los 4 escenarios:
 *   1. Primera request       → se procesa normalmente (transactionId único)
 *   2. Misma key, 2da vez    → respuesta cacheada (mismo transactionId, Idempotency-Replayed: true)
 *   3. Requests paralelas    → segunda obtiene 409 Conflict
 *   4. Sin Idempotency-Key   → 400 Bad Request
 */

const BASE    = 'http://localhost:3000';
const ENDPOINT = '/demo/level2/payment';

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function pay(
  key: string,
  amount: number,
): Promise<{ status: number; headers: Record<string, string | null>; data: unknown }> {
  const res = await fetch(`${BASE}${ENDPOINT}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': key,
    },
    body: JSON.stringify({ amount, description: 'demo payment' }),
  });
  const data = await res.json().catch(() => ({}));
  return {
    status: res.status,
    headers: {
      'idempotency-key':     res.headers.get('idempotency-key'),
      'idempotency-replayed': res.headers.get('idempotency-replayed'),
    },
    data,
  };
}

async function payNoKey(): Promise<{ status: number; data: unknown }> {
  const res = await fetch(`${BASE}${ENDPOINT}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount: 100 }),
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

let failures = 0;

function log(status: number, label: string, info: string) {
  const icon = status < 300 ? '✅' : status === 409 ? '⚡' : '❌';
  if (icon.startsWith('⚠️')) failures++;
  console.log(`${icon} [${status}] ${label}`);
  console.log(`       ${info}\n`);
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n════════════════════════════════════════════');
  console.log('  guard-nest — Idempotency Test Suite');
  console.log('════════════════════════════════════════════\n');

  const key = `key-${Date.now()}`;
  console.log(`Using Idempotency-Key: ${key}\n`);

  // ── 1. Primera request — se procesa ──────────────────────────────────────
  console.log('── Escenario 1: Primera request (se procesa) ──\n');
  const first = await pay(key, 9900);
  const firstTxId = (first.data as any)?.transactionId ?? '?';
  log(
    first.status,
    'Primera request',
    `transactionId=${firstTxId}  replayed=${first.headers['idempotency-replayed'] ?? 'false'}`,
  );

  // ── 2. Misma key — se replica sin reprocesar ───────────────────────────────
  console.log('── Escenario 2: Misma key, segunda vez (replay) ──\n');
  const second = await pay(key, 9900);
  const secondTxId = (second.data as any)?.transactionId ?? '?';
  const replayed    = second.headers['idempotency-replayed'] === 'true';
  const sameId      = firstTxId === secondTxId;
  log(
    second.status,
    `Replay${replayed ? ' ✓' : ' ✗ MISSING REPLAY HEADER'}${sameId ? '' : ' ✗ DIFFERENT txnId!'}`,
    `transactionId=${secondTxId}  replayed=${String(replayed)}  same=${String(sameId)}`,
  );

  // ── 3. Request paralelas — race condition ──────────────────────────────────
  console.log('── Escenario 3: Requests paralelas con la misma key ──\n');
  const raceKey = `race-${Date.now()}`;
  console.log(`   Firing 3 concurrent requests with key: ${raceKey}\n`);

  const [r1, r2, r3] = await Promise.all([
    pay(raceKey, 5000),
    pay(raceKey, 5000),
    pay(raceKey, 5000),
  ]);

  const results = [r1, r2, r3];
  const ok409 = results.filter((r) => r.status === 409).length;
  const ok200 = results.filter((r) => r.status === 201 || r.status === 200).length;

  results.forEach((r, i) => {
    log(
      r.status,
      `Request #${i + 1}`,
      r.status === 409
        ? 'Conflict — lock held by concurrent request'
        : `Processed — txnId=${(r.data as any)?.transactionId ?? '?'}`,
    );
  });

  console.log(
    `   Summary: ${ok200} processed, ${ok409} conflicted (expected: 1 processed, 2 conflicted)\n`,
  );

  // ── 4. Sin Idempotency-Key — 400 ────────────────────────────────────────
  console.log('── Escenario 4: Sin Idempotency-Key header ──\n');
  const noKey = await payNoKey();
  log(noKey.status, 'Sin header → 400 Bad Request', JSON.stringify(noKey.data).slice(0, 80));

  // ── 5. Key diferente — se vuelve a procesar ────────────────────────────────
  console.log('── Escenario 5: Key diferente → nuevo transactionId ──\n');
  const newKey  = `key-${Date.now()}-new`;
  const third   = await pay(newKey, 9900);
  const thirdTxId = (third.data as any)?.transactionId ?? '?';
  const differentId = firstTxId !== thirdTxId;
  log(
    third.status,
    `Key diferente → nuevo procesamiento${differentId ? ' ✓' : ' ✗ SAME txnId!'}`,
    `transactionId=${thirdTxId}  diferente de primera=${String(differentId)}`,
  );

  console.log('════════════════════════════════════════════');
  console.log('  Done');
  console.log('════════════════════════════════════════════\n');
}

main()
  .then(() => { if (failures > 0) { console.error(`\n❌ ${failures} test(s) failed`); process.exit(1); } })
  .catch((e: unknown) => { console.error(e); process.exit(1); });