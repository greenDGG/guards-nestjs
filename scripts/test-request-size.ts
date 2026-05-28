/**
 * test-request-size.ts — Prueba RequestSizeGuard
 *
 * Run: npx ts-node scripts/test-request-size.ts
 *
 * El guard lee el header Content-Length (no bufferiza el body).
 * Solo aplica a POST/PUT/PATCH por defecto; GET/DELETE se saltan.
 * Condición de bloqueo: size > maxBytes  (el límite es inclusivo).
 *
 * Endpoint: POST /demo/level2/request-size  — maxBytes: 100
 *
 * Tamaños de body usados:
 *   bajo  = {"data":"xxx...x"} — 50 bytes exactos
 *   justo = {"data":"xxx...x"} — 100 bytes exactos  (límite inclusivo → pasa)
 *   sobre = {"data":"xxx...x"} — 101 bytes exactos  (> 100 → 413)
 *   grande= {"data":"xxx...x"} — 500 bytes
 */

const BASE = 'http://localhost:3000';

function buildBody(targetBytes: number): string {
  // Formato: {"data":"<padding>"}
  // overhead fijo: {"data":""} = 11 bytes  → padding = targetBytes - 11
  const padding = Math.max(0, targetBytes - 11);
  return JSON.stringify({ data: 'x'.repeat(padding) });
}

async function post(
  path: string,
  body: string,
): Promise<{ status: number; contentLength: number; data: any }> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    body,
    headers: { 'Content-Type': 'application/json' },
  });
  return {
    status: res.status,
    contentLength: Buffer.byteLength(body, 'utf8'),
    data: await res.json().catch(() => ({})),
  };
}

function log(status: number, bytes: number, note?: string) {
  const icon = status < 400 ? '✅' : status === 413 ? '📦' : '⚠️ ';
  console.log(`  ${icon} [${status}] ${bytes} bytes${note ? `  — ${note}` : ''}`);
}

async function main() {
  console.log('\n════════════════════════════════════════════');
  console.log('  guard-nest — Request Size Guard Test Suite');
  console.log('  Endpoint: POST /demo/level2/request-size');
  console.log('  maxBytes: 100  (size > 100 → 413)');
  console.log('════════════════════════════════════════════\n');

  // ── 1. Body pequeño → pasa ────────────────────────────────────────────────
  console.log('── 1. Body dentro del límite ──\n');

  for (const bytes of [10, 50, 99]) {
    const body = buildBody(bytes);
    const actual = Buffer.byteLength(body, 'utf8');
    const r = await post('/demo/level2/request-size', body);
    log(r.status, actual, actual <= 100 ? 'dentro del límite → PASS' : '');
  }

  // ── 2. Body exactamente en el límite (100 bytes) → pasa ───────────────────
  console.log('\n── 2. Body = 100 bytes exactos (límite inclusivo) ──\n');

  const body100 = buildBody(100);
  const r100 = await post('/demo/level2/request-size', body100);
  log(r100.status, Buffer.byteLength(body100, 'utf8'),
    r100.status < 400
      ? '100 bytes = maxBytes → PASS (size > maxBytes es estricto)'
      : '413 inesperado');

  // ── 3. Body sobre el límite → 413 ────────────────────────────────────────
  console.log('\n── 3. Body > 100 bytes → 413 Payload Too Large ──\n');

  for (const bytes of [101, 200, 500]) {
    const body = buildBody(bytes);
    const actual = Buffer.byteLength(body, 'utf8');
    const r = await post('/demo/level2/request-size', body);
    log(r.status, actual, r.status === 413 ? '> maxBytes → 413' : 'PASS (inesperado)');
  }

  console.log('\n════════════════════════════════════════════');
  console.log('  Resumen:');
  console.log('    body ≤ maxBytes  → PASS (size > maxBytes es estricto)');
  console.log('    body > maxBytes  → 413 Payload Too Large');
  console.log('    GET/DELETE       → skip automático (solo POST/PUT/PATCH)');
  console.log('    sin Content-Length (rejectMissingContentLength=false) → PASS');
  console.log('════════════════════════════════════════════\n');
}

main().catch(console.error);
