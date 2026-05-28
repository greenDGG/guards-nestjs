/**
 * test-geo.ts — Prueba GeoIpGuard
 *
 * Run: npx ts-node scripts/test-geo.ts
 *
 * GeoIpGuard llama a ipapi.co para obtener el país de la IP de la request.
 * Resultados cacheados 24h. Para IPs privadas/localhost, el lookup devuelve null.
 *
 * fallbackAllow: true  (default) — si el lookup falla, permite la request
 * fallbackAllow: false            — si el lookup falla, bloquea la request
 *
 * Al correr localmente (127.0.0.1 es IP privada → lookup omitido):
 *   - fallbackAllow: true  → 200 siempre
 *   - fallbackAllow: false → 403 siempre (simula IP de país desconocido)
 *
 * En producción con IPs reales, el modo whitelist/blacklist funciona por país.
 */

const BASE = 'http://localhost:3000';

async function get(path: string): Promise<{ status: number; data: unknown }> {
  const res = await fetch(`${BASE}${path}`);
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

let failures = 0;

function log(status: number, label: string, note?: string) {
  const icon = status === 200 ? '✅' : status === 403 ? '🚫' : '⚠️ ';
  console.log(`${icon} [${status}] ${label}${note ? `  ← ${note}` : ''}`);
}

async function main() {
  console.log('\n════════════════════════════════════════════');
  console.log('  guard-nest — GeoIP Guard Test Suite');
  console.log('  (ipapi.co · cache 24h · IPs privadas → fallback)');
  console.log('════════════════════════════════════════════\n');

  // ── 1. Blacklist mode, fallbackAllow: true ────────────────────────────────
  console.log('── 1. Blacklist (KP, SY) — fallbackAllow: true ──\n');

  const r1 = await get('/demo/level4/geo-blacklist');
  log(r1.status, 'GET /geo-blacklist',
    r1.status === 200
      ? 'IP local → lookup omitido → fallback permite'
      : 'inesperado'
  );

  // ── 2. Whitelist mode, fallbackAllow: true ────────────────────────────────
  console.log('\n── 2. Whitelist (MX, US, ES, AR, CO, CL) — fallbackAllow: true ──\n');

  const r2 = await get('/demo/level4/geo-whitelist');
  log(r2.status, 'GET /geo-whitelist',
    r2.status === 200
      ? 'IP local → lookup omitido → fallback permite'
      : 'inesperado'
  );

  // ── 3. Strict fallback (fallbackAllow: false) ─────────────────────────────
  console.log('\n── 3. Whitelist (MX, US, ES) — fallbackAllow: false ──\n');
  console.log('   IP local = país desconocido → sin fallback → debe bloquearse\n');

  const r3 = await get('/demo/level4/geo-strict');
  log(r3.status, 'GET /geo-strict',
    r3.status === 403
      ? 'IP local → lookup omitido → sin fallback → 403'
      : r3.status === 200
        ? 'En producción con IP real permitida → 200'
        : 'inesperado'
  );

  const r3data = r3.data as any;
  if (r3.status === 403) {
    console.log(`\n  Error: ${r3data?.message ?? JSON.stringify(r3data)}`);
  }

  // ── 4. SecurityContext — GeoIP compartido entre guards ───────────────────
  console.log('\n── 4. SecurityContext — GeoIP se cachea entre guards ──\n');
  console.log('   /security-context corre BotDetectionGuard + GeoIpGuard.');
  console.log('   El segundo guard reutiliza ctx.geo sin llamar a la API.\n');

  const r4 = await get('/demo/level4/security-context');
  if (r4.status === 200) {
    const ctx = (r4.data as any)?.securityContext;
    console.log(`  ctx.geo: ${ctx?.geo ? JSON.stringify(ctx.geo) : 'null (IP local sin lookup)'}`);
    console.log(`  ctx.ip:  ${ctx?.ip ?? 'n/a'}`);
    console.log('');
    log(r4.status, 'GET /security-context',
      'ambos guards leen del mismo SecurityContext');
  } else {
    log(r4.status, 'GET /security-context');
  }

  // ── Resumen ───────────────────────────────────────────────────────────────
  console.log('════════════════════════════════════════════');
  console.log('  Resumen:');
  console.log('    IPs locales (127.x / ::1 / 10.x)  → lookup omitido');
  console.log('    fallbackAllow: true   → permite si lookup falla');
  console.log('    fallbackAllow: false  → bloquea si lookup falla');
  console.log('    GeoIP cacheado 24h en RedisStoreService (evita rate limit)');
  console.log('    En producción con IPs reales: whitelist / blacklist por país');
  console.log('════════════════════════════════════════════\n');
}

main()
  .then(() => { if (failures > 0) { console.error(`\n❌ ${failures} test(s) failed`); process.exit(1); } })
  .catch((e: unknown) => { console.error(e); process.exit(1); });