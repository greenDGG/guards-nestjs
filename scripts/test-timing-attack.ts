/**
 * test-timing-attack.ts — Prueba TimingAttackGuard + TimingAttackInterceptor
 *
 * Run: npx ts-node scripts/test-timing-attack.ts
 *
 * Sin protección de timing:
 *   "user not found" → retorna en ~5ms
 *   "wrong password" → bcrypt compare tarda ~200ms
 *   Diferencia observable → atacante sabe si el usuario existe.
 *
 * Con TimingAttackGuard + TimingAttackInterceptor (minResponseMs=300):
 *   path rápido  (~5ms)   → padded → ~300ms
 *   path lento   (~200ms) → padded → ~300ms
 *   Ambos iguales → el atacante no puede inferir nada del tiempo.
 *
 * Endpoints:
 *   POST /demo/level2/timing-fast  — handler retorna en <5ms (simula "not found")
 *   POST /demo/level2/timing-slow  — handler tarda 200ms (simula bcrypt compare)
 *   Ambos: minResponseMs=300, jitterMs=100
 */

const BASE = 'http://localhost:3000';

async function post(path: string): Promise<{ status: number; ms: number; data: any }> {
  const start = Date.now();
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  const ms = Date.now() - start;
  return { status: res.status, ms, data: await res.json().catch(() => ({})) };
}

function bar(ms: number, max: number): string {
  const filled = Math.round((ms / max) * 30);
  return '█'.repeat(filled) + '░'.repeat(Math.max(0, 30 - filled));
}

async function main() {
  console.log('\n════════════════════════════════════════════');
  console.log('  guard-nest — Timing Attack Protection Test');
  console.log('  minResponseMs=300  jitterMs=100');
  console.log('════════════════════════════════════════════\n');

  // ── 1. Warmup (descartado) ────────────────────────────────────────────────
  await post('/demo/level2/timing-fast');
  await post('/demo/level2/timing-slow');

  // ── 2. Medir ambos paths 5 veces ─────────────────────────────────────────
  const fastSamples: number[] = [];
  const slowSamples: number[] = [];

  console.log('── Midiendo 5 muestras por path ──\n');
  console.log('  Path         ms     barra (0 ─────────────── 500ms)');
  console.log('  ─────────────────────────────────────────────────────');

  for (let i = 0; i < 5; i++) {
    const f = await post('/demo/level2/timing-fast');
    const s = await post('/demo/level2/timing-slow');
    fastSamples.push(f.ms);
    slowSamples.push(s.ms);
    console.log(`  timing-fast  ${String(f.ms).padStart(4)}ms  ${bar(f.ms, 500)}`);
    console.log(`  timing-slow  ${String(s.ms).padStart(4)}ms  ${bar(s.ms, 500)}\n`);
  }

  const avg = (arr: number[]) => Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);
  const avgFast = avg(fastSamples);
  const avgSlow = avg(slowSamples);
  const diff    = Math.abs(avgFast - avgSlow);

  console.log('── Resumen ──\n');
  console.log(`  timing-fast  promedio: ${avgFast}ms  (handler: <5ms   + padding)`);
  console.log(`  timing-slow  promedio: ${avgSlow}ms  (handler: ~200ms + padding)`);
  console.log(`  diferencia observable: ${diff}ms  ${diff < 50 ? '✅ indistinguibles' : '⚠️  diferencia notable'}\n`);

  console.log('  Sin protección:');
  console.log('    timing-fast → ~5ms   ← atacante deduce "usuario no existe"');
  console.log('    timing-slow → ~200ms ← atacante deduce "usuario existe, contraseña incorrecta"');
  console.log('\n  Con TimingAttackGuard + Interceptor:');
  console.log(`    timing-fast → ~${avgFast}ms  ← sin información de timing`);
  console.log(`    timing-slow → ~${avgSlow}ms  ← sin información de timing`);

  console.log('\n════════════════════════════════════════════\n');
}

main().catch(console.error);
