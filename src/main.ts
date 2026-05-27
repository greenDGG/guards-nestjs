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
