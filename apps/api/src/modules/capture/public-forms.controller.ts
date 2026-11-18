import { Controller, Get, Header, HttpCode, Options, Param, Post, Req, Res } from '@nestjs/common';
import { ApiExcludeEndpoint } from '@nestjs/swagger';
import { type PublicFormResponse, publicFormResponseSchema } from '@revops/shared';
import type { Request, Response } from 'express';
import { DomainError } from '../../platform/errors/domain-error';
import { ZodResponse } from '../../platform/openapi/openapi';
import { EMBED_SCRIPT } from './embed-script';
import { PublicFormsService } from './public-forms.service';

/** CORS for one allowed origin: the snippet may read our answer; nothing is credentialed. */
function allowOrigin(res: Response, origin: string): void {
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
}

/**
 * Public capture: web form posts and the embed snippet (M2-T2). No session, no CSRF (nothing
 * here acts on a session); the tenant comes from the source's public key only.
 */
@Controller('v1/public')
export class PublicFormsController {
  constructor(private readonly forms: PublicFormsService) {}

  @Get('embed.js')
  @ApiExcludeEndpoint()
  @Header('Content-Type', 'application/javascript; charset=utf-8')
  @Header('Cache-Control', 'public, max-age=3600')
  @Header('Cross-Origin-Resource-Policy', 'cross-origin')
  embed(): string {
    return EMBED_SCRIPT;
  }

  /**
   * Accepted, duplicate and silently-dropped spam all answer 201 `{ ok: true }`. 404 for an
   * unknown/inactive key, 403 for an origin not on the allow-list, 422 without a usable phone or
   * email, 429 over a rate limit.
   */
  @Post('forms/:publicKey')
  @HttpCode(201)
  @ZodResponse(201, publicFormResponseSchema, 'Accepted')
  async submit(
    @Param('publicKey') publicKey: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<PublicFormResponse> {
    const form = await this.forms.resolve(publicKey, req.ip ?? null);
    const origin = req.header('origin');
    if (!this.forms.originAllowed(form, origin)) {
      // No CORS headers: a browser page on another site can't even read this answer.
      throw new DomainError('origin_not_allowed', 403, 'This website may not post to this form');
    }
    allowOrigin(res, origin);
    await this.forms.submit(form, req.body as unknown, req.ip ?? null);
    return { ok: true };
  }

  /** Preflight for clients that post `application/json` (the snippet itself doesn't need one). */
  @Options('forms/:publicKey')
  @ApiExcludeEndpoint()
  @HttpCode(204)
  async preflight(
    @Param('publicKey') publicKey: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const form = await this.forms.resolve(publicKey, req.ip ?? null);
    const origin = req.header('origin');
    if (!this.forms.originAllowed(form, origin)) return;
    allowOrigin(res, origin);
    res.setHeader('Access-Control-Allow-Methods', 'POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Max-Age', '600');
  }
}
