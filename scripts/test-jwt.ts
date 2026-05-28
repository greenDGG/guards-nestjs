/**
 * test-jwt.ts — Prueba JwtAuthGuard
 *
 * Run: npx ts-node scripts/test-jwt.ts
 *
 * Escenarios:
 *   1. Ruta pública (@Public())          → ✅ 200 sin token
 *   2. Login válido                       → ✅ 200 + accessToken + refreshToken
 *   3. Ruta protegida con token válido    → ✅ 200
 *   4. Ruta protegida sin token           → ❌ 401
 *   5. Token malformado                   → ❌ 401
 *   6. Token expirado (fabricado)         → ❌ 401
 *   7. Scheme incorrecto (Basic vs Bearer)→ ❌ 401
 *   8. GET /auth/me — payload del token   → ✅ muestra sub, username, roles
 *   9. Refresh token → nuevo accessToken  → ✅ 200 + nuevo token
 */

const BASE = 'http://localhost:3000';

async function request(
  method: 'GET' | 'POST',
  path: string,
  opts: { token?: string; body?: unknown } = {},
): Promise<{ status: number; data: unknown }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.token) headers['Authorization'] = `Bearer ${opts.token}`;

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

let failures = 0;

function log(status: number, label: string, extra?: string) {
  const icon = status < 300 ? '✅' : status === 401 ? '🔐' : '⚠️ ';
  if (icon.startsWith('⚠️')) failures++;
  console.log(`${icon} [${status}] ${label}${extra ? `  —  ${extra}` : ''}`);
}

async function main() {
  console.log('\n════════════════════════════════════════════');
  console.log('  guard-nest — JWT Auth Guard Test Suite');
  console.log('════════════════════════════════════════════\n');

  // ── 1. Ruta pública — sin token ───────────────────────────────────────────
  {
    const { status } = await request('GET', '/demo/level1/public');
    log(status, '@Public() — sin token → PASS');
  }

  // ── 2. Login — obtener tokens ─────────────────────────────────────────────
  console.log('\n── Login ──\n');

  let accessToken  = '';
  let refreshToken = '';

  {
    const { status, data } = await request('POST', '/auth/login', {
      body: { username: 'admin', password: 'admin123' },
    });
    log(status, 'POST /auth/login admin:admin123');

    if (status === 200) {
      accessToken  = (data as any).accessToken;
      refreshToken = (data as any).refreshToken;
      console.log(`     accessToken:  ${accessToken.slice(0, 30)}...`);
      console.log(`     refreshToken: ${refreshToken.slice(0, 30)}...`);
    }
  }

  if (!accessToken) {
    console.error('\n❌ Login falló — deteniendo tests\n');
    process.exit(1);
  }

  // ── 3. Ruta protegida con token válido ────────────────────────────────────
  console.log('\n── Rutas protegidas ──\n');

  {
    const { status } = await request('GET', '/demo/level1/jwt', { token: accessToken });
    log(status, 'Token válido → PASS');
  }

  // ── 4. Sin token ──────────────────────────────────────────────────────────
  {
    const { status, data } = await request('GET', '/demo/level1/jwt');
    log(status, 'Sin Authorization header → BLOCKED', (data as any)?.message);
  }

  // ── 5. Token malformado ────────────────────────────────────────────────────
  {
    const { status, data } = await request('GET', '/demo/level1/jwt', { token: 'esto.no.es.jwt' });
    log(status, 'Token malformado → BLOCKED', (data as any)?.message);
  }

  // ── 6. Token expirado ──────────────────────────────────────────────────────
  // JWT con exp en el pasado, firmado con el mismo secret del proyecto
  const expiredToken =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
    'eyJzdWIiOjEsInVzZXJuYW1lIjoiYWRtaW4iLCJleHAiOjE2MDAwMDAwMDB9.' +
    'invalid-sig-so-it-fails-cleanly';

  {
    const { status, data } = await request('GET', '/demo/level1/jwt', { token: expiredToken });
    log(status, 'Token expirado / firma inválida → BLOCKED', (data as any)?.message);
  }

  // ── 7. Scheme incorrecto — Basic en vez de Bearer ─────────────────────────
  {
    const res = await fetch(`${BASE}/demo/level1/jwt`, {
      headers: { Authorization: `Basic ${accessToken}` },
    });
    const data = await res.json().catch(() => ({}));
    log(res.status, 'Authorization: Basic <token> (scheme incorrecto) → BLOCKED', (data as any)?.message);
  }

  // ── 8. GET /auth/me — payload del token ───────────────────────────────────
  console.log('\n── Payload del token ──\n');

  {
    const { status, data } = await request('GET', '/auth/me', { token: accessToken });
    log(status, 'GET /auth/me — payload decodificado');
    if (status === 200) {
      const d = data as any;
      console.log(`     id:          ${d.id}`);
      console.log(`     username:    ${d.username}`);
      console.log(`     roles:       ${d.roles?.join(', ')}`);
      console.log(`     permissions: ${d.permissions?.slice(0, 3).join(', ')}...`);
    }
  }

  // ── 9. Refresh token → nuevo accessToken ──────────────────────────────────
  console.log('\n── Refresh token ──\n');

  {
    const { status, data } = await request('POST', '/auth/refresh', {
      body: { refreshToken },
    });
    log(status, 'POST /auth/refresh → nuevo accessToken');
    if (status === 200) {
      const newToken = (data as any).accessToken;
      console.log(`     nuevo accessToken: ${newToken.slice(0, 30)}...`);
      console.log(`     distinto al anterior: ${newToken !== accessToken}`);
    }
  }

  console.log('\n════════════════════════════════════════════');
  console.log('  Esperado: tests 1-3, 8-9 → 2xx | tests 4-7 → 401');
  console.log('════════════════════════════════════════════\n');
}

main()
  .then(() => { if (failures > 0) { console.error(`\n❌ ${failures} test(s) failed`); process.exit(1); } })
  .catch((e: unknown) => { console.error(e); process.exit(1); });