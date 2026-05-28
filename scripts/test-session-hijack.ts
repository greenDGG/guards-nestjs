/**
 * test-session-hijack.ts — Prueba SessionHijackGuard
 *
 * Run: npx ts-node scripts/test-session-hijack.ts
 *
 * SessionHijackGuard detecta tokens JWT robados comparando cada request
 * contra la baseline establecida en la primera request del token.
 *
 * Señales (score 0–100):
 *   Subnet change  : hasta 25 pts — /24 IP diferente del baseline
 *   UA change      : 35 pts       — User-Agent cambia mid-session
 *   Concurrent use : 20–25 pts    — 2+ IPs distintas con el mismo token en 30s
 *   Geo change     : 15 pts       — país diferente al baseline
 *
 * Umbrales:
 *   < 30  → allow
 *   30–59 → warn   (penaliza trust score, deja pasar)
 *   ≥ 60  → block  → 401 SessionHijackedException
 *
 * Endpoints demo:
 *   GET /demo/level4/session-hijack         logOnly: true — nunca bloquea
 *   GET /demo/level4/session-hijack-strict  warn≥20, block≥45 — más sensible
 */

const BASE = 'http://localhost:3000';

const UA_CHROME  = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
const UA_FIREFOX = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0';
const UA_MOBILE  = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1';

interface HitResult {
  status:  number;
  risk:    string;
  action:  string;
  data:    any;
}

async function login(username: string, password: string): Promise<string> {
  const res = await fetch(`${BASE}/auth/login`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ username, password }),
  });
  if (!res.ok) throw new Error(`Login failed: ${res.status}`);
  const data = await res.json() as any;
  return data.accessToken as string;
}

async function hit(
  path:    string,
  token:   string,
  ua:      string,
  extra:   Record<string, string> = {},
): Promise<HitResult> {
  const res = await fetch(`${BASE}${path}`, {
    headers: {
      'Authorization':   `Bearer ${token}`,
      'User-Agent':      ua,
      'Accept-Language': 'es-MX,es;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      ...extra,
    },
  });
  return {
    status: res.status,
    risk:   res.headers.get('x-session-risk')   ?? '—',
    action: res.headers.get('x-session-action') ?? '—',
    data:   await res.json().catch(() => ({})),
  };
}

function icon(r: HitResult): string {
  if (r.status === 401) return '🔴';
  if (r.action === 'block') return '🔴';
  if (r.action === 'warn')  return '🟡';
  if (r.action === 'allow') return '🟢';
  return r.status >= 400 ? '🔴' : '🟢';
}

function row(label: string, r: HitResult) {
  const riskPad = String(r.risk).padStart(3);
  console.log(`  ${icon(r)}  ${label.padEnd(50)}  risk=${riskPad}  action=${r.action}  HTTP ${r.status}`);
}

async function main() {
  console.log('\n═════════════════════════════════════════════════════════════');
  console.log('  guard-nest — SessionHijackGuard Test');
  console.log('  Detecta tokens robados via IP/UA/concurrent/geo signals');
  console.log('═════════════════════════════════════════════════════════════\n');

  const OBSERVE = '/demo/level4/session-hijack';
  const STRICT  = '/demo/level4/session-hijack-strict';

  // ── Scenario 1: Sesión normal ──────────────────────────────────────────────
  console.log('── Scenario 1: Sesión normal (mismo UA, mismo "IP") ──\n');

  // Fresh token → fresh baseline
  const token1 = await login('user', 'user123');
  console.log(`  Token: ${token1.slice(0, 40)}...\n`);

  const s1a = await hit(OBSERVE, token1, UA_CHROME);
  row('Primera request — establece baseline', s1a);

  const s1b = await hit(OBSERVE, token1, UA_CHROME);
  row('Segunda request — mismo UA → allow', s1b);

  const s1c = await hit(OBSERVE, token1, UA_CHROME);
  row('Tercera request — mismo UA → allow', s1c);

  // ── Scenario 2: Cambio de User-Agent (robo más común) ─────────────────────
  console.log('\n── Scenario 2: Cambio de User-Agent (+35 pts) ──\n');
  console.log('  (UA change es la señal más fuerte — 35/100 pts)\n');

  const token2 = await login('user', 'user123');

  const s2a = await hit(OBSERVE, token2, UA_CHROME);
  row('Baseline con Chrome', s2a);

  const s2b = await hit(OBSERVE, token2, UA_FIREFOX);
  row('Cambio a Firefox UA → señal ua-changed (+35)', s2b);

  const s2c = await hit(OBSERVE, token2, UA_MOBILE);
  row('Cambio a Mobile UA → señal ua-changed (+35)', s2c);

  // ── Scenario 3: Modo estricto — UA change supera umbral de bloqueo ─────────
  console.log('\n── Scenario 3: Modo strict (block≥45) — UA change → 401 ──\n');
  console.log('  En modo strict un cambio de UA (35 pts) + subnet (15 pts) supera el bloqueo.\n');

  const token3 = await login('admin', 'admin123');

  const s3a = await hit(STRICT, token3, UA_CHROME);
  row('Strict — baseline con Chrome', s3a);

  const s3b = await hit(STRICT, token3, UA_FIREFOX);
  if (s3b.status === 401) {
    console.log(`  🔴  Strict — Firefox UA → HTTP 401 SessionHijackedException`);
    const err = s3b.data as any;
    if (err?.message) console.log(`       ↳ ${err.message}`);
    if (err?.breakdown) {
      const b = err.breakdown;
      console.log(`       ↳ breakdown: subnet=${b.subnetChange} ua=${b.uaChange} conc=${b.concurrent} geo=${b.geoChange} total=${b.total}`);
    }
  } else {
    row('Strict — Firefox UA → no bloqueó (revisa logs)', s3b);
  }

  // ── Scenario 4: logOnly — nunca bloquea aunque el score sea alto ──────────
  console.log('\n── Scenario 4: logOnly:true — score alto pero siempre pasa ──\n');

  const token4 = await login('user', 'user123');

  const s4a = await hit(OBSERVE, token4, UA_CHROME);
  row('logOnly — baseline', s4a);

  const s4b = await hit(OBSERVE, token4, UA_FIREFOX);
  row('logOnly — Firefox UA (score alto) → HTTP 200 igual', s4b);

  const s4c = await hit(OBSERVE, token4, UA_MOBILE);
  row('logOnly — Mobile UA → HTTP 200 igual', s4c);

  console.log('\n  (Mira los logs del servidor para ver los warnings de SessionHijackGuard)');

  // ── Scenario 5: Re-login resetea baseline ─────────────────────────────────
  console.log('\n── Scenario 5: Re-login genera nuevo token → baseline limpio ──\n');

  const tokenOld = await login('user', 'user123');

  await hit(OBSERVE, tokenOld, UA_CHROME);           // establece baseline con Chrome
  await hit(OBSERVE, tokenOld, UA_FIREFOX);          // ensucia el historial

  // nuevo login → nuevo iat → baseline independiente
  const tokenNew = await login('user', 'user123');

  const s5 = await hit(OBSERVE, tokenNew, UA_CHROME);
  row('Nuevo token → baseline limpio desde cero', s5);

  // ── Resumen ────────────────────────────────────────────────────────────────
  console.log('\n═════════════════════════════════════════════════════════════');
  console.log('  Resumen de señales:');
  console.log('    Subnet change  : hasta 25 pts  (IP /24 diferente)');
  console.log('    UA change      : 35 pts         (señal más fuerte)');
  console.log('    Concurrent use : 20–25 pts      (mismo token en 2+ IPs)');
  console.log('    Geo change     : 15 pts          (país diferente)');
  console.log();
  console.log('  Modo observe   (logOnly:true) : nunca bloquea, solo loguea');
  console.log('  Modo estándar  (warn≥30)      : penaliza trust score, deja pasar');
  console.log('  Modo strict    (block≥45)     : bloquea con un cambio de UA');
  console.log('═════════════════════════════════════════════════════════════\n');
}

main().catch(console.error);
