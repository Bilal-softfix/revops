import { Controller, HttpCode, Param, Post, Req, Res } from '@nestjs/common';
import {
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_TOKEN_HEADER,
  type WebhookAccepted,
  webhookAcceptedSchema,
} from '@revops/shared';
import type { Response } from 'express';
import { ZodResponse } from '../../platform/openapi/openapi';
import type { RequestWithRawBody } from '../../platform/validation/public-body';
import { WebhooksService } from './webhooks.service';

/**
 * Signed generic webhook (M2-T3) for Zapier and website backends. No session: the source comes
 * from the public key in the URL. By default every delivery is signed with the source's secret
 * (`X-RevOps-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>`); a source in
 * simple-token mode instead sends the secret itself in `X-Webhook-Token` (no-code tools).
 */
@Controller('v1/public/webhooks')
export class WebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  /**
   * 202 accepted (processed asynchronously) · 200 duplicate event id (nothing new) · 401 bad or
   * missing signature/token (stored as rejected) · 400 invalid payload (stored as failed) · 404 unknown
   * or inactive key · 413 over 64 kB · 429 rate limited.
   */
  @Post(':publicKey')
  @HttpCode(202)
  @ZodResponse(202, webhookAcceptedSchema, 'Accepted')
  async receive(
    @Param('publicKey') publicKey: string,
    @Req() req: RequestWithRawBody,
    @Res({ passthrough: true }) res: Response,
  ): Promise<WebhookAccepted> {
    const result = await this.webhooks.receive({
      publicKey,
      signature: req.header(WEBHOOK_SIGNATURE_HEADER),
      token: req.header(WEBHOOK_TOKEN_HEADER),
      rawBody: req.rawBody,
      body: req.body as unknown,
      ip: req.ip ?? null,
    });
    if (result.duplicate) res.status(200);
    return result;
  }
}
