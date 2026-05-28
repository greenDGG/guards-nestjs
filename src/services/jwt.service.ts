import { Injectable } from '@nestjs/common';
import { JwtService as NestJwtService } from '@nestjs/jwt';
import { JwtPayload } from '../interfaces/jwt-payload.interface';
import { AUTH_CONSTANTS } from '../constants/auth.constants';

@Injectable()
export class JwtService {
  constructor(private readonly jwtService: NestJwtService) {}

  signToken(payload: Partial<JwtPayload>, expiresIn?: string | number) {
    const tokenPayload = {
      sub: payload.sub || 0,
      username: payload.username || '',
      email: payload.email,
      roles: payload.roles || [],
      permissions: payload.permissions || [],
      tenantId: payload.tenantId,
      subscriptionPlan: payload.subscriptionPlan,
      mfaVerifiedAt: payload.mfaVerifiedAt,
      walletAddress: payload.walletAddress,
      chainId: payload.chainId,
    };
    const exp =
      typeof expiresIn === 'number'
        ? expiresIn
        : parseInt(expiresIn || `${AUTH_CONSTANTS.JWT_EXPIRATION}`, 10);

    // Do not pass `secret` here — use whatever GuardNestModule.forRoot({ jwt: { secret } })
    // registered in JwtModule. Passing it explicitly would override forRoot() config.
    return this.jwtService.sign(tokenPayload as any, { expiresIn: exp });
  }

  async verifyToken(token: string): Promise<JwtPayload> {
    try {
      // No explicit secret — use JwtModule-registered secret (from forRoot() config).
      return await this.jwtService.verifyAsync(token);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Token verification failed: ${errorMessage}`);
    }
  }

  decodeToken(token: string): JwtPayload | null {
    try {
      return this.jwtService.decode(token) as JwtPayload | null;
    } catch {
      return null;
    }
  }

  isTokenExpired(token: string): boolean {
    const decoded = this.decodeToken(token);
    if (!decoded || !decoded.exp) return true;
    return decoded.exp < Math.floor(Date.now() / 1000);
  }

  signRefreshToken(payload: Partial<JwtPayload>) {
    return this.jwtService.sign(
      { sub: payload.sub || 0, username: payload.username || '', type: 'refresh' } as any,
      { secret: AUTH_CONSTANTS.JWT_REFRESH_SECRET, expiresIn: AUTH_CONSTANTS.JWT_REFRESH_EXPIRATION },
    );
  }

  async verifyRefreshToken(token: string): Promise<JwtPayload> {
    try {
      return await this.jwtService.verifyAsync(token, {
        secret: AUTH_CONSTANTS.JWT_REFRESH_SECRET,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Refresh token verification failed: ${errorMessage}`);
    }
  }
}
