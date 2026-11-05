import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res, UseGuards } from '@nestjs/common';
import {
  type EmailOnlyRequest,
  type LoginRequest,
  type ResetPasswordRequest,
  type SessionResponse,
  type SignupRequest,
  type SignupResponse,
  type VerifyEmailRequest,
  emailOnlyRequestSchema,
  loginRequestSchema,
  resetPasswordRequestSchema,
  signupRequestSchema,
  verifyEmailRequestSchema,
} from '@revops/shared';
import type { ApiEnv } from '@revops/shared/env';
import type { CookieOptions, Request, Response } from 'express';
import { API_ENV } from '../../config/env';
import { ZodBodyPipe } from '../../platform/validation/zod-body.pipe';
import { IdentityService, type RequestMeta } from './identity.service';
import { CurrentAuth, SessionGuard } from './session.guard';
import { type AuthContext, SESSION_MAX_AGE_MS, sessionCookieName } from './session.service';

const meta = (req: Request): RequestMeta => ({
  ip: req.ip ?? null,
  userAgent: req.header('user-agent')?.slice(0, 512) ?? null,
});

@Controller('v1/auth')
export class IdentityController {
  constructor(
    private readonly identity: IdentityService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  private cookieOptions(): CookieOptions {
    return { httpOnly: true, secure: this.env.COOKIE_SECURE, sameSite: 'lax', path: '/' };
  }

  @Post('signup')
  @HttpCode(201)
  signup(
    @Body(new ZodBodyPipe(signupRequestSchema)) body: SignupRequest,
    @Req() req: Request,
  ): Promise<SignupResponse> {
    return this.identity.signup(body, meta(req));
  }

  @Post('verify-email')
  @HttpCode(204)
  verifyEmail(@Body(new ZodBodyPipe(verifyEmailRequestSchema)) body: VerifyEmailRequest) {
    return this.identity.verifyEmail(body);
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
    res.cookie(sessionCookieName(this.env.COOKIE_SECURE), token, {
      ...this.cookieOptions(),
      maxAge: SESSION_MAX_AGE_MS,
    });
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
    res.clearCookie(sessionCookieName(this.env.COOKIE_SECURE), this.cookieOptions());
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
