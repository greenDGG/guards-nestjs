import { Injectable } from '@nestjs/common';
import { JwtService } from './jwt.service';
import { User } from '../interfaces/user.interface';
import { JwtPayload } from '../interfaces/jwt-payload.interface';
import { AUTH_CONSTANTS } from '../constants/auth.constants';
import {
  InvalidCredentialsException,
  TokenNotFoundException,
  InvalidTokenException,
} from '../exceptions/auth.exception';

const MOCK_USERS: Record<number, User> = {
  1: {
    id: 1,
    username: 'admin',
    email: 'admin@example.com',
    password: 'admin123',
    roles: [AUTH_CONSTANTS.ROLES.ADMIN],
    permissions: Object.values(AUTH_CONSTANTS.PERMISSIONS),
    isActive: true,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  },
  2: {
    id: 2,
    username: 'user',
    email: 'user@example.com',
    password: 'user123',
    roles: [AUTH_CONSTANTS.ROLES.USER],
    permissions: [
      AUTH_CONSTANTS.PERMISSIONS.USERS_READ,
      AUTH_CONSTANTS.PERMISSIONS.POSTS_READ,
      AUTH_CONSTANTS.PERMISSIONS.POSTS_CREATE,
    ],
    isActive: true,
    createdAt: new Date('2024-01-02'),
    updatedAt: new Date('2024-01-02'),
  },
  3: {
    id: 3,
    username: 'guest',
    email: 'guest@example.com',
    password: 'guest123',
    roles: [AUTH_CONSTANTS.ROLES.GUEST],
    permissions: [AUTH_CONSTANTS.PERMISSIONS.POSTS_READ],
    isActive: true,
    createdAt: new Date('2024-01-03'),
    updatedAt: new Date('2024-01-03'),
  },
};

@Injectable()
export class AuthService {
  constructor(private jwtService: JwtService) {}

  async validateUser(username: string, password: string): Promise<User | null> {
    const user = Object.values(MOCK_USERS).find((u) => u.username === username);
    if (!user || user.password !== password) return null;
    return user;
  }

  async login(
    username: string,
    password: string,
  ): Promise<{ accessToken: string; refreshToken: string; user: Partial<User> }> {
    const user = await this.validateUser(username, password);
    if (!user) throw new InvalidCredentialsException();

    const payload: Partial<JwtPayload> = {
      sub: user.id,
      username: user.username,
      email: user.email,
      roles: user.roles,
      permissions: user.permissions,
    };

    return {
      accessToken: this.jwtService.signToken(payload),
      refreshToken: this.jwtService.signRefreshToken(payload),
      user: { id: user.id, username: user.username, email: user.email, roles: user.roles },
    };
  }

  async refreshToken(refreshToken: string): Promise<{ accessToken: string }> {
    if (!refreshToken) throw new TokenNotFoundException('Refresh token not provided');

    try {
      const payload = await this.jwtService.verifyRefreshToken(refreshToken);
      const user = MOCK_USERS[payload.sub as number];
      if (!user) throw new InvalidTokenException('User not found');

      const newPayload: Partial<JwtPayload> = {
        sub: user.id,
        username: user.username,
        email: user.email,
        roles: user.roles,
        permissions: user.permissions,
      };

      return { accessToken: this.jwtService.signToken(newPayload) };
    } catch {
      throw new InvalidTokenException('Invalid refresh token');
    }
  }

  async getUserById(userId: number): Promise<User | null> {
    return MOCK_USERS[userId] || null;
  }

  async loginWithSubscription(
    username: string,
    password: string,
    subscriptionPlan: string,
  ): Promise<{ accessToken: string }> {
    const user = await this.validateUser(username, password);
    if (!user) throw new InvalidCredentialsException();

    const payload: Partial<JwtPayload> = {
      sub: user.id,
      username: user.username,
      email: user.email,
      roles: user.roles,
      permissions: user.permissions,
      subscriptionPlan,
    };

    return { accessToken: this.jwtService.signToken(payload) };
  }

  async loginWithMfa(
    username: string,
    password: string,
    mfaAgeSeconds: number | null,
  ): Promise<{ accessToken: string }> {
    const user = await this.validateUser(username, password);
    if (!user) throw new InvalidCredentialsException();

    const now = Math.floor(Date.now() / 1000);
    const payload: Partial<JwtPayload> = {
      sub: user.id,
      username: user.username,
      email: user.email,
      roles: user.roles,
      permissions: user.permissions,
      mfaVerifiedAt: mfaAgeSeconds !== null ? now - mfaAgeSeconds : undefined,
    };

    return { accessToken: this.jwtService.signToken(payload) };
  }
}
