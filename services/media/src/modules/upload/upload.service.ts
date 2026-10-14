import { Injectable } from '@nestjs/common';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import sharp from 'sharp';
import { readImageSize } from '../../common/utils/image';
import { InputError } from '../../common/utils/errors';
import { isContributor } from '../../infra/clients/backend';
import { UPLOAD_DIR } from '../../config';

const isUuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

/** The declared MIME type is client-controlled: keep a file only if it really decodes as an image. */
async function keepOnlyRealImages(files: Express.Multer.File[]): Promise<Express.Multer.File[]> {
  const good: Express.Multer.File[] = [];
  for (const f of files) {
    if (await readImageSize(f.path)) good.push(f);
    else fs.rmSync(f.path, { force: true });
  }
  return good;
}

// ---- manga pages
const MANGA_MAX_WIDTH = 1600; // wider pages are scaled down; readers pick smaller copies via ?w=
const WEBP_MAX_SIDE = 16383; // WebP limit: very tall webtoon strips are kept as JPEG instead
// Long webtoon strips are cut into parts (as MangaDex asks uploaders to do): one huge image
// stalls weaker phones. Parts follow each other with no gap in the long-strip reader.
const STRIP_SPLIT_ABOVE = 5000;
const STRIP_PART_HEIGHT = 4000;

@Injectable()
export class UploadService {
  async multipleImages(allFiles: Express.Multer.File[]) {
    const files = await keepOnlyRealImages(allFiles);
    if (files.length === 0) throw new InputError('Không tìm thấy file ảnh nào được tải lên');

    const urls = files.map((file) => `/uploads/posts/${file.filename}`);
    return {
      success: true,
      message: `Tải lên thành công ${urls.length} hình ảnh`,
      data: {
        urls,
        files: files.map((f, i) => ({
          filename: f.filename,
          originalName: f.originalname,
          size: f.size,
          mimetype: f.mimetype,
          url: urls[i],
        })),
      },
    };
  }

  async singleImage(upload?: Express.Multer.File) {
    const [file] = await keepOnlyRealImages(upload ? [upload] : []);
    if (!file) throw new InputError('Không tìm thấy file ảnh nào được tải lên');

    const url = `/uploads/posts/${file.filename}`;
    const size = await readImageSize(file.path);
    return {
      success: true,
      message: 'Tải lên hình ảnh thành công',
      data: {
        url,
        width: size?.width ?? null,
        height: size?.height ?? null,
        filename: file.filename,
        originalName: file.originalname,
        size: file.size,
        mimetype: file.mimetype,
      },
    };
  }

  /**
   * POST /upload/manga-pages  (multipart: story_id, then up to 20 "pages")
   * Each page is auto-rotated, scaled to at most 1600px wide and re-encoded (WebP, or JPEG for very
   * tall strips) into uploads/manga/<story_id>/. Results come back in the order the files were sent.
   * Returns success:false when no page could be stored (the controller answers 400 then).
   */
  async mangaPages(userId: string | undefined, body: any, files: Express.Multer.File[]) {
    const cleanup = () => files.forEach((f) => fs.rmSync(f.path, { force: true }));
    try {
      const storyId = body?.story_id;
      if (!isUuid(storyId)) {
        cleanup();
        throw new InputError('Thiếu hoặc sai story_id.');
      }
      if (!userId || !(await isContributor(userId, storyId))) {
        cleanup();
        throw new InputError('Bạn không có quyền đăng chương cho truyện này.', 403);
      }
      if (files.length === 0) throw new InputError('Không có trang nào được gửi lên.');

      const dir = path.join(UPLOAD_DIR, 'manga', storyId);
      fs.mkdirSync(dir, { recursive: true });

      type Part = { url: string; width: number; height: number; size: number };
      const pages: Array<{ originalName: string; url?: string; width?: number; height?: number; size?: number; parts?: Part[]; error?: string }> = [];
      for (const file of files) {
        try {
          const image = sharp(file.path, { failOn: 'none', limitInputPixels: 200_000_000 }).rotate();
          const meta = await image.metadata();
          if (!meta.width || !meta.height) throw new Error('not an image');
          // EXIF orientation 5-8 swaps the sides
          const [srcW, srcH] = (meta.orientation || 1) >= 5 ? [meta.height, meta.width] : [meta.width, meta.height];
          const width = Math.min(srcW, MANGA_MAX_WIDTH);
          const height = Math.round(srcH * (width / srcW));
          // equal slices, each at most STRIP_PART_HEIGHT tall
          const count = height > STRIP_SPLIT_ABOVE ? Math.ceil(height / STRIP_PART_HEIGHT) : 1;
          const sliceH = Math.ceil(height / count);
          const parts: Part[] = [];
          for (let i = 0; i < count; i++) {
            const top = i * sliceH;
            const partH = Math.min(sliceH, height - top);
            const asJpeg = partH > WEBP_MAX_SIDE;
            const name = `${Date.now()}-${crypto.randomBytes(5).toString('hex')}${asJpeg ? '.jpg' : '.webp'}`;
            const target = path.join(dir, name);
            let pipeline = sharp(file.path, { failOn: 'none', limitInputPixels: 200_000_000 }).rotate()
              .resize({ width, withoutEnlargement: true });
            if (count > 1) pipeline = pipeline.extract({ left: 0, top, width, height: partH });
            await (asJpeg ? pipeline.jpeg({ quality: 85, mozjpeg: true }) : pipeline.webp({ quality: 85 })).toFile(target);
            parts.push({ url: `/uploads/manga/${storyId}/${name}`, width, height: partH, size: fs.statSync(target).size });
          }
          pages.push({
            originalName: file.originalname,
            url: parts[0].url,
            width,
            height: parts[0].height,
            size: parts.reduce((s, p) => s + p.size, 0),
            parts,
          });
        } catch {
          pages.push({ originalName: file.originalname, error: 'File không phải ảnh hợp lệ hoặc bị hỏng' });
        }
      }
      cleanup();

      const okCount = pages.filter((p) => p.url).length;
      return {
        success: okCount > 0,
        message: okCount === pages.length ? `Đã tải lên ${okCount} trang` : `Tải lên ${okCount}/${pages.length} trang`,
        data: { pages },
      };
    } catch (error) {
      cleanup();
      throw error;
    }
  }
}
