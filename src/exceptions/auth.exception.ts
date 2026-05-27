import { UnauthorizedException } from '@nestjs/common';

export class InvalidCredentialsException extends UnauthorizedException {
  constructor(message: string = 'Invalid credentials provided') {
    super(message);
    this.name = 'InvalidCredentialsException';
  }
}

export class TokenExpiredException extends UnauthorizedException {
  constructor(message: string = 'JWT token has expired') {
    super(message);
    this.name = 'TokenExpiredException';
  }
}

export class TokenNotFoundException extends UnauthorizedException {
  constructor(message: string = 'No token provided in request') {
    super(message);
    this.name = 'TokenNotFoundException';
  }
}

export class InvalidTokenException extends UnauthorizedException {
  constructor(message: string = 'Invalid or malformed token') {
    super(message);
    this.name = 'InvalidTokenException';
  }
}
