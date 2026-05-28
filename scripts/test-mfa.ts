/**
 * test-mfa.ts — Prueba MfaGuard (Multi-Factor Authentication)
 *
 * Run: npx ts-node scripts/test-mfa.ts
 *
 * El MfaGuard lee jwt.mfaVerifiedAt (unix timestamp en segundos).
 * El login normal no incluye ese campo. Este script usa el endpoint
 * POST /auth/test/mfa-token para obtener tokens con distintos estados de MFA
 * (el servidor firma con el mismo secret — cero problemas de key mismatch).
 *
 * Escenarios:
 *   1. MFA verificado hace 1 min   (maxAge 3600s)  → ✅ 200
 *   2. MFA verificado hace 2 horas (maxAge 3600s)  → ❌ 401 expirado
 *   3. Sin mfaVerifiedAt           (required: true) → ❌ 401
 *   4. Sin mfaVerifiedAt           (required: false)→ ✅ 200 (soft MFA)
 *   5. Sin token                                    → ❌ 401
 */

const BASE = 'http://localhost:3000';

async function getMfaToken(
  username: string,
  password: string,
  mfaAgeSeconds: number | null,
): Promise<string> {
  const res = await fetch(`${BASE}/auth/test/mfa-token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password, mfaAgeSeconds }),
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

function log(status: number, label: string, extra?: string) {
  const icon = status === 200 ? '✅' : status === 401 ? '🔐' : '⚠️ ';
  console.log(`${icon} [${status}] ${label}${extra ? `  —  ${extra}` : ''}`);
}

async function main() {
  console.log('\n════════════════════════════════════════════');
  console.log('  guard-nest — MFA Guard Test Suite');
  console.log('  (Multi-Factor Authentication)');
  console.log('════════════════════════════════════════════\n');

  // Obtener tokens via servidor (firma con el mismo JWT secret)
  const tokenFreshMfa   = await getMfaToken('user', 'user123', 60);    // MFA hace 1 min
  const tokenExpiredMfa = await getMfaToken('user', 'user123', 7200);  // MFA hace 2 horas
  const tokenNoMfa      = await getMfaToken('user', 'user123', null);  // sin mfaVerifiedAt

  console.log('  Tokens obtenidos:');
  console.log(`    freshMfa   (mfaVerifiedAt=now-60s):   ${tokenFreshMfa.slice(0, 30)}...`);
  console.log(`    expiredMfa (mfaVerifiedAt=now-7200s): ${tokenExpiredMfa.slice(0, 30)}...`);
  console.log(`    noMfa      (sin mfaVerifiedAt):       ${tokenNoMfa.slice(0, 30)}...\n`);

  // ── GET /demo/level5/mfa-required  (maxAgeSeconds: 3600, required: true) ──
  console.log('── GET /demo/level5/mfa-required  (maxAgeSeconds: 3600, required: true) ──\n');

  {
    const { status, data } = await get('/demo/level5/mfa-required', tokenFreshMfa);
    const age = (data as any)?.mfaVerifiedSecondsAgo;
    log(status, `MFA fresco (hace 1 min) → PASS`, age != null ? `verificado hace ${age}s` : undefined);
  }
  {
    const { status, data } = await get('/demo/level5/mfa-required', tokenExpiredMfa);
    log(status, 'MFA expirado (hace 2h > maxAge 3600s) → BLOCKED', (data as any)?.message);
  }
  {
    const { status, data } = await get('/demo/level5/mfa-required', tokenNoMfa);
    log(status, 'Sin mfaVerifiedAt (required: true) → BLOCKED', (data as any)?.message);
  }

  // ── GET /demo/level5/mfa-optional  (maxAgeSeconds: 3600, required: false) ──
  console.log('\n── GET /demo/level5/mfa-optional  (maxAgeSeconds: 3600, required: false) ──\n');

  {
    const { status, data } = await get('/demo/level5/mfa-optional', tokenFreshMfa);
    const age = (data as any)?.mfaVerifiedSecondsAgo;
    log(status, 'MFA fresco → PASS', age != null ? `verificado hace ${age}s` : undefined);
  }
  {
    const { status, data } = await get('/demo/level5/mfa-optional', tokenNoMfa);
    log(status, 'Sin mfaVerifiedAt (required: false) → PASS (soft MFA)', (data as any)?.message);
  }

  // ── Sin token ─────────────────────────────────────────────────────────────
  console.log('\n── Sin token ──\n');

  {
    const { status, data } = await get('/demo/level5/mfa-required');
    log(status, 'Sin token → BLOCKED (JwtAuthGuard corre antes)', (data as any)?.message);
  }

  console.log('\n════════════════════════════════════════════');
  console.log('  Esperado:');
  console.log('    mfa-required: fresco ✅ | expirado 🔐 | sin MFA 🔐');
  console.log('    mfa-optional: fresco ✅ | sin MFA ✅  (required: false)');
  console.log('    sin token:    401 🔐');
  console.log('════════════════════════════════════════════\n');
}

main().catch(console.error);
