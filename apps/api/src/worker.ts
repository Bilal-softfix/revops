// Tracing must load before anything requires http.
import './instrument-worker';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { loadWorkerEnv } from './config/env';
import { WorkerModule } from './worker/worker.module';

async function bootstrap(): Promise<void> {
  const env = loadWorkerEnv();
  const app = await NestFactory.createApplicationContext(WorkerModule.register(env), {
    bufferLogs: true,
  });
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();
}

bootstrap().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
