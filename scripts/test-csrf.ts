/**
 * test-csrf.ts — Prueba CsrfGuard (Double Submit Cookie pattern)
 *
 * Run: npx ts-node scripts/test-csrf.ts
 *
 * Flujo protegido:
 *   1. GET /csrf-token  → servidor fija la cookie csrf-token + devuelve el token
 *   2. POST /csrf-protected con cookie + header x-csrf-token → ✅ 201
 *   3. POST sin header    → ❌ 403 missing
 *   4. POST con mismatch  → ❌ 403 mismatch
 *
 * Un atacante en otro origen NO puede leer la cookie (same-origin policy)
 * → no puede construir el header correcto → guard rechaza la request.
 */

const BASE = 'http://localhost:3000';

interface Result {
  status: number;
  data:   any;
}

async function get(path: string): Promise<{ status: number; cookie: string; token: string }> {
  const res = await fetch(`${BASE}${path}`);
  const data = await res.json().catch(() => ({}));
  const cookie = res.headers.get('set-cookie') ?? '';
  return { status: res.status, cookie, token: data?.csrfToken ?? '' };
}

async function post(
  path:   string,
  cookie: string,
  csrfHeader?: string,
): Promise<Result> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(cookie      ? { Cookie:          cookie }      : {}),
    ...(csrfHeader  ? { 'x-csrf-token':  csrfHeader }  : {}),
  };
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ demo: true }),
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

let failures = 0;

function line(label: string, r: Result, expectOk: boolean) {
  const ok  = expectOk ? r.status < 400 : r.status >= 400;
  if (!ok) failures++;
  const ico = ok ? '✅' : '❌';
  const msg = r.data?.message ?? JSON.stringify(r.data);
  console.log(`  ${ico}  ${label.padEnd(40)} ${r.status}  ${msg}`);
}

async function main() {
  console.log('\n════════════════════════════════════════════');
  console.log('  guard-nest — CSRF Protection Test');
  console.log('  Double Submit Cookie pattern');
  console.log('════════════════════════════════════════════\n');

  // ── Paso 1: Obtener token ─────────────────────────────────────────────────
  console.log('── Paso 1: GET /csrf-token ──\n');
  const { status: s1, cookie, token } = await get('/demo/level2/csrf-token');
  console.log(`  Status : ${s1}`);
  console.log(`  Token  : ${token.slice(0, 16)}...`);
  console.log(`  Cookie : ${cookie.slice(0, 40)}...\n`);

  if (!token || !cookie) {
    console.error('  ❌ No se pudo obtener el token. ¿Está corriendo el servidor?\n');
    process.exit(1);
  }

  // Extraer solo "csrf-token=<value>" del Set-Cookie header
  const cookieValue = cookie.split(';')[0];

  // ── Paso 2: POST con cookie + header correctos ────────────────────────────
  console.log('── Paso 2: Casos de prueba ──\n');
  console.log('  ' + '─'.repeat(72));

  const r1 = await post('/demo/level2/csrf-protected', cookieValue, token);
  line('Cookie + header correcto          →  200', r1, true);

  const r2 = await post('/demo/level2/csrf-protected', cookieValue, undefined);
  line('Sin header x-csrf-token           →  403', r2, false);

  const r3 = await post('/demo/level2/csrf-protected', '', token);
  line('Sin cookie                        →  403', r3, false);

  const r4 = await post('/demo/level2/csrf-protected', cookieValue, 'wrong-token-abc123');
  line('Token mal en header (mismatch)    →  403', r4, false);

  const r5 = await post('/demo/level2/csrf-protected', cookieValue, token.slice(0, -4) + '0000');
  line('Token modificado (mismatch)       →  403', r5, false);

  // ── Paso 3: Doble uso del mismo token ─────────────────────────────────────
  const r6 = await post('/demo/level2/csrf-protected', cookieValue, token);
  line('Mismo token 2ª vez (sin refresh)  →  200', r6, true);

  console.log('  ' + '─'.repeat(72));

  console.log('\n── Por qué funciona ──\n');
  console.log('  El cookie csrf-token tiene httpOnly: false');
  console.log('  → tu JS puede leerlo (document.cookie)');
  console.log('  → lo mandas en x-csrf-token header');
  console.log('  El guard compara cookie vs header — deben ser iguales.\n');
  console.log('  Un atacante en otro origen no puede leer la cookie:');
  console.log('  → same-origin policy lo bloquea');
  console.log('  → no puede forjar el header correcto');
  console.log('  → 403 Forbidden para requests cross-origin.\n');

  console.log('════════════════════════════════════════════\n');
}

main()
  .then(() => { if (failures > 0) { console.error(`\n❌ ${failures} test(s) failed`); process.exit(1); } })
  .catch((e: unknown) => { console.error(e); process.exit(1); });