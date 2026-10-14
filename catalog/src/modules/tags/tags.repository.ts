import { Injectable } from '@nestjs/common';
import { DbService } from '../../infra/database/db.service';

/** SQL of the tags feature. */
@Injectable()
export class TagsRepository {
  constructor(private readonly db: DbService) {}

  /** Every tag category with its tags, in display order. */
  async listByCategory() {
    const result = await this.db.query(`
      SELECT
        c.id as category_id,
        c.name as category_name,
        c.label as category_label,
        json_agg(
          json_build_object(
            'id', t.id,
            'name', t.name,
            'slug', t.slug,
            'description', t.description
          ) ORDER BY t.name
        ) as tags
      FROM tag_categories c
      LEFT JOIN tags t ON c.id = t.category_id
      GROUP BY c.id, c.name, c.label, c.sort_order
      ORDER BY c.sort_order;
    `);
    return result.rows;
  }
}
