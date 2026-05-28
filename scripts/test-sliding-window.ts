/**
 * test-sliding-window.ts — Prueba SlidingWindowRateLimitGuard
 *
 * Run: npx ts-node scripts/test-sliding-window.ts
 *
 * Ventana deslizante vs. ventana fija:
 *   Ventana fija  — el contador se resetea en T+windowMs desde la PRIMERA request.
 *                   Permite burst de 2×max en el límite de dos ventanas.
 *   Ventana deslizante — siempre mira los últimos windowMs milisegundos.
 *                         Sin burst posible. Límite exacto en todo momento.
 *
 * Endpoints usados (Level3RateLimitController):
 *   /demo/level3/sliding-window       — max=5 / 10s por IP
 *   /demo/level3/sliding-window-user  — max=3 / 5s  por usuario (anónimo)
 *
 * Flujo del test:
 *   1. 5 requests — todas pasan, headers muestran countdown
 *   2. Request #6 — 429 + Retry-After header
 *   3. Esperar 11s para que la ventana expire
 *   4. Request #7 — pasa de nuevo (ventana limpia)
 *   5. Endpoint por usuario — max=3/5s, misma demostración
 */

const BASE = 'http://localhost:3000';

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function req(path: string, method = 'GET'): Promise<{ status: number; headers: Headers; data: any }> {
  const res = await fetch(`${BASE}${path}`, { method });
  return { status: res.status, headers: res.headers, data: await res.json().catch(() => ({})) };
}

function fmt(r: { status: number; headers: Headers }): string {
  const limit     = r.headers.get('x-ratelimit-limit')     ?? '-';
  const remaining = r.headers.get('x-ratelimit-remaining') ?? '-';
  const reset     = r.headers.get('x-ratelimit-reset')     ?? '-';
  const retry     = r.headers.get('retry-after');
  const icon      = r.status === 200 ? '✅' : r.status === 429 ? '❌' : '⚠️ ';
  const base      = `${icon} [${r.status}]  limit=${limit}  remaining=${remaining}  reset=${reset}s`;
  return retry ? `${base}  retry-after=${retry}s` : base;
}

let failures = 0;

async function main() {
  console.log('\n════════════════════════════════════════════');
  console.log('  guard-nest — Sliding Window Rate Limit Test');
  console.log('  Algoritmo: rolling timestamps (no boundary burst)');
  console.log('════════════════════════════════════════════\n');

  // ── 1. Requests dentro del límite (max=5 / 10s) ───────────────────────────
  console.log('── 1. max=5 / 10s por IP — requests que pasan ──\n');

  for (let i = 1; i <= 5; i++) {
    const r = await req('/demo/level3/sliding-window');
    console.log(`  Request #${i}  ${fmt(r)}`);
    await sleep(50);
  }

  // ── 2. Request #6 — límite excedido ──────────────────────────────────────
  console.log('\n── 2. Request #6 — límite excedido (429) ──\n');

  const r6 = await req('/demo/level3/sliding-window');
  console.log(`  Request #6  ${fmt(r6)}`);

  // ── 3. Esperar a que la ventana deslizante expire ─────────────────────────
  const waitSec = 11;
  console.log(`\n── 3. Esperando ${waitSec}s para que la ventana de 10s expire ──\n`);
  console.log('  (ventana deslizante: los timestamps más antiguos caducan uno a uno)\n');
  await sleep(waitSec * 1000);

  // ── 4. Request post-ventana — pasa de nuevo ───────────────────────────────
  console.log('── 4. Ventana expirada — request pasa de nuevo ──\n');

  const r7 = await req('/demo/level3/sliding-window');
  console.log(`  Request #7  ${fmt(r7)}`);

  // ── 5. Endpoint por usuario (max=3 / 5s) ─────────────────────────────────
  console.log('\n── 5. max=3 / 5s por usuario (anónimo) ──\n');

  for (let i = 1; i <= 4; i++) {
    const r = await req('/demo/level3/sliding-window-user');
    console.log(`  Request #${i}  ${fmt(r)}`);
    await sleep(50);
  }

  console.log('\n════════════════════════════════════════════');
  console.log('  Resumen del algoritmo:');
  console.log('    - Guarda timestamps en lista (RedisStoreService)');
  console.log('    - Filtra los que cayeron fuera de la ventana');
  console.log('    - count >= max → 429 + Retry-After');
  console.log('    - headers: X-RateLimit-Limit / Remaining / Reset');
  console.log('════════════════════════════════════════════\n');
}

main()
  .then(() => { if (failures > 0) { console.error(`\n❌ ${failures} test(s) failed`); process.exit(1); } })
  .catch((e: unknown) => { console.error(e); process.exit(1); });