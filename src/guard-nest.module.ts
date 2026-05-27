import { DynamicModule, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { APP_GUARD } from '@nestjs/core';

// Services
import { AuthService } from './services/auth.service';
import { JwtService as CustomJwtService } from './services/jwt.service';
import { PermissionsService } from './services/permissions.service';
import { PermissionsCacheService } from './services/permissions-cache.service';
import { IpExtractorService } from './services/ip-extractor.service';
import { RedisStoreService } from './services/redis-store.service';
import { BotDetectionService } from './services/bot-detection.service';
import { GeoIpService } from './services/geo-ip.service';
import { AnomalyDetectionService } from './services/anomaly-detection.service';
import { Web3RpcService } from './services/web3-rpc.service';
import { EtherscanService } from './services/etherscan.service';
import { SecurityContextService } from './services/security-context.service';

// Guards / Interceptors
import { JwtAuthGuard } from './guards/basic/jwt-auth.guard';
import { RolesGuard } from './guards/basic/roles.guard';
import { PermissionsGuard } from './guards/basic/permissions.guard';
import { IdempotencyInterceptor } from './guards/basic/idempotency.interceptor';
import { ConcurrencyInterceptor } from './guards/basic/concurrency.interceptor';
import { AUTH_CONSTANTS } from './constants/auth.constants';

export interface GuardNestModuleOptions {
  /**
   * Register guards globally via APP_GUARD (recommended for JWT + roles + permissions).
   * Default: true
   */
  globalGuards?: boolean;
  /**
   * JWT configuration — uses AUTH_CONSTANTS by default (env vars: JWT_SECRET, JWT_EXPIRATION)
   */
  jwt?: {
    secret?: string;
    expiresIn?: number;
  };
}

const ALL_SERVICES = [
  AuthService,
  CustomJwtService,
  PermissionsService,
  PermissionsCacheService,
  IpExtractorService,
  RedisStoreService,
  BotDetectionService,
  GeoIpService,
  AnomalyDetectionService,
  Web3RpcService,
  EtherscanService,
  SecurityContextService,
  IdempotencyInterceptor,
  ConcurrencyInterceptor,
];

/**
 * GuardNestModule — root module for the guard-nest library.
 *
 * Usage in app.module.ts:
 *   @Module({
 *     imports: [GuardNestModule.forRoot()],
 *   })
 *   export class AppModule {}
 *
 * With options:
 *   GuardNestModule.forRoot({
 *     globalGuards: true,
 *     jwt: { secret: 'my-secret', expiresIn: 3600 },
 *   })
 */
@Module({})
export class GuardNestModule {
  static forRoot(options: GuardNestModuleOptions = {}): DynamicModule {
    const globalGuards = options.globalGuards !== false;

    const globalGuardProviders = globalGuards
      ? [
          { provide: APP_GUARD, useClass: JwtAuthGuard },
          { provide: APP_GUARD, useClass: RolesGuard },
          { provide: APP_GUARD, useClass: PermissionsGuard },
        ]
      : [];

    return {
      module: GuardNestModule,
      global: true,
      imports: [
        PassportModule.register({ defaultStrategy: 'jwt' }),
        JwtModule.register({
          secret: options.jwt?.secret ?? AUTH_CONSTANTS.JWT_SECRET,
          signOptions: { expiresIn: options.jwt?.expiresIn ?? AUTH_CONSTANTS.JWT_EXPIRATION },
        }),
      ],
      providers: [...ALL_SERVICES, ...globalGuardProviders],
      exports: [...ALL_SERVICES],
    };
  }
}
