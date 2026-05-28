/**
 * test-rate-limit-by-route.ts — Prueba RateLimitByRouteGuard
 *
 * Run: npx ts-node scripts/test-rate-limit-by-route.ts
 *
 * RateLimitByRouteGuard tiene tres features que SlidingWindowRateLimitGuard no tiene:
 *
 *   1. Profiles      — @RateLimit('login') vs configurar manualmente max/windowMs
 *   2. Dual-window   — burst (ventana corta) + sustained (ventana larga) en un solo guard
 *   3. Penalty box   — lockout automático tras N violations (brute-force protection real)
 *
 * Endpoints demo:
 *   GET  /demo/level3/login-sim    → profile 'login'   (5/60s, burst 2/5s, penalty 5min)
 *   POST /demo/level3/payment-sim  → profile 'payment' (10/60s, burst 2/10s, penalty 15min)
 *   GET  /demo/level3/search-sim   → profile 'search'  (60/60s, burst 15/5s)
 *   GET  /demo/level3/custom-burst → profile override  (max=10, burst=3/3s, penalty=60s)
 */

const BASE = 'http://localhost:3000';

interface Hit {
  status:    number;
  profile:   string;
  limit:     string;
  remaining: string;
  burst:     string;
  burstRem:  string;
  retryAfter: string;
  data:      any;
}

async function get(path: string, headers: Record<string, string> = {}): Promise<Hit> {
  const res = await fetch(`${BASE}${path}`, { headers });
  return parse(res);
}

async function post(path: string, headers: Record<string, string> = {}): Promise<Hit> {
  const res = await fetch(`${BASE}${path}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body:    JSON.stringify({}),
  });
  return parse(res);
}

async function parse(res: Response): Promise<Hit> {
  return {
    status:     res.status,
    profile:    res.headers.get('x-ratelimit-profile')        ?? '—',
    limit:      res.headers.get('x-ratelimit-limit')          ?? '—',
    remaining:  res.headers.get('x-ratelimit-remaining')      ?? '—',
    burst:      res.headers.get('x-ratelimit-burst-limit')    ?? '—',
    burstRem:   res.headers.get('x-ratelimit-burst-remaining') ?? '—',
    retryAfter: res.headers.get('retry-after')                ?? '—',
    data:       await res.json().catch(() => ({})),
  };
}

function icon(h: Hit): string {
  if (h.status === 200 || h.status === 201) return '🟢';
  if (h.status === 429) return h.data?.message?.includes('blocked') ? '🔴' : '🟡';
  return '⚠️ ';
}

function row(label: string, h: Hit) {
  const lim  = h.burst !== '—' ? `burst=${h.burstRem}/${h.burst} sust=${h.remaining}/${h.limit}` : `remaining=${h.remaining}/${h.limit}`;
  const extra = h.status === 429 ? `  Retry-After=${h.retryAfter}s  "${(h.data?.message ?? '').slice(0, 60)}"` : '';
  console.log(`  ${icon(h)}  ${label.padEnd(52)}  HTTP ${h.status}  ${lim}${extra}`);
}

async function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function fireN(n: number, fn: () => Promise<Hit>): Promise<Hit[]> {
  const results: Hit[] = [];
  for (let i = 0; i < n; i++) {
    results.push(await fn());
  }
  return results;
}

async function main() {
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  guard-nest — RateLimitByRouteGuard Test');
  console.log('  3 features: Profiles · Dual-window burst · Penalty box');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // ── Scenario 1: Profile 'search' — muestra los headers básicos ───────────
  console.log('── Feature 1: Profiles — @RateLimit(\'search\') (60/min, burst 15/5s) ──\n');

  const s1 = await get('/demo/level3/search-sim');
  row('Primera request — headers automáticos del profile', s1);
  console.log(`       ↳ X-RateLimit-Profile=${s1.profile}  limit=${s1.limit}  burst-limit=${s1.burst}`);

  console.log();

  // ── Scenario 2: Profile 'login' — burst detection ─────────────────────────
  console.log('── Feature 2: Burst detection — profile \'login\' (burst: 2 req / 5s) ──\n');
  console.log('  Un bot que envía 5 logins en 2 segundos es bloqueado aunque esté');
  console.log('  dentro del límite sostenido (5/min). El burst window lo captura.\n');

  // Primero warmup para tener baseline
  const b0 = await get('/demo/level3/login-sim');
  row('Login #1 — dentro del burst', b0);

  const b1 = await get('/demo/level3/login-sim');
  row('Login #2 — burst limit alcanzado (2/5s)', b1);

  const b2 = await get('/demo/level3/login-sim');
  row('Login #3 — burst excedido → 429', b2);

  const b3 = await get('/demo/level3/login-sim');
  row('Login #4 — burst excedido → 429', b3);

  const b4 = await get('/demo/level3/login-sim');
  row('Login #5 — burst excedido → 429', b4);

  console.log(`\n  Esperando 6s para que el burst window se resetee...`);
  await delay(6_000);

  const bAfter = await get('/demo/level3/login-sim');
  row('Login tras 6s — burst window limpio → 200', bAfter);

  console.log();

  // ── Scenario 3: Penalty box ────────────────────────────────────────────────
  console.log('── Feature 3: Penalty box — custom-burst (3 violations → 60s lockout) ──\n');
  console.log('  El custom-burst endpoint tiene penaltyMs=60_000 y violations=3.');
  console.log('  Cada vez que se excede el límite suma una violation.');
  console.log('  Al llegar a 3 → lockout de 60 segundos independientemente de la ventana.\n');

  // Provocar 3 violations de burst (burst=3/3s → necesitamos 4+ en <3s tres veces)
  let violations = 0;
  let penaltyHit = false;

  for (let round = 1; round <= 6 && !penaltyHit; round++) {
    console.log(`  Round ${round}:`);
    for (let i = 0; i < 5; i++) {
      const h = await get('/demo/level3/custom-burst');
      if (h.data?.message?.includes('blocked')) {
        row(`    Penalty box activo (round ${round}, req ${i + 1})`, h);
        penaltyHit = true;
        violations++;
        break;
      } else if (h.status === 429) {
        row(`    Violation #${++violations} — límite excedido`, h);
      } else {
        row(`    req ${i + 1} — OK`, h);
      }
    }
    if (!penaltyHit && round < 6) {
      console.log(`  Esperando 4s para resetear burst window...`);
      await delay(4_000);
    }
  }

  if (penaltyHit) {
    console.log('\n  ✅ Penalty box activado correctamente.');
    console.log('  Todas las requests siguientes devuelven 429 hasta que expire el lockout.\n');
    const p1 = await get('/demo/level3/custom-burst');
    row('  Request durante lockout → 429 (Retry-After en header)', p1);
  } else {
    console.log('\n  ⚠️  Penalty box no alcanzado en este ciclo (puede necesitar más rounds).');
    console.log('  Revisa los logs del servidor para ver los contadores de violations.\n');
  }

  console.log();

  // ── Scenario 4: Profile 'payment' — POST ──────────────────────────────────
  console.log('── Scenario 4: Profile \'payment\' — POST (burst 2/10s, penalty 15min) ──\n');

  const pay1 = await post('/demo/level3/payment-sim');
  row('Payment #1 — dentro del burst', pay1);

  const pay2 = await post('/demo/level3/payment-sim');
  row('Payment #2 — burst limit alcanzado', pay2);

  const pay3 = await post('/demo/level3/payment-sim');
  row('Payment #3 — burst excedido → 429', pay3);

  console.log();

  // ── Resumen ────────────────────────────────────────────────────────────────
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  Perfiles disponibles:');
  console.log('    login    5/60s   burst 2/5s   keyBy=ip   penalty 5min  (3 violations)');
  console.log('    payment  10/60s  burst 2/10s  keyBy=user penalty 15min (2 violations)');
  console.log('    search   60/60s  burst 15/5s  keyBy=user sin penalty');
  console.log('    api      100/60s burst 20/5s  keyBy=user sin penalty');
  console.log('    public   30/60s  burst 10/5s  keyBy=ip   sin penalty');
  console.log();
  console.log('  Uso mínimo:');
  console.log('    @RateLimit(\'login\')');
  console.log('    @UseGuards(RateLimitByRouteGuard)');
  console.log('    @Post(\'auth/login\')');
  console.log('    login() {}');
  console.log('═══════════════════════════════════════════════════════════════\n');
}

main().catch(console.error);
