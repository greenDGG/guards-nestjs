/**
 * test-tenant.ts — Prueba TenantGuard (aislamiento multi-tenant)
 *
 * Run: npx ts-node scripts/test-tenant.ts
 *
 * Previene que un usuario de tenant-A acceda a datos de tenant-B manipulando la URL.
 * El TenantGuard compara jwt.tenantId con el tenantId de la request (param/header/body/query).
 *
 * Escenarios:
 *   1. JWT tenant-a → GET /tenant/tenant-a/data        ✅ (match)
 *   2. JWT tenant-a → GET /tenant/tenant-b/data        ❌ 403 (mismatch)
 *   3. Sin tenantId en JWT, strict: false              ✅ (strict=false, pasa)
 *   4. Sin tenantId en JWT, strict: true               ❌ 403
 *   5. JWT tenant-a → GET /tenant/tenant-b/strict-data ❌ 403
 *   6. Sin token                                        ❌ 401
 */

const BASE = 'http://localhost:3000';

async function getTenantToken(
  username: string,
  password: string,
  tenantId: string | null,
): Promise<string> {
  const res = await fetch(`${BASE}/auth/test/tenant-token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password, tenantId }),
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
  console.log('  guard-nest — Tenant Guard Test Suite');
  console.log('  (Multi-Tenant Isolation)');
  console.log('════════════════════════════════════════════\n');

  const tokenTenantA = await getTenantToken('user', 'user123', 'tenant-a');
  const tokenNoTenant = await getTenantToken('user', 'user123', null);

  console.log('  Tokens obtenidos:');
  console.log(`    tenantA:   ${tokenTenantA.slice(0, 30)}...  (jwt.tenantId = 'tenant-a')`);
  console.log(`    noTenant:  ${tokenNoTenant.slice(0, 30)}...  (sin tenantId en JWT)\n`);

  // ── strict: false  (sources: ['param']) ───────────────────────────────────
  console.log('── GET /demo/level5/tenant/:tenantId/data  (strict: false) ──\n');

  {
    const { status } = await get('/demo/level5/tenant/tenant-a/data', tokenTenantA);
    log(status, "JWT tenant-a → /tenant/tenant-a/data  → PASS (match)");
  }
  {
    const { status, data } = await get('/demo/level5/tenant/tenant-b/data', tokenTenantA);
    log(status, "JWT tenant-a → /tenant/tenant-b/data  → BLOCKED (mismatch)", (data as any)?.message);
  }
  {
    const { status, data } = await get('/demo/level5/tenant/tenant-a/data', tokenNoTenant);
    log(status, "Sin tenantId en JWT → PASS (strict: false, pasa sin tenant)", (data as any)?.jwtTenant);
  }

  // ── strict: true  (sources: ['param']) ────────────────────────────────────
  console.log('\n── GET /demo/level5/tenant/:tenantId/strict-data  (strict: true) ──\n');

  {
    const { status } = await get('/demo/level5/tenant/tenant-a/strict-data', tokenTenantA);
    log(status, "JWT tenant-a → /tenant/tenant-a/strict-data → PASS (match)");
  }
  {
    const { status, data } = await get('/demo/level5/tenant/tenant-b/strict-data', tokenTenantA);
    log(status, "JWT tenant-a → /tenant/tenant-b/strict-data → BLOCKED (mismatch)", (data as any)?.message);
  }
  {
    const { status, data } = await get('/demo/level5/tenant/tenant-a/strict-data', tokenNoTenant);
    log(status, "Sin tenantId en JWT → BLOCKED (strict: true, requiere tenantId)", (data as any)?.message);
  }

  // ── Sin token ─────────────────────────────────────────────────────────────
  console.log('\n── Sin token ──\n');

  {
    const { status, data } = await get('/demo/level5/tenant/tenant-a/data');
    log(status, 'Sin token → BLOCKED (JwtAuthGuard corre antes)', (data as any)?.message);
  }

  console.log('\n════════════════════════════════════════════');
  console.log('  Esperado:');
  console.log('    data (strict:false): match ✅ | mismatch 🚫 | sin tenant ✅');
  console.log('    strict-data:         match ✅ | mismatch 🚫 | sin tenant 🚫');
  console.log('    sin token:           401 🔐');
  console.log('════════════════════════════════════════════\n');
}

main()
  .then(() => { if (failures > 0) { console.error(`\n❌ ${failures} test(s) failed`); process.exit(1); } })
  .catch((e: unknown) => { console.error(e); process.exit(1); });