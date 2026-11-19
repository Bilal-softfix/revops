/**
 * Captcha check for public forms (M2-T2). Implementations: FakeCaptchaVerifier (dev/tests) and
 * TurnstileCaptchaVerifier (Cloudflare). Never throws for a bad token — returns false.
 */
export abstract class CaptchaVerifier {
  abstract verify(token: string, remoteIp: string | null): Promise<boolean>;
}
