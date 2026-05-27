import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { Request, Response } from 'express';
import { InvalidBasicAuthException } from '../../exceptions/security.exception';

export interface BasicAuthOptions {
  credentials?: Record<string, string>;
  validator?: (username: string, password: string) => Promise<boolean>;
  realm?: string;
}

/**
 * Level 1 — HTTP Basic Authentication Guard
 *
 * Validates the standard Authorization: Basic <base64(user:pass)> header.
 * Passwords may contain colons — only the first colon is used as separator.
 *
 * Usage:
 *   @UseGuards(new BasicAuthGuard({ credentials: { admin: 'secret123' } }))
 *   @Get('admin')
 *   admin() {}
 *
 *   // With async validator (e.g., database lookup):
 *   @UseGuards(new BasicAuthGuard({ validator: async (u, p) => db.validateUser(u, p), realm: 'MyApp' }))
 */
@Injectable()
export class BasicAuthGuard implements CanActivate {
  private readonly logger = new Logger(BasicAuthGuard.name);
  private readonly options: BasicAuthOptions;

  constructor(options: BasicAuthOptions = {}) {
    this.options = { realm: 'API', ...options };
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();

    const authHeader = request.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Basic ')) {
      this.sendChallenge(response);
      throw new InvalidBasicAuthException(this.options.realm);
    }

    const base64 = authHeader.slice(6);
    const decoded = Buffer.from(base64, 'base64').toString('utf-8');
    const colonIndex = decoded.indexOf(':');

    if (colonIndex === -1) {
      this.sendChallenge(response);
      throw new InvalidBasicAuthException(this.options.realm);
    }

    const username = decoded.slice(0, colonIndex);
    const password = decoded.slice(colonIndex + 1);

    const valid = await this.validateCredentials(username, password);

    if (!valid) {
      this.logger.warn(`Basic auth failed for user: ${username}`);
      this.sendChallenge(response);
      throw new InvalidBasicAuthException(this.options.realm);
    }

    this.logger.debug(`Basic auth accepted for: ${username}`);
    return true;
  }

  private async validateCredentials(username: string, password: string): Promise<boolean> {
    if (this.options.validator) {
      return this.options.validator(username, password);
    }
    if (this.options.credentials) {
      return this.options.credentials[username] === password;
    }
    return false;
  }

  private sendChallenge(response: Response): void {
    response.setHeader('WWW-Authenticate', `Basic realm="${this.options.realm}"`);
  }
}
