# guard-nest

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)
![NestJS](https://img.shields.io/badge/NestJS-11.x-E0234E?logo=nestjs&logoColor=white)
![Build](https://img.shields.io/badge/build-passing-brightgreen)
![Guards](https://img.shields.io/badge/guards-30-blueviolet)

Colección de guards NestJS de referencia — desde autenticación básica hasta detección de bots y análisis de wallets cripto.

**No es un paquete npm.** Encuentras el guard que necesitas, copias el archivo a tu proyecto y lo adaptas. Nada más.

---

## Quick Start

```bash
git clone https://github.com/greenDGG/guards-nestjs.git
cd guard-nest
npm install
cp .env.example .env
npm run start:dev
```

Servidor en `http://localhost:3000`. Cada nivel tiene un controller de demo listo para explorar.

```bash
# Login para obtener token JWT
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}'
```

| Usuario | Contraseña | Roles |
|---------|-----------|-------|
| `admin` | `admin123` | admin |
| `user`  | `user123`  | user  |
| `guest` | `guest123` | guest |

---

## Guards

| # | Nivel | Guard | Demo endpoint |
|---|-------|-------|---------------|
| 1 | Basic | `JwtAuthGuard` | `GET /demo/level1/protected` |
| 2 | Basic | `RolesGuard` | `GET /demo/level1/admin-only` |
| 3 | Basic | `PermissionsGuard` | `GET /demo/level1/with-permissions` |
| 4 | Basic | `ApiKeyGuard` | `GET /demo/level1/api-key` |
| 5 | Basic | `BasicAuthGuard` | `GET /demo/level1/basic-auth` |
| 6 | Basic | `OwnershipGuard` | `GET /demo/level1/users/:id/profile` |
| 7 | Basic | `SignatureGuard` | `POST /demo/level2/webhook/stripe-style` |
| 8 | Basic | `IdempotencyInterceptor` | `POST /demo/level2/payment` |
| 9 | Basic | `NonceGuard` | `POST /demo/level2/nonce-check` |
| 10 | Basic | `ConcurrencyInterceptor` | `POST /demo/level2/heavy-job` |
| 11 | Security | `IpGuard` | `GET /demo/level2/ip-whitelist` |
| 12 | Security | `HttpsOnlyGuard` | `GET /demo/level2/https-only` |
| 13 | Security | `RequestSizeGuard` | `POST /demo/level2/request-size` |
| 14 | Security | `ContentTypeGuard` | `POST /demo/level2/content-type` |
| 15 | Security | `CorsGuard` | `GET /demo/level2/cors` |
| 16 | Rate Limit | `SlidingWindowRateLimitGuard` | `GET /demo/level3/sliding` |
| 17 | Rate Limit | `AdaptiveRateLimitGuard` | `GET /demo/level3/adaptive` |
| 18 | Rate Limit | `CircuitBreakerGuard` | `GET /demo/level3/circuit` |
| 19 | Detection | `BotDetectionGuard` | `GET /demo/level4/bot-check` |
| 20 | Detection | `GeoIpGuard` | `GET /demo/level4/geo` |
| 21 | Detection | `DeviceFingerprintGuard` | `GET /demo/level4/fingerprint` |
| 22 | Detection | `AnomalyDetectionGuard` | `GET /demo/level4/anomaly` |
| 23 | Business | `SubscriptionGuard` | `GET /demo/level5/pro-feature` |
| 24 | Business | `TimeBasedAccessGuard` | `GET /demo/level5/office-hours` |
| 25 | Business | `TenantGuard` | `GET /demo/level5/:tenantId/data` |
| 26 | Business | `MfaGuard` | `POST /demo/level5/sensitive-action` |
| 27 | Web3 | `WalletSignatureGuard` | `POST /demo/level6/wallet-action` |
| 28 | Web3 | `SuspiciousTransactionGuard` | `POST /demo/level6/withdraw` |
| 29 | Web3 | `TokenHolderGuard` | `GET /demo/level6/token-gate` |
| 30 | Web3 | `ChainIdGuard` | `POST /demo/level6/swap` |

---

## Cómo funciona

**Vista simple** — la mayoría de endpoints solo necesitan esto:

```
Request → JwtAuthGuard → RolesGuard → Controller
                ↓               ↓
              401             403
```

**Vista avanzada** — las capas disponibles, en orden recomendado:

```
Network → RateLimit → Detection → Auth → Roles → Business → Handler
  (Lv 2)    (Lv 3)     (Lv 4)   (Lv 1)  (Lv 1)   (Lv 5-6)
```

Cada capa es opcional. Usas solo las que necesita tu endpoint.

---

## Arquitectura

```
src/
├── guards/
│   ├── basic/        # JWT, Roles, Perms, ApiKey, BasicAuth, Ownership, Signature, Idempotency, Nonce, Concurrency
│   ├── security/     # IP, HTTPS, RequestSize, ContentType, CORS
│   ├── rate-limit/   # SlidingWindow, Adaptive, CircuitBreaker
│   ├── detection/    # BotDetection, GeoIP, DeviceFingerprint, Anomaly
│   ├── business/     # Subscription, TimeAccess, Tenant, MFA
│   └── web3/         # WalletSignature, SuspiciousTx, TokenHolder, ChainId
├── services/         # Shared: IpExtractor, RedisStore, BotDetection, GeoIp, Anomaly, Web3Rpc, Etherscan
├── decorators/       # @Public, @Roles, @Owner, @Signature, @Idempotent, @Nonce, @Concurrent, ...
├── exceptions/       # Typed exceptions per category
├── interfaces/       # JwtPayload, SecurityContext, User, ...
├── examples/         # Demo controllers (one per level)
└── scripts/          # Test scripts (one per guard category)
```

### SecurityContext

Todos los guards comparten estado por request vía `request.securityContext`:

```typescript
{
  ip, requestId, requestedAt,
  botScore, isBot,           // BotDetectionGuard
  geo,                       // GeoIpGuard
  trustScore,                // AdaptiveRateLimitGuard
  deviceFingerprint,         // DeviceFingerprintGuard
}
```

Accesible en cualquier handler con `@SecurityCtx()`.

---

## Test Scripts

```bash
npm run test:normal        # happy path — todos los niveles
npm run test:bot           # BotDetectionGuard — 14 casos
npm run test:rate-limit    # SlidingWindow + CircuitBreaker
npm run test:signature     # HMAC Signature — Stripe y GitHub style
npm run test:idempotency   # IdempotencyInterceptor — 5 escenarios
npm run test:nonce         # NonceGuard — replay attacks
npm run test:concurrency   # ConcurrencyInterceptor — race conditions
npm run test:web3          # WalletSignature — flujo completo EIP-191
```

---

## Documentación por guard

Cada guard tiene su propia doc en `docs/`:

| Categoría | Docs |
|-----------|------|
| Basic | [JWT](docs/guards/basic/jwt-auth.md) · [Roles](docs/guards/basic/roles.md) · [Permissions](docs/guards/basic/permissions.md) · [ApiKey](docs/guards/basic/api-key.md) · [BasicAuth](docs/guards/basic/basic-auth.md) |
| Basic+ | [Ownership](docs/guards/basic/ownership.md) · [Signature](docs/guards/basic/signature.md) · [Idempotency](docs/guards/basic/idempotency.md) · [Nonce](docs/guards/basic/nonce.md) · [Concurrency](docs/guards/basic/concurrency.md) |
| Security | [IP/CIDR](docs/guards/security/ip.md) · [HTTPS](docs/guards/security/https-only.md) · [RequestSize](docs/guards/security/request-size.md) · [ContentType](docs/guards/security/content-type.md) · [CORS](docs/guards/security/cors.md) · [TimingAttack](docs/guards/security/timing-attack.md) |
| Rate Limit | [SlidingWindow](docs/guards/rate-limit/sliding-window.md) · [Adaptive](docs/guards/rate-limit/adaptive.md) · [CircuitBreaker](docs/guards/rate-limit/circuit-breaker.md) |
| Detection | [BotDetection](docs/guards/detection/bot-detection.md) · [GeoIP](docs/guards/detection/geo-ip.md) · [DeviceFingerprint](docs/guards/detection/device-fingerprint.md) · [Anomaly](docs/guards/detection/anomaly-detection.md) |
| Business | [Subscription](docs/guards/business/subscription.md) · [TimeAccess](docs/guards/business/time-access.md) · [Tenant](docs/guards/business/tenant.md) · [MFA](docs/guards/business/mfa.md) |
| Web3 | [WalletSignature](docs/guards/web3/wallet-signature.md) · [SuspiciousTx](docs/guards/web3/suspicious-transaction.md) · [TokenHolder](docs/guards/web3/token-holder.md) · [ChainId](docs/guards/web3/chain-id.md) |
| Services | [RedisStore](docs/services/redis-store.md) · [IpExtractor](docs/services/ip-extractor.md) · [SecurityContext](docs/services/security-context.md) |

---

## Dependencias opcionales

| Guard | Comando |
|-------|---------|
| `WalletSignatureGuard` | `npm install ethers` |
| `RedisStoreService` en multi-instancia | `npm install ioredis` |

---

## Licencia

MIT
