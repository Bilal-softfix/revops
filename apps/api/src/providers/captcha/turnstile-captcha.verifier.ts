import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { CaptchaVerifier } from './captcha-verifier';

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const responseSchema = z.object({ success: z.boolean() });

/**
 * Cloudflare Turnstile server-side check. Blocked on external (needs site + secret keys); off
 * unless CAPTCHA_DRIVER=turnstile. Fails closed: network errors and timeouts count as invalid.
 */
@Injectable()
export class TurnstileCaptchaVerifier extends CaptchaVerifier {
  private readonly logger = new Logger(TurnstileCaptchaVerifier.name);

  constructor(
    private readonly secret: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    super();
  }

  async verify(token: string, remoteIp: string | null): Promise<boolean> {
    const body = new URLSearchParams({ secret: this.secret, response: token });
    if (remoteIp) body.set('remoteip', remoteIp);
    try {
      const res = await this.fetchImpl(SITEVERIFY_URL, {
        method: 'POST',
        body,
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return false;
      const parsed = responseSchema.safeParse(await res.json());
      return parsed.success && parsed.data.success;
    } catch (error) {
      // Never log the token or the secret.
      this.logger.warn(`turnstile verify failed: ${error instanceof Error ? error.name : 'error'}`);
      return false;
    }
  }
}
