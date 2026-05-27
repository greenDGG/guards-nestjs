import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { Roles } from '../../decorators/roles.decorator';
import { InsufficientRolesException } from '../../exceptions/permissions.exception';

/**
 * Level 1 — Role-Based Access Control (RBAC) Guard
 *
 * Checks that the authenticated user has at least one of the required roles (OR logic).
 * Must run after JwtAuthGuard so that request.user is populated.
 *
 * Usage:
 *   @Roles(['admin', 'moderator'])
 *   @Get('admin-area')
 *   adminArea() {}
 */
@Injectable()
export class RolesGuard implements CanActivate {
  private readonly logger = new Logger(RolesGuard.name);

  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.get<string[]>(Roles, context.getHandler());

    if (!requiredRoles || requiredRoles.length === 0) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const user = (request as any).user;

    if (!user) {
      this.logger.error('User not found in request — RolesGuard must run after JwtAuthGuard');
      throw new InsufficientRolesException(requiredRoles);
    }

    const hasRole = requiredRoles.some((role) => user.roles?.includes(role));

    if (!hasRole) {
      this.logger.warn(
        `${user.username} lacks roles [${requiredRoles.join(', ')}]. Has: [${user.roles?.join(', ') ?? 'none'}]`,
      );
      throw new InsufficientRolesException(requiredRoles);
    }

    this.logger.debug(`${user.username} — roles ok: [${requiredRoles.join(', ')}]`);
    return true;
  }
}
