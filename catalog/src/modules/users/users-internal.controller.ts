import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { IdentityHeaderGuard, InternalAuthGuard } from '../../common/guards/auth.guard';
import { UsersService } from './users.service';

/** Service-to-service routes about users (not under /api/v1: the gateway answers 404 for /internal from outside). */
@Controller('internal/users')
export class UsersInternalController {
  constructor(private readonly users: UsersService) {}

  /** identity → catalog (signed actor headers): may this account be deleted without orphaning a group? */
  @Get(':id/delete-check')
  @UseGuards(IdentityHeaderGuard)
  deleteCheck(@Param('id') id: string) {
    return this.users.deleteCheck(id);
  }

  /** messaging → catalog (X-Internal-Auth): names/avatars to show. */
  @Post('profiles')
  @HttpCode(200)
  @UseGuards(InternalAuthGuard)
  async profiles(@Body() body: unknown) {
    return { success: true, data: await this.users.profiles(body) };
  }
}
