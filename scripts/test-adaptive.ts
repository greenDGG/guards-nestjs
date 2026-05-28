/**
 * test-adaptive.ts — Prueba AdaptiveRateLimitGuard
 *
 * Run: npx ts-node scripts/test-adaptive.ts
 *
 * effectiveLimit = baseMax × trustMultiplier × botMultiplier
 *
 * El endpoint /demo/level3/adaptive usa:
 *   windowMs: 60_000  (1 minuto)
 *   baseMax:  100
 *   keyBy:    'ip'
 *   BotDetectionGuard antes (threshold=200, nunca bloquea, solo pone botScore en ctx)
 *
 * Usuarios anónimos arrancan con trustScore=50 (new-user tier ×0.10).
 *   Chrome UA  → botScore~0   (clean ×1.00)  → 100×0.10×1.00 = 10 req/min
 *   curl UA    → botScore~30  (suspicious ×0.50) → 100×0.10×0.50 = 5 req/min
 *
 * Escenarios:
 *   1. Request limpia — muestra todos los headers X-RateLimit-*
 *   2. Request con curl UA — muestra cómo sube el bot score y baja el límite
 *   3. Burst hasta 429 — demuestra la aplicación del límite adaptado
 */

const BASE = 'http://localhost:3000';

const CHROME_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'es-MX,es;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'sec-fetch-site': 'none',
};

const CURL_HEADERS = {
  'User-Agent': 'curl/8.0',
};

async function req(
  ua: 'chrome' | 'curl',
): Promise<{ status: number; data: unknown; rl: Record<string, string> }> {
  const res = await fetch(`${BASE}/demo/level3/adaptive`, {
    headers: ua === 'chrome' ? CHROME_HEADERS : CURL_HEADERS,
  });
  const rl: Record<string, string> = {};
  res.headers.forEach((v, k) => { if (k.startsWith('x-ratelimit-')) rl[k] = v; });
  return { status: res.status, data: await res.json().catch(() => ({})), rl };
}

function printHeaders(rl: Record<string, string>) {
  const get = (k: string) => rl[`x-ratelimit-${k}`] ?? 'n/a';
  console.log(`
  Trust Score:      ${get('trust-score')}   Tier: ${get('trust-tier')}   Multiplier: ×${get('trust-multiplier')}
  Bot Score:        ${get('bot-score')}   Tier: ${get('bot-tier')}   Multiplier: ×${get('bot-multiplier')}
  Combined:         ×${get('multiplier')}
  Base Max:         ${get('base')}
  Effective Limit:  ${get('limit')}
  Remaining:        ${get('remaining')}
  Reset:            ${get('reset')}s`);
}

async function main() {
  console.log('\n════════════════════════════════════════════');
  console.log('  guard-nest — Adaptive Rate Limit Test Suite');
  console.log('  effectiveLimit = baseMax × trustMult × botMult');
  console.log('════════════════════════════════════════════\n');

  // ── 1. Clean request — ver todos los headers ──────────────────────────────
  console.log('── 1. Request limpia (Chrome UA) — trust × bot = límite efectivo ──');

  const r1 = await req('chrome');
  const icon1 = r1.status === 200 ? '✅' : r1.status === 429 ? '🚦' : '⚠️ ';
  console.log(`\n  ${icon1} [${r1.status}] GET /adaptive`);
  printHeaders(r1.rl);

  // ── 2. Curl UA — bot score sube → límite baja ─────────────────────────────
  console.log('\n── 2. Request con curl UA — bot score eleva × límite baja ──');

  const r2 = await req('curl');
  const icon2 = r2.status === 200 ? '✅' : r2.status === 429 ? '🚦' : '⚠️ ';
  console.log(`\n  ${icon2} [${r2.status}] GET /adaptive  (curl/8.0 UA)`);
  printHeaders(r2.rl);

  const limitClean = parseInt(r1.rl['x-ratelimit-limit'] ?? '10');
  const limitCurl  = parseInt(r2.rl['x-ratelimit-limit'] ?? '5');
  if (limitCurl < limitClean) {
    console.log(`\n  → Límite bajó de ${limitClean} a ${limitCurl} por bot score más alto`);
  }

  // ── 3. Burst hasta 429 ────────────────────────────────────────────────────
  // Cuántos requests ya se hicieron (restando los 2 anteriores del remaining)
  const remaining = parseInt(r2.rl['x-ratelimit-remaining'] ?? '3');
  const toFire = remaining + 3; // fire enough to hit the limit

  console.log(`\n── 3. Burst (${toFire} requests) — debe llegar a 429 ──\n`);

  let blocked = false;
  for (let i = 1; i <= toFire; i++) {
    const r = await req('chrome');
    const lim = r.rl['x-ratelimit-limit'] ?? '?';
    const rem = r.rl['x-ratelimit-remaining'] ?? '?';

    if (r.status === 429) {
      const reset = r.rl['x-ratelimit-reset'] ?? '?';
      console.log(`  🚦 [429] #${i} — RATE LIMIT exceeded  limit=${lim}  reset=${reset}s`);
      blocked = true;
      break;
    } else {
      console.log(`  ✅ [${r.status}] #${i}   remaining=${rem}/${lim}`);
    }
  }

  if (!blocked) {
    console.log('\n  (ventana ya tenía requests previos — 429 puede requerir más requests)');
    console.log('  Tip: espera 60 segundos y vuelve a ejecutar para ventana limpia');
  }

  console.log('\n════════════════════════════════════════════');
  console.log('  Resumen:');
  console.log(`    trustScore=50 (new-user ×0.10) × botScore clean (×1.00) → limit=${limitClean}`);
  console.log(`    trustScore=50 (new-user ×0.10) × botScore ~30 (suspicious ×0.50) → limit=${limitCurl}`);
  console.log('    AdaptiveRateLimitGuard nunca supone trust — comienza conservador (×0.10)');
  console.log('    AnomalyDetectionGuard puede bajar el trust score si detecta comportamiento anómalo');
  console.log('════════════════════════════════════════════\n');
}

main().catch(console.error);
