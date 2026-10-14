import { Body, Controller, Delete, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthGuard } from '../../common/guards/auth.guard';
import { ChaptersService, ChapterUser } from './chapters.service';

/** Chapters under /api/v1/chapters (publishing goes straight to the reading copy, no review). Static path before :id. */
@Controller('chapters')
@UseGuards(AuthGuard)
export class ChaptersController {
  constructor(private readonly chapters: ChaptersService) {}

  // POST answers 201 (published and saved-as-draft alike), as before
  @Post('submissions')
  async submit(@CurrentUser() user: ChapterUser, @Body() body: any) {
    const { message, data } = await this.chapters.submit(user, body);
    return { success: true, message, data };
  }

  @Get(':id')
  async getForEdit(@Param('id') id: string, @CurrentUser() user: ChapterUser) {
    return { success: true, data: await this.chapters.getForEdit(id, user) };
  }

  @Put(':id')
  async update(@Param('id') id: string, @CurrentUser() user: ChapterUser, @Body() body: any) {
    const { message, data } = await this.chapters.update(id, user, body);
    return { success: true, message, data };
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @CurrentUser() user: ChapterUser) {
    return { success: true, message: await this.chapters.remove(id, user) };
  }
}
