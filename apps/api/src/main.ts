// Tracing must load before anything requires http/express.
import './instrument-api';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { APP_OPTIONS, configureApp } from './app-setup';
import { AppModule } from './app.module';
import { loadApiEnv } from './config/env';

async function bootstrap(): Promise<void> {
  const env = loadApiEnv();
  const app = await NestFactory.create(AppModule.register(env), APP_OPTIONS);
  const logger = app.get(Logger);
  app.useLogger(logger);
  configureApp(app);
  app.enableShutdownHooks();
  await app.listen(env.API_PORT);
  logger.log(`API listening on http://localhost:${env.API_PORT}`, 'Bootstrap');
}

bootstrap().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
