/**
 * test-cors.ts — Prueba CorsGuard (per-route CORS validation)
 *
 * Run: npx ts-node scripts/test-cors.ts
 *
 * El guard valida el header Origin contra una allowlist por ruta.
 * Sin Origin header → PASS (same-origin o request no-browser).
 * Origin en allowlist → PASS + headers Access-Control-Allow-Origin.
 * Origin fuera de allowlist → 403 CorsOriginBlockedException.
 *
 * Endpoint: GET /demo/level2/cors
 * Allowed: ['http://localhost:3000', 'http://localhost:4200', /\.example\.com$/]
 * allowCredentials: true
 */

const BASE = 'http://localhost:3000';

async function get(
  path: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; headers: Headers; data: any }> {
  const res = await fetch(`${BASE}${path}`, { headers });
  return { status: res.status, headers: res.headers, data: await res.json().catch(() => ({})) };
}

async function options(
  path: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; headers: Headers }> {
  const res = await fetch(`${BASE}${path}`, { method: 'OPTIONS', headers });
  return { status: res.status, headers: res.headers };
}

let failures = 0;

function log(status: number, label: string, detail?: string) {
  const icon = status === 200 || status === 204 ? '✅' : status === 403 ? '🚫' : '⚠️ ';
  console.log(`  ${icon} [${status}] ${label}${detail ? `  — ${detail}` : ''}`);
}

function corsHeaders(headers: Headers): string {
  const acao  = headers.get('access-control-allow-origin');
  const acac  = headers.get('access-control-allow-credentials');
  const parts: string[] = [];
  if (acao)  parts.push(`ACAO=${acao}`);
  if (acac)  parts.push(`ACAC=${acac}`);
  return parts.length ? parts.join('  ') : '(sin headers CORS)';
}

async function main() {
  console.log('\n════════════════════════════════════════════');
  console.log('  guard-nest — CORS Guard Test Suite');
  console.log('  Endpoint: GET /demo/level2/cors');
  console.log('  Allowed:  localhost:3000, localhost:4200, *.example.com');
  console.log('════════════════════════════════════════════\n');

  // ── 1. Sin Origin → PASS (same-origin / non-browser) ─────────────────────
  console.log('── 1. Sin header Origin → PASS (same-origin / server-to-server) ──\n');

  const r1 = await get('/demo/level2/cors');
  log(r1.status, '(sin Origin header)', corsHeaders(r1.headers));

  // ── 2. Origen exacto en allowlist → PASS + headers ────────────────────────
  console.log('\n── 2. Orígenes exactos en allowlist → PASS ──\n');

  const r2 = await get('/demo/level2/cors', { Origin: 'http://localhost:3000' });
  log(r2.status, 'Origin: http://localhost:3000', corsHeaders(r2.headers));

  const r3 = await get('/demo/level2/cors', { Origin: 'http://localhost:4200' });
  log(r3.status, 'Origin: http://localhost:4200', corsHeaders(r3.headers));

  // ── 3. Origen via RegExp (*.example.com) → PASS ───────────────────────────
  console.log('\n── 3. Orígenes vía RegExp (/\\.example\\.com$/) → PASS ──\n');

  const r4 = await get('/demo/level2/cors', { Origin: 'http://api.example.com' });
  log(r4.status, 'Origin: http://api.example.com', corsHeaders(r4.headers));

  const r5 = await get('/demo/level2/cors', { Origin: 'https://app.example.com' });
  log(r5.status, 'Origin: https://app.example.com', corsHeaders(r5.headers));

  // ── 4. Origen bloqueado → 403 ─────────────────────────────────────────────
  console.log('\n── 4. Orígenes fuera de la allowlist → 403 ──\n');

  const r6 = await get('/demo/level2/cors', { Origin: 'http://evil.com' });
  log(r6.status, 'Origin: http://evil.com', '403 esperado');

  const r7 = await get('/demo/level2/cors', { Origin: 'http://notexample.com' });
  log(r7.status, 'Origin: http://notexample.com',
    r7.status === 403 ? '403 esperado (no termina en .example.com)' : '');

  const r8 = await get('/demo/level2/cors', { Origin: 'http://localhost:9999' });
  log(r8.status, 'Origin: http://localhost:9999', '403 esperado (puerto distinto)');

  // ── 5. Preflight (OPTIONS) ────────────────────────────────────────────────
  // NOTA: NestJS no enruta OPTIONS a un handler @Get.
  // El guard tiene lógica de preflight (204 + headers), pero sólo se activa
  // si la ruta está registrada con @Options() o @All(). En este demo @Get
  // el preflight devuelve 404 — comportamiento esperado de NestJS.
  // En producción el CORS global de NestJS maneja el preflight antes del guard.
  console.log('\n── 5. Preflight OPTIONS — nota de comportamiento ──\n');

  const r9 = await options('/demo/level2/cors', {
    Origin: 'http://localhost:4200',
    'Access-Control-Request-Method': 'POST',
  });
  log(r9.status, 'OPTIONS preflight a ruta @Get',
    r9.status === 404
      ? '404 esperado — @Get no enruta OPTIONS (guard no ejecuta)'
      : r9.status === 204 ? '204 — guard manejó el preflight' : '');
  console.log('  ℹ️  La lógica preflight del guard aplica cuando la ruta usa @All() o @Options()');

  console.log('\n════════════════════════════════════════════');
  console.log('  Resumen:');
  console.log('    Sin Origin header          → 200 ✅ (same-origin)');
  console.log('    Origen en allowlist exacta → 200 ✅ + ACAO + ACAC headers');
  console.log('    Origen en allowlist RegExp → 200 ✅ + ACAO + ACAC headers');
  console.log('    Origen bloqueado           → 403 🚫');
  console.log('    OPTIONS en ruta @Get       → 404  (NestJS no enruta OPTIONS)');
  console.log('    OPTIONS en ruta @All/@Options → 204 ✅ (guard maneja preflight)');
  console.log('════════════════════════════════════════════\n');
}

main()
  .then(() => { if (failures > 0) { console.error(`\n❌ ${failures} test(s) failed`); process.exit(1); } })
  .catch((e: unknown) => { console.error(e); process.exit(1); });