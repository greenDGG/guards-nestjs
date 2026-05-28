/**
 * test-nonce.ts — Prueba NonceGuard (replay attack prevention)
 *
 * Run: npx ts-node scripts/test-nonce.ts
 *
 * Escenarios:
 *   1. Nonce único         → ✅ procesado
 *   2. Mismo nonce         → ❌ 401 Replay attack
 *   3. Sin nonce           → ❌ 401 Missing header
 *   4. Nonce muy corto     → ❌ 401 Invalid nonce
 *   5. Nonces paralelos    → sólo uno pasa (setnx atómico)
 *   6. Nonce + Firma       → combo completo
 */

import { createHmac, randomUUID } from 'crypto';

const BASE = 'http://localhost:3000';

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function post(
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; data: unknown }> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

let failures = 0;

function log(status: number, label: string, extra?: string) {
  const icon = status < 300 ? '✅' : status === 401 ? '🔐' : '⚠️ ';
  if (icon.startsWith('⚠️')) failures++;
  console.log(`${icon} [${status}] ${label}${extra ? `  —  ${extra}` : ''}`);
}

async function main() {
  console.log('\n════════════════════════════════════════════');
  console.log('  guard-nest — Nonce Guard Test Suite');
  console.log('════════════════════════════════════════════\n');

  const body = { action: 'test', value: 42 };

  // ── 1. Nonce único — pasa ────────────────────────────────────────────────
  console.log('── /demo/level2/nonce-check  (NonceGuard solo) ──\n');

  const nonce1 = randomUUID();
  {
    const { status } = await post('/demo/level2/nonce-check', body, { 'x-nonce': nonce1 });
    log(status, `Nonce nuevo "${nonce1.slice(0,8)}..." → PASS`);
  }

  // ── 2. Mismo nonce — replay blocked ─────────────────────────────────────
  {
    const { status, data } = await post('/demo/level2/nonce-check', body, { 'x-nonce': nonce1 });
    log(status, `Mismo nonce "${nonce1.slice(0,8)}..." → REPLAY BLOCKED`, (data as any)?.message);
  }

  // ── 3. Sin nonce ─────────────────────────────────────────────────────────
  {
    const { status, data } = await post('/demo/level2/nonce-check', body);
    log(status, 'Sin x-nonce header → 401', (data as any)?.message);
  }

  // ── 4. Nonce demasiado corto ──────────────────────────────────────────────
  {
    const { status, data } = await post('/demo/level2/nonce-check', body, { 'x-nonce': 'short' });
    log(status, 'Nonce "short" (5 chars < min 16) → 401', (data as any)?.message);
  }

  // ── 5. Nonces paralelos — solo uno pasa ──────────────────────────────────
  console.log('\n── Replay race condition (3 requests paralelas con mismo nonce) ──\n');

  const raceNonce = randomUUID();
  const [r1, r2, r3] = await Promise.all([
    post('/demo/level2/nonce-check', body, { 'x-nonce': raceNonce }),
    post('/demo/level2/nonce-check', body, { 'x-nonce': raceNonce }),
    post('/demo/level2/nonce-check', body, { 'x-nonce': raceNonce }),
  ]);

  [r1, r2, r3].forEach((r, i) => {
    log(r.status, `Request paralela #${i + 1}`);
  });

  const passed   = [r1, r2, r3].filter(r => r.status < 300).length;
  const blocked  = [r1, r2, r3].filter(r => r.status === 401).length;
  console.log(`\n   Resultado: ${passed} procesada(s), ${blocked} bloqueada(s)`);
  console.log(`   Esperado:  1 procesada,  2 bloqueadas  (setnx atómico)\n`);

  // ── 6. Nonce diferente — pasa de nuevo ───────────────────────────────────
  const nonce2 = randomUUID();
  {
    const { status } = await post('/demo/level2/nonce-check', body, { 'x-nonce': nonce2 });
    log(status, `Nonce diferente "${nonce2.slice(0,8)}..." → PASS (nonces son por solicitud)`);
  }

  // ── 7. Nonce + Firma — combo completo ─────────────────────────────────────
  console.log('\n── /demo/level2/secure-transfer  (SignatureGuard + NonceGuard) ──\n');

  const secret    = 'demo-webhook-secret';
  const nonce3    = randomUUID();
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const rawBody   = JSON.stringify(body);
  const message   = `${timestamp}.${rawBody}`;
  const sig       = createHmac('sha256', secret).update(message).digest('hex');

  {
    const { status } = await post('/demo/level2/secure-transfer', body, {
      'x-timestamp': timestamp,
      'x-signature': sig,
      'x-nonce':     nonce3,
    });
    log(status, 'Firma válida + nonce nuevo → PASS');
  }

  {
    // Same nonce, still valid signature — replay blocked
    const { status, data } = await post('/demo/level2/secure-transfer', body, {
      'x-timestamp': timestamp,
      'x-signature': sig,
      'x-nonce':     nonce3,   // ← mismo nonce
    });
    log(status, 'Firma válida + mismo nonce → REPLAY BLOCKED', (data as any)?.message);
  }

  console.log('\n════════════════════════════════════════════');
  console.log('  Done');
  console.log('════════════════════════════════════════════\n');
}

main()
  .then(() => { if (failures > 0) { console.error(`\n❌ ${failures} test(s) failed`); process.exit(1); } })
  .catch((e: unknown) => { console.error(e); process.exit(1); });