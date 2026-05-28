import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import * as dotenv from 'dotenv';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';

dotenv.config();

async function bootstrap() {
  // rawBody: true preserves req.rawBody (Buffer) — required by SignatureGuard
  const app = await NestFactory.create(AppModule, { rawBody: true });

  // Trust the first proxy hop so IpExtractorService reads the real client IP
  // from X-Forwarded-For instead of the load balancer/reverse proxy address.
  // Set to the number of trusted proxy hops in your infrastructure (1 for most setups).
  // Without this, IP-based guards (IpGuard, rate limits) can be spoofed with a
  // forged X-Forwarded-For header.
  app.getHttpAdapter().getInstance().set('trust proxy', 1);

  // CORS — tighten allowedOrigins for your production domains
  app.enableCors({
    origin: process.env.CORS_ORIGIN
      ? process.env.CORS_ORIGIN.split(',').map(o => o.trim())
      : ['http://localhost:3000', 'http://localhost:4200'],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key',
                     'X-Idempotency-Key', 'X-Nonce', 'X-Timestamp',
                     'X-Signature', 'X-CSRF-Token', 'X-Admin-Key',
                     'Sec-CH-UA', 'Sec-CH-UA-Mobile', 'Sec-CH-UA-Platform'],
    credentials: true,
  });

  // Pipes
  app.useGlobalPipes(new ValidationPipe({ transform: true }));

  // Filters
  app.useGlobalFilters(new GlobalExceptionFilter());

  // Interceptors
  app.useGlobalInterceptors(new LoggingInterceptor());

  const port = process.env.PORT || 3000;

  await app.listen(port);
  console.log(`🚀 Application is running on: http://localhost:${port}`);
}

bootstrap().catch((err) => {
  console.error('❌ Application failed to start:', err);
  process.exit(1);
});
