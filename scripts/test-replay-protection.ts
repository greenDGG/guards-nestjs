/**
 * test-replay-protection.ts — Prueba ReplayProtectionGuard
 *
 * Run: npx ts-node scripts/test-replay-protection.ts
 *
 * Combina tres capas de protección en un solo guard:
 *   1. Timestamp   → request válida solo dentro de 5 minutos
 *   2. Firma HMAC  → HMAC-SHA256(secret, `${timestamp}.${nonce}.${body}`)
 *   3. Nonce único → mismo nonce rechazado aunque la firma sea válida
 *
 * vs SignatureGuard + NonceGuard por separado:
 *   El nonce forma parte de la firma → no puede reemplazarse sin romperla.
 */

import { createHmac, randomBytes } from 'crypto';

const BASE   = 'http://localhost:3000';
const SECRET = 'demo-replay-secret';
const URL    = `${BASE}/demo/level2/replay-protection`;

interface Result {
  status: number;
  data:   any;
}

function sign(timestamp: string, nonce: string, body: string): string {
  return createHmac('sha256', SECRET)
    .update(`${timestamp}.${nonce}.${body}`)
    .digest('hex');
}

function freshNonce(): string {
  return randomBytes(16).toString('hex');
}

function now(): string {
  return Math.floor(Date.now() / 1000).toString();
}

async function req(
  timestamp: string,
  nonce: string,
  sig: string,
  body: Record<string, unknown> = { amount: 100 },
): Promise<Result> {
  const bodyStr = JSON.stringify(body);
  const res = await fetch(URL, {
    method:  'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-timestamp':  timestamp,
      'x-nonce':      nonce,
      'x-signature':  sig,
    },
    body: bodyStr,
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

let failures = 0;

function line(label: string, r: Result, expectOk: boolean) {
  const ok  = expectOk ? r.status < 400 : r.status >= 400;
  if (!ok) failures++;
  const ico = ok ? '✅' : '❌';
  const msg = (r.data?.message ?? JSON.stringify(r.data)).slice(0, 70);
  console.log(`  ${ico}  ${label.padEnd(44)} ${String(r.status).padStart(3)}  ${msg}`);
}

async function main() {
  console.log('\n════════════════════════════════════════════════');
  console.log('  guard-nest — ReplayProtectionGuard Test');
  console.log('  timestamp + nonce + HMAC-SHA256');
  console.log('════════════════════════════════════════════════\n');

  // ── Caso 1: Request válida ──────────────────────────────────────────────
  const ts1    = now();
  const nonce1 = freshNonce();
  const body1  = JSON.stringify({ amount: 100, to: 'alice' });
  const sig1   = sign(ts1, nonce1, body1);
  const r1     = await req(ts1, nonce1, sig1, { amount: 100, to: 'alice' });

  // ── Caso 2: Replay exacto — mismo nonce ────────────────────────────────
  const r2 = await req(ts1, nonce1, sig1, { amount: 100, to: 'alice' });

  // ── Caso 3: Timestamp vencido ──────────────────────────────────────────
  const oldTs  = (parseInt(now()) - 400).toString(); // 400s atrás > maxAge 300s
  const nonce3 = freshNonce();
  const body3  = JSON.stringify({ amount: 50 });
  const sig3   = sign(oldTs, nonce3, body3);
  const r3     = await req(oldTs, nonce3, sig3, { amount: 50 });

  // ── Caso 4: Firma inválida ─────────────────────────────────────────────
  const ts4    = now();
  const nonce4 = freshNonce();
  const body4  = JSON.stringify({ amount: 200 });
  const sig4   = sign(ts4, nonce4, body4).replace(/.$/, 'X'); // corromper 1 char
  const r4     = await req(ts4, nonce4, sig4, { amount: 200 });

  // ── Caso 5: Body modificado después de firmar ─────────────────────────
  const ts5    = now();
  const nonce5 = freshNonce();
  const body5  = JSON.stringify({ amount: 100 });
  const sig5   = sign(ts5, nonce5, body5);
  const r5     = await req(ts5, nonce5, sig5, { amount: 9999 }); // body diferente al firmado

  // ── Caso 6: Nonce reemplazado (ataque que SignatureGuard solo no atrapa)
  // Con SignatureGuard solo: firma sobre timestamp.body → nonce no está en la firma
  // → atacante puede poner un nonce fresco y la firma sigue siendo válida.
  // Con ReplayProtectionGuard: nonce está en la firma → reemplazarlo rompe la verificación.
  const ts6     = now();
  const nonce6  = freshNonce(); // nonce original (firmado)
  const body6   = JSON.stringify({ amount: 100 });
  const sig6    = sign(ts6, nonce6, body6);
  const nonce6b = freshNonce(); // atacante reemplaza el nonce
  const r6      = await req(ts6, nonce6b, sig6, { amount: 100 }); // firma no cuadra

  // ── Caso 7: Header faltante ───────────────────────────────────────────
  const res7 = await fetch(URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'x-timestamp': now(), 'x-nonce': freshNonce() },
    body: '{"amount":1}',
  });
  const r7: Result = { status: res7.status, data: await res7.json().catch(() => ({})) };

  // ── Imprimir resultados ────────────────────────────────────────────────
  console.log('  ' + '─'.repeat(80));
  line('Request válida                        →  200', r1, true);
  line('Replay exacto (mismo nonce)           →  401', r2, false);
  line('Timestamp vencido (>5min)             →  401', r3, false);
  line('Firma corrupta                        →  401', r4, false);
  line('Body modificado post-firma            →  401', r5, false);
  line('Nonce reemplazado (nonce swap attack) →  401', r6, false);
  line('Falta x-signature header             →  401', r7, false);
  console.log('  ' + '─'.repeat(80));

  console.log('\n── Por qué el nonce-swap attack falla ──\n');
  console.log('  SignatureGuard firma: timestamp.body');
  console.log('  → atacante puede quitar x-nonce y poner uno fresco');
  console.log('  → firma válida + nonce pasa el check → ✅ ataque exitoso\n');
  console.log('  ReplayProtectionGuard firma: timestamp.nonce.body');
  console.log('  → reemplazar el nonce cambia el mensaje firmado');
  console.log('  → firma ya no cuadra → ❌ ataque bloqueado');

  console.log('\n════════════════════════════════════════════════\n');
}

main()
  .then(() => { if (failures > 0) { console.error(`\n❌ ${failures} test(s) failed`); process.exit(1); } })
  .catch((e: unknown) => { console.error(e); process.exit(1); });