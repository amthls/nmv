import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { InternalAuthGuard } from '../../common/guards/auth.guard';
import { isUuid } from '../../utils/validation';
import { LibrarySyncRepository, SyncKind } from './library-sync.repository';

/** Library -> catalog (X-Internal-Auth): changed stories/chapters for its read copies, every id (nightly reconcile). */
@Controller('internal/library')
@UseGuards(InternalAuthGuard)
export class LibrarySyncInternalController {
  constructor(private readonly repo: LibrarySyncRepository) {}

  /** GET /internal/library/stories?since=&after=&limit= (or ?ids=a,b: exact rows, the cursor is not involved) */
  @Get('stories')
  stories(@Query() query: any) {
    return this.sync('stories', query);
  }

  @Get('chapters')
  chapters(@Query() query: any) {
    return this.sync('chapters', query);
  }

  /** GET /internal/library/ids?type=story|chapter -> every id (the library drops copies of rows that are gone). */
  @Get('ids')
  async ids(@Query() query: any) {
    return { success: true, data: await this.repo.allIds(query.type === 'chapter' ? 'chapters' : 'stories') };
  }

  private async sync(kind: SyncKind, query: any) {
    const since = typeof query.since === 'string' && query.since ? query.since : '1970-01-01T00:00:00Z';
    const after = isUuid(query.after) ? query.after : '00000000-0000-0000-0000-000000000000';
    const limit = Math.min(Math.max(Number(query.limit) || 500, 1), 2000);
    if (typeof query.ids === 'string') {
      const ids = query.ids.split(',').filter(isUuid).slice(0, 100);
      return { success: true, data: await this.repo.byIds(kind, ids) };
    }
    return { success: true, data: await this.repo.changedSince(kind, since, after, limit) };
  }
}
