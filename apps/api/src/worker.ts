import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { loadWorkerEnv, nestLogLevels } from './config/env';
import { WorkerModule } from './worker/worker.module';

async function bootstrap(): Promise<void> {
  const env = loadWorkerEnv();
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    logger: nestLogLevels(env.LOG_LEVEL),
  });
  app.enableShutdownHooks();
}

bootstrap().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
