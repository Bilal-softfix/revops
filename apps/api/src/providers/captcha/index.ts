import { type DynamicModule, Global, Module } from '@nestjs/common';
import type { ApiEnv } from '@revops/shared/env';
import { CaptchaVerifier } from './captcha-verifier';
import { FakeCaptchaVerifier } from './fake-captcha.verifier';
import { TurnstileCaptchaVerifier } from './turnstile-captcha.verifier';

export { CaptchaVerifier } from './captcha-verifier';
export { FakeCaptchaVerifier } from './fake-captcha.verifier';
export { TurnstileCaptchaVerifier } from './turnstile-captcha.verifier';

@Global()
@Module({})
export class CaptchaModule {
  static register(env: Pick<ApiEnv, 'CAPTCHA_DRIVER' | 'TURNSTILE_SECRET'>): DynamicModule {
    const provider =
      env.CAPTCHA_DRIVER === 'turnstile'
        ? {
            provide: CaptchaVerifier,
            useFactory: () => new TurnstileCaptchaVerifier(env.TURNSTILE_SECRET ?? ''),
          }
        : { provide: CaptchaVerifier, useClass: FakeCaptchaVerifier };
    return { module: CaptchaModule, providers: [provider], exports: [CaptchaVerifier] };
  }
}
