/**
 * test-risk-score.ts — Prueba RiskScoreGuard
 *
 * Run: npx ts-node scripts/test-risk-score.ts
 *
 * RiskScoreGuard agrega 5 señales:
 *   Bot score (0–40) + Geo riesgo (0–15) + Trust inverso (0–15)
 *   + Velocity (0–15) + Fingerprint cambio (0–15)
 *   = Score total 0–100 → allow / challenge / block
 *
 * GET /demo/level4/risk-score        logOnly:true  — siempre pasa, muestra score
 * GET /demo/level4/risk-score-strict enforce:true  — bloquea si score >= 70
 */

const BASE = 'http://localhost:3000';

interface Result {
  status:     number;
  score:      string;
  action:     string;
  data:       any;
}

async function get(
  path: string,
  headers: Record<string, string> = {},
): Promise<Result> {
  const res = await fetch(`${BASE}${path}`, { headers });
  return {
    status: res.status,
    score:  res.headers.get('x-risk-score')  ?? '—',
    action: res.headers.get('x-risk-action') ?? '—',
    data:   await res.json().catch(() => ({})),
  };
}

function bar(score: number): string {
  const filled = Math.round((score / 100) * 20);
  const color  =
    score >= 70 ? '█' :
    score >= 40 ? '▓' :
                  '░';
  return color.repeat(filled) + '·'.repeat(Math.max(0, 20 - filled));
}

function row(label: string, r: Result) {
  const scoreNum = parseInt(r.score, 10) || 0;
  const icon =
    r.action === 'block'     ? '🔴' :
    r.action === 'challenge' ? '🟡' :
    r.action === 'allow'     ? '🟢' :
    r.status >= 400          ? '🔴' : '🟢';

  console.log(
    `  ${icon}  ${label.padEnd(42)}` +
    `  score=${String(r.score).padStart(3)}  [${bar(scoreNum)}]  ${r.action}`,
  );
}

let failures = 0;

async function main() {
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('  guard-nest — RiskScoreGuard Test');
  console.log('  5 señales → score 0–100 → allow / challenge / block');
  console.log('═══════════════════════════════════════════════════════\n');

  // ── Warmup ─────────────────────────────────────────────────────────────────
  await get('/demo/level4/risk-score');

  console.log('── Perfil 1: Navegador humano normal ──\n');
  const humanHeaders = {
    'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'es-MX,es;q=0.9,en;q=0.8',
    'Accept-Encoding': 'gzip, deflate, br',
    'Sec-Fetch-Site':  'none',
    'Sec-Fetch-Mode':  'navigate',
  };
  const r1 = await get('/demo/level4/risk-score', humanHeaders);
  row('Chrome humano (UA completo)', r1);
  if (r1.data?.breakdown) {
    const b = r1.data.breakdown;
    console.log(`       ↳ bot=${b.bot}  geo=${b.geo}  trust=${b.trust}  vel=${b.velocity}  fp=${b.fingerprint}`);
  }

  console.log();
  console.log('── Perfil 2: Herramientas de automatización ──\n');

  const r2 = await get('/demo/level4/risk-score', {
    'User-Agent': 'curl/8.4.0',
  });
  row('curl (sin Accept, sin lang)', r2);

  const r3 = await get('/demo/level4/risk-score', {
    'User-Agent': 'python-requests/2.31.0',
  });
  row('python-requests', r3);

  const r4 = await get('/demo/level4/risk-score', {
    'User-Agent': 'HeadlessChrome/125.0 Puppeteer',
  });
  row('HeadlessChrome / Puppeteer', r4);

  const r5 = await get('/demo/level4/risk-score', {});
  row('Sin User-Agent (máximo bot score)', r5);

  console.log();
  console.log('── Perfil 3: Velocity — 10 requests rápidas ──\n');

  for (let i = 0; i < 9; i++) {
    await get('/demo/level4/risk-score', humanHeaders);
  }
  const rVel = await get('/demo/level4/risk-score', humanHeaders);
  row('Tras 10 requests rápidas (velocity)', rVel);

  console.log();
  console.log('── Modo strict (enforce) — con fingerprint diferente ──\n');

  const r6 = await get('/demo/level4/risk-score-strict', humanHeaders);
  if (r6.status < 400) {
    row('risk-score-strict (score bajo)', r6);
  } else {
    const msg = r6.data?.message ?? 'bloqueado';
    console.log(`  🔴  risk-score-strict → HTTP ${r6.status}  score=${r6.score}  ${msg.slice(0, 60)}`);
  }

  console.log();
  console.log('── Leyenda ──');
  console.log('  🟢 allow     (score 0–39)   ░░ barras grises');
  console.log('  🟡 challenge (score 40–69)  ▓▓ barras medias');
  console.log('  🔴 block     (score 70–100) ██ barras llenas');

  console.log('\n── Stack fintech recomendado ──\n');
  console.log('  @AuditLog({ resource: "transfer" })');
  console.log('  @RiskScore({ thresholds: { challenge: 30, block: 60 } })');
  console.log('  @ReplayProtect({ secret: process.env.API_SECRET })');
  console.log('  @UseGuards(BotDetectionGuard, GeoIpGuard, ReplayProtectionGuard, RiskScoreGuard)');
  console.log('  @UseInterceptors(AuditLogInterceptor)');
  console.log('  @Post("transfer")');
  console.log('  transfer() {}');

  console.log('\n═══════════════════════════════════════════════════════\n');
}

main()
  .then(() => { if (failures > 0) { console.error(`\n❌ ${failures} test(s) failed`); process.exit(1); } })
  .catch((e: unknown) => { console.error(e); process.exit(1); });