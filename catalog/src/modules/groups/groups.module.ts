import { Module } from '@nestjs/common';
import { GroupsController } from './groups.controller';
import { GroupsInternalController } from './groups-internal.controller';
import { GroupsRepository } from './groups.repository';
import { GroupsService } from './groups.service';
import { JoinRequestsService } from './join-requests.service';

/** Translation groups, members, join requests, workflow. */
@Module({
  controllers: [GroupsController, GroupsInternalController],
  providers: [GroupsService, JoinRequestsService, GroupsRepository],
  exports: [GroupsService],
})
export class GroupsModule {}
