/**
 * test-signature.ts — Prueba SignatureGuard (HMAC-SHA256)
 *
 * Run: npx ts-node scripts/test-signature.ts
 *
 * Demuestra el flujo completo cliente→servidor:
 *   1. Stripe-style  (x-timestamp + x-signature = HMAC(timestamp.body))
 *   2. GitHub-style  (x-hub-signature-256 = sha256=HMAC(body))
 *   3. Replay attack (mismo timestamp viejo → rechazado)
 *   4. Firma inválida
 */

import { createHmac } from 'crypto';

const BASE = 'http://localhost:3000';

// ── Helpers ────────────────────────────────────────────────────────────────

function hmac(secret: string, message: string, algo = 'sha256'): string {
  return createHmac(algo, secret).update(message).digest('hex');
}

async function post(
  path: string,
  body: unknown,
  headers: Record<string, string>,
): Promise<{ status: number; data: unknown }> {
  const rawBody = JSON.stringify(body);
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: rawBody,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

function log(status: number, label: string, data?: unknown) {
  const icon = status < 400 ? '✅' : status === 401 ? '🔐' : '❌';
  console.log(`${icon} [${status}] ${label}`);
  if (status >= 400) console.log('   →', JSON.stringify(data).slice(0, 100));
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n════════════════════════════════════════════');
  console.log('  guard-nest — Signature Guard Test Suite');
  console.log('════════════════════════════════════════════\n');

  const stripeSecret = 'demo-webhook-secret';
  const githubSecret = 'demo-github-secret';
  const payload = { event: 'payment.success', amount: 9900, currency: 'usd' };
  const rawBody = JSON.stringify(payload);

  // ── Stripe style ────────────────────────────────────────────────────────
  console.log('── Stripe style  (x-timestamp + x-signature = HMAC(ts.body)) ──\n');

  {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const message   = `${timestamp}.${rawBody}`;
    const sig       = hmac(stripeSecret, message);

    const { status, data } = await post('/demo/level2/webhook/stripe-style', payload, {
      'x-timestamp': timestamp,
      'x-signature': sig,
    });
    log(status, 'Firma correcta → PASS', data);
  }

  {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const message   = `${timestamp}.${rawBody}`;
    const sig       = hmac('wrong-secret', message);

    const { status, data } = await post('/demo/level2/webhook/stripe-style', payload, {
      'x-timestamp': timestamp,
      'x-signature': sig,
    });
    log(status, 'Firma con secret incorrecto → 401', data);
  }

  {
    // Timestamp de hace 10 minutos → fuera de la ventana de 5min
    const oldTimestamp = (Math.floor(Date.now() / 1000) - 600).toString();
    const message      = `${oldTimestamp}.${rawBody}`;
    const sig          = hmac(stripeSecret, message);

    const { status, data } = await post('/demo/level2/webhook/stripe-style', payload, {
      'x-timestamp': oldTimestamp,
      'x-signature': sig,
    });
    log(status, 'Replay attack (timestamp 10min viejo) → 401', data);
  }

  {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const { status, data } = await post('/demo/level2/webhook/stripe-style', payload, {
      'x-timestamp': timestamp,
      // sin x-signature
    });
    log(status, 'Sin header x-signature → 401', data);
  }

  {
    // Body manipulado después de firmar
    const timestamp      = Math.floor(Date.now() / 1000).toString();
    const originalMessage = `${timestamp}.${rawBody}`;
    const sig            = hmac(stripeSecret, originalMessage);
    const tamperedPayload = { ...payload, amount: 1 }; // ← amount modificado

    const { status, data } = await post('/demo/level2/webhook/stripe-style', tamperedPayload, {
      'x-timestamp': timestamp,
      'x-signature': sig,
    });
    log(status, 'Body modificado tras firmar (integridad) → 401', data);
  }

  // ── GitHub style ─────────────────────────────────────────────────────────
  console.log('\n── GitHub style  (x-hub-signature-256: sha256=HMAC(body)) ──\n');

  {
    const sig = 'sha256=' + hmac(githubSecret, rawBody);

    const { status, data } = await post('/demo/level2/webhook/github-style', payload, {
      'x-hub-signature-256': sig,
    });
    log(status, 'Firma GitHub correcta → PASS', data);
  }

  {
    const sig = 'sha256=' + hmac('wrong-secret', rawBody);

    const { status, data } = await post('/demo/level2/webhook/github-style', payload, {
      'x-hub-signature-256': sig,
    });
    log(status, 'Firma GitHub con secret incorrecto → 401', data);
  }

  {
    // signaturePrefix solo se QUITA si está presente — enviar sin él también funciona
    const sig = hmac(githubSecret, rawBody); // sin prefijo 'sha256='

    const { status, data } = await post('/demo/level2/webhook/github-style', payload, {
      'x-hub-signature-256': sig,
    });
    log(status, 'Sin prefijo sha256= → PASS (prefijo es opcional, no obligatorio)', data);
  }

  console.log('\n════════════════════════════════════════════');
  console.log('  Done');
  console.log('════════════════════════════════════════════\n');
}

main().catch(console.error);
