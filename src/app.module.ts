import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';

import { GuardNestModule } from './guard-nest.module';
import { AuthModule } from './auth/auth.module';
import { DemoModule } from './examples/demo.module';
import { SecurityContextMiddleware } from './middleware/security-context.middleware';
import { LoggingMiddleware } from './common/middleware/logging.middleware';
import { AppController } from './app.controller';

@Module({
  imports: [
    ThrottlerModule.forRoot([
      {
        name: 'short',
        ttl: parseInt(process.env.THROTTLE_SHORT_TTL || '1000'),
        limit: parseInt(process.env.THROTTLE_SHORT_LIMIT || '3'),
      },
      {
        name: 'long',
        ttl: parseInt(process.env.THROTTLE_LONG_TTL || '60000'),
        limit: parseInt(process.env.THROTTLE_LONG_LIMIT || '100'),
      },
    ]),
    // guard-nest library module — registers JWT + Roles + Permissions guards globally
    GuardNestModule.forRoot({ globalGuards: true }),
    // Auth module with login/refresh endpoints
    AuthModule,
    // Demo controllers for each guard level
    DemoModule,
  ],
  controllers: [AppController],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // SecurityContextMiddleware must run before LoggingMiddleware so guards find ctx initialized
    consumer
      .apply(SecurityContextMiddleware)
      .forRoutes('*');
    consumer
      .apply(LoggingMiddleware)
      .forRoutes('*');
  }
}
