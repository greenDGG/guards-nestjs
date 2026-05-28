/**
 * guard-nest — Colección de guards NestJS de referencia
 * Copia el guard que necesites a tu proyecto y adáptalo.
 *
 * Guards organizados por nivel de complejidad:
 *   Level 1 — Basic:     JWT, Roles, Permissions, ApiKey, BasicAuth
 *   Level 2 — Security:  IP, HTTPS-Only, RequestSize, ContentType, CORS
 *   Level 3 — Rate:      SlidingWindow, Adaptive, CircuitBreaker
 *   Level 4 — Detection: BotDetection, GeoIP, DeviceFingerprint, Anomaly
 *   Level 5 — Business:  Subscription, TimeAccess, Tenant, MFA
 *   Level 6 — Web3:      WalletSignature, SuspiciousTransaction, TokenHolder, ChainId
 */

// ─── Module ──────────────────────────────────────────────────────────────────
export { GuardNestModule } from './guard-nest.module';
export type { GuardNestModuleOptions } from './guard-nest.module';

// ─── Level 1: Basic Guards ────────────────────────────────────────────────────
export { JwtAuthGuard } from './guards/basic/jwt-auth.guard';
export { RolesGuard } from './guards/basic/roles.guard';
export { PermissionsGuard } from './guards/basic/permissions.guard';
export { ApiKeyGuard } from './guards/basic/api-key.guard';
export { BasicAuthGuard } from './guards/basic/basic-auth.guard';
export type { BasicAuthOptions } from './guards/basic/basic-auth.guard';
export { OwnershipGuard } from './guards/basic/ownership.guard';
export { SignatureGuard } from './guards/basic/signature.guard';
export { IdempotencyInterceptor } from './guards/basic/idempotency.interceptor';
export { NonceGuard } from './guards/basic/nonce.guard';
export { ConcurrencyInterceptor } from './guards/basic/concurrency.interceptor';

// ─── Level 2: Security Guards ─────────────────────────────────────────────────
export { IpGuard } from './guards/security/ip.guard';
export { HttpsOnlyGuard } from './guards/security/https-only.guard';
export { RequestSizeGuard } from './guards/security/request-size.guard';
export type { RequestSizeOptions } from './guards/security/request-size.guard';
export { ContentTypeGuard } from './guards/security/content-type.guard';
export type { ContentTypeOptions } from './guards/security/content-type.guard';
export { CorsGuard } from './guards/security/cors.guard';
export type { CorsGuardOptions } from './guards/security/cors.guard';
export { TimingAttackGuard, TimingAttackInterceptor } from './guards/security/timing-attack.guard';
export type { TimingAttackOptions } from './guards/security/timing-attack.guard';
export { CsrfGuard, generateCsrfToken } from './guards/security/csrf.guard';
export type { CsrfOptions } from './guards/security/csrf.guard';
export { ReplayProtectionGuard } from './guards/basic/replay-protection.guard';
export { ReplayProtect } from './decorators/replay-protection.decorator';
export type { ReplayProtectionOptions } from './decorators/replay-protection.decorator';

// ─── Level 3: Rate Limiting Guards ───────────────────────────────────────────
export { SlidingWindowRateLimitGuard } from './guards/rate-limit/sliding-window-rate-limit.guard';
export type { SlidingWindowOptions } from './guards/rate-limit/sliding-window-rate-limit.guard';
export { AdaptiveRateLimitGuard } from './guards/rate-limit/adaptive-rate-limit.guard';
export type { AdaptiveRateLimitOptions, SignalTier } from './guards/rate-limit/adaptive-rate-limit.guard';
export { DEFAULT_TRUST_TIERS, DEFAULT_BOT_TIERS } from './guards/rate-limit/adaptive-rate-limit.guard';
export { CircuitBreakerGuard, CircuitBreakerInterceptor } from './guards/rate-limit/circuit-breaker.guard';
export type { CircuitBreakerOptions } from './guards/rate-limit/circuit-breaker.guard';

// ─── Level 4: Detection Guards ────────────────────────────────────────────────
export { BotDetectionGuard } from './guards/detection/bot-detection.guard';
export { GeoIpGuard } from './guards/detection/geo-ip.guard';
export type { GeoIpGuardOptions } from './guards/detection/geo-ip.guard';
export { DeviceFingerprintGuard } from './guards/detection/device-fingerprint.guard';
export type { DeviceFingerprintOptions } from './guards/detection/device-fingerprint.guard';
export { AnomalyDetectionGuard } from './guards/detection/anomaly-detection.guard';
export type { AnomalyDetectionOptions } from './guards/detection/anomaly-detection.guard';

// ─── Level 5: Business Guards ─────────────────────────────────────────────────
export { SubscriptionGuard } from './guards/business/subscription.guard';
export { TimeBasedAccessGuard } from './guards/business/time-based-access.guard';
export type { TimeAccessOptions, TimeWindow } from './guards/business/time-based-access.guard';
export { TenantGuard } from './guards/business/tenant.guard';
export type { TenantOptions } from './guards/business/tenant.guard';
export { MfaGuard } from './guards/business/mfa.guard';
export type { MfaOptions } from './guards/business/mfa.guard';

// ─── Level 6: Web3 Guards ─────────────────────────────────────────────────────
export { ChainIdGuard } from './guards/web3/chain-id.guard';
export { WalletSignatureGuard, issueWalletNonce } from './guards/web3/wallet-signature.guard';
export type { WalletSignatureOptions } from './guards/web3/wallet-signature.guard';
export { SuspiciousTransactionGuard } from './guards/web3/suspicious-transaction.guard';
export type { SuspiciousTransactionOptions } from './guards/web3/suspicious-transaction.guard';
export { TokenHolderGuard } from './guards/web3/token-holder.guard';

// ─── Decorators ───────────────────────────────────────────────────────────────
export { Public, IS_PUBLIC_KEY } from './decorators/public.decorator';
export { Roles } from './decorators/roles.decorator';
export { Permissions } from './decorators/permissions.decorator';
export { CurrentUser } from './decorators/current-user.decorator';
export { ApiKey } from './decorators/api-key.decorator';
export type { ApiKeyOptions } from './decorators/api-key.decorator';
export { SecurityCtx } from './decorators/security-context.decorator';
export type { SecurityContext } from './interfaces/security-context.interface';
export { Owner } from './decorators/owner.decorator';
export type { OwnershipOptions } from './decorators/owner.decorator';
export { Signature } from './decorators/signature.decorator';
export type { SignatureOptions } from './decorators/signature.decorator';
export { Idempotent } from './decorators/idempotency.decorator';
export type { IdempotencyOptions } from './decorators/idempotency.decorator';
export { Nonce } from './decorators/nonce.decorator';
export type { NonceOptions } from './decorators/nonce.decorator';
export { Concurrent } from './decorators/concurrent.decorator';
export type { ConcurrencyOptions } from './decorators/concurrent.decorator';
export { IpFilter } from './decorators/ip.decorator';
export type { IpGuardOptions } from './decorators/ip.decorator';
export { RequireSubscription } from './decorators/subscription.decorator';
export type { SubscriptionOptions } from './decorators/subscription.decorator';
export { RequireChain } from './decorators/chain-id.decorator';
export type { ChainIdOptions } from './decorators/chain-id.decorator';
export { RequireTokenBalance } from './decorators/token-holder.decorator';
export type { TokenHolderOptions } from './decorators/token-holder.decorator';

// ─── Interfaces ───────────────────────────────────────────────────────────────
export type { JwtPayload } from './interfaces/jwt-payload.interface';
export type { User } from './interfaces/user.interface';
export type { Permission } from './interfaces/permission.interface';

// ─── Exceptions ───────────────────────────────────────────────────────────────
export {
  InvalidCredentialsException,
  TokenExpiredException,
  TokenNotFoundException,
  InvalidTokenException,
} from './exceptions/auth.exception';
export {
  InsufficientRolesException,
  InsufficientPermissionsException,
  AccessDeniedException,
} from './exceptions/permissions.exception';
export { ThrottleException, RateLimitExceededException } from './exceptions/throttle.exception';
export {
  IpBlockedException,
  HttpsRequiredException,
  RequestTooLargeException,
  InvalidContentTypeException,
  CorsOriginBlockedException,
  InvalidApiKeyException,
  InvalidBasicAuthException,
  InvalidSignatureException,
  SignatureExpiredException,
  SignatureMissingException,
  IdempotencyKeyMissingException,
  IdempotencyConflictException,
  ReplayAttackException,
  NonceMissingException,
  NonceInvalidException,
  ConcurrencyLimitException,
  CsrfTokenException,
} from './exceptions/security.exception';
export {
  BotDetectedException,
  GeoIpBlockedException,
  FingerprintChangedException,
  CircuitOpenException,
} from './exceptions/detection.exception';
export {
  SubscriptionRequiredException,
  AccessOutsideAllowedHoursException,
  TenantMismatchException,
  MfaRequiredException,
} from './exceptions/business.exception';
export {
  InvalidWalletSignatureException,
  WalletNonceExpiredException,
  SuspiciousWalletException,
  InsufficientTokenBalanceException,
  InvalidChainIdException,
} from './exceptions/web3.exception';

// ─── Services (injectable) ────────────────────────────────────────────────────
export { AuthService } from './services/auth.service';
export { JwtService } from './services/jwt.service';
export { PermissionsService } from './services/permissions.service';
export { PermissionsCacheService } from './services/permissions-cache.service';
export { IpExtractorService } from './services/ip-extractor.service';
export { RedisStoreService } from './services/redis-store.service';
export { BotDetectionService } from './services/bot-detection.service';
export type { BotDetectionOptions, BotSignalWeights } from './services/bot-detection.service';
export { GeoIpService } from './services/geo-ip.service';
export { AnomalyDetectionService } from './services/anomaly-detection.service';
export { Web3RpcService } from './services/web3-rpc.service';
export { EtherscanService } from './services/etherscan.service';
export { SecurityContextService } from './services/security-context.service';

// ─── Constants ────────────────────────────────────────────────────────────────
export { AUTH_CONSTANTS } from './constants/auth.constants';
export { GUARD_METADATA } from './constants/guard.constants';
export {
  CHAIN_IDS,
  KNOWN_MIXER_ADDRESSES,
  KNOWN_BRIDGE_ADDRESSES,
  LARGE_TRANSFER_THRESHOLDS,
} from './constants/web3.constants';
