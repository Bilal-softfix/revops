import { describe, expect, it } from 'vitest';
import { TurnstileCaptchaVerifier } from './turnstile-captcha.verifier';

const fakeFetch = (impl: () => Promise<Response>) => (() => impl()) as unknown as typeof fetch;

describe('TurnstileCaptchaVerifier', () => {
  it('posts secret, token and IP; true only on success: true', async () => {
    let sent: URLSearchParams | undefined;
    const fetchImpl = ((_url: string, init: RequestInit) => {
      sent = init.body as URLSearchParams;
      return Promise.resolve(new Response(JSON.stringify({ success: true })));
    }) as unknown as typeof fetch;
    expect(await new TurnstileCaptchaVerifier('s3cret', fetchImpl).verify('tok', '1.2.3.4')).toBe(
      true,
    );
    expect(sent?.get('secret')).toBe('s3cret');
    expect(sent?.get('response')).toBe('tok');
    expect(sent?.get('remoteip')).toBe('1.2.3.4');
  });

  it.each([
    ['success: false', () => Promise.resolve(new Response(JSON.stringify({ success: false })))],
    ['HTTP 500', () => Promise.resolve(new Response('boom', { status: 500 }))],
    ['garbage JSON', () => Promise.resolve(new Response('not json'))],
    ['network error', () => Promise.reject(new TypeError('fetch failed'))],
  ])('fails closed on %s', async (_label, impl) => {
    expect(await new TurnstileCaptchaVerifier('s', fakeFetch(impl)).verify('tok', null)).toBe(
      false,
    );
  });
});
