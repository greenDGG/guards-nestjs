export interface JwtPayload {
  sub: number | string;
  username: string;
  email?: string;
  roles: string[];
  permissions: string[];
  // Level 5: business guards
  tenantId?: string;
  subscriptionPlan?: string;
  mfaVerifiedAt?: number;
  // Level 6: Web3 guards
  walletAddress?: string;
  chainId?: number;
  iat?: number;
  exp?: number;
}
