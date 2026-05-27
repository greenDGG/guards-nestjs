/**
 * test-concurrency.ts — Prueba ConcurrencyInterceptor
 *
 * Run: npx ts-node scripts/test-concurrency.ts
 *
 * Escenarios:
 *   1. Request secuencial          → ✅ todos pasan (un slot a la vez)
 *   2. 2 paralelas (límite exacto) → ✅ ambas pasan simultáneamente
 *   3. 3 paralelas (sobre límite)  → 1-2 pasan, 3ra recibe 429
 *   4. Slot liberado               → siguiente request pasa
 *   5. Global — recurso exclusivo  → solo 1 a la vez para todos
 *   6. Race condition extrema      → 5 paralelas, máximo 2 pasan
 */

const BASE = 'http://localhost:3000';

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function post(
  path: string,
  body: unknown = {},
): Promise<{ status: number; data: unknown; duration: number }> {
  const start = Date.now();
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json().catch(() => ({})), duration: Date.now() - start };
}

function log(status: number, label: string, extra?: string) {
  const icon = status < 300 ? '✅' : status === 429 ? '🚫' : '⚠️ ';
  console.log(`${icon} [${status}] ${label}${extra ? `  —  ${extra}` : ''}`);
}

async function main() {
  console.log('\n════════════════════════════════════════════');
  console.log('  guard-nest — Concurrency Interceptor Test');
  console.log('════════════════════════════════════════════\n');

  // ── 1. Secuenciales — todos pasan ─────────────────────────────────────────
  console.log('── /demo/level2/heavy-job  (max 2 por IP) ──\n');
  console.log('Test 1: 3 requests secuenciales (todas deben pasar)');

  for (let i = 1; i <= 3; i++) {
    const { status, duration } = await post('/demo/level2/heavy-job', { seq: i });
    log(status, `Request secuencial #${i}`, `${duration}ms`);
  }

  // ── 2. 2 paralelas — dentro del límite ───────────────────────────────────
  console.log('\nTest 2: 2 requests paralelas (ambas deben pasar — límite exacto)');

  const [a, b] = await Promise.all([
    post('/demo/level2/heavy-job', { parallel: 'A' }),
    post('/demo/level2/heavy-job', { parallel: 'B' }),
  ]);

  log(a.status, 'Paralela A', `${a.duration}ms`);
  log(b.status, 'Paralela B', `${b.duration}ms`);

  const bothPassed = a.status < 300 && b.status < 300;
  console.log(`   Resultado: ${bothPassed ? '✅ Ambas pasaron' : '⚠️  Resultado inesperado'}`);

  await sleep(1200); // esperar a que el endpoint termine (1000ms de latencia simulada)

  // ── 3. 3 paralelas — sobre el límite ─────────────────────────────────────
  console.log('\nTest 3: 3 requests paralelas (3ra debe recibir 429)');

  const [r1, r2, r3] = await Promise.all([
    post('/demo/level2/heavy-job', { race: 1 }),
    post('/demo/level2/heavy-job', { race: 2 }),
    post('/demo/level2/heavy-job', { race: 3 }),
  ]);

  [r1, r2, r3].forEach((r, i) => {
    log(r.status, `Paralela #${i + 1}`, `${r.duration}ms`);
  });

  const passed  = [r1, r2, r3].filter(r => r.status < 300).length;
  const blocked = [r1, r2, r3].filter(r => r.status === 429).length;
  console.log(`\n   Resultado: ${passed} procesada(s), ${blocked} bloqueada(s)`);
  console.log(`   Esperado:  ≤2 procesadas, ≥1 bloqueada\n`);

  await sleep(1200);

  // ── 4. Slot liberado — siguiente pasa ────────────────────────────────────
  console.log('Test 4: Request después del bloqueo (slot debe estar libre)');

  const { status: s4, duration: d4 } = await post('/demo/level2/heavy-job', { after: 'release' });
  log(s4, 'Request post-bloqueo', `${d4}ms`);

  await sleep(1200);

  // ── 5. Global — recurso exclusivo (1 a la vez para todos) ────────────────
  console.log('\n── /demo/level2/exclusive-resource  (global, max 1) ──\n');
  console.log('Test 5: 3 requests paralelas al recurso exclusivo');

  const [e1, e2, e3] = await Promise.all([
    post('/demo/level2/exclusive-resource', { client: 'X' }),
    post('/demo/level2/exclusive-resource', { client: 'Y' }),
    post('/demo/level2/exclusive-resource', { client: 'Z' }),
  ]);

  [e1, e2, e3].forEach((r, i) => {
    const label = ['X', 'Y', 'Z'][i];
    log(r.status, `Cliente ${label}`, `${r.duration}ms`);
  });

  const excPassed  = [e1, e2, e3].filter(r => r.status < 300).length;
  const excBlocked = [e1, e2, e3].filter(r => r.status === 429).length;
  console.log(`\n   Resultado: ${excPassed} procesada(s), ${excBlocked} bloqueada(s)`);
  console.log(`   Esperado:  1 procesada, 2 bloqueadas (recurso exclusivo global)\n`);

  await sleep(700);

  // ── 6. Race condition extrema ─────────────────────────────────────────────
  console.log('── Race condition extrema: 5 paralelas, límite 2 ──\n');

  const races = await Promise.all(
    Array.from({ length: 5 }, (_, i) =>
      post('/demo/level2/heavy-job', { extreme: i + 1 })
    ),
  );

  races.forEach((r, i) => log(r.status, `Extrema #${i + 1}`, `${r.duration}ms`));

  const rPassed  = races.filter(r => r.status < 300).length;
  const rBlocked = races.filter(r => r.status === 429).length;
  console.log(`\n   Resultado: ${rPassed} procesada(s), ${rBlocked} bloqueada(s)`);
  console.log(`   Esperado:  ≤2 procesadas, ≥3 bloqueadas\n`);

  console.log('════════════════════════════════════════════');
  console.log('  Done');
  console.log('════════════════════════════════════════════\n');
}

main().catch(console.error);
