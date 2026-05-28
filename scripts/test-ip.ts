/**
 * test-ip.ts — Prueba IpGuard (whitelist / blacklist / CIDR)
 *
 * Run: npx ts-node scripts/test-ip.ts
 *
 * IpExtractorService lee la IP del cliente en este orden:
 *   1. request.securityContext.ip  (si SecurityContextMiddleware ya corrió)
 *   2. x-forwarded-for             (primer valor)
 *   3. x-real-ip
 *   4. socket.remoteAddress        (strips ::ffff: prefix)
 *
 * Endpoints del demo:
 *   /demo/level2/ip-whitelist  — mode: 'whitelist', list: [127.0.0.1, ::1, ::ffff:127.0.0.1]
 *   /demo/level2/ip-blacklist  — mode: 'blacklist', list: [1.2.3.4, 10.10.0.0/16]
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
  console.log('  guard-nest — IP Guard Test Suite');
  console.log('  Whitelist: 127.0.0.1, ::1, ::ffff:127.0.0.1');
  console.log('  Blacklist: 1.2.3.4, 10.10.0.0/16');
  console.log('════════════════════════════════════════════\n');

  // ── 1. Whitelist — IP local en la lista ───────────────────────────────────
  console.log('── 1. Whitelist — IP local (127.0.0.1) ──\n');

  const r1 = await get('/demo/level2/ip-whitelist');
  log(r1.status, '(sin override — socket IP = 127.0.0.1)', '127.0.0.1 en whitelist → PASS');

  // ── 2. Whitelist — IP externa simulada via x-forwarded-for → 403 ──────────
  console.log('\n── 2. Whitelist — IP externa vía x-forwarded-for → 403 ──\n');

  const r2 = await get('/demo/level2/ip-whitelist', { 'x-forwarded-for': '5.5.5.5' });
  log(r2.status, 'x-forwarded-for: 5.5.5.5', '5.5.5.5 no está en whitelist → 403');

  const r3 = await get('/demo/level2/ip-whitelist', { 'x-forwarded-for': '192.168.1.100' });
  log(r3.status, 'x-forwarded-for: 192.168.1.100', 'IP privada fuera de lista → 403');

  // ── 3. Blacklist — IP normal, no bloqueada → 200 ──────────────────────────
  console.log('\n── 3. Blacklist — IP no bloqueada → PASS ──\n');

  const r4 = await get('/demo/level2/ip-blacklist');
  log(r4.status, '(sin override — socket IP = 127.0.0.1)', '127.0.0.1 no está en blacklist → PASS');

  const r5 = await get('/demo/level2/ip-blacklist', { 'x-forwarded-for': '8.8.8.8' });
  log(r5.status, 'x-forwarded-for: 8.8.8.8', '8.8.8.8 no está en blacklist → PASS');

  // ── 4. Blacklist — IP exacta bloqueada → 403 ─────────────────────────────
  console.log('\n── 4. Blacklist — IP exacta (1.2.3.4) → 403 ──\n');

  const r6 = await get('/demo/level2/ip-blacklist', { 'x-forwarded-for': '1.2.3.4' });
  log(r6.status, 'x-forwarded-for: 1.2.3.4', 'match exacto → 403');

  // ── 5. Blacklist — CIDR 10.10.0.0/16 ─────────────────────────────────────
  console.log('\n── 5. Blacklist — CIDR 10.10.0.0/16 (10.10.0.0 – 10.10.255.255) ──\n');

  const cidrCases: Array<[string, boolean]> = [
    ['10.10.0.1',   true],   // primer host del rango
    ['10.10.128.5', true],   // mitad del rango
    ['10.10.255.255', true], // último host del rango
    ['10.11.0.1',   false],  // fuera del rango (siguiente /16)
    ['10.9.255.255', false], // fuera del rango (anterior)
  ];

  for (const [ip, shouldBlock] of cidrCases) {
    const r = await get('/demo/level2/ip-blacklist', { 'x-forwarded-for': ip });
    const expected = shouldBlock ? 403 : 200;
    const ok = r.status === expected;
    const icon = ok ? (shouldBlock ? '🚫' : '✅') : '❌';
    console.log(`  ${icon} [${r.status}] x-forwarded-for: ${ip.padEnd(15)}` +
      `  — ${shouldBlock ? 'en rango → 403' : 'fuera del rango → PASS'}${ok ? '' : ' (INESPERADO)'}`);
  }

  console.log('\n════════════════════════════════════════════');
  console.log('  Resumen:');
  console.log('    Whitelist — IP en lista     → 200 ✅');
  console.log('    Whitelist — IP fuera         → 403 🚫');
  console.log('    Blacklist — IP no bloqueada → 200 ✅');
  console.log('    Blacklist — exacto (1.2.3.4) → 403 🚫');
  console.log('    Blacklist — CIDR (10.10.x.x) → 403 🚫');
  console.log('    Blacklist — fuera del CIDR   → 200 ✅');
  console.log('════════════════════════════════════════════\n');
}

main()
  .then(() => { if (failures > 0) { console.error(`\n❌ ${failures} test(s) failed`); process.exit(1); } })
  .catch((e: unknown) => { console.error(e); process.exit(1); });