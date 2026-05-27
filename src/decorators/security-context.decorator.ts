import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { SecurityContext } from '../interfaces/security-context.interface';

/**
 * @SecurityCtx() — inject the full SecurityContext into a controller handler
 *
 * Usage:
 *   @Get('profile')
 *   getProfile(@SecurityCtx() ctx: SecurityContext) {
 *     console.log(ctx.ip, ctx.botScore, ctx.geo?.countryCode);
 *   }
 *
 * Partial access:
 *   @SecurityCtx('geo') geo: SecurityContext['geo']
 *   @SecurityCtx('trustScore') trust: number
 */
export const SecurityCtx = createParamDecorator(
  (field: keyof SecurityContext | undefined, ctx: ExecutionContext): unknown => {
    const request = ctx.switchToHttp().getRequest();
    const secCtx: SecurityContext = request.securityContext ?? {};
    return field ? secCtx[field] : secCtx;
  },
);
