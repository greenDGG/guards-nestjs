function parseEnvInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const n = parseInt(raw, 10);
  if (isNaN(n)) {
    console.warn(`\x1b[33m⚠️  [CONFIG WARNING]\x1b[0m ${name}="${raw}" is not a valid integer — using default ${fallback}`);
    return fallback;
  }
  return n;
}

// Fail fast if critical secrets are missing or still set to the insecure demo value.
// In production, all secrets must come from the environment — no fallback.
// In development, a fallback is allowed but a warning is printed.
(function validateSecrets() {
  const insecure = ['your-secret-key-change-in-production', 'your-refresh-secret-key'];
  const isProd = process.env.NODE_ENV === 'production';

  if (!process.env.JWT_SECRET || insecure.includes(process.env.JWT_SECRET)) {
    const msg = 'JWT_SECRET is missing or set to the insecure demo value. Set it in .env.';
    if (isProd) throw new Error(`[SECURITY] ${msg}`);
    console.warn(`\x1b[33m⚠️  [SECURITY WARNING]\x1b[0m ${msg}`);
  }
  if (!process.env.JWT_REFRESH_SECRET || insecure.includes(process.env.JWT_REFRESH_SECRET)) {
    const msg = 'JWT_REFRESH_SECRET is missing or set to the insecure demo value. Set it in .env.';
    if (isProd) throw new Error(`[SECURITY] ${msg}`);
    console.warn(`\x1b[33m⚠️  [SECURITY WARNING]\x1b[0m ${msg}`);
  }
})();

export const AUTH_CONSTANTS = {
  JWT_SECRET:              process.env.JWT_SECRET              ?? 'dev-insecure-jwt-secret',
  JWT_EXPIRATION:          parseEnvInt('JWT_EXPIRATION', 3600),
  JWT_REFRESH_SECRET:      process.env.JWT_REFRESH_SECRET      ?? 'dev-insecure-refresh-secret',
  JWT_REFRESH_EXPIRATION:  parseEnvInt('JWT_REFRESH_EXPIRATION', 604800),
  PERMISSIONS_CACHE_TTL:   parseEnvInt('PERMISSIONS_CACHE_TTL', 300000),

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
