import { Controller, Get, UseGuards } from '@nestjs/common';
import { Mw } from '../../common/guards/express-middleware.guard';
import { cacheJson } from '../../middlewares/cache';
import { TagsService } from './tags.service';

@Controller('tags')
export class TagsController {
  constructor(private readonly tags: TagsService) {}

  /** GET /api/v1/tags (same for everyone: cached 10 minutes). */
  @Get()
  @UseGuards(Mw(cacheJson(600)))
  async list() {
    return { success: true, data: await this.tags.list() };
  }
}
