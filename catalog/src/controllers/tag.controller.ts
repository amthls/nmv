import { Request, Response } from 'express';
import { pool } from '../config/db';

export const getTags = async (req: Request, res: Response) => {
  try {
    const result = await pool.query(`
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

    res.json({
      success: true,
      data: result.rows,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};
