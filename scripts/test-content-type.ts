/**
 * test-content-type.ts — Prueba ContentTypeGuard
 *
 * Run: npx ts-node scripts/test-content-type.ts
 *
 * El guard valida el Content-Type de requests con body (POST/PUT/PATCH).
 * Elimina parámetros antes de comparar: "application/json; charset=utf-8" → "application/json".
 * GET/HEAD/DELETE/OPTIONS se saltan automáticamente.
 *
 * Endpoint: POST /demo/level2/content-type  — allowed: ['application/json']
 */

const BASE = 'http://localhost:3000';

async function post(
  path: string,
  body: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; data: any }> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    body,
    headers,
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

function log(status: number, label: string, note?: string) {
  const icon = status === 200 || status === 201 ? '✅' : status === 403 ? '🚫' : '⚠️ ';
  console.log(`  ${icon} [${status}] ${label}${note ? `  — ${note}` : ''}`);
}

async function main() {
  console.log('\n════════════════════════════════════════════');
  console.log('  guard-nest — Content-Type Guard Test Suite');
  console.log('  Endpoint: POST /demo/level2/content-type');
  console.log('  Allowed:  application/json');
  console.log('════════════════════════════════════════════\n');

  // ── 1. Content-Type correcto → pasa ─────────────────────────────────────
  console.log('── 1. Content-Type válido ──\n');

  const r1 = await post('/demo/level2/content-type', '{"name":"alice"}', {
    'Content-Type': 'application/json',
  });
  log(r1.status, 'application/json', 'tipo exacto → aceptado');

  // ── 2. Content-Type con parámetros → parámetros se ignoran, pasa ─────────
  console.log('\n── 2. Content-Type con parámetros (strip) ──\n');

  const r2 = await post('/demo/level2/content-type', '{"name":"bob"}', {
    'Content-Type': 'application/json; charset=utf-8',
  });
  log(r2.status, 'application/json; charset=utf-8',
    r2.status < 400 ? 'charset ignorado → aceptado' : 'rechazado (inesperado)');

  const r3 = await post('/demo/level2/content-type', '{"name":"carol"}', {
    'Content-Type': 'application/json; boundary=something',
  });
  log(r3.status, 'application/json; boundary=something',
    r3.status < 400 ? 'parámetros ignorados → aceptado' : 'rechazado (inesperado)');

  // ── 3. Content-Type incorrecto → 403 ─────────────────────────────────────
  console.log('\n── 3. Content-Type no permitido → 403 ──\n');

  const r4 = await post('/demo/level2/content-type', 'name=alice', {
    'Content-Type': 'application/x-www-form-urlencoded',
  });
  log(r4.status, 'application/x-www-form-urlencoded', '403 esperado');

  const r5 = await post('/demo/level2/content-type', '<xml/>', {
    'Content-Type': 'application/xml',
  });
  log(r5.status, 'application/xml', '403 esperado');

  const r6 = await post('/demo/level2/content-type', 'plain text', {
    'Content-Type': 'text/plain',
  });
  log(r6.status, 'text/plain', '403 esperado');

  // ── 4. Sin Content-Type → 403 ────────────────────────────────────────────
  console.log('\n── 4. Content-Type ausente → 403 ──\n');

  const r7 = await post('/demo/level2/content-type', '{"name":"dave"}');
  log(r7.status, '(sin Content-Type header)', '403 esperado');

  console.log('\n════════════════════════════════════════════');
  console.log('  Resumen:');
  console.log('    application/json            → 200 ✅');
  console.log('    application/json; charset=* → 200 ✅ (parámetros ignorados)');
  console.log('    application/xml             → 403 🚫');
  console.log('    application/x-www-form-*    → 403 🚫');
  console.log('    text/plain                  → 403 🚫');
  console.log('    (sin header)                → 403 🚫');
  console.log('════════════════════════════════════════════\n');
}

main().catch(console.error);
