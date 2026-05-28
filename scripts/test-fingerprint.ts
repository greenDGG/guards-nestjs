/**
 * test-fingerprint.ts — Prueba DeviceFingerprintGuard
 *
 * Run: npx ts-node scripts/test-fingerprint.ts
 *
 * DeviceFingerprintGuard construye un hash SHA-256 de:
 *   User-Agent + Accept-Language + Accept-Encoding + IP subnet (/24)
 *
 * Primera request: almacena el fingerprint en el store.
 * Requests siguientes: compara y actúa según onMismatch:
 *   'block'    → 403 si el fingerprint cambia
 *   'penalize' → permite pasar pero baja el trust score
 *
 * Escenarios:
 *   1. Primera request — fingerprint almacenado
 *   2. Mismo UA — fingerprint coincide → 200
 *   3. UA diferente — mismatch → 403 (block mode)
 *   4. Penalize mode — mismatch permite pasar pero penaliza trust score
 */

const BASE = 'http://localhost:3000';

async function login(username: string, password: string): Promise<string> {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const data = await res.json() as any;
  return data.accessToken as string;
}

async function get(
  path: string,
  token: string,
  ua: string,
): Promise<{ status: number; data: unknown }> {
  const res = await fetch(`${BASE}${path}`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'User-Agent': ua,
      'Accept-Language': 'es-MX,es;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
    },
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

async function getTrustScore(token: string): Promise<number> {
  const res = await fetch(`${BASE}/demo/level4/trust-score`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  const data = await res.json() as any;
  return data?.trustScore ?? -1;
}

function log(status: number, label: string) {
  const icon = status === 200 || status === 201 ? '✅' : status === 403 ? '🚫' : '⚠️ ';
  console.log(`${icon} [${status}] ${label}`);
}

const UA_CHROME  = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36';
const UA_FIREFOX = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0';

async function main() {
  console.log('\n════════════════════════════════════════════');
  console.log('  guard-nest — Device Fingerprint Guard Test Suite');
  console.log('  (SHA-256: User-Agent + Accept-Language + Accept-Encoding + IP/24)');
  console.log('════════════════════════════════════════════\n');

  // ── Scenario 1-3: Block mode (user) ───────────────────────────────────────
  console.log('── Scenario: onMismatch = "block"  (user) ──\n');

  const tokenUser = await login('user', 'user123');
  console.log(`  Token: ${tokenUser.slice(0, 30)}...\n`);

  const r1 = await get('/demo/level4/fingerprint', tokenUser, UA_CHROME);
  log(r1.status, 'Primera request (Chrome UA) → fingerprint almacenado');

  const r2 = await get('/demo/level4/fingerprint', tokenUser, UA_CHROME);
  log(r2.status, 'Segunda request (mismo Chrome UA) → fingerprint coincide');

  const r3 = await get('/demo/level4/fingerprint', tokenUser, UA_FIREFOX);
  log(r3.status, 'Tercera request (Firefox UA) → fingerprint MISMATCH → bloqueado');

  const r3data = r3.data as any;
  if (r3.status === 403) {
    console.log(`\n  Error: ${r3data?.message ?? JSON.stringify(r3data)}`);
  }

  // ── Scenario 4: Penalize mode (admin) ─────────────────────────────────────
  console.log('\n── Scenario: onMismatch = "penalize"  (admin) ──\n');

  const tokenAdmin = await login('admin', 'admin123');
  console.log(`  Token: ${tokenAdmin.slice(0, 30)}...\n`);

  const scoreBefore = await getTrustScore(tokenAdmin);
  console.log(`  Trust score inicial: ${scoreBefore}`);

  const p1 = await get('/demo/level4/fingerprint-penalize', tokenAdmin, UA_CHROME);
  log(p1.status, 'Primera request (Chrome UA) → fingerprint almacenado');

  const scoreMid = await getTrustScore(tokenAdmin);
  console.log(`  Trust score después del primer request: ${scoreMid}`);

  const p2 = await get('/demo/level4/fingerprint-penalize', tokenAdmin, UA_FIREFOX);
  log(p2.status, 'Segunda request (Firefox UA) → fingerprint MISMATCH → penaliza pero pasa ✅');

  const scoreAfter = await getTrustScore(tokenAdmin);
  const delta = scoreMid - scoreAfter;
  console.log(`\n  Trust score después del mismatch: ${scoreAfter}  (↓ ${delta > 0 ? `bajó ${delta} puntos` : 'sin cambio'})`);

  const p3 = await get('/demo/level4/fingerprint-penalize', tokenAdmin, UA_FIREFOX);
  log(p3.status, 'Tercera request (Firefox UA) → nuevo fingerprint guardado → coincide');

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('\n════════════════════════════════════════════');
  console.log('  Resumen:');
  console.log(`    Block mode:   mismatch → 403 FingerprintChangedException`);
  console.log(`    Penalize mode: mismatch → 200 + trust score baja ${delta > 0 ? delta : '(verificar server logs)'} puntos`);
  console.log('════════════════════════════════════════════\n');
}

main().catch(console.error);
