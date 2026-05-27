import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AUTH_CONSTANTS } from '../constants/auth.constants';
import { AuthController } from './auth.controller';
import { PostsController } from './posts.controller';
import { AuthService } from '../services/auth.service';
import { JwtService as CustomJwtService } from '../services/jwt.service';
import { PermissionsService } from '../services/permissions.service';
import { PermissionsCacheService } from '../services/permissions-cache.service';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.register({
      secret: AUTH_CONSTANTS.JWT_SECRET,
      signOptions: { expiresIn: AUTH_CONSTANTS.JWT_EXPIRATION },
    }),
  ],
  controllers: [AuthController, PostsController],
  providers: [AuthService, CustomJwtService, PermissionsService, PermissionsCacheService],
  exports: [CustomJwtService, PermissionsService, PermissionsCacheService],
})
export class AuthModule {}
