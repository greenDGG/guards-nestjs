/**
 * test-bot.ts — Triggers BotDetectionGuard with various bot signals
 *
 * Run: npx ts-node scripts/test-bot.ts
 *
 * What this tests:
 *   1. Real browser headers → score low → passes
 *   2. curl-like User-Agent → score high → blocked (threshold=70)
 *   3. HeadlessChrome UA → blocked
 *   4. Missing all headers → blocked
 *   5. Honeypot field in POST body → blocked
 *   6. Rapid requests (machine timing) → adaptive trust-score drops
 *   7. log-only mode → never blocked regardless of UA
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

// ── Browser headers (real Chrome) ────────────────────────────────────────

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

  // ── Group 1: Normal threshold (70) ─────────────────────────────────────
  console.log('── /demo/level4/bot-check  (threshold = 70) ──\n');

  await runCase({
    label: 'Real Chrome UA + full headers (score ~0) → should PASS',
    path: '/demo/level4/bot-check',
    headers: REAL_BROWSER_HEADERS,
    expectBlocked: false,
  });

  await runCase({
    label: 'curl/8.0 User-Agent (+25) + missing headers (+15) → should BLOCK',
    path: '/demo/level4/bot-check',
    headers: { 'User-Agent': 'curl/8.0' },
    expectBlocked: true,
  });

  await runCase({
    label: 'HeadlessChrome UA (+25) + missing headers (+15) → should BLOCK',
    path: '/demo/level4/bot-check',
    headers: {
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 HeadlessChrome/120.0.0.0 Safari/537.36',
    },
    expectBlocked: true,
  });

  await runCase({
    label: 'Puppeteer UA (+25) → should BLOCK',
    path: '/demo/level4/bot-check',
    headers: { 'User-Agent': 'puppeteer-bot/1.0' },
    expectBlocked: true,
  });

  await runCase({
    label: 'No User-Agent at all (+30) → should BLOCK',
    path: '/demo/level4/bot-check',
    headers: { 'User-Agent': '' },
    expectBlocked: true,
  });

  await runCase({
    label: 'Googlebot (known good bot) → should PASS (whitelisted)',
    path: '/demo/level4/bot-check',
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    },
    expectBlocked: false,
  });

  // ── Group 2: Strict threshold (30) ─────────────────────────────────────
  console.log('\n── /demo/level4/bot-strict  (threshold = 30) ──\n');

  await runCase({
    label: 'Real Chrome + full headers → PASS even in strict mode',
    path: '/demo/level4/bot-strict',
    headers: REAL_BROWSER_HEADERS,
    expectBlocked: false,
  });

  await runCase({
    label: 'Missing Accept-Language (+5) + missing sec-fetch (+5) + short UA (+15) → BLOCK at 30',
    path: '/demo/level4/bot-strict',
    headers: {
      'User-Agent': 'Go-http-client/1.1',  // malformed (<20 chars + no parens: +15)
    },
    expectBlocked: true,
  });

  // ── Group 3: Honeypot POST ──────────────────────────────────────────────
  console.log('\n── /demo/level4/bot-form  (honeypot, threshold = 25) ──\n');

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
    label: 'curl UA — should PASS (log-only never blocks)',
    path: '/demo/level4/bot-log-only',
    headers: { 'User-Agent': 'curl/8.0' },
    expectBlocked: false,
  });

  await runCase({
    label: 'No headers at all — should PASS (log-only never blocks)',
    path: '/demo/level4/bot-log-only',
    headers: { 'User-Agent': '' },
    expectBlocked: false,
  });

  // ── Group 5: Machine-timing simulation ─────────────────────────────────
  console.log('\n── Rapid requests (machine timing detection) ──\n');
  console.log('   Firing 10 requests with <50ms gap...\n');

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
  console.log('   Note: timing-based detection requires many requests in a short window');
  console.log('         Check server logs for the bot score on each request');

  console.log('\n════════════════════════════════════════════');
  console.log('  Done — Check server console for scores');
  console.log('════════════════════════════════════════════\n');
}

main().catch(console.error);
