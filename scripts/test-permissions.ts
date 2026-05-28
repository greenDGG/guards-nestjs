/**
 * test-permissions.ts — Prueba PermissionsGuard (PBAC — lógica AND entre permisos)
 *
 * Run: npx ts-node scripts/test-permissions.ts
 *
 * Permisos por usuario:
 *   admin (id=1): todos los permisos
 *   user  (id=2): [users:read, posts:read, posts:create]
 *   guest (id=3): [posts:read]
 *
 * Escenarios:
 *   1. read-users  (permisos: ['users:read'])                    — admin ✅ | user ✅ | guest ❌
 *   2. delete-post (permisos: ['posts:update', 'posts:delete'])  — admin ✅ | user ❌ | guest ❌
 *   3. Sin token                                                  — 401
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
  console.log('  guard-nest — Permissions Guard Test Suite');
  console.log('  (PBAC — lógica AND entre permisos)');
  console.log('════════════════════════════════════════════\n');

  const adminToken = await login('admin', 'admin123');
  const userToken  = await login('user',  'user123');
  const guestToken = await login('guest', 'guest123');

  console.log('  Permisos por usuario:');
  console.log('    admin: todos');
  console.log('    user:  [users:read, posts:read, posts:create]');
  console.log('    guest: [posts:read]\n');

  // ── GET /demo/level1/read-users  (permisos: ['users:read']) ───────────────
  console.log('── GET /demo/level1/read-users  (permisos: ["users:read"]) ──\n');

  {
    const { status } = await get('/demo/level1/read-users', adminToken);
    log(status, 'admin (tiene users:read) → PASS');
  }
  {
    const { status } = await get('/demo/level1/read-users', userToken);
    log(status, 'user  (tiene users:read) → PASS');
  }
  {
    const { status, data } = await get('/demo/level1/read-users', guestToken);
    log(status, 'guest (sin users:read) → BLOCKED', (data as any)?.message);
  }

  // ── GET /demo/level1/delete-post  (AND: posts:update + posts:delete) ───────
  console.log('\n── GET /demo/level1/delete-post  (permisos: ["posts:update", "posts:delete"] — AND) ──\n');

  {
    const { status } = await get('/demo/level1/delete-post', adminToken);
    log(status, 'admin (tiene posts:update AND posts:delete) → PASS');
  }
  {
    const { status, data } = await get('/demo/level1/delete-post', userToken);
    log(status, 'user  (tiene posts:create pero NO posts:update/delete) → BLOCKED', (data as any)?.message);
  }
  {
    const { status, data } = await get('/demo/level1/delete-post', guestToken);
    log(status, 'guest (solo posts:read) → BLOCKED', (data as any)?.message);
  }

  // ── Sin token ─────────────────────────────────────────────────────────────
  console.log('\n── Sin token ──\n');

  {
    const { status, data } = await get('/demo/level1/read-users');
    log(status, 'Sin token → BLOCKED (JwtAuthGuard corre antes)', (data as any)?.message);
  }

  console.log('\n════════════════════════════════════════════');
  console.log('  Esperado:');
  console.log('    read-users:  admin ✅ | user ✅ | guest 🚫');
  console.log('    delete-post: admin ✅ | user 🚫 | guest 🚫');
  console.log('    sin token:   401 🔐');
  console.log('════════════════════════════════════════════\n');
}

main()
  .then(() => { if (failures > 0) { console.error(`\n❌ ${failures} test(s) failed`); process.exit(1); } })
  .catch((e: unknown) => { console.error(e); process.exit(1); });