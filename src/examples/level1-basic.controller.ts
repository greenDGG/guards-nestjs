import { Controller, Get, Param, UseGuards, SetMetadata } from '@nestjs/common';
import { Public } from '../decorators/public.decorator';
import { Roles } from '../decorators/roles.decorator';
import { Permissions } from '../decorators/permissions.decorator';
import { CurrentUser } from '../decorators/current-user.decorator';
import { Owner } from '../decorators/owner.decorator';
import { ApiKeyGuard } from '../guards/basic/api-key.guard';
import { BasicAuthGuard } from '../guards/basic/basic-auth.guard';
import { OwnershipGuard } from '../guards/basic/ownership.guard';
import { GUARD_METADATA } from '../constants/guard.constants';
import { JwtPayload } from '../interfaces/jwt-payload.interface';

/**
 * Level 1 — Basic Guards Demo
 * Base: http://localhost:3000/demo/level1
 *
 * Test commands at the bottom of this file.
 */
@Controller('demo/level1')
export class Level1BasicController {

  // ── Public ────────────────────────────────────────────────────────────────
  // GET /demo/level1/public
  // No auth required — anyone can access
  @Public()
  @Get('public')
  publicRoute() {
    return { guard: 'none', message: 'Este endpoint es público, sin autenticación' };
  }

  // ── JWT Auth ──────────────────────────────────────────────────────────────
  // GET /demo/level1/jwt
  // Requires: Authorization: Bearer <token>
  @Get('jwt')
  jwtProtected(@CurrentUser() user: JwtPayload) {
    return {
      guard: 'JwtAuthGuard',
      message: 'Token JWT válido',
      user: { id: user.sub, username: user.username, roles: user.roles },
    };
  }

  // ── Roles ─────────────────────────────────────────────────────────────────
  // GET /demo/level1/admin-only
  // Requires: JWT + role 'admin'
  @Get('admin-only')
  @Roles(['admin'])
  adminOnly(@CurrentUser() user: JwtPayload) {
    return {
      guard: 'RolesGuard',
      message: 'Solo admins pueden ver esto',
      user: user.username,
    };
  }

  // GET /demo/level1/staff
  // Requires: JWT + role 'admin' OR 'moderator'
  @Get('staff')
  @Roles(['admin', 'moderator'])
  staffOnly(@CurrentUser() user: JwtPayload) {
    return {
      guard: 'RolesGuard',
      message: 'Admin o moderador — lógica OR entre roles',
      user: user.username,
      roles: user.roles,
    };
  }

  // ── Permissions ───────────────────────────────────────────────────────────
  // GET /demo/level1/read-users
  // Requires: JWT + permission 'users:read'
  @Get('read-users')
  @Permissions(['users:read'])
  readUsers(@CurrentUser() user: JwtPayload) {
    return {
      guard: 'PermissionsGuard',
      message: 'Permiso users:read verificado',
      user: user.username,
    };
  }

  // GET /demo/level1/delete-post
  // Requires: JWT + permissions 'posts:update' AND 'posts:delete' (lógica AND)
  @Get('delete-post')
  @Permissions(['posts:update', 'posts:delete'])
  deletePost(@CurrentUser() user: JwtPayload) {
    return {
      guard: 'PermissionsGuard',
      message: 'posts:update AND posts:delete — lógica AND entre permisos',
      user: user.username,
    };
  }

  // ── API Key ───────────────────────────────────────────────────────────────
  // GET /demo/level1/api-key
  // Requires: x-api-key: demo-key-123
  @Get('api-key')
  @SetMetadata(GUARD_METADATA.API_KEY_OPTIONS, { keys: ['demo-key-123', 'otro-key-456'] })
  @UseGuards(ApiKeyGuard)
  @Public()
  apiKey() {
    return {
      guard: 'ApiKeyGuard',
      message: 'API key válida — Header: x-api-key: demo-key-123',
    };
  }

  // ── Basic Auth ────────────────────────────────────────────────────────────
  // GET /demo/level1/basic-auth
  // Requires: Authorization: Basic YWRtaW46c2VjcmV0MTIz  (admin:secret123)
  @Get('basic-auth')
  @UseGuards(new BasicAuthGuard({ credentials: { admin: 'secret123', dev: 'dev456' }, realm: 'Demo' }))
  @Public()
  basicAuth() {
    return {
      guard: 'BasicAuthGuard',
      message: 'HTTP Basic Auth válido',
      hint: 'Credentials: admin:secret123 o dev:dev456',
    };
  }

  // ── Ownership — param coincide con JWT sub ────────────────────────────────
  // GET /demo/level1/users/:userId/profile
  // Solo el propio usuario puede ver su perfil. Admin puede ver cualquiera.
  // Prueba:
  //   token de userId=1 (admin) → GET /demo/level1/users/1/profile  ✅
  //   token de userId=1 (admin) → GET /demo/level1/users/99/profile ✅ (bypass admin)
  //   token de userId=2 (user)  → GET /demo/level1/users/2/profile  ✅
  //   token de userId=2 (user)  → GET /demo/level1/users/1/profile  ❌ 403
  @Get('users/:userId/profile')
  @Owner({ param: 'userId' })
  @UseGuards(OwnershipGuard)
  userProfile(@Param('userId') userId: string, @CurrentUser() user: JwtPayload) {
    return {
      guard: 'OwnershipGuard',
      pattern: 'param: userId === jwt.sub',
      message: 'Solo puedes ver tu propio perfil (IDOR bloqueado)',
      requestedUserId: userId,
      tokenUserId: user.sub,
      roles: user.roles,
    };
  }

  // ── Ownership — sin bypass de admin ──────────────────────────────────────
  // Útil cuando ni el admin puede ver datos sensibles de otro usuario (ej: secretos 2FA)
  // GET /demo/level1/users/:userId/secret
  @Get('users/:userId/secret')
  @Owner({ param: 'userId', bypassRoles: [] })
  @UseGuards(OwnershipGuard)
  userSecret(@Param('userId') userId: string, @CurrentUser() user: JwtPayload) {
    return {
      guard: 'OwnershipGuard',
      pattern: 'param: userId === jwt.sub (sin bypass — ni admin entra)',
      message: 'Dato sensible — solo el propio usuario puede verlo',
      requestedUserId: userId,
      tokenUserId: user.sub,
    };
  }
}

/*
 * ═══════════════════════════════════════════════════════
 * COMANDOS DE PRUEBA — ejecutar desde scripts/test-*.ts
 * ═══════════════════════════════════════════════════════
 *
 * # Público (siempre pasa)
 * GET /demo/level1/public
 *
 * # JWT (necesita token)
 * GET /demo/level1/jwt   Header: Authorization: Bearer <token>
 *
 * # Admin (solo role=admin)
 * GET /demo/level1/admin-only   Header: Authorization: Bearer <admin-token>
 *
 * # API Key
 * GET /demo/level1/api-key   Header: x-api-key: demo-key-123
 *
 * # Basic Auth (admin:secret123 en base64 = YWRtaW46c2VjcmV0MTIz)
 * GET /demo/level1/basic-auth   Header: Authorization: Basic YWRtaW46c2VjcmV0MTIz
 */
