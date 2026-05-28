/**
 * test-audit-log.ts — Prueba AuditLogInterceptor
 *
 * Run: npx ts-node scripts/test-audit-log.ts
 *
 * AuditLogInterceptor nunca bloquea — siempre pasa la request.
 * El audit trail aparece en la CONSOLA DEL SERVIDOR.
 *
 * Este script muestra:
 *   - El X-Trace-Id que retorna cada respuesta
 *   - El status HTTP de cada request
 *   - Instrucciones para correlacionar con los logs del servidor
 *
 * En la consola del servidor verás líneas del tipo:
 *   [AuditLogInterceptor] AUDIT  trace=a1b2c3d4  userId=null  action="demo:read-sensitive-data"
 *     resource=demo  ip=127.0.0.1  status=201  ms=3  outcome=success
 */

const BASE = 'http://localhost:3000';

interface Result {
  status:  number;
  traceId: string;
  data:    any;
}

async function send(
  method: 'GET' | 'POST',
  path:   string,
  body?:  Record<string, unknown>,
): Promise<Result> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return {
    status:  res.status,
    traceId: res.headers.get('x-trace-id') ?? '—',
    data:    await res.json().catch(() => ({})),
  };
}

function row(label: string, r: Result) {
  const outcome = r.status < 400 ? 'success ✅' : 'error   ⚠️ ';
  console.log(
    `  ${outcome}  ${label.padEnd(44)}` +
    `  HTTP ${r.status}  trace=${r.traceId}`,
  );
}

async function main() {
  console.log('\n════════════════════════════════════════════════════');
  console.log('  guard-nest — AuditLogInterceptor Test');
  console.log('  Audit trail → CONSOLA DEL SERVIDOR');
  console.log('════════════════════════════════════════════════════\n');

  // ── Requests ──────────────────────────────────────────────────────────────
  const r1 = await send('POST', '/demo/level2/audit-success', {
    userId: 'usr_42',
    amount: 100,
    to:     'alice',
  });

  const r2 = await send('POST', '/demo/level2/audit-success', {
    username: 'admin',
    password: 'secret123',    // este campo será [REDACTED] en el log
    token:    'jwt.abc.xyz',  // este también
  });

  const r3 = await send('POST', '/demo/level2/audit-fail', {
    action: 'delete-all-users',
  });

  // ── Resultados ────────────────────────────────────────────────────────────
  console.log('── Requests enviadas ──\n');
  console.log('  ' + '─'.repeat(70));
  row('POST /audit-success (body normal)',         r1);
  row('POST /audit-success (body con password)',   r2);
  row('POST /audit-fail   (handler lanza 403)',    r3);
  console.log('  ' + '─'.repeat(70));

  console.log('\n── Cómo leer los logs del servidor ──\n');
  console.log('  Busca en la consola donde corre npm run start:dev:\n');
  console.log('  [AuditLogInterceptor] AUDIT  trace=<id>  userId=null');
  console.log('    action="demo:read-sensitive-data"  resource=demo');
  console.log('    ip=127.0.0.1  status=201  ms=<N>  outcome=success');
  console.log('    body={"userId":"usr_42","amount":100,"to":"alice"}\n');
  console.log('  Para el request con password:');
  console.log('    body={"username":"admin","password":"[REDACTED]","token":"[REDACTED]"}\n');
  console.log('  Para el request que falló:');
  console.log('    status=403  outcome=error  error="Acceso denegado — sin permisos"\n');

  console.log('── X-Trace-Id para correlación ──\n');
  console.log(`  Request 1: ${r1.traceId}`);
  console.log(`  Request 2: ${r2.traceId}`);
  console.log(`  Request 3: ${r3.traceId}`);
  console.log('\n  Busca estos IDs en los logs del servidor para localizar cada request.\n');

  console.log('── Uso enterprise con custom logger ──\n');
  console.log('  @AuditLog({');
  console.log('    resource: "transfer",');
  console.log('    logger: async (entry) => {');
  console.log('      await db.auditLogs.insert(entry);');
  console.log('      // o: await cloudwatch.putLogEvents(...)');
  console.log('    },');
  console.log('  })');

  console.log('\n════════════════════════════════════════════════════\n');
}

main().catch(console.error);
