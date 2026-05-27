import { Controller, Get, Post, Param, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { Roles } from '../decorators/roles.decorator';
import { Permissions } from '../decorators/permissions.decorator';
import { CurrentUser } from '../decorators/current-user.decorator';
import { JwtPayload } from '../interfaces/jwt-payload.interface';
import { AUTH_CONSTANTS } from '../constants/auth.constants';

@Controller('posts')
export class PostsController {
  private posts = [
    { id: 1, title: 'First Post', content: 'Content 1', authorId: 2 },
    { id: 2, title: 'Second Post', content: 'Content 2', authorId: 2 },
    { id: 3, title: 'Admin Post', content: 'Admin content', authorId: 1 },
  ];

  @Get()
  @Permissions([AUTH_CONSTANTS.PERMISSIONS.POSTS_READ])
  getAllPosts() {
    return { message: 'Posts retrieved', count: this.posts.length, posts: this.posts };
  }

  @Get(':id')
  @Permissions([AUTH_CONSTANTS.PERMISSIONS.POSTS_READ])
  getPost(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return { message: 'Post retrieved', user: user.username, post: this.posts.find((p) => p.id === Number(id)) };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Permissions([AUTH_CONSTANTS.PERMISSIONS.POSTS_CREATE])
  createPost(@Body() dto: { title: string; content: string }, @CurrentUser() user: JwtPayload) {
    const newPost = { id: this.posts.length + 1, ...dto, authorId: user.sub as number };
    this.posts.push(newPost);
    return { message: 'Post created', post: newPost, createdBy: user.username };
  }

  @Post(':id/admin-approve')
  @HttpCode(HttpStatus.OK)
  @Roles([AUTH_CONSTANTS.ROLES.ADMIN])
  approvePost(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    const post = this.posts.find((p) => p.id === Number(id));
    if (!post) return { error: 'Post not found' };
    return { message: 'Post approved', post, approvedBy: user.username, approvedAt: new Date().toISOString() };
  }

  @Post(':id/delete')
  @HttpCode(HttpStatus.OK)
  @Permissions([AUTH_CONSTANTS.PERMISSIONS.POSTS_UPDATE, AUTH_CONSTANTS.PERMISSIONS.POSTS_DELETE])
  deletePost(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    const index = this.posts.findIndex((p) => p.id === Number(id));
    if (index === -1) return { error: 'Post not found' };
    const deleted = this.posts.splice(index, 1)[0];
    return { message: 'Post deleted', post: deleted, deletedBy: user.username };
  }

  @Get('admin/stats')
  @Roles([AUTH_CONSTANTS.ROLES.ADMIN])
  getAdminStats(@CurrentUser() user: JwtPayload) {
    return {
      message: 'Admin stats',
      accessedBy: user.username,
      stats: { totalPosts: this.posts.length, totalAuthors: new Set(this.posts.map((p) => p.authorId)).size },
    };
  }
}
