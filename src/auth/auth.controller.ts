import { Controller, Post, Body, HttpCode, HttpStatus, Get } from '@nestjs/common';
import { AuthService } from '../services/auth.service';
import { Public } from '../decorators/public.decorator';
import { CurrentUser } from '../decorators/current-user.decorator';
import { JwtPayload } from '../interfaces/jwt-payload.interface';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() body: { username: string; password: string }) {
    return this.authService.login(body.username, body.password);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Body() body: { refreshToken: string }) {
    return this.authService.refreshToken(body.refreshToken);
  }

  @Get('me')
  async getCurrentUser(@CurrentUser() user: JwtPayload) {
    return {
      id: user.sub,
      username: user.username,
      email: user.email,
      roles: user.roles,
      permissions: user.permissions,
    };
  }

  @Public()
  @Get('health')
  health() {
    return { status: 'ok', message: 'Auth service is running', timestamp: new Date().toISOString() };
  }

  // Genera un token con tenantId — solo para test scripts (no usar en producción)
  @Public()
  @Post('test/tenant-token')
  @HttpCode(HttpStatus.OK)
  async tenantTestToken(
    @Body() body: { username: string; password: string; tenantId?: string | null },
  ) {
    const tid = typeof body.tenantId === 'string' ? body.tenantId : null;
    return this.authService.loginWithTenant(body.username, body.password, tid);
  }

  // Genera un token con subscriptionPlan — solo para test scripts (no usar en producción)
  @Public()
  @Post('test/subscription-token')
  @HttpCode(HttpStatus.OK)
  async subscriptionTestToken(
    @Body() body: { username: string; password: string; subscriptionPlan: string },
  ) {
    return this.authService.loginWithSubscription(body.username, body.password, body.subscriptionPlan);
  }

  // Genera un token con mfaVerifiedAt — solo para test scripts (no usar en producción)
  @Public()
  @Post('test/mfa-token')
  @HttpCode(HttpStatus.OK)
  async mfaTestToken(
    @Body() body: { username: string; password: string; mfaAgeSeconds?: number | null },
  ) {
    // null → sin mfaVerifiedAt en el token  |  número → mfaVerifiedAt = now - mfaAgeSeconds
    const mfaAge = typeof body.mfaAgeSeconds === 'number' ? body.mfaAgeSeconds : null;
    return this.authService.loginWithMfa(body.username, body.password, mfaAge);
  }
}
