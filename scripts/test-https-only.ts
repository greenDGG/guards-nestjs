/**
 * test-https-only.ts — Prueba HttpsOnlyGuard
 *
 * Run: npx ts-node scripts/test-https-only.ts
 *
 * El guard verifica en orden:
 *   1. request.secure / request.protocol === 'https'  → PASS
 *   2. x-forwarded-proto header (reverse proxy)       → evalúa primer valor
 *   3. Hostname === localhost / 127.0.0.1              → PASS (dev bypass)
 *   4. Ninguna condición cumplida                      → 403
 *
 * Importante: x-forwarded-proto se evalúa ANTES del localhost bypass.
 * Enviar x-forwarded-proto: http bloquea incluso en localhost.
 *
 * Endpoint: GET /demo/level2/https-only
 */

const BASE = 'http://localhost:3000';

async function get(
  path: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; data: any }> {
  const res = await fetch(`${BASE}${path}`, { headers });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

let failures = 0;

function log(status: number, label: string, note?: string) {
  const icon = status === 200 ? '✅' : status === 403 ? '🚫' : '⚠️ ';
  console.log(`  ${icon} [${status}] ${label}${note ? `  — ${note}` : ''}`);
}

async function main() {
  console.log('\n════════════════════════════════════════════');
  console.log('  guard-nest — HTTPS-Only Guard Test Suite');
  console.log('  Endpoint: GET /demo/level2/https-only');
  console.log('════════════════════════════════════════════\n');

  // ── 1. Sin header → dev bypass (localhost) ────────────────────────────────
  console.log('── 1. Sin x-forwarded-proto → dev bypass (localhost) ──\n');

  const r1 = await get('/demo/level2/https-only');
  log(r1.status, '(sin headers)', 'localhost bypass → PASS');

  // ── 2. x-forwarded-proto: https → reverse proxy HTTPS ────────────────────
  console.log('\n── 2. x-forwarded-proto: https → simula reverse proxy HTTPS ──\n');

  const r2 = await get('/demo/level2/https-only', { 'x-forwarded-proto': 'https' });
  log(r2.status, 'x-forwarded-proto: https', 'primer valor = https → PASS');

  const r3 = await get('/demo/level2/https-only', { 'x-forwarded-proto': 'https, http' });
  log(r3.status, 'x-forwarded-proto: https, http',
    r3.status === 200 ? 'primer valor = https → PASS (http ignorado)' : '');

  // ── 3. x-forwarded-proto: http → bloqueado (incluso en localhost) ─────────
  console.log('\n── 3. x-forwarded-proto: http → 403 (proxy header tiene prioridad) ──\n');

  const r4 = await get('/demo/level2/https-only', { 'x-forwarded-proto': 'http' });
  log(r4.status, 'x-forwarded-proto: http',
    r4.status === 403 ? '403 — proxy dice HTTP, localhost bypass no aplica' : '');

  const r5 = await get('/demo/level2/https-only', { 'x-forwarded-proto': 'http, https' });
  log(r5.status, 'x-forwarded-proto: http, https',
    r5.status === 403 ? '403 — primer valor = http (segundo ignorado)' : '');

  console.log('\n════════════════════════════════════════════');
  console.log('  Resumen del orden de evaluación:');
  console.log('    1. request.secure / protocol=https → PASS');
  console.log('    2. x-forwarded-proto (primer valor) → https=PASS / http=403');
  console.log('    3. hostname = localhost              → PASS (dev bypass)');
  console.log('    4. ninguna condición                → 403');
  console.log('════════════════════════════════════════════\n');
}

main()
  .then(() => { if (failures > 0) { console.error(`\n❌ ${failures} test(s) failed`); process.exit(1); } })
  .catch((e: unknown) => { console.error(e); process.exit(1); });