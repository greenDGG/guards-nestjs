/**
 * test-bot.ts — Triggers BotDetectionGuard with various bot signals
 *
 * Run: npx ts-node scripts/test-bot.ts
 *
 * Scoring model (default weights):
 *   +30  No User-Agent
 *   +25  Headless/automation UA (HeadlessChrome, Puppeteer, curl, wget, etc.)
 *   +15  Malformed UA (<20 chars or no parentheses)
 *   + 5  Missing Accept header
 *   + 5  Missing Accept-Encoding
 *   + 5  Missing Accept-Language
 *   + 5  Chrome UA without sec-fetch-site
 *   + 5  All three Accept headers missing (bonus)
 *   +25  Very fast requests (avg interval < 200ms)
 *   +15  Fast requests (avg interval < 500ms)
 *   +20  Machine-precision regularity (CV < 0.05)
 *   +30  Honeypot field filled in POST body
 *
 * Note: node-fetch (used here) auto-adds Accept and Accept-Encoding.
 *   UA-based tests use /bot-strict (threshold=30) where headless UA (+25)
 *   + missing Accept-Language (+5) = 30 reliably triggers the block.
 */

const BASE = 'http://localhost:3000';

// ── Helpers ────────────────────────────────────────────────────────────────

interface TestCase {
  label: string;
  path: string;
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  expectBlocked?: boolean;
}

let failures = 0;

async function runCase(tc: TestCase): Promise<void> {
  const method = tc.method ?? 'GET';
  const url = `${BASE}${tc.path}`;
  const fetchHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(tc.headers ?? {}),
  };

  try {
    const res = await fetch(url, {
      method,
      headers: fetchHeaders,
      body: tc.body ? JSON.stringify(tc.body) : undefined,
    });
    const data = await res.json().catch(() => ({})) as Record<string, unknown>;

    const blocked = res.status === 403 || res.status === 429;
    const correct = tc.expectBlocked ? blocked : !blocked;
    if (!correct) failures++;
    const icon = correct ? '✅' : '⚠️ ';
    const expected = tc.expectBlocked ? 'BLOCKED' : 'ALLOWED';
    const actual = blocked ? 'BLOCKED' : `ALLOWED [${res.status}]`;

    console.log(`${icon} [${actual}] ${tc.label}`);
    if (!correct) {
      console.log(`      Expected: ${expected}`);
      console.log(`      Response: ${JSON.stringify(data).slice(0, 120)}`);
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log(`💥 ${tc.label} → ${msg}`);
  }
}

// ── Header sets ────────────────────────────────────────────────────────────

const REAL_BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'es-MX,es;q=0.9,en;q=0.8',
  'Accept-Encoding': 'gzip, deflate, br',
  'sec-fetch-site': 'none',
  'sec-fetch-mode': 'navigate',
  'sec-fetch-dest': 'document',
};

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n════════════════════════════════════════════');
  console.log('  guard-nest — Bot Detection Test Suite');
  console.log('════════════════════════════════════════════\n');

  // ── Group 1: Normal threshold (70) — legit traffic always passes ──────────
  console.log('── /demo/level4/bot-check  (threshold = 70) ──');
  console.log('   At threshold 70, multiple weak signals must combine to block.\n');

  await runCase({
    label: 'Real Chrome UA + full headers (score ~0) → PASS',
    path: '/demo/level4/bot-check',
    headers: REAL_BROWSER_HEADERS,
    expectBlocked: false,
  });

  await runCase({
    label: 'Googlebot (whitelisted — score always 0) → PASS',
    path: '/demo/level4/bot-check',
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    },
    expectBlocked: false,
  });

  // ── Group 2: Strict threshold (30) — bot UA detection ────────────────────
  // headless UA (+25) + missing Accept-Language (+5) = 30 → blocked at threshold 30.
  // node-fetch auto-adds Accept and Accept-Encoding, so those signals are suppressed.
  console.log('\n── /demo/level4/bot-strict  (threshold = 30) — UA detection ──\n');

  await runCase({
    label: 'Real Chrome + full headers → PASS even in strict mode',
    path: '/demo/level4/bot-strict',
    headers: REAL_BROWSER_HEADERS,
    expectBlocked: false,
  });

  await runCase({
    label: 'curl/8.0 UA (+25) + no Accept-Language (+5) = 30 → BLOCK',
    path: '/demo/level4/bot-strict',
    headers: { 'User-Agent': 'curl/8.0' },
    expectBlocked: true,
  });

  await runCase({
    label: 'HeadlessChrome UA (+25) + no Accept-Language (+5) = 30 → BLOCK',
    path: '/demo/level4/bot-strict',
    headers: {
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 HeadlessChrome/120.0.0.0 Safari/537.36',
    },
    expectBlocked: true,
  });

  await runCase({
    label: 'Puppeteer UA (+25) + no Accept-Language (+5) = 30 → BLOCK',
    path: '/demo/level4/bot-strict',
    headers: { 'User-Agent': 'puppeteer-bot/1.0' },
    expectBlocked: true,
  });

  await runCase({
    label: 'No User-Agent (+30) + no Accept-Language (+5) = 35 → BLOCK',
    path: '/demo/level4/bot-strict',
    headers: { 'User-Agent': '' },
    expectBlocked: true,
  });

  await runCase({
    label: 'Googlebot → PASS (whitelisted, returns score 0)',
    path: '/demo/level4/bot-strict',
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    },
    expectBlocked: false,
  });

  await runCase({
    label: 'Go-http-client/1.1 — matches headless pattern (+25) + no AcceptLang (+5) = 30 → BLOCK',
    path: '/demo/level4/bot-strict',
    headers: { 'User-Agent': 'Go-http-client/1.1' },
    expectBlocked: true,
  });

  // ── Group 3: Honeypot POST (threshold = 30) ─────────────────────────────
  // honeypot field filled = +30 → blocked even without timing signal.
  // threshold is 30 (not 25) so normal POST is safe even when timing adds +25.
  console.log('\n── /demo/level4/bot-form  (honeypot, threshold = 30) ──\n');

  await runCase({
    label: 'Normal POST, no honeypot fields → PASS',
    path: '/demo/level4/bot-form',
    method: 'POST',
    headers: REAL_BROWSER_HEADERS,
    body: { nombre: 'Juan', mensaje: 'Hola' },
    expectBlocked: false,
  });

  await runCase({
    label: 'POST with "website" honeypot filled (+30) → BLOCK',
    path: '/demo/level4/bot-form',
    method: 'POST',
    headers: REAL_BROWSER_HEADERS,
    body: { nombre: 'Juan', website: 'http://spam.com', mensaje: 'Hola' },
    expectBlocked: true,
  });

  await runCase({
    label: 'POST with "_gotcha" honeypot filled (+30) → BLOCK',
    path: '/demo/level4/bot-form',
    method: 'POST',
    headers: REAL_BROWSER_HEADERS,
    body: { nombre: 'Juan', _gotcha: 'trapped', mensaje: 'Hola' },
    expectBlocked: true,
  });

  // ── Group 4: Log-only mode ──────────────────────────────────────────────
  console.log('\n── /demo/level4/bot-log-only  (logOnly = true) ──\n');

  await runCase({
    label: 'curl UA — PASS (log-only never blocks)',
    path: '/demo/level4/bot-log-only',
    headers: { 'User-Agent': 'curl/8.0' },
    expectBlocked: false,
  });

  await runCase({
    label: 'No headers at all — PASS (log-only never blocks)',
    path: '/demo/level4/bot-log-only',
    headers: { 'User-Agent': '' },
    expectBlocked: false,
  });

  // ── Group 5: Machine-timing simulation ─────────────────────────────────
  console.log('\n── Rapid requests (machine timing detection) ──\n');
  console.log('   Firing 10 requests with machine-speed intervals...\n');

  const timingResults: number[] = [];
  for (let i = 0; i < 10; i++) {
    const start = Date.now();
    const res = await fetch(`${BASE}/demo/level4/bot-check`, {
      headers: REAL_BROWSER_HEADERS,
    });
    timingResults.push(Date.now() - start);
    if (res.status === 403) {
      console.log(`   → Blocked at request #${i + 1} (timing pattern detected)`);
      break;
    }
  }
  const avg = timingResults.reduce((a, b) => a + b, 0) / timingResults.length;
  console.log(`   Average response time: ${avg.toFixed(0)}ms`);
  console.log('   Note: real browser headers score 0 for UA/header signals.');
  console.log('         Timing adds +25 (avg<200ms) — still below threshold 70.');
  console.log('         Check server logs to see the bot score per request.\n');

  console.log('════════════════════════════════════════════');
  console.log('  Done — Check server console for detailed scores');
  console.log('════════════════════════════════════════════\n');
}

main()
  .then(() => { if (failures > 0) { console.error(`\n❌ ${failures} test(s) failed`); process.exit(1); } })
  .catch((e: unknown) => { console.error(e); process.exit(1); });