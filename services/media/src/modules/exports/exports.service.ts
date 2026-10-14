import { Injectable } from '@nestjs/common';
import fs from 'fs';
import path from 'path';
import { EXPORT_DIR } from '../../config';
import { InputError } from '../../common/utils/errors';
import { exportSource, ExportRequestError, MAX_EXPORT_CHAPTERS, MIME, requestExport } from './builder';
import { ExportsRepository } from './exports.repository';

const isUuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

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

/** What the controller needs to stream a finished export. */
export interface ExportFile {
  filePath: string;
  size: number;
  headers: Record<string, string>;
}

/** Requests and downloads of EPUB/PDF exports. Building the files is the builder (./builder), run by the export loop. */
@Injectable()
export class ExportsService {
  constructor(private readonly repo: ExportsRepository) {}

  /** POST /stories/:slug/exports  { format: 'epub'|'pdf', mode: 'merged'|'single', chapter_ids?: uuid[] } */
  async create(userId: string | undefined, slug: string, body: any) {
    try {
      const { format, mode, chapter_ids } = body || {};
      if (format !== 'epub' && format !== 'pdf') throw new InputError('Định dạng phải là EPUB hoặc PDF.');
      if (mode !== 'merged' && mode !== 'single') throw new InputError('Hãy chọn gộp thành 1 tệp hoặc mỗi chương 1 tệp.');
      let chapterIds: string[] | null = null;
      if (chapter_ids !== undefined && chapter_ids !== null && chapter_ids !== 'all') {
        if (!Array.isArray(chapter_ids) || chapter_ids.length === 0 || !chapter_ids.every(isUuid)) {
          throw new InputError('Danh sách chương không hợp lệ.');
        }
        if (chapter_ids.length > MAX_EXPORT_CHAPTERS) throw new InputError(`Mỗi lần tải tối đa ${MAX_EXPORT_CHAPTERS} chương.`);
        chapterIds = Array.from(new Set<string>(chapter_ids));
      }

      const source = await exportSource({ slug }, chapterIds);
      if (!source || !source.approved) throw new InputError('Không tìm thấy truyện.', 404);
      if (!source.allow_download) throw new InputError('Truyện này chưa bật tính năng tải xuống.', 403);

      const row = await requestExport({ source, format, mode, userId: userId || null });
      return { success: true, data: serialize(row) };
    } catch (err: any) {
      if (err instanceof InputError) throw err;
      if (err instanceof ExportRequestError) throw new InputError(err.message, err.status);
      console.error('[Export] request failed:', err);
      throw new InputError('Không thể tạo yêu cầu tải xuống.', 500);
    }
  }

  /** GET /exports/:id  -> progress of a build */
  async get(id: string) {
    if (!isUuid(id)) throw new InputError('Không tìm thấy yêu cầu tải.', 404);
    const row = await this.repo.findById(id);
    if (!row) throw new InputError('Không tìm thấy yêu cầu tải.', 404);
    return { success: true, data: serialize(row) };
  }

  /** GET /exports/:id/download  -> the file, while the story still allows downloads */
  async file(id: string): Promise<ExportFile> {
    if (!isUuid(id)) throw new InputError('Không tìm thấy tệp.', 404);
    const row = await this.repo.findById(id);
    const story = row ? await exportSource({ story_id: row.story_id }, []) : null; // the story only: still downloadable?
    if (!row || !story?.approved) throw new InputError('Không tìm thấy tệp.', 404);
    if (!story.allow_download) throw new InputError('Truyện này đã tắt tính năng tải xuống.', 403);
    if (row.status !== 'ready' || !row.file_path) throw new InputError('Tệp chưa sẵn sàng.', 409);

    const filePath = path.resolve(EXPORT_DIR, row.file_path);
    if (!filePath.startsWith(path.resolve(EXPORT_DIR) + path.sep) || !fs.existsSync(filePath)) {
      // removed by cleanup: let the client request it again
      await this.repo.markGone(id);
      throw new InputError('Tệp đã hết hạn, hãy bấm tải lại.', 410);
    }

    await this.repo.recordDownload(id);
    const ext = path.extname(row.file_name || '').slice(1).toLowerCase();
    const size = fs.statSync(filePath).size;
    return {
      filePath,
      size,
      headers: {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Content-Length': String(size),
        'Content-Disposition': contentDisposition(row.file_name || `truyen.${row.format}`),
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    };
  }
}
