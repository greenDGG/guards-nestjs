/**
 * test-api-key.ts — Prueba ApiKeyGuard
 *
 * Run: npx ts-node scripts/test-api-key.ts
 *
 * Pre-requisito: genera tu API key primero:
 *   npx ts-node scripts/generate-api-key.ts
 *
 * Escenarios:
 *   1. Key válida (desde .env)       → ✅ 200
 *   2. Key inválida                  → ❌ 401
 *   3. Sin header x-api-key          → ❌ 401
 *   4. Key multi — key-servicio-a    → ✅ 200
 *   5. Key multi — key-servicio-b    → ✅ 200
 *   6. Key multi — key del .env      → ✅ 200 (env siempre incluida)
 *   7. Key multi — key desconocida   → ❌ 401
 */

import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const BASE    = 'http://localhost:3000';
if (!process.env.API_KEY) {
  console.error('\n❌ API_KEY no encontrada en .env');
  console.error('   Genera una con: npx ts-node scripts/generate-api-key.ts\n');
  process.exit(1);
}

const API_KEY = process.env.API_KEY as string;

async function get(
  path: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; data: unknown }> {
  const res = await fetch(`${BASE}${path}`, { headers });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

function log(status: number, label: string, extra?: string) {
  const icon = status === 200 ? '✅' : status === 401 ? '🔐' : '⚠️ ';
  console.log(`${icon} [${status}] ${label}${extra ? `  —  ${extra}` : ''}`);
}

async function main() {
  console.log('\n════════════════════════════════════════════');
  console.log('  guard-nest — API Key Guard Test Suite');
  console.log('════════════════════════════════════════════\n');
  console.log(`  API_KEY cargada: ${API_KEY.slice(0, 8)}...\n`);

  // ── /demo/level1/api-key — solo env var ──────────────────────────────────
  console.log('── GET /demo/level1/api-key  (env-only) ──\n');

  // 1. Key válida desde .env → 200
  {
    const { status } = await get('/demo/level1/api-key', { 'x-api-key': API_KEY });
    log(status, `Key válida (${API_KEY.slice(0, 8)}...) → PASS`);
  }

  // 2. Key inválida → 401
  {
    const { status, data } = await get('/demo/level1/api-key', { 'x-api-key': 'key-incorrecta' });
    log(status, 'Key inválida "key-incorrecta" → BLOCKED', (data as any)?.message);
  }

  // 3. Sin header → 401
  {
    const { status, data } = await get('/demo/level1/api-key');
    log(status, 'Sin x-api-key header → BLOCKED', (data as any)?.message);
  }

  // ── /demo/level1/api-key-multi — múltiples keys ───────────────────────────
  console.log('\n── GET /demo/level1/api-key-multi  (multi-key + env) ──\n');

  // 4. key-servicio-a → 200
  {
    const { status } = await get('/demo/level1/api-key-multi', { 'x-api-key': 'key-servicio-a' });
    log(status, '"key-servicio-a" → PASS (key hardcodeada)');
  }

  // 5. key-servicio-b → 200
  {
    const { status } = await get('/demo/level1/api-key-multi', { 'x-api-key': 'key-servicio-b' });
    log(status, '"key-servicio-b" → PASS (key hardcodeada)');
  }

  // 6. env key también funciona en multi-key → 200
  {
    const { status } = await get('/demo/level1/api-key-multi', { 'x-api-key': API_KEY });
    log(status, `Key del .env en endpoint multi → PASS (env siempre incluida)`);
  }

  // 7. Key desconocida en multi → 401
  {
    const { status, data } = await get('/demo/level1/api-key-multi', { 'x-api-key': 'key-fantasma' });
    log(status, '"key-fantasma" en multi → BLOCKED', (data as any)?.message);
  }

  // ── Resumen ───────────────────────────────────────────────────────────────
  console.log('\n════════════════════════════════════════════');
  console.log('  Comportamiento esperado:');
  console.log('    Tests 1, 4, 5, 6 → 200 ✅');
  console.log('    Tests 2, 3, 7    → 401 🔐');
  console.log('════════════════════════════════════════════\n');
}

main().catch(console.error);
