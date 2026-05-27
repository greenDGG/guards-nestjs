export const AUTH_CONSTANTS = {
  JWT_SECRET: process.env.JWT_SECRET || 'your-secret-key-change-in-production',
  JWT_EXPIRATION: parseInt(process.env.JWT_EXPIRATION || '3600'),
  JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET || 'your-refresh-secret-key',
  JWT_REFRESH_EXPIRATION: parseInt(process.env.JWT_REFRESH_EXPIRATION || '604800'),
  PERMISSIONS_CACHE_TTL: parseInt(process.env.PERMISSIONS_CACHE_TTL || '300000'),

  ROLES: {
    ADMIN: 'admin',
    USER: 'user',
    MODERATOR: 'moderator',
    GUEST: 'guest',
  },

  PERMISSIONS: {
    USERS_READ: 'users:read',
    USERS_CREATE: 'users:create',
    USERS_UPDATE: 'users:update',
    USERS_DELETE: 'users:delete',
    POSTS_READ: 'posts:read',
    POSTS_CREATE: 'posts:create',
    POSTS_UPDATE: 'posts:update',
    POSTS_DELETE: 'posts:delete',
    ADMIN_PANEL: 'admin:panel',
    ADMIN_SETTINGS: 'admin:settings',
  },
};
