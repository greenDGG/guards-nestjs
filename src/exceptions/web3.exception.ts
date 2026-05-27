import { ForbiddenException, UnauthorizedException } from '@nestjs/common';

export class InvalidWalletSignatureException extends UnauthorizedException {
  constructor() {
    super('Wallet signature is invalid or does not match the claimed address');
    this.name = 'InvalidWalletSignatureException';
  }
}

export class WalletNonceExpiredException extends UnauthorizedException {
  constructor() {
    super('Wallet authentication nonce has expired or was already used');
    this.name = 'WalletNonceExpiredException';
  }
}

export class SuspiciousWalletException extends ForbiddenException {
  constructor(score: number) {
    super(`Wallet blocked due to suspicious activity (score: ${score}/100)`);
    this.name = 'SuspiciousWalletException';
  }
}

export class InsufficientTokenBalanceException extends ForbiddenException {
  constructor(minBalance: string, tokenAddress: string) {
    super(`Insufficient token balance. Required minimum: ${minBalance} of token ${tokenAddress}`);
    this.name = 'InsufficientTokenBalanceException';
  }
}

export class InvalidChainIdException extends ForbiddenException {
  constructor(received: number | string, allowed: number[]) {
    super(`Chain ID '${received}' is not supported. Allowed chains: ${allowed.join(', ')}`);
    this.name = 'InvalidChainIdException';
  }
}
