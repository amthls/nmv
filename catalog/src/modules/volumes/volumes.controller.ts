import { Body, Controller, Delete, Param, Post, Put, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthGuard } from '../../common/guards/auth.guard';
import { VolumeUser, VolumesService } from './volumes.service';

/** Volumes: created and re-ordered under their story, edited and deleted by id. */
@Controller()
@UseGuards(AuthGuard)
export class VolumesController {
  constructor(private readonly volumes: VolumesService) {}

  @Post('stories/:storyId/volumes')
  async create(@Param('storyId') storyId: string, @CurrentUser() user: VolumeUser, @Body() body: any) {
    const { title, volume } = await this.volumes.create(storyId, user, body);
    return { success: true, message: `Tạo ${title} thành công`, data: volume };
  }

  @Put('stories/:storyId/volumes/reorder')
  async reorder(@Param('storyId') storyId: string, @CurrentUser() user: VolumeUser, @Body() body: any) {
    return { success: true, message: 'Đã sắp xếp lại các tập.', data: await this.volumes.reorder(storyId, user, body) };
  }

  @Put('volumes/:id')
  async update(@Param('id') id: string, @CurrentUser() user: VolumeUser, @Body() body: any) {
    return { success: true, message: 'Đã cập nhật tập.', data: await this.volumes.update(id, user, body) };
  }

  @Delete('volumes/:id')
  async remove(@Param('id') id: string, @CurrentUser() user: VolumeUser) {
    return { success: true, message: await this.volumes.remove(id, user) };
  }
}
