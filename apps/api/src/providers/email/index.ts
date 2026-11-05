import { type DynamicModule, Global, Module } from '@nestjs/common';
import { ConsoleEmailProvider } from './console-email.provider';
import { EmailProvider } from './email-provider';
import { FakeEmailProvider } from './fake-email.provider';

export { type EmailMessage, EmailProvider, maskEmail } from './email-provider';
export { FakeEmailProvider } from './fake-email.provider';

@Global()
@Module({})
export class EmailModule {
  static register(driver: 'console' | 'fake'): DynamicModule {
    return {
      module: EmailModule,
      providers: [
        {
          provide: EmailProvider,
          useClass: driver === 'fake' ? FakeEmailProvider : ConsoleEmailProvider,
        },
      ],
      exports: [EmailProvider],
    };
  }
}
