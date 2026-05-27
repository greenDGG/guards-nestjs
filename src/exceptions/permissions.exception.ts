import { ForbiddenException } from '@nestjs/common';

export class InsufficientRolesException extends ForbiddenException {
  constructor(requiredRoles: string[] = []) {
    super(`Insufficient roles. Required one of: ${requiredRoles.join(', ')}`);
    this.name = 'InsufficientRolesException';
  }
}

export class InsufficientPermissionsException extends ForbiddenException {
  constructor(requiredPermissions: string[] = []) {
    super(`Insufficient permissions. Required: ${requiredPermissions.join(', ')}`);
    this.name = 'InsufficientPermissionsException';
  }
}

export class AccessDeniedException extends ForbiddenException {
  constructor(message: string = 'Access denied') {
    super(message);
    this.name = 'AccessDeniedException';
  }
}
