import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { Permissions } from '../../decorators/permissions.decorator';
import { PermissionsService } from '../../services/permissions.service';
import { InsufficientPermissionsException } from '../../exceptions/permissions.exception';

/**
 * Level 1 — Permission-Based Access Control Guard
 *
 * Checks that the user holds ALL of the required permissions (AND logic).
 * Results are cached via PermissionsCacheService to avoid repeated DB lookups.
 * Must run after JwtAuthGuard.
 *
 * Usage:
 *   @Permissions(['posts:create', 'posts:update'])
 *   @Post(':id')
 *   updatePost() {}
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  private readonly logger = new Logger(PermissionsGuard.name);

  constructor(
    private reflector: Reflector,
    private permissionsService: PermissionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredPermissions = this.reflector.get<string[]>(Permissions, context.getHandler());

    if (!requiredPermissions || requiredPermissions.length === 0) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const user = (request as any).user;

    if (!user) {
      this.logger.error('User not found in request — PermissionsGuard must run after JwtAuthGuard');
      throw new InsufficientPermissionsException(requiredPermissions);
    }

    const userPermissions = await this.permissionsService.getUserPermissions(user.sub);
    const missing = requiredPermissions.filter((p) => !userPermissions.includes(p));

    if (missing.length > 0) {
      this.logger.warn(`${user.username} missing permissions: [${missing.join(', ')}]`);
      throw new InsufficientPermissionsException(missing);
    }

    this.logger.debug(`${user.username} — permissions ok: [${requiredPermissions.join(', ')}]`);
    return true;
  }
}
