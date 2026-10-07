import { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { pool } from '../config/db';
import { AuthenticatedRequest } from '../middlewares/auth.middleware';
import { isUuid } from '../utils/validation';
import { EXPORT_DIR, ExportRequestError, MIME, requestExport } from '../services/export';
import { MAX_EXPORT_CHAPTERS } from '../services/export/content';

function serialize(row: any) {
  return {
    id: row.id,
    status: row.status as 'queued' | 'processing' | 'ready' | 'failed',
    progress: row.progress,
    format: row.format,
    mode: row.mode,
    chapter_count: Array.isArray(row.chapter_ids) ? row.chapter_ids.length : undefined,
    file_name: row.file_name,
    file_size: row.file_size === null || row.file_size === undefined ? null : Number(row.file_size),
    error: row.status === 'failed' ? row.error || 'Tạo tệp thất bại.' : null,
  };
}

/** POST /stories/:slug/exports  { format: 'epub'|'pdf', mode: 'merged'|'single', chapter_ids?: uuid[] } */
export const createExport = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { slug } = req.params;
    const { format, mode, chapter_ids } = req.body || {};
    if (format !== 'epub' && format !== 'pdf') {
      return res.status(400).json({ success: false, message: 'Định dạng phải là EPUB hoặc PDF.' });
    }
    if (mode !== 'merged' && mode !== 'single') {
      return res.status(400).json({ success: false, message: 'Hãy chọn gộp thành 1 tệp hoặc mỗi chương 1 tệp.' });
    }
    let chapterIds: string[] | null = null;
    if (chapter_ids !== undefined && chapter_ids !== null && chapter_ids !== 'all') {
      if (!Array.isArray(chapter_ids) || chapter_ids.length === 0 || !chapter_ids.every(isUuid)) {
        return res.status(400).json({ success: false, message: 'Danh sách chương không hợp lệ.' });
      }
      if (chapter_ids.length > MAX_EXPORT_CHAPTERS) {
        return res.status(400).json({ success: false, message: `Mỗi lần tải tối đa ${MAX_EXPORT_CHAPTERS} chương.` });
      }
      chapterIds = Array.from(new Set<string>(chapter_ids));
    }

    const storyRes = await pool.query(
      `SELECT id, allow_download, approval_status FROM stories WHERE slug = $1`,
      [slug]
    );
    const story = storyRes.rows[0];
    if (!story || story.approval_status !== 'approved') {
      return res.status(404).json({ success: false, message: 'Không tìm thấy truyện.' });
    }
    if (!story.allow_download) {
      return res.status(403).json({ success: false, message: 'Truyện này chưa bật tính năng tải xuống.' });
    }

    const row = await requestExport({
      storyId: story.id,
      format,
      mode,
      chapterIds,
      userId: req.user?.id || null,
    });
    res.json({ success: true, data: serialize(row) });
  } catch (err: any) {
    if (err instanceof ExportRequestError) return res.status(err.status).json({ success: false, message: err.message });
    console.error('[Export] request failed:', err);
    res.status(500).json({ success: false, message: 'Không thể tạo yêu cầu tải xuống.' });
  }
};

/** GET /exports/:id  -> progress of a build */
export const getExport = async (req: Request, res: Response) => {
  const { id } = req.params;
  if (!isUuid(id)) return res.status(404).json({ success: false, message: 'Không tìm thấy yêu cầu tải.' });
  const r = await pool.query(`SELECT * FROM story_exports WHERE id = $1`, [id]);
  if (!r.rows[0]) return res.status(404).json({ success: false, message: 'Không tìm thấy yêu cầu tải.' });
  res.json({ success: true, data: serialize(r.rows[0]) });
};

function contentDisposition(fileName: string) {
  const ascii = fileName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .replace(/[^\x20-\x7e]/g, '_')
    .replace(/["\\]/g, '_');
  const encoded = encodeURIComponent(fileName).replace(/['()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

/** GET /exports/:id/download  -> the file, while the story still allows downloads */
export const downloadExport = async (req: Request, res: Response) => {
  const { id } = req.params;
  if (!isUuid(id)) return res.status(404).json({ success: false, message: 'Không tìm thấy tệp.' });
  const r = await pool.query(
    `SELECT e.*, s.allow_download, s.approval_status
       FROM story_exports e JOIN stories s ON s.id = e.story_id
      WHERE e.id = $1`,
    [id]
  );
  const row = r.rows[0];
  if (!row || row.approval_status !== 'approved') return res.status(404).json({ success: false, message: 'Không tìm thấy tệp.' });
  if (!row.allow_download) return res.status(403).json({ success: false, message: 'Truyện này đã tắt tính năng tải xuống.' });
  if (row.status !== 'ready' || !row.file_path) return res.status(409).json({ success: false, message: 'Tệp chưa sẵn sàng.' });

  const filePath = path.resolve(EXPORT_DIR, row.file_path);
  if (!filePath.startsWith(path.resolve(EXPORT_DIR) + path.sep) || !fs.existsSync(filePath)) {
    // removed by cleanup: let the client request it again
    await pool.query(`UPDATE story_exports SET status = 'failed', error = 'Tệp đã bị xóa, hãy tạo lại.' WHERE id = $1`, [id]);
    return res.status(410).json({ success: false, message: 'Tệp đã hết hạn, hãy bấm tải lại.' });
  }

  await pool.query(`UPDATE story_exports SET download_count = download_count + 1, last_used_at = NOW() WHERE id = $1`, [id]);
  const ext = path.extname(row.file_name || '').slice(1).toLowerCase();
  const stat = fs.statSync(filePath);
  res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream');
  res.setHeader('Content-Length', String(stat.size));
  res.setHeader('Content-Disposition', contentDisposition(row.file_name || `truyen.${row.format}`));
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const stream = fs.createReadStream(filePath);
  stream.on('error', () => res.destroy());
  stream.pipe(res);
};
