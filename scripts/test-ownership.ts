/**
 * test-ownership.ts — Prueba OwnershipGuard (IDOR prevention)
 *
 * Run: npx ts-node scripts/test-ownership.ts
 *
 * Escenarios:
 *   1. Usuario accede a su propio recurso (param)         → ✅ 200
 *   2. Usuario accede al recurso de otro (IDOR)           → ❌ 403
 *   3. Admin accede al recurso de cualquier usuario       → ✅ 200 (bypass)
 *   4. Admin intenta recurso con bypassRoles: [] vacío    → ❌ 403 (sin bypass)
 *   5. Sin token en ruta protegida                        → ❌ 401
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
  token?: string,
): Promise<{ status: number; data: unknown }> {
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, { headers });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

let failures = 0;

function log(status: number, label: string, extra?: string) {
  const icon = status === 200 ? '✅' : status === 403 ? '🚫' : status === 401 ? '🔐' : '⚠️ ';
  console.log(`${icon} [${status}] ${label}${extra ? `  —  ${extra}` : ''}`);
}

async function main() {
  console.log('\n════════════════════════════════════════════');
  console.log('  guard-nest — Ownership Guard Test Suite');
  console.log('  (IDOR prevention)');
  console.log('════════════════════════════════════════════\n');

  // Login con ambos usuarios
  // admin → sub: 1  |  user → sub: 2
  const adminToken = await login('admin', 'admin123');
  const userToken  = await login('user',  'user123');

  console.log('  Tokens obtenidos:');
  console.log('    admin (sub=1):', adminToken.slice(0, 25) + '...');
  console.log('    user  (sub=2):', userToken.slice(0, 25) + '...\n');

  // ── /demo/level1/users/:userId/profile  (bypassRoles: ['admin']) ──────────
  console.log('── GET /demo/level1/users/:userId/profile  (bypassRoles: ["admin"]) ──\n');

  // 1. user (sub=2) accede a /users/2/profile → su propio recurso ✅
  {
    const { status, data } = await get('/demo/level1/users/2/profile', userToken);
    log(status, 'user (sub=2) → GET /users/2/profile (propio recurso)');
  }

  // 2. user (sub=2) intenta /users/1/profile → recurso ajeno ❌ IDOR
  {
    const { status, data } = await get('/demo/level1/users/1/profile', userToken);
    log(status, 'user (sub=2) → GET /users/1/profile (IDOR intento)', (data as any)?.message);
  }

  // 3. admin (sub=1) accede a /users/99/profile → bypass por rol admin ✅
  {
    const { status } = await get('/demo/level1/users/99/profile', adminToken);
    log(status, 'admin (sub=1) → GET /users/99/profile (bypass por rol admin)');
  }

  // 4. admin (sub=1) → su propio recurso también pasa ✅
  {
    const { status } = await get('/demo/level1/users/1/profile', adminToken);
    log(status, 'admin (sub=1) → GET /users/1/profile (propio recurso)');
  }

  // ── /demo/level1/users/:userId/secret  (bypassRoles: [] — sin bypass) ─────
  console.log('\n── GET /demo/level1/users/:userId/secret  (bypassRoles: [] — ni admin entra) ──\n');

  // 5. user (sub=2) → su propio secreto ✅
  {
    const { status } = await get('/demo/level1/users/2/secret', userToken);
    log(status, 'user (sub=2) → GET /users/2/secret (propio secreto)');
  }

  // 6. admin (sub=1) → intenta secreto de user (bypassRoles: [] vacío) ❌
  {
    const { status, data } = await get('/demo/level1/users/2/secret', adminToken);
    log(status, 'admin (sub=1) → GET /users/2/secret (sin bypass, bypassRoles: [])', (data as any)?.message);
  }

  // 7. admin (sub=1) → su propio secreto ✅ (ownership verifica correctamente)
  {
    const { status } = await get('/demo/level1/users/1/secret', adminToken);
    log(status, 'admin (sub=1) → GET /users/1/secret (propio secreto)');
  }

  // ── Sin token ─────────────────────────────────────────────────────────────
  console.log('\n── Sin token ──\n');

  // 8. Sin token → 401 antes de llegar al ownership check
  {
    const { status, data } = await get('/demo/level1/users/1/profile');
    log(status, 'Sin token → BLOCKED (JwtAuthGuard antes que OwnershipGuard)', (data as any)?.message);
  }

  console.log('\n════════════════════════════════════════════');
  console.log('  Esperado:');
  console.log('    Tests 1, 3, 4, 5, 7 → 200 ✅');
  console.log('    Tests 2, 6          → 403 🚫  (IDOR bloqueado)');
  console.log('    Test  8             → 401 🔐  (sin auth)');
  console.log('════════════════════════════════════════════\n');
}

main()
  .then(() => { if (failures > 0) { console.error(`\n❌ ${failures} test(s) failed`); process.exit(1); } })
  .catch((e: unknown) => { console.error(e); process.exit(1); });