/**
 * test-header-validation.ts — Prueba HeaderValidationGuard
 *
 * Run: npx ts-node scripts/test-header-validation.ts
 *
 * HeaderValidationGuard — validación determinística de headers.
 * Diferencia vs BotDetectionGuard (scoring probabilístico):
 *   este guard falla de inmediato en la primera violation.
 *
 * Checks disponibles:
 *   1. Automation blocklist   — x-playwright-*, x-selenium-*, x-webdriver-*, etc.
 *   2. Browser headers        — Accept, Accept-Language, Accept-Encoding requeridos
 *   3. Accept wildcard        — browser UA con Accept: */* → sospechoso
 *   4. sec-ch-ua consistency  — Chrome 90+ sin Sec-CH-UA → UA falso
 *   5. Custom rules           — required/forbidden/pattern/notPattern
 *   6. logOnly                — observar sin bloquear
 *
 * Endpoints:
 *   GET /demo/level2/header-check       — automation blocklist
 *   GET /demo/level2/header-browser     — browser headers + accept wildcard
 *   GET /demo/level2/header-sec-ch-ua   — sec-ch-ua consistency
 *   GET /demo/level2/header-custom      — reglas custom (x-api-version + accept)
 *   GET /demo/level2/header-observe     — logOnly: true
 */

const BASE = 'http://localhost:3000';

const UA_CHROME  = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const UA_FIREFOX = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0';
const UA_CURL    = 'curl/8.4.0';

const SEC_CH_UA_VALID   = '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"';
const SEC_CH_UA_STALE   = '"Chromium";v="110", "Google Chrome";v="110", "Not-A.Brand";v="99"'; // wrong version
const ACCEPT_BROWSER    = 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8';
const ACCEPT_WILDCARD   = '*/*';
const ACCEPT_JSON       = 'application/json';

interface Hit {
  status:     number;
  violations: string;
  data:       any;
}

async function get(path: string, headers: Record<string, string>): Promise<Hit> {
  const res = await fetch(`${BASE}${path}`, { headers });
  return {
    status:     res.status,
    violations: res.headers.get('x-header-violations') ?? '0',
    data:       await res.json().catch(() => ({})),
  };
}

function icon(h: Hit): string {
  if (h.status === 200) return '🟢';
  if (h.status === 400) return '🟡';
  if (h.status === 403) return '🔴';
  return '⚠️ ';
}

function row(label: string, h: Hit) {
  const msg = h.status >= 400
    ? (h.data?.message ?? JSON.stringify(h.data)).slice(0, 70)
    : 'OK';
  console.log(`  ${icon(h)}  ${label.padEnd(58)}  HTTP ${h.status}  ${msg}`);
}

async function main() {
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  guard-nest — HeaderValidationGuard Test');
  console.log('  Deterministic: any violation = immediate block');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // ── Check 1: Automation blocklist ──────────────────────────────────────────
  console.log('── Check 1: Automation header blocklist ──\n');

  const a1 = await get('/demo/level2/header-check', {
    'User-Agent': UA_CHROME,
    'Accept':     ACCEPT_BROWSER,
  });
  row('Normal request — sin headers de automatización', a1);

  const a2 = await get('/demo/level2/header-check', {
    'User-Agent':  UA_CHROME,
    'Accept':      ACCEPT_BROWSER,
    'x-playwright': '1',
  });
  row('Con x-playwright: 1 → 403 automation detected', a2);

  const a3 = await get('/demo/level2/header-check', {
    'User-Agent':   UA_CHROME,
    'Accept':       ACCEPT_BROWSER,
    'x-selenium-id': 'webdriver-12345',
  });
  row('Con x-selenium-id → 403 automation detected', a3);

  const a4 = await get('/demo/level2/header-check', {
    'User-Agent':  UA_CHROME,
    'Accept':      ACCEPT_BROWSER,
    '__webdriver_evaluate': '1',
  });
  row('Con __webdriver_evaluate → 403 automation detected', a4);

  console.log();

  // ── Check 2: Browser required headers ──────────────────────────────────────
  console.log('── Check 2: Browser required headers + Accept wildcard ──\n');

  const b1 = await get('/demo/level2/header-browser', {
    'User-Agent':      UA_CHROME,
    'Accept':          ACCEPT_BROWSER,
    'Accept-Language': 'es-MX,es;q=0.9,en;q=0.8',
    'Accept-Encoding': 'gzip, deflate, br',
  });
  row('Chrome con headers completos → 200', b1);

  const b2 = await get('/demo/level2/header-browser', {
    'User-Agent': UA_CURL,
  });
  row('curl sin Accept/Language/Encoding → 400 missing headers', b2);

  const b3 = await get('/demo/level2/header-browser', {
    'User-Agent':      UA_CHROME,
    'Accept':          ACCEPT_WILDCARD,   // */* con UA de Chrome
    'Accept-Language': 'es-MX',
    'Accept-Encoding': 'gzip',
  });
  row('Chrome UA + Accept: */* → 403 accept wildcard', b3);

  const b4 = await get('/demo/level2/header-browser', {
    'User-Agent':      UA_FIREFOX,
    'Accept':          ACCEPT_BROWSER,
    'Accept-Language': 'en-US,en;q=0.5',
    'Accept-Encoding': 'gzip, deflate, br',
  });
  row('Firefox con headers completos → 200', b4);

  console.log();

  // ── Check 3: sec-ch-ua consistency ─────────────────────────────────────────
  console.log('── Check 3: Sec-CH-UA version consistency (Chrome 90+) ──\n');
  console.log('  Chrome 90+ envía Sec-CH-UA automáticamente. Sin él = UA falso.\n');

  const c1 = await get('/demo/level2/header-sec-ch-ua', {
    'User-Agent':        UA_CHROME,
    'Accept':            ACCEPT_BROWSER,
    'Accept-Language':   'es-MX',
    'Accept-Encoding':   'gzip, deflate, br',
    'Sec-CH-UA':         SEC_CH_UA_VALID,
    'Sec-CH-UA-Mobile':  '?0',
    'Sec-CH-UA-Platform': '"Windows"',
  });
  row('Chrome/124 + Sec-CH-UA v="124" → 200 OK', c1);

  const c2 = await get('/demo/level2/header-sec-ch-ua', {
    'User-Agent':      UA_CHROME,
    'Accept':          ACCEPT_BROWSER,
    'Accept-Language': 'es-MX',
    'Accept-Encoding': 'gzip',
    // Sin Sec-CH-UA → bot spoofing Chrome UA
  });
  row('Chrome/124 UA sin Sec-CH-UA → 403 spoofed UA', c2);

  const c3 = await get('/demo/level2/header-sec-ch-ua', {
    'User-Agent':      UA_CHROME,
    'Accept':          ACCEPT_BROWSER,
    'Accept-Language': 'es-MX',
    'Accept-Encoding': 'gzip',
    'Sec-CH-UA':       SEC_CH_UA_STALE,   // v="110" pero UA dice Chrome/124
  });
  row('Chrome/124 UA con Sec-CH-UA v="110" → 403 version mismatch', c3);

  const c4 = await get('/demo/level2/header-sec-ch-ua', {
    'User-Agent':      UA_FIREFOX,   // Firefox no envía sec-ch-ua → no aplica el check
    'Accept':          ACCEPT_BROWSER,
    'Accept-Language': 'en-US',
    'Accept-Encoding': 'gzip',
  });
  row('Firefox UA (no Chrome) → 200 OK (check no aplica)', c4);

  console.log();

  // ── Check 4: Custom rules ──────────────────────────────────────────────────
  console.log('── Check 4: Custom rules (x-api-version required + Accept no wildcard) ──\n');

  const d1 = await get('/demo/level2/header-custom', {
    'User-Agent':    UA_CHROME,
    'Accept':        ACCEPT_JSON,
    'x-api-version': 'v3',
  });
  row('Con x-api-version: v3 y Accept: application/json → 200', d1);

  const d2 = await get('/demo/level2/header-custom', {
    'User-Agent': UA_CHROME,
    'Accept':     ACCEPT_JSON,
    // Sin x-api-version
  });
  row('Sin x-api-version → 400 missing required header', d2);

  const d3 = await get('/demo/level2/header-custom', {
    'User-Agent':    UA_CHROME,
    'Accept':        ACCEPT_JSON,
    'x-api-version': '3',  // falta la 'v'
  });
  row('x-api-version: "3" (sin v) → 400 pattern mismatch', d3);

  const d4 = await get('/demo/level2/header-custom', {
    'User-Agent':    UA_CHROME,
    'Accept':        ACCEPT_WILDCARD,   // */* está bloqueado por notPattern
    'x-api-version': 'v3',
  });
  row('Accept: */* con x-api-version ok → 403 forbidden accept pattern', d4);

  console.log();

  // ── Check 5: logOnly — nunca bloquea ──────────────────────────────────────
  console.log('── Check 5: logOnly:true — todas las violations se registran, ninguna bloquea ──\n');

  const e1 = await get('/demo/level2/header-observe', { 'User-Agent': UA_CURL });
  row(`curl sin headers → violations=${e1.violations} pero HTTP ${e1.status} (logOnly)`, e1);

  const e2 = await get('/demo/level2/header-observe', {
    'User-Agent':      UA_CHROME,
    'Accept':          ACCEPT_BROWSER,
    'Accept-Language': 'es-MX',
    'Accept-Encoding': 'gzip',
    'Sec-CH-UA':       SEC_CH_UA_VALID,
  });
  row(`Chrome completo → violations=${e2.violations} HTTP ${e2.status}`, e2);

  console.log('\n  (Mira los logs del servidor para ver el detalle de las violations)\n');

  // ── Resumen ────────────────────────────────────────────────────────────────
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  Checks disponibles:');
  console.log('    blockAutomationHeaders  x-playwright, x-selenium, x-webdriver, …');
  console.log('    requireBrowserHeaders   Accept + Accept-Language + Accept-Encoding');
  console.log('    checkAcceptWildcard     browser UA + Accept: */* → sospechoso');
  console.log('    checkSecChUa            Chrome 90+ sin/con versión incorrecta');
  console.log('    minHeaderCount          sparse header sets');
  console.log('    rules                   required/forbidden/pattern/notPattern por header');
  console.log('    logOnly                 observar sin bloquear');
  console.log();
  console.log('  Diferencia clave vs BotDetectionGuard:');
  console.log('    BotDetectionGuard  → score acumulado, threshold, probabilístico');
  console.log('    HeaderValidation   → cualquier violation = bloqueo inmediato (determinístico)');
  console.log('═══════════════════════════════════════════════════════════════\n');
}

main().catch(console.error);
