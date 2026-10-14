import { Injectable } from '@nestjs/common';
import { DbService } from '../../infra/database/db.service';

/** SQL of the export requests and downloads (the build queue itself is in ./builder). */
@Injectable()
export class ExportsRepository {
  constructor(private readonly db: DbService) {}

  async findById(id: string) {
    return (await this.db.query(`SELECT * FROM story_exports WHERE id = $1`, [id])).rows[0];
  }

  markGone(id: string) {
    return this.db.query(`UPDATE story_exports SET status = 'failed', error = 'Tệp đã bị xóa, hãy tạo lại.' WHERE id = $1`, [id]);
  }

  recordDownload(id: string) {
    return this.db.query(`UPDATE story_exports SET download_count = download_count + 1, last_used_at = NOW() WHERE id = $1`, [id]);
  }
}
