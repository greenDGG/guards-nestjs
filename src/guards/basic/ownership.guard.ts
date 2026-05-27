import { CanActivate, ExecutionContext, ForbiddenException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { GUARD_METADATA } from '../../constants/guard.constants';
import { OwnershipOptions } from '../../decorators/owner.decorator';
import { JwtPayload } from '../../interfaces/jwt-payload.interface';

/**
 * Level 1 — Ownership Guard (IDOR prevention)
 *
 * Ensures the authenticated user owns the resource being accessed.
 * Prevents Insecure Direct Object Reference (IDOR) — one of the most
 * common and impactful API vulnerabilities.
 *
 * ─── Basic usage (param matches JWT sub) ────────────────────────────────────
 *
 *   @Owner({ param: 'userId' })
 *   @UseGuards(OwnershipGuard)
 *   @Get(':userId/profile')
 *   getProfile(@Param('userId') id: string) {}
 *   // → User 42 can only GET /users/42/profile, not /users/99/profile
 *
 * ─── Body field ──────────────────────────────────────────────────────────────
 *
 *   @Owner({ body: 'authorId' })
 *   @UseGuards(OwnershipGuard)
 *   @Post('posts')
 *   createPost(@Body() dto: CreatePostDto) {}
 *   // → Can't create a post claiming to be someone else
 *
 * ─── Async resolver (resource ID → owner lookup) ────────────────────────────
 *
 *   @Owner({
 *     resolver: async (req) => {
 *       const post = await postRepo.findOne(req.params.postId);
 *       return post?.authorId ?? null;   // null → access denied
 *     },
 *   })
 *   @UseGuards(OwnershipGuard)
 *   @Delete('posts/:postId')
 *   deletePost() {}
 *
 * ─── Admin bypass ────────────────────────────────────────────────────────────
 *
 *   // By default, users with role 'admin' bypass the check.
 *   // Override with bypassRoles: ['admin', 'moderator'] or [] to disable bypass.
 *
 * ─── Custom JWT field ────────────────────────────────────────────────────────
 *
 *   @Owner({ param: 'tenantId', jwtField: 'tenantId' })
 *   // → Compares req.params.tenantId against jwt.tenantId instead of jwt.sub
 */
@Injectable()
export class OwnershipGuard implements CanActivate {
  private readonly logger = new Logger(OwnershipGuard.name);

  constructor(private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const options = this.reflector.getAllAndOverride<OwnershipOptions | undefined>(
      GUARD_METADATA.OWNERSHIP_OPTIONS,
      [context.getHandler(), context.getClass()],
    );

    // No @Owner() decorator on this route — skip
    if (!options) return true;

    const request = context.switchToHttp().getRequest<Request & { user?: JwtPayload }>();
    const user = request.user;

    if (!user) {
      throw new UnauthorizedException('Authentication required to access this resource');
    }

    // Privileged roles bypass ownership check
    const bypassRoles = options.bypassRoles ?? ['admin'];
    if (bypassRoles.length > 0 && user.roles?.some((r) => bypassRoles.includes(r))) {
      this.logger.debug(`Ownership bypassed — user ${user.sub} has privileged role`);
      return true;
    }

    // Resolve the owner ID from the request
    const ownerId = await this.resolveOwnerId(request, options);

    if (ownerId === null || ownerId === undefined) {
      this.logger.warn(
        `OwnershipGuard: could not resolve owner ID — ${request.method} ${request.url}`,
      );
      throw new ForbiddenException('Could not determine resource owner');
    }

    // Get the value to compare against from the JWT
    const jwtValue = options.jwtField ? (user as any)[options.jwtField] : user.sub;

    // Compare as strings to handle number/string mismatches (e.g., param '42' vs JWT sub 42)
    if (String(ownerId) !== String(jwtValue)) {
      this.logger.warn(
        `IDOR blocked — user ${user.sub} attempted to access resource owned by ${ownerId} ` +
          `[${request.method} ${request.url}]`,
      );
      throw new ForbiddenException('You do not have permission to access this resource');
    }

    this.logger.debug(`Ownership verified — user ${user.sub} owns resource ${ownerId}`);
    return true;
  }

  private async resolveOwnerId(
    request: Request & { user?: JwtPayload },
    options: OwnershipOptions,
  ): Promise<string | number | null> {
    // Custom async resolver takes priority — used when the URL has a resource ID (e.g.,
    // postId) rather than the user ID, and you need to fetch who owns it.
    if (options.resolver) {
      return options.resolver(request);
    }

    // Route param: /users/:userId, /orders/:userId/items
    if (options.param) {
      return (request.params as Record<string, string>)[options.param] ?? null;
    }

    // Body field: { authorId: '42' }, { ownerId: '42' }
    if (options.body) {
      return (request.body as Record<string, unknown>)?.[options.body] as string | number ?? null;
    }

    // Header: x-user-id, x-owner-id
    if (options.header) {
      const val = request.headers[options.header.toLowerCase()];
      return typeof val === 'string' ? val : null;
    }

    return null;
  }
}
