/**
 * generate-api-key.ts — Genera una API key criptográficamente segura
 *
 * Run: npx ts-node scripts/generate-api-key.ts
 *
 * Escribe automáticamente API_KEY en el .env del proyecto.
 * Si ya existe, la sobreescribe con una nueva key.
 */

import { randomBytes } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

const ENV_PATH = path.join(__dirname, '..', '.env');
const KEY_VAR  = 'API_KEY';

// ── Generar key ───────────────────────────────────────────────────────────────
// 32 bytes → 64 chars hex — suficiente entropía para producción
const apiKey = randomBytes(32).toString('hex');

// ── Leer .env actual ──────────────────────────────────────────────────────────
let envContent = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf-8') : '';

const keyLine  = `${KEY_VAR}=${apiKey}`;
const regex    = new RegExp(`^${KEY_VAR}=.*$`, 'm');

if (regex.test(envContent)) {
  // Reemplaza la línea existente
  envContent = envContent.replace(regex, keyLine);
} else {
  // Agrega la sección al final
  envContent = envContent.trimEnd() + `\n\n# API Key Guard\n${keyLine}\n`;
}

fs.writeFileSync(ENV_PATH, envContent, 'utf-8');

// ── Output ────────────────────────────────────────────────────────────────────
console.log('\n══════════════════════════════════════════════════════');
console.log('  guard-nest — API Key Generator');
console.log('══════════════════════════════════════════════════════\n');
console.log(`  Key generada (64 chars hex, 256 bits de entropía):\n`);
console.log(`  ${apiKey}\n`);
console.log(`  ✅ Escrita en .env → ${KEY_VAR}=${apiKey.slice(0, 8)}...`);
console.log(`\n  Para probarla:`);
console.log(`    npm run start:dev`);
console.log(`    npm run test:api-key`);
console.log('\n══════════════════════════════════════════════════════\n');
