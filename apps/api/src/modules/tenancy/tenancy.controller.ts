import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  type AcceptInvitationRequest,
  type Invitation,
  type InviteRequest,
  type Member,
  type MemberPage,
  type MyTenantsResponse,
  type PageQuery,
  type SessionResponse,
  type SwitchTenantRequest,
  type UpdateMemberRequest,
  acceptInvitationRequestSchema,
  inviteRequestSchema,
  pageQuerySchema,
  switchTenantRequestSchema,
  updateMemberRequestSchema,
  memberPageSchema,
  memberSchema,
  invitationSchema,
  sessionResponseSchema,
  myTenantsResponseSchema,
} from '@revops/shared';
import type { ApiEnv } from '@revops/shared/env';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { API_ENV } from '../../config/env';
import { requestMeta } from '../../platform/request-meta';
import { ZodResponse } from '../../platform/openapi/openapi';
import { ZodBodyPipe } from '../../platform/validation/zod-body.pipe';
import {
  type AuthContext,
  CurrentAuth,
  OptionalAuth,
  OptionalSessionGuard,
  SessionGuard,
  setSessionCookie,
} from '../identity';
import { RequirePermission } from './permission.guard';
import { TenancyService } from './tenancy.service';

const idParam = new ZodBodyPipe(z.uuid());
const invitationListSchema = z.object({ items: z.array(invitationSchema) });

/** @RequirePermission guarantees an active tenant + role. */
type TenantAuth = AuthContext & { tenantId: string; role: NonNullable<AuthContext['role']> };

@Controller('v1')
export class TenancyController {
  constructor(
    private readonly tenancy: TenancyService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  @Get('members')
  @ZodResponse(200, memberPageSchema)
  @RequirePermission('member.read')
  listMembers(
    @CurrentAuth() auth: TenantAuth,
    @Query(new ZodBodyPipe(pageQuerySchema)) query: PageQuery,
  ): Promise<MemberPage> {
    return this.tenancy.listMembers(auth, query);
  }

  @Patch('members/:userId')
  @ZodResponse(200, memberSchema)
  @RequirePermission('member.manage')
  updateMember(
    @CurrentAuth() auth: TenantAuth,
    @Param('userId', idParam) userId: string,
    @Body(new ZodBodyPipe(updateMemberRequestSchema)) body: UpdateMemberRequest,
    @Req() req: Request,
  ): Promise<Member> {
    return this.tenancy.updateMember(auth, userId, body, requestMeta(req));
  }

  @Get('invitations')
  @ZodResponse(200, invitationListSchema)
  @RequirePermission('member.invite')
  listInvitations(@CurrentAuth() auth: TenantAuth): Promise<{ items: Invitation[] }> {
    return this.tenancy.listInvitations(auth);
  }

  @Post('invitations')
  @ZodResponse(201, invitationSchema, 'Created')
  @HttpCode(201)
  @RequirePermission('member.invite')
  invite(
    @CurrentAuth() auth: TenantAuth,
    @Body(new ZodBodyPipe(inviteRequestSchema)) body: InviteRequest,
    @Req() req: Request,
  ): Promise<Invitation> {
    return this.tenancy.invite(auth, body, requestMeta(req));
  }

  @Post('invitations/:id/resend')
  @HttpCode(204)
  @RequirePermission('member.invite')
  resend(
    @CurrentAuth() auth: TenantAuth,
    @Param('id', idParam) id: string,
    @Req() req: Request,
  ): Promise<void> {
    return this.tenancy.resend(auth, id, requestMeta(req));
  }

  @Delete('invitations/:id')
  @HttpCode(204)
  @RequirePermission('member.invite')
  revoke(
    @CurrentAuth() auth: TenantAuth,
    @Param('id', idParam) id: string,
    @Req() req: Request,
  ): Promise<void> {
    return this.tenancy.revoke(auth, id, requestMeta(req));
  }

  /** Public (the token is the credential); a live session is used if present (existing users). */
  @Post('invitations/accept')
  @ZodResponse(200, sessionResponseSchema)
  @HttpCode(200)
  @UseGuards(OptionalSessionGuard)
  async accept(
    @OptionalAuth() auth: AuthContext | undefined,
    @Body(new ZodBodyPipe(acceptInvitationRequestSchema)) body: AcceptInvitationRequest,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessionResponse> {
    const { response, sessionToken } = await this.tenancy.accept(body, auth, requestMeta(req));
    if (sessionToken) setSessionCookie(res, this.env, sessionToken);
    return response;
  }

  @Get('tenants')
  @ZodResponse(200, myTenantsResponseSchema)
  @UseGuards(SessionGuard)
  myTenants(@CurrentAuth() auth: AuthContext): Promise<MyTenantsResponse> {
    return this.tenancy.myTenants(auth);
  }

  @Post('session/tenant')
  @ZodResponse(200, sessionResponseSchema)
  @HttpCode(200)
  @UseGuards(SessionGuard)
  switchTenant(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodBodyPipe(switchTenantRequestSchema)) body: SwitchTenantRequest,
  ): Promise<SessionResponse> {
    return this.tenancy.switchTenant(auth, body.tenantId);
  }
}
