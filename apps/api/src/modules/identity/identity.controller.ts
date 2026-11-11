import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res, UseGuards } from '@nestjs/common';
import {
  type CancelSignupRequest,
  type EmailOnlyRequest,
  type LoginRequest,
  type ResetPasswordRequest,
  type SessionResponse,
  type SignupRequest,
  type SignupResponse,
  type VerifyEmailRequest,
  cancelSignupRequestSchema,
  emailOnlyRequestSchema,
  loginRequestSchema,
  resetPasswordRequestSchema,
  signupRequestSchema,
  verifyEmailRequestSchema,
} from '@revops/shared';
import type { ApiEnv } from '@revops/shared/env';
import type { Request, Response } from 'express';
import { API_ENV } from '../../config/env';
import { requestMeta as meta } from '../../platform/request-meta';
import { ZodBodyPipe } from '../../platform/validation/zod-body.pipe';
import { IdentityService } from './identity.service';
import { CurrentAuth, SessionGuard } from './session.guard';
import { clearSessionCookie, setSessionCookie } from './session-cookie';
import type { AuthContext } from './session.service';

@Controller('v1/auth')
export class IdentityController {
  constructor(
    private readonly identity: IdentityService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  /** Always 202 { status: 'check_email' }; the outcome only ever arrives by email. */
  @Post('signup')
  @HttpCode(202)
  signup(
    @Body(new ZodBodyPipe(signupRequestSchema)) body: SignupRequest,
    @Req() req: Request,
  ): Promise<SignupResponse> {
    return this.identity.signup(body, meta(req));
  }

  @Post('verify-email')
  @HttpCode(204)
  verifyEmail(
    @Body(new ZodBodyPipe(verifyEmailRequestSchema)) body: VerifyEmailRequest,
    @Req() req: Request,
  ) {
    return this.identity.verifyEmail(body, meta(req));
  }

  /** "This wasn't me / start over": deletes the unverified account (and tenant) the link belongs to. */
  @Post('verify-email/cancel')
  @HttpCode(204)
  cancelSignup(
    @Body(new ZodBodyPipe(cancelSignupRequestSchema)) body: CancelSignupRequest,
    @Req() req: Request,
  ) {
    return this.identity.cancelSignup(body, meta(req));
  }

  @Post('resend-verification')
  @HttpCode(202)
  resendVerification(
    @Body(new ZodBodyPipe(emailOnlyRequestSchema)) body: EmailOnlyRequest,
    @Req() req: Request,
  ) {
    return this.identity.resendVerification(body, meta(req));
  }

  @Post('login')
  @HttpCode(200)
  async login(
    @Body(new ZodBodyPipe(loginRequestSchema)) body: LoginRequest,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessionResponse> {
    const { token, response } = await this.identity.login(body, meta(req));
    setSessionCookie(res, this.env, token);
    return response;
  }

  @Post('logout')
  @HttpCode(204)
  @UseGuards(SessionGuard)
  async logout(
    @CurrentAuth() auth: AuthContext,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.identity.logout(auth, meta(req));
    clearSessionCookie(res, this.env);
  }

  @Get('me')
  @UseGuards(SessionGuard)
  me(@CurrentAuth() auth: AuthContext): Promise<SessionResponse> {
    return this.identity.me(auth);
  }

  @Post('forgot-password')
  @HttpCode(202)
  forgotPassword(
    @Body(new ZodBodyPipe(emailOnlyRequestSchema)) body: EmailOnlyRequest,
    @Req() req: Request,
  ) {
    return this.identity.forgotPassword(body, meta(req));
  }

  @Post('reset-password')
  @HttpCode(204)
  resetPassword(@Body(new ZodBodyPipe(resetPasswordRequestSchema)) body: ResetPasswordRequest) {
    return this.identity.resetPassword(body);
  }
}
