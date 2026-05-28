/**
 * test-anomaly.ts — Prueba AnomalyDetectionGuard (detección de comportamiento anómalo)
 *
 * Run: npx ts-node scripts/test-anomaly.ts
 *
 * AnomalyDetectionGuard NUNCA bloquea — penaliza el trust score del usuario
 * cuando detecta picos de RPM o alta tasa de errores.
 * AdaptiveRateLimitGuard lee ese score para ajustar los límites automáticamente.
 *
 * EMA_ALPHA = 0.3 — cada request actualiza el baseline ponderando el pasado.
 * Un pico de RPM (currentRpm > ema_rpm × multiplier) activa la penalización.
 *
 * Escenarios:
 *   1. Trust score inicial (usuario nuevo) = 75
 *   2. 20 requests rápidas → RPM spike → score baja
 *   3. Adaptive rate limit headers reflejan el nuevo score
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
): Promise<{ status: number; data: unknown; headers: Record<string, string> }> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  const headers: Record<string, string> = {};
  res.headers.forEach((v, k) => { headers[k] = v; });
  return { status: res.status, data: await res.json().catch(() => ({})), headers };
}

let failures = 0;

function log(status: number, label: string, extra?: string) {
  const icon = status === 200 ? '✅' : status === 429 ? '🚦' : '⚠️ ';
  console.log(`${icon} [${status}] ${label}${extra ? `  —  ${extra}` : ''}`);
}

async function getTrustScore(token: string): Promise<number> {
  const { data } = await get('/demo/level4/trust-score', token);
  return (data as any)?.trustScore ?? -1;
}

async function main() {
  console.log('\n════════════════════════════════════════════');
  console.log('  guard-nest — Anomaly Detection Guard Test Suite');
  console.log('  (EMA-based behavioral analysis)');
  console.log('════════════════════════════════════════════\n');

  const token = await login('user', 'user123');
  console.log(`  Token obtenido: ${token.slice(0, 30)}...\n`);

  // ── 1. Trust score inicial ────────────────────────────────────────────────
  console.log('── 1. Trust score antes de cualquier actividad ──\n');

  const scoreBefore = await getTrustScore(token);
  console.log(`  Trust score inicial: ${scoreBefore}  (default = 75 para usuario conocido)`);
  console.log(`  Tier: ${getTier(scoreBefore)}\n`);

  // ── 2. Request normal — sin anomalía ─────────────────────────────────────
  console.log('── 2. Requests normales (1 por segundo) — sin anomalía esperada ──\n');

  for (let i = 0; i < 3; i++) {
    const { status } = await get('/demo/level4/anomaly', token);
    log(status, `Request normal #${i + 1}`);
    await new Promise(r => setTimeout(r, 1000));
  }
  const scoreAfterNormal = await getTrustScore(token);
  console.log(`\n  Trust score después de requests normales: ${scoreAfterNormal}`);

  // ── 3. Burst de requests rápidas — triggea RPM spike ─────────────────────
  console.log('\n── 3. Burst de 20 requests en ~2 segundos (RPM spike) ──\n');

  const burst = Array.from({ length: 20 }, (_, i) =>
    get('/demo/level4/anomaly', token).then(({ status }) => {
      process.stdout.write(status === 200 ? '.' : '!');
    }),
  );
  await Promise.all(burst);
  console.log('\n');

  const scoreAfterBurst = await getTrustScore(token);
  console.log(`  Trust score después del burst: ${scoreAfterBurst}  (${scoreBefore - scoreAfterBurst > 0 ? `↓ bajó ${scoreBefore - scoreAfterBurst} puntos` : 'sin cambio aún — EMA necesita más requests'})`);
  console.log(`  Tier: ${getTier(scoreAfterBurst)}`);

  // ── 4. Adaptive rate limit headers ───────────────────────────────────────
  console.log('\n── 4. Adaptive Rate Limit — headers reflejan el trust score ──\n');

  const { status, headers } = await get('/demo/level4/anomaly-adaptive', token);
  log(status, 'GET /anomaly-adaptive');
  console.log(`
  X-RateLimit-Trust-Score:      ${headers['x-ratelimit-trust-score'] ?? 'n/a'}
  X-RateLimit-Trust-Tier:       ${headers['x-ratelimit-trust-tier'] ?? 'n/a'}
  X-RateLimit-Trust-Multiplier: ${headers['x-ratelimit-trust-multiplier'] ?? 'n/a'}
  X-RateLimit-Limit:            ${headers['x-ratelimit-limit'] ?? 'n/a'}  (baseMax=30 × multiplier)
  X-RateLimit-Remaining:        ${headers['x-ratelimit-remaining'] ?? 'n/a'}
  `);

  console.log('════════════════════════════════════════════');
  console.log('  Resumen:');
  console.log(`    Trust score: ${scoreBefore} → ${scoreAfterBurst}`);
  console.log(`    AnomalyDetectionGuard: NUNCA bloquea — solo penaliza`);
  console.log(`    AdaptiveRateLimitGuard: lee el trust score y ajusta límites`);
  console.log('════════════════════════════════════════════\n');
}

function getTier(score: number): string {
  if (score <= 25) return 'severely-untrusted (×0.02)';
  if (score <= 50) return 'new-user (×0.10)';
  if (score <= 75) return 'regular (×0.50)';
  if (score <= 90) return 'trusted (×1.00)';
  return 'vip (×2.00)';
}

main()
  .then(() => { if (failures > 0) { console.error(`\n❌ ${failures} test(s) failed`); process.exit(1); } })
  .catch((e: unknown) => { console.error(e); process.exit(1); });