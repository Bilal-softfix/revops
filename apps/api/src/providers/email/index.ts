import { type DynamicModule, Global, Module } from '@nestjs/common';
import type { ApiEnv } from '@revops/shared/env';
import { ConsoleEmailProvider } from './console-email.provider';
import { EmailProvider } from './email-provider';
import { FakeEmailProvider } from './fake-email.provider';
import { FileEmailProvider } from './file-email.provider';

export { type EmailMessage, EmailProvider, maskEmail } from './email-provider';
export { FakeEmailProvider } from './fake-email.provider';
export { FileEmailProvider, readMailbox } from './file-email.provider';

@Global()
@Module({})
export class EmailModule {
  static register(env: Pick<ApiEnv, 'EMAIL_DRIVER' | 'EMAIL_FILE_DIR'>): DynamicModule {
    const provider = (() => {
      switch (env.EMAIL_DRIVER) {
        case 'fake':
          return { provide: EmailProvider, useClass: FakeEmailProvider };
        case 'file':
          return {
            provide: EmailProvider,
            useFactory: () => new FileEmailProvider(env.EMAIL_FILE_DIR),
          };
        default:
          return { provide: EmailProvider, useClass: ConsoleEmailProvider };
      }
    })();
    return { module: EmailModule, providers: [provider], exports: [EmailProvider] };
  }
}
