import { Injectable } from '@nestjs/common';
import { PermissionsCacheService } from './permissions-cache.service';
import { AUTH_CONSTANTS } from '../constants/auth.constants';

const MOCK_USER_PERMISSIONS: Record<number, string[]> = {
  1: Object.values(AUTH_CONSTANTS.PERMISSIONS),
  2: [
    AUTH_CONSTANTS.PERMISSIONS.USERS_READ,
    AUTH_CONSTANTS.PERMISSIONS.POSTS_READ,
    AUTH_CONSTANTS.PERMISSIONS.POSTS_CREATE,
  ],
  3: [AUTH_CONSTANTS.PERMISSIONS.POSTS_READ],
};

@Injectable()
export class PermissionsService {
  constructor(private cacheService: PermissionsCacheService) {}

  async getUserPermissions(userId: number): Promise<string[]> {
    const cached = this.cacheService.get(userId);
    if (cached) return cached;

    const permissions = await this.fetchPermissionsFromDatabase(userId);
    this.cacheService.set(userId, permissions);
    return permissions;
  }

  private async fetchPermissionsFromDatabase(userId: number): Promise<string[]> {
    await new Promise((resolve) => setTimeout(resolve, 50));
    return MOCK_USER_PERMISSIONS[userId] || [];
  }

  invalidateUserCache(userId: number): void {
    this.cacheService.invalidate(userId);
  }

  clearAllCache(): void {
    this.cacheService.clear();
  }

  getCacheStats(): { size: number; ttl: number } {
    return { size: this.cacheService.size(), ttl: AUTH_CONSTANTS.PERMISSIONS_CACHE_TTL };
  }
}
