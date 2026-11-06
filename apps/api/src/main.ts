import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { APP_OPTIONS, configureApp } from './app-setup';
import { AppModule } from './app.module';
import { loadApiEnv, nestLogLevels } from './config/env';

async function bootstrap(): Promise<void> {
  const env = loadApiEnv();
  const app = await NestFactory.create(AppModule.register(env), {
    ...APP_OPTIONS,
    logger: nestLogLevels(env.LOG_LEVEL),
  });
  configureApp(app);
  app.enableShutdownHooks();
  await app.listen(env.API_PORT);
  Logger.log(`API listening on http://localhost:${env.API_PORT}`, 'Bootstrap');
}

bootstrap().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
