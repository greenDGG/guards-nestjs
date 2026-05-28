/**
 * test-emergency-lock.ts — Prueba EmergencyLockGuard
 *
 * Run: npx ts-node scripts/test-emergency-lock.ts
 *
 * EmergencyLockGuard — kill switch de endpoints.
 * Lock/unlock en caliente sin reiniciar el servidor.
 *
 * Endpoints demo:
 *   GET  /demo/level2/emergency-check     — key: "demo-check"
 *   POST /demo/level2/emergency-login     — key: "login"
 *   POST /demo/level2/emergency-withdraw  — key: "withdrawals"
 *   GET  /demo/level2/emergency-observe   — logOnly: true
 *
 * Admin API:
 *   POST /emergency/lock      { key, reason, ttlSeconds? }
 *   POST /emergency/unlock    { key }
 *   POST /emergency/unlock-all
 *   GET  /emergency/status
 *   Header: x-admin-key: <EMERGENCY_LOCK_ADMIN_KEY>
 */

const BASE       = 'http://localhost:3000';
const ADMIN_KEY  = process.env.EMERGENCY_LOCK_ADMIN_KEY ?? 'emergency-admin-key';

interface Hit {
  status: number;
  data:   any;
  headers: Headers;
}

async function req(
  method: string,
  path: string,
  body?: any,
  extraHeaders?: Record<string, string>,
): Promise<Hit> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type':  'application/json',
      'x-admin-key':   ADMIN_KEY,
      ...extraHeaders,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return {
    status:  res.status,
    data:    await res.json().catch(() => ({})),
    headers: res.headers,
  };
}

async function get(path: string, extra?: Record<string, string>) {
  return req('GET', path, undefined, extra);
}
async function post(path: string, body?: any, extra?: Record<string, string>) {
  return req('POST', path, body, extra);
}

function icon(status: number): string {
  if (status === 200 || status === 201) return '🟢';
  if (status === 503) return '🔴';
  if (status === 401 || status === 403) return '🟡';
  return '⚪';
}

function row(label: string, h: Hit) {
  const msg = h.status >= 400
    ? (h.data?.message ?? JSON.stringify(h.data)).slice(0, 70)
    : JSON.stringify(h.data).slice(0, 60);
  const retry = h.headers.get('retry-after');
  const extra = retry ? `  (Retry-After: ${retry}s)` : '';
  console.log(`  ${icon(h.status)}  ${label.padEnd(56)}  HTTP ${h.status}  ${msg}${extra}`);
}

async function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

let failures = 0;

async function main() {
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  guard-nest — EmergencyLockGuard Test');
  console.log('  Kill switch: lock/unlock endpoints in hot without restart');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // ── Limpieza inicial ───────────────────────────────────────────────────────
  await post('/emergency/unlock-all');

  // ── Check 1: Estado inicial — sin locks ────────────────────────────────────
  console.log('── Check 1: Sin locks — todos los endpoints operativos ──\n');

  const s1 = await get('/emergency/status');
  console.log(`  Estado inicial: ${s1.data.activeLocks} locks activos\n`);

  const a1 = await get('/demo/level2/emergency-check');
  row('GET /emergency-check → 200 (sin lock)', a1);

  const b1 = await post('/demo/level2/emergency-login', { username: 'alice' });
  row('POST /emergency-login → 200 (sin lock)', b1);

  const c1 = await post('/demo/level2/emergency-withdraw', { amount: 500 });
  row('POST /emergency-withdraw → 200 (sin lock)', c1);

  console.log();

  // ── Check 2: Lock + respuesta 503 ─────────────────────────────────────────
  console.log('── Check 2: Lock "demo-check" → 503 inmediato ──\n');

  const lockRes = await post('/emergency/lock', {
    key:    'demo-check',
    reason: 'Bajo ataque — DDoS detectado',
  });
  console.log(`  Admin: LOCK "demo-check" → ${JSON.stringify(lockRes.data)}\n`);

  const a2 = await get('/demo/level2/emergency-check', { 'x-admin-key': '' });
  row('GET /emergency-check → 503 (locked)', a2);

  const s2 = await get('/emergency/status');
  console.log(`\n  Status: ${s2.data.activeLocks} lock(s) activo(s) — key="${s2.data.locks[0]?.key}", reason="${s2.data.locks[0]?.reason}"\n`);

  // ── Check 3: Unlock → vuelve a operar ─────────────────────────────────────
  console.log('── Check 3: Unlock "demo-check" → vuelve a 200 ──\n');

  const unlockRes = await post('/emergency/unlock', { key: 'demo-check' });
  console.log(`  Admin: UNLOCK "demo-check" → unlocked=${unlockRes.data.unlocked}\n`);

  const a3 = await get('/demo/level2/emergency-check');
  row('GET /emergency-check → 200 (desbloqueado)', a3);

  console.log();

  // ── Check 4: Lock múltiple → unlock-all ───────────────────────────────────
  console.log('── Check 4: Lock múltiple ("login" + "withdrawals") → unlock-all ──\n');

  await post('/emergency/lock', { key: 'login',       reason: 'Credential stuffing detectado' });
  await post('/emergency/lock', { key: 'withdrawals', reason: 'Transacciones sospechosas' });

  const b2 = await post('/demo/level2/emergency-login',   { username: 'alice' }, { 'x-admin-key': '' });
  const c2 = await post('/demo/level2/emergency-withdraw', { amount: 500 },       { 'x-admin-key': '' });
  row('POST /emergency-login    → 503 (locked)', b2);
  row('POST /emergency-withdraw → 503 (locked)', c2);

  const s3 = await get('/emergency/status');
  console.log(`\n  Status: ${s3.data.activeLocks} locks activos\n`);

  const unlockAll = await post('/emergency/unlock-all');
  console.log(`  Admin: UNLOCK-ALL → count=${unlockAll.data.count}, keys=${JSON.stringify(unlockAll.data.keys)}\n`);

  const b3 = await post('/demo/level2/emergency-login',   { username: 'alice' }, { 'x-admin-key': '' });
  const c3 = await post('/demo/level2/emergency-withdraw', { amount: 500 },       { 'x-admin-key': '' });
  row('POST /emergency-login    → 200 (desbloqueado)', b3);
  row('POST /emergency-withdraw → 200 (desbloqueado)', c3);

  console.log();

  // ── Check 5: TTL — auto-unlock ────────────────────────────────────────────
  console.log('── Check 5: Lock con TTL 3s → auto-unlock ──\n');

  await post('/emergency/lock', {
    key:        'withdrawals',
    reason:     'Mantenimiento programado — 3 segundos',
    ttlSeconds: 3,
  });

  const c4 = await post('/demo/level2/emergency-withdraw', { amount: 100 }, { 'x-admin-key': '' });
  const retryAfter = c4.headers.get('retry-after');
  row(`POST /emergency-withdraw → 503 (Retry-After: ${retryAfter}s)`, c4);

  console.log('\n  Esperando 3.5s para auto-unlock...\n');
  await sleep(3_500);

  const c5 = await post('/demo/level2/emergency-withdraw', { amount: 100 }, { 'x-admin-key': '' });
  row('POST /emergency-withdraw → 200 (TTL expirado, auto-desbloqueado)', c5);

  console.log();

  // ── Check 6: logOnly — observar sin bloquear ──────────────────────────────
  console.log('── Check 6: logOnly — nunca bloquea, registra en logs ──\n');

  await post('/emergency/lock', { key: 'observe-demo', reason: 'Test logOnly mode' });

  const d1 = await get('/demo/level2/emergency-observe');
  row('GET /emergency-observe → 200 (logOnly=true, aunque locked)', d1);
  console.log('  (Mira los logs del servidor: [EMERGENCY-LOCK] [OBSERVE])\n');

  await post('/emergency/unlock', { key: 'observe-demo' });

  // ── Check 7: Admin sin key → 401 ──────────────────────────────────────────
  console.log('── Check 7: Admin sin x-admin-key → 401 ──\n');

  const noKey = await get('/emergency/status', { 'x-admin-key': 'wrong-key' });
  row('GET /emergency/status (wrong key) → 401', noKey);

  console.log();

  // ── Limpieza final ────────────────────────────────────────────────────────
  await post('/emergency/unlock-all');

  // ── Resumen ───────────────────────────────────────────────────────────────
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  EmergencyLockGuard — resumen:');
  console.log('    lock({ key })               → 503 inmediato en todos los @EmergencyLock({ key })');
  console.log('    lock({ key, ttlSeconds })   → auto-unlock después de N segundos');
  console.log('    unlock({ key })             → restaura el endpoint');
  console.log('    unlock-all                  → restaura todo en una sola llamada');
  console.log('    logOnly: true               → observa sin bloquear (ramp seguro)');
  console.log('    allowedRoles / allowedIps   → bypass estático o dinámico');
  console.log();
  console.log('  Casos de uso reales:');
  console.log('    withdrawals   — bloquear durante ataque de draining');
  console.log('    login         — parar credential stuffing instantáneamente');
  console.log('    api-key       — bloquear key comprometida sin despliegue');
  console.log('    EMERGENCY_LOCK_KEYS=login,withdraw — lock en arranque via env var');
  console.log('═══════════════════════════════════════════════════════════════\n');
}

main()
  .then(() => { if (failures > 0) { console.error(`\n❌ ${failures} test(s) failed`); process.exit(1); } })
  .catch((e: unknown) => { console.error(e); process.exit(1); });