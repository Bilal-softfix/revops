import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  SetMetadata,
  applyDecorators,
  UseGuards,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { type Permission, hasPermission } from '@revops/shared';
import type { Request } from 'express';
import { type AuthContext, SessionGuard } from '../identity';
import { forbidden, noActiveTenant } from './errors';

const PERMISSION_KEY = 'revops:permission';

/**
 * Route needs a session with an active tenant whose role has `permission` (ROLE_PERMISSIONS in
 * @revops/shared). Applies SessionGuard first, so CSRF is checked on unsafe methods too.
 */
export const RequirePermission = (permission: Permission) =>
  applyDecorators(
    SetMetadata(PERMISSION_KEY, permission),
    UseGuards(SessionGuard, PermissionGuard),
  );

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const permission = this.reflector.getAllAndOverride<Permission | undefined>(PERMISSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!permission) return true;
    const auth = context.switchToHttp().getRequest<Request & { auth?: AuthContext }>().auth;
    // SessionGuard re-resolves the active membership on every request: role is current.
    if (!auth?.tenantId || !auth.role) throw noActiveTenant();
    if (!hasPermission(auth.role, permission)) throw forbidden();
    return true;
  }
}
