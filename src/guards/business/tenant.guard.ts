import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { GUARD_METADATA } from '../../constants/guard.constants';
import { TenantMismatchException } from '../../exceptions/business.exception';

export interface TenantOptions {
  tenantIdSources?: Array<'header' | 'param' | 'body' | 'query'>;
  paramName?: string;
  headerName?: string;
  strict?: boolean;
}

/**
 * Level 5 — Multi-Tenant Isolation Guard
 *
 * Prevents cross-tenant data access by verifying that the tenantId
 * in the JWT matches the tenantId in the request (header, URL param, body, or query).
 *
 * Prevents: user from tenant A accessing tenant B's data by manipulating the URL.
 *
 * Usage:
 *   @SetMetadata(GUARD_METADATA.TENANT_OPTIONS, {
 *     tenantIdSources: ['header', 'param'],
 *     headerName: 'x-tenant-id',
 *     paramName: 'tenantId',
 *   })
 *   @UseGuards(TenantGuard)
 *   @Get(':tenantId/users')
 *   getUsers(@Param('tenantId') tid: string) {}
 */
@Injectable()
export class TenantGuard implements CanActivate {
  private readonly logger = new Logger(TenantGuard.name);

  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const options = this.reflector.getAllAndOverride<TenantOptions>(
      GUARD_METADATA.TENANT_OPTIONS,
      [context.getHandler(), context.getClass()],
    );

    if (!options) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const user = (request as any).user;

    if (!user?.tenantId) {
      if (options.strict !== false) {
        this.logger.warn('No tenantId in JWT — denying access');
        throw new TenantMismatchException();
      }
      return true;
    }

    const jwtTenantId = String(user.tenantId);
    const requestTenantId = this.extractTenantId(request, options);

    if (!requestTenantId) {
      if (options.strict !== false) {
        this.logger.warn(`No tenantId in request for user ${user.sub}`);
        throw new TenantMismatchException();
      }
      return true;
    }

    if (jwtTenantId !== requestTenantId) {
      this.logger.warn(`Tenant mismatch: JWT '${jwtTenantId}' vs request '${requestTenantId}' for user ${user.sub}`);
      throw new TenantMismatchException();
    }

    this.logger.debug(`Tenant verified: '${jwtTenantId}' for user ${user.sub}`);
    return true;
  }

  private extractTenantId(request: Request, options: TenantOptions): string | null {
    const sources = options.tenantIdSources ?? ['header', 'param', 'query'];
    const paramName = options.paramName ?? 'tenantId';
    const headerName = options.headerName ?? 'x-tenant-id';

    for (const source of sources) {
      let value: string | undefined;
      if (source === 'header') value = request.headers[headerName] as string;
      else if (source === 'param') value = (request.params as any)?.[paramName];
      else if (source === 'body') value = (request.body as any)?.[paramName];
      else if (source === 'query') value = (request.query as any)?.[paramName];
      if (value) return String(value);
    }
    return null;
  }
}
