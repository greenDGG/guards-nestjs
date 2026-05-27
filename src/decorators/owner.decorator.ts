import { SetMetadata } from '@nestjs/common';
import { GUARD_METADATA } from '../constants/guard.constants';
import { JwtPayload } from '../interfaces/jwt-payload.interface';

export interface OwnershipOptions {
  /**
   * Route param whose value must match the JWT subject.
   * Example: param: 'userId' → /users/:userId → checks req.params.userId === jwt.sub
   */
  param?: string;

  /**
   * Body field whose value must match the JWT subject.
   * Example: body: 'authorId' → { authorId: '42' } → checks body.authorId === jwt.sub
   */
  body?: string;

  /**
   * Header whose value must match the JWT subject.
   * Example: header: 'x-user-id'
   */
  header?: string;

  /**
   * Async resolver for when the resource ID in the URL belongs to the resource (e.g., postId),
   * not to the user. Fetch the record and return the owner's user ID.
   *
   * Example:
   *   resolver: async (req) => {
   *     const post = await postRepo.findById(req.params.postId);
   *     return post?.authorId ?? null;
   *   }
   */
  resolver?: (req: any) => Promise<string | number | null> | string | number | null;

  /**
   * Which JWT field to compare the resolved owner ID against.
   * Defaults to 'sub' (the standard JWT subject claim).
   */
  jwtField?: keyof JwtPayload;

  /**
   * Roles that bypass the ownership check (they can access any resource).
   * Defaults to ['admin'].
   */
  bypassRoles?: string[];
}

export const Owner = (options: OwnershipOptions) =>
  SetMetadata(GUARD_METADATA.OWNERSHIP_OPTIONS, options);
