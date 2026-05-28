/**
 * test-time-based.ts — Prueba TimeBasedAccessGuard
 *
 * Run: npx ts-node scripts/test-time-based.ts
 *
 * Los endpoints de tiempo son @Public() — no requieren token JWT.
 * Los resultados de business-hours y overnight-access dependen de la hora actual.
 *
 * Escenarios:
 *   1. always-open        (00:00-23:59 UTC)            → ✅ siempre
 *   2. narrow-window      (00:00-00:01 UTC)            → ❌ casi siempre
 *   3. under-maintenance  (maintenance 24h)            → ❌ siempre (override)
 *   4. business-hours     (09:00-18:00 MX, L-V)        → depende de la hora actual
 *   5. overnight-access   (22:00-06:00 UTC)            → depende de la hora actual
 */

const BASE = 'http://localhost:3000';

async function get(path: string): Promise<{ status: number; data: unknown }> {
  const res = await fetch(`${BASE}${path}`);
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

let failures = 0;

function log(status: number, label: string, extra?: string) {
  const icon = status === 200 ? '✅' : status === 403 ? '🚫' : '⚠️ ';
  console.log(`${icon} [${status}] ${label}${extra ? `  —  ${extra}` : ''}`);
}

function getCurrentUtcTime(): string {
  const now = new Date();
  const h = now.getUTCHours().toString().padStart(2, '0');
  const m = now.getUTCMinutes().toString().padStart(2, '0');
  const days = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
  return `${days[now.getUTCDay()]} ${h}:${m} UTC`;
}

function getMexicoTime(): string {
  return new Intl.DateTimeFormat('es-MX', {
    timeZone: 'America/Mexico_City',
    weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date());
}

async function main() {
  console.log('\n════════════════════════════════════════════');
  console.log('  guard-nest — Time-Based Access Guard Test Suite');
  console.log('════════════════════════════════════════════\n');

  console.log(`  Hora actual: ${getCurrentUtcTime()}  |  México: ${getMexicoTime()}\n`);

  // ── always-open: nunca bloquea ────────────────────────────────────────────
  console.log('── always-open  (00:00–23:59 UTC — siempre abierto) ──\n');

  {
    const { status } = await get('/demo/level5/always-open');
    log(status, 'Siempre pasa → PASS');
  }

  // ── narrow-window: casi siempre bloquea ───────────────────────────────────
  console.log('\n── narrow-window  (00:00–00:01 UTC — casi siempre bloqueado) ──\n');

  {
    const { status, data } = await get('/demo/level5/narrow-window');
    const msg = status === 200 ? 'Pasaste el minuto exacto' : (data as any)?.message;
    log(status, 'Ventana de 1 min por hora (casi siempre bloqueado)', msg);
  }

  // ── under-maintenance: maintenance sobreescribe allowedWindows ────────────
  console.log('\n── under-maintenance  (maintenance 24h — siempre bloqueado) ──\n');

  {
    const { status, data } = await get('/demo/level5/under-maintenance');
    log(status, 'Maintenance overrides allowedWindows → siempre bloqueado', (data as any)?.message);
  }

  // ── business-hours: depende de la hora actual ─────────────────────────────
  console.log('\n── business-hours  (09:00–18:00 L–V, América/Mexico_City) ──\n');

  {
    const { status, data } = await get('/demo/level5/business-hours');
    const note = status === 200 ? 'estás en horario laboral MX' : 'fuera de horario laboral MX (L–V 9–18h)';
    log(status, `business-hours → ${note}`, (data as any)?.serverTime?.slice(0, 19));
  }

  // ── overnight: depende de la hora actual ──────────────────────────────────
  console.log('\n── overnight-access  (22:00–06:00 UTC — ventana nocturna) ──\n');

  {
    const { status, data } = await get('/demo/level5/overnight-access');
    const note = status === 200 ? 'estás en la ventana nocturna (22–06 UTC)' : 'fuera de la ventana nocturna';
    log(status, `overnight → ${note}`, (data as any)?.currentTime?.slice(11, 16) + ' UTC');
  }

  console.log('\n════════════════════════════════════════════');
  console.log('  Resultados esperados:');
  console.log('    always-open:       ✅ siempre');
  console.log('    narrow-window:     🚫 casi siempre');
  console.log('    under-maintenance: 🚫 siempre (maintenance override)');
  console.log('    business-hours:    depende de la hora actual (L-V 9-18h MX)');
  console.log('    overnight:         depende de la hora actual (22-06h UTC)');
  console.log('════════════════════════════════════════════\n');
}

main()
  .then(() => { if (failures > 0) { console.error(`\n❌ ${failures} test(s) failed`); process.exit(1); } })
  .catch((e: unknown) => { console.error(e); process.exit(1); });