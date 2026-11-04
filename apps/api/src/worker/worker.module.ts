import {
  Injectable,
  Logger,
  Module,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';

/**
 * Keeps the worker process alive until real consumers exist. BullMQ workers (M0-T6) hold
 * the event loop themselves, at which point this goes away.
 */
@Injectable()
export class WorkerHeartbeat implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('Worker');
  private timer: NodeJS.Timeout | undefined;

  onApplicationBootstrap(): void {
    this.logger.log('Worker started — no consumers registered yet (outbox relay lands in M0-T6)');
    this.timer = setInterval(() => this.logger.debug('heartbeat'), 60_000);
  }

  onApplicationShutdown(): void {
    clearInterval(this.timer);
  }
}

@Module({
  providers: [WorkerHeartbeat],
})
export class WorkerModule {}
