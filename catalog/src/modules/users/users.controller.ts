import { Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthGuard, OptionalAuthGuard } from '../../common/guards/auth.guard';
import { UsersService } from './users.service';

type Actor = { id: string; roles: string[] };

/** Profile side of "who am I", the demo list and public profiles (sign-in itself lives in the identity service). */
@Controller()
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('auth/me')
  @UseGuards(AuthGuard)
  async me(@CurrentUser() user: Actor) {
    return { success: true, data: await this.users.me(user.id) };
  }

  @Get('auth/accounts')
  demoAccounts() {
    return this.users.demoAccounts();
  }

  @Get('profile/me')
  @UseGuards(AuthGuard)
  async ownProfile(@CurrentUser() user: Actor) {
    return { success: true, data: await this.users.ownProfile(user.id) };
  }

  @Put('profile/me')
  @UseGuards(AuthGuard)
  async updateProfile(@CurrentUser() user: Actor, @Body() body: unknown) {
    return {
      success: true,
      message: 'Cập nhật hồ sơ cá nhân thành công',
      data: await this.users.updateProfile(user.id, body),
    };
  }

  @Put('profile/me/settings')
  @UseGuards(AuthGuard)
  async updateSettings(@CurrentUser() user: Actor, @Body() body: unknown) {
    return {
      success: true,
      message: 'Cập nhật cấu hình trải nghiệm đọc thành công',
      data: await this.users.updateSettings(user.id, body),
    };
  }

  @Get('users')
  async list() {
    return { success: true, data: await this.users.list() };
  }

  @Get('users/:username')
  @UseGuards(OptionalAuthGuard)
  async publicProfile(@Param('username') username: string, @CurrentUser() viewer?: Actor) {
    return { success: true, data: await this.users.publicProfile(username, viewer) };
  }
}
