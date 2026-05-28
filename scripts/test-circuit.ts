/**
 * test-circuit.ts — Prueba CircuitBreakerGuard + CircuitBreakerInterceptor
 *
 * Run: npx ts-node scripts/test-circuit.ts
 *
 * Estados del circuit breaker:
 *   CLOSED    — normal. Cuenta fallos.
 *   OPEN      — demasiados fallos. Rechaza todo con 503.
 *   HALF_OPEN — probando recuperación. Deja pasar UNA request.
 *
 * Usa dos endpoints con el mismo serviceKey='test-service':
 *   /circuit-faulty  — siempre lanza Error (para abrir el circuit determinísticamente)
 *   /circuit-healthy — siempre tiene éxito (para cerrar el circuit en HALF_OPEN)
 *
 * Config: failureThreshold=3, successThreshold=2, timeout=6s
 *
 * Flujo del test:
 *   1. 3 requests a /circuit-faulty → 3 fallos → circuit ABRE
 *   2. Request a /circuit-healthy  → circuit OPEN → 503
 *   3. Esperar 7 segundos (timeout=6s)
 *   4. Request a /circuit-healthy  → HALF_OPEN → pasa (éxito #1)
 *   5. Request a /circuit-healthy  → successThreshold=2 → circuit CIERRA
 *   6. Request a /circuit-faulty   → circuit CLOSED → pasa (aunque falla, solo cuenta)
 */

const BASE = 'http://localhost:3000';

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function get(path: string): Promise<{ status: number; data: any }> {
  const res = await fetch(`${BASE}${path}`);
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

let failures = 0;

function log(status: number, label: string, note?: string) {
  const icon = status === 200 || status === 201 ? '✅' : status === 503 ? '⚡' : status === 500 ? '💥' : '⚠️ ';
  console.log(`  ${icon} [${status}] ${label}${note ? `  — ${note}` : ''}`);
}

async function main() {
  console.log('\n════════════════════════════════════════════');
  console.log('  guard-nest — Circuit Breaker Test Suite');
  console.log('  CLOSED → (3 fallos) → OPEN → (6s) → HALF_OPEN → (2 éxitos) → CLOSED');
  console.log('════════════════════════════════════════════\n');

  // ── 1. Circuit CLOSED → acumular 3 fallos → OPEN ─────────────────────────
  console.log('── 1. Circuit CLOSED — 3 requests que siempre fallan ──\n');

  for (let i = 1; i <= 3; i++) {
    const r = await get('/demo/level3/circuit-faulty');
    log(r.status, `Request #${i} a /circuit-faulty`,
      r.status === 500 ? `fallo ${i}/3 registrado` :
      r.status === 503 ? 'circuit ya abierto' : '');
  }

  // ── 2. Circuit OPEN → siguiente request bloqueada con 503 ────────────────
  console.log('\n── 2. Circuit OPEN — siguiente request bloqueada ──\n');

  const r4 = await get('/demo/level3/circuit-healthy');
  log(r4.status, 'Request a /circuit-healthy mientras circuit OPEN',
    r4.status === 503
      ? `circuit bloqueó → retry in ~6s`
      : r4.status === 200 ? 'circuit no llegó a abrirse aún' : '');

  if (r4.status === 503) {
    const waitSec = 7;
    console.log(`\n── 3. Esperando ${waitSec}s para que expire el timeout (6s) ──\n`);
    await sleep(waitSec * 1000);
  } else {
    console.log('\n── 3. Circuit aún no abierto — disparando más fallos ──\n');
    for (let i = 0; i < 3; i++) await get('/demo/level3/circuit-faulty');
    console.log('  Esperando 7s...');
    await sleep(7000);
  }

  // ── 4. Circuit HALF_OPEN → deja pasar probe request ──────────────────────
  console.log('── 4. Circuit HALF_OPEN — probe request ──\n');

  const r5 = await get('/demo/level3/circuit-healthy');
  log(r5.status, 'Probe request #1 (éxito esperado)',
    r5.status === 200 ? 'éxito 1/2 — aún HALF_OPEN' :
    r5.status === 503 ? 'todavía OPEN — timeout insuficiente' : '');

  // ── 5. successThreshold=2 → circuit CIERRA ───────────────────────────────
  console.log('\n── 5. Segundo éxito → successThreshold=2 → circuit CIERRA ──\n');

  const r6 = await get('/demo/level3/circuit-healthy');
  log(r6.status, 'Probe request #2',
    r6.status === 200 ? 'éxito 2/2 → circuit CLOSED ✅' : '');

  // ── 6. Circuit CLOSED — vuelve a la normalidad ────────────────────────────
  console.log('\n── 6. Circuit CLOSED — operación normal restaurada ──\n');

  const r7 = await get('/demo/level3/circuit-healthy');
  log(r7.status, 'Request normal post-recovery', r7.status === 200 ? 'circuit funcionando ✅' : '');

  const r8 = await get('/demo/level3/circuit-faulty');
  log(r8.status, 'Fallo pasa (circuit CLOSED, fallo #1/3)',
    r8.status === 500 ? 'fallo registrado pero circuit sigue CLOSED' : '');

  console.log('\n════════════════════════════════════════════');
  console.log('  Resumen del ciclo completo:');
  console.log('    CLOSED  → 3 fallos    → OPEN');
  console.log('    OPEN    → timeout 6s  → HALF_OPEN');
  console.log('    HALF_OPEN → 2 éxitos  → CLOSED');
  console.log('════════════════════════════════════════════\n');
}

main()
  .then(() => { if (failures > 0) { console.error(`\n❌ ${failures} test(s) failed`); process.exit(1); } })
  .catch((e: unknown) => { console.error(e); process.exit(1); });