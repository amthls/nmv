import { Injectable } from '@nestjs/common';
import { DbService, Queryable } from '../../infra/database/db.service';

/** SQL of volumes (tập) of a story. */
@Injectable()
export class VolumesRepository {
  constructor(private readonly db: DbService) {}

  async nextNumber(storyId: string): Promise<number> {
    const maxRes = await this.db.query(`SELECT COALESCE(MAX(volume_number), 0) + 1 AS next FROM volumes WHERE story_id = $1`, [storyId]);
    return Number(maxRes.rows[0].next);
  }

  /** Inserts a volume and refreshes the story's count; null when the number is taken. */
  async insert(storyId: string, title: string, num: number, coverUrl: string | null, desc: string | null) {
    const volRes = await this.db.query(`
      INSERT INTO volumes (story_id, title, volume_number, cover_image_url, description)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (story_id, volume_number) DO NOTHING
      RETURNING *;
    `, [storyId, title, num, coverUrl, desc]);
    if (volRes.rows.length === 0) return null;

    // Update total_volumes
    await this.db.query(`
      UPDATE stories SET total_volumes = (SELECT count(*) FROM volumes WHERE story_id = $1)
      WHERE id = $1;
    `, [storyId]);
    return volRes.rows[0];
  }

  async byId(id: string) {
    const volRes = await this.db.query(`SELECT * FROM volumes WHERE id = $1`, [id]);
    return volRes.rows[0] || null;
  }

  async update(id: string, title: string, description: string | null, cover: string | null) {
    const updRes = await this.db.query(`
      UPDATE volumes SET
        title = $1, description = $2, cover_image_url = $3, updated_at = NOW()
      WHERE id = $4 RETURNING *;
    `, [title, description, cover, id]);
    return updRes.rows[0];
  }

  /** Deletes a volume; its chapters stay and become "unassigned". Returns how many chapters were moved. */
  deleteKeepingChapters(id: string, storyId: string): Promise<number> {
    return this.db.withTransaction(async (tx) => {
      await tx.query(`UPDATE chapter_submissions SET volume_id = NULL WHERE volume_id = $1`, [id]);
      const moved = await tx.query(`UPDATE chapters SET volume_id = NULL WHERE volume_id = $1`, [id]);
      await tx.query(`DELETE FROM volumes WHERE id = $1`, [id]);
      await tx.query(
        `UPDATE stories SET total_volumes = (SELECT count(*) FROM volumes WHERE story_id = $1) WHERE id = $1`,
        [storyId],
      );
      return moved.rowCount ?? 0;
    });
  }

  /** Rewrites volume_number and sort_order as 1..n in `order`; `check` sees the story's current ids first and may throw. */
  reorder(storyId: string, order: string[], check: (existingIds: Set<string>) => void) {
    return this.db.withTransaction(async (tx: Queryable) => {
      const existing = await tx.query(`SELECT id FROM volumes WHERE story_id = $1`, [storyId]);
      check(new Set<string>(existing.rows.map((r) => r.id)));
      // Two phases: (story_id, volume_number) is UNIQUE, so park numbers out of range first.
      await tx.query(`UPDATE volumes SET volume_number = volume_number + 100000 WHERE story_id = $1`, [storyId]);
      for (let i = 0; i < order.length; i++) {
        await tx.query(
          `UPDATE volumes SET volume_number = $1, sort_order = $1, updated_at = NOW() WHERE id = $2 AND story_id = $3`,
          [i + 1, order[i], storyId],
        );
      }
    });
  }

  async listByStory(storyId: string) {
    const result = await this.db.query(`SELECT * FROM volumes WHERE story_id = $1 ORDER BY volume_number`, [storyId]);
    return result.rows;
  }
}
