import { Injectable } from '@nestjs/common';
import { AUTH_CONSTANTS } from '../constants/auth.constants';

interface CachedPermissions {
  permissions: string[];
  expiresAt: number;
}

@Injectable()
export class PermissionsCacheService {
  private cache = new Map<number, CachedPermissions>();

  get(userId: number): string[] | null {
    const cached = this.cache.get(userId);
    if (!cached) return null;
    if (Date.now() > cached.expiresAt) {
      this.cache.delete(userId);
      return null;
    }
    return cached.permissions;
  }

  set(userId: number, permissions: string[]): void {
    const expiresAt = Date.now() + AUTH_CONSTANTS.PERMISSIONS_CACHE_TTL;
    this.cache.set(userId, { permissions, expiresAt });
  }

  invalidate(userId: number): void {
    this.cache.delete(userId);
  }

  clear(): void {
    this.cache.clear();
  }

  size(): number {
    return this.cache.size;
  }
}
