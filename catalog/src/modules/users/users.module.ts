import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersInternalController } from './users-internal.controller';
import { UsersRepository } from './users.repository';
import { UsersService } from './users.service';

/** Profiles, settings and public user pages. */
@Module({
  controllers: [UsersController, UsersInternalController],
  providers: [UsersService, UsersRepository],
  exports: [UsersService],
})
export class UsersModule {}
