import { Injectable } from '@nestjs/common';
import { DbService } from '../../infra/database/db.service';

/** SQL of the smart-code lookups owned by catalog (users, groups, stories, chapters). Each returns the page path or null. */
@Injectable()
export class CodesRepository {
  constructor(private readonly db: DbService) {}

  private async one(sql: string, params: unknown[]): Promise<string | null> {
    return (await this.db.query(sql, params)).rows[0]?.path ?? null;
  }

  user(no: number, isStaff: boolean) {
    return this.one(`SELECT '/nguoi-dung/' || username AS path FROM users
                            WHERE code_no = $1 AND ($2 OR (deleted_at IS NULL AND NOT COALESCE(is_banned, false)))`,
                    [no, isStaff]);
  }

  group(no: number) {
    return this.one(`SELECT '/nhom-dich/' || slug AS path FROM translation_groups WHERE code_no = $1`, [no]);
  }

  story(no: number) {
    return this.one(`SELECT '/truyen/' || slug AS path FROM stories WHERE code_no = $1 AND approval_status = 'approved'`, [no]);
  }

  chapter(no: number, chapter: string) {
    return this.one(`SELECT '/truyen/' || s.slug || '/' || c.slug AS path FROM stories s
                            JOIN chapters c ON c.story_id = s.id AND c.chapter_number = $2::numeric AND c.is_published = true
                            WHERE s.code_no = $1 AND s.approval_status = 'approved' LIMIT 1`, [no, chapter]);
  }
}
