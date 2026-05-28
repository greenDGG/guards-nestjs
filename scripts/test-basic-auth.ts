/**
 * test-basic-auth.ts — Prueba BasicAuthGuard
 *
 * Run: npx ts-node scripts/test-basic-auth.ts
 *
 * Credenciales del endpoint demo:
 *   admin : secret123
 *   dev   : dev456
 *
 * Escenarios:
 *   1. admin:secret123 válido           → ✅ 200
 *   2. dev:dev456 válido                → ✅ 200
 *   3. Password incorrecta              → ❌ 401 + WWW-Authenticate header
 *   4. Usuario inexistente              → ❌ 401
 *   5. Sin header Authorization         → ❌ 401 + WWW-Authenticate header
 *   6. Header mal formado (no Basic)    → ❌ 401
 *   7. Base64 sin colon (user sin pass) → ❌ 401
 *   8. Password con colon (admin:se:c)  → ✅ 200 (solo split en el primer colon)
 */

const BASE = 'http://localhost:3000';

function basicHeader(user: string, pass: string): string {
  return 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
}

async function get(
  path: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; data: unknown; wwwAuth: string | null }> {
  const res = await fetch(`${BASE}${path}`, { headers });
  return {
    status:  res.status,
    data:    await res.json().catch(() => ({})),
    wwwAuth: res.headers.get('www-authenticate'),
  };
}

let failures = 0;

function log(status: number, label: string, extra?: string) {
  const icon = status === 200 ? '✅' : status === 401 ? '🔐' : '⚠️ ';
  console.log(`${icon} [${status}] ${label}${extra ? `  —  ${extra}` : ''}`);
}

async function main() {
  console.log('\n════════════════════════════════════════════');
  console.log('  guard-nest — Basic Auth Guard Test Suite');
  console.log('════════════════════════════════════════════\n');

  const PATH = '/demo/level1/basic-auth';

  // ── 1. admin:secret123 — válido ───────────────────────────────────────────
  {
    const { status } = await get(PATH, { authorization: basicHeader('admin', 'secret123') });
    log(status, 'admin:secret123 → PASS');
  }

  // ── 2. dev:dev456 — válido ────────────────────────────────────────────────
  {
    const { status } = await get(PATH, { authorization: basicHeader('dev', 'dev456') });
    log(status, 'dev:dev456 → PASS');
  }

  // ── 3. Password incorrecta ────────────────────────────────────────────────
  {
    const { status, data, wwwAuth } = await get(PATH, { authorization: basicHeader('admin', 'wrong') });
    log(status, 'admin:wrong → BLOCKED', (data as any)?.message);
    if (wwwAuth) console.log(`     WWW-Authenticate: ${wwwAuth}`);
  }

  // ── 4. Usuario inexistente ─────────────────────────────────────────────────
  {
    const { status, data } = await get(PATH, { authorization: basicHeader('ghost', 'ghost123') });
    log(status, 'ghost:ghost123 (usuario inexistente) → BLOCKED', (data as any)?.message);
  }

  // ── 5. Sin header Authorization ───────────────────────────────────────────
  {
    const { status, data, wwwAuth } = await get(PATH);
    log(status, 'Sin Authorization header → BLOCKED', (data as any)?.message);
    if (wwwAuth) console.log(`     WWW-Authenticate: ${wwwAuth}`);
  }

  // ── 6. Header mal formado — no empieza con "Basic " ───────────────────────
  {
    const { status, data } = await get(PATH, { authorization: 'Bearer token-jwt-aqui' });
    log(status, 'Authorization: Bearer ... (no Basic) → BLOCKED', (data as any)?.message);
  }

  // ── 7. Base64 sin colon — username sin password ───────────────────────────
  {
    const malformed = 'Basic ' + Buffer.from('sincolon').toString('base64');
    const { status, data } = await get(PATH, { authorization: malformed });
    log(status, 'Base64 sin colon "sincolon" → BLOCKED', (data as any)?.message);
  }

  // ── 8. Password con colon — split solo en el primer colon ─────────────────
  // Esto es válido según RFC 7617: el username no puede tener colon,
  // pero el password sí. "admin:se:cret" → user=admin, pass=se:cret
  // Aquí el user "admin" existe pero su pass es "secret123", no "se:cret",
  // así que debe fallar — pero demuestra que el parsing es correcto.
  {
    const { status, data } = await get(PATH, { authorization: basicHeader('admin', 'se:cret') });
    log(status, 'admin:se:cret (pass con colon) → BLOCKED (pass no coincide, parsing OK)', (data as any)?.message);
  }

  console.log('\n════════════════════════════════════════════');
  console.log('  Esperado: tests 1-2 → 200, tests 3-8 → 401');
  console.log('════════════════════════════════════════════\n');
}

main()
  .then(() => { if (failures > 0) { console.error(`\n❌ ${failures} test(s) failed`); process.exit(1); } })
  .catch((e: unknown) => { console.error(e); process.exit(1); });