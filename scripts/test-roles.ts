/**
 * test-roles.ts — Prueba RolesGuard (RBAC — lógica OR entre roles)
 *
 * Run: npx ts-node scripts/test-roles.ts
 *
 * Usuarios:
 *   admin  → roles: ['admin']
 *   user   → roles: ['user']
 *   guest  → roles: ['guest']
 *
 * Escenarios:
 *   1. admin-only  (roles: ['admin'])          — admin ✅ | user ❌ | guest ❌
 *   2. staff       (roles: ['admin','moderator']) — admin ✅ | user ❌ | guest ❌
 *   3. Sin token                                  — 401
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
  console.log('  guard-nest — Roles Guard Test Suite');
  console.log('  (RBAC — lógica OR entre roles)');
  console.log('════════════════════════════════════════════\n');

  const adminToken = await login('admin', 'admin123');
  const userToken  = await login('user',  'user123');
  const guestToken = await login('guest', 'guest123');

  console.log('  Tokens obtenidos:');
  console.log('    admin (roles=[admin]):', adminToken.slice(0, 25) + '...');
  console.log('    user  (roles=[user]): ', userToken.slice(0, 25)  + '...');
  console.log('    guest (roles=[guest]):', guestToken.slice(0, 25) + '...\n');

  // ── GET /demo/level1/admin-only  (roles: ['admin']) ───────────────────────
  console.log('── GET /demo/level1/admin-only  (roles: ["admin"]) ──\n');

  {
    const { status } = await get('/demo/level1/admin-only', adminToken);
    log(status, 'admin (roles=[admin]) → PASS');
  }
  {
    const { status, data } = await get('/demo/level1/admin-only', userToken);
    log(status, 'user  (roles=[user])  → BLOCKED', (data as any)?.message);
  }
  {
    const { status, data } = await get('/demo/level1/admin-only', guestToken);
    log(status, 'guest (roles=[guest]) → BLOCKED', (data as any)?.message);
  }

  // ── GET /demo/level1/staff  (roles: ['admin', 'moderator'] — OR) ──────────
  console.log('\n── GET /demo/level1/staff  (roles: ["admin", "moderator"] — OR) ──\n');

  {
    const { status } = await get('/demo/level1/staff', adminToken);
    log(status, 'admin (tiene "admin") → PASS');
  }
  {
    const { status, data } = await get('/demo/level1/staff', userToken);
    log(status, 'user  (sin "admin" ni "moderator") → BLOCKED', (data as any)?.message);
  }
  {
    const { status, data } = await get('/demo/level1/staff', guestToken);
    log(status, 'guest (sin "admin" ni "moderator") → BLOCKED', (data as any)?.message);
  }

  // ── Sin token ─────────────────────────────────────────────────────────────
  console.log('\n── Sin token ──\n');

  {
    const { status, data } = await get('/demo/level1/admin-only');
    log(status, 'Sin token → BLOCKED (JwtAuthGuard corre antes)', (data as any)?.message);
  }

  console.log('\n════════════════════════════════════════════');
  console.log('  Esperado:');
  console.log('    admin-only: admin ✅ | user 🚫 | guest 🚫');
  console.log('    staff:      admin ✅ | user 🚫 | guest 🚫');
  console.log('    sin token:  401 🔐');
  console.log('════════════════════════════════════════════\n');
}

main()
  .then(() => { if (failures > 0) { console.error(`\n❌ ${failures} test(s) failed`); process.exit(1); } })
  .catch((e: unknown) => { console.error(e); process.exit(1); });