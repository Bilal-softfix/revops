import { Injectable } from '@nestjs/common';
import { CaptchaVerifier } from './captcha-verifier';

/** Accepts exactly the token "pass"; records what it was asked (tests). */
@Injectable()
export class FakeCaptchaVerifier extends CaptchaVerifier {
  static readonly VALID_TOKEN = 'pass';
  readonly calls: { token: string; remoteIp: string | null }[] = [];

  verify(token: string, remoteIp: string | null): Promise<boolean> {
    this.calls.push({ token, remoteIp });
    return Promise.resolve(token === FakeCaptchaVerifier.VALID_TOKEN);
  }
}
