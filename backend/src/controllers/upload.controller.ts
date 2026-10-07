import { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import sharp from 'sharp';
import { readImageSize } from '../services/image.service';
import { AuthenticatedRequest } from '../middlewares/auth.middleware';
import { canUserManageStory } from './story.controller';
import { isUuid } from '../utils/validation';

/** The declared MIME type is client-controlled: keep a file only if it really decodes as an image. */
async function keepOnlyRealImages(files: Express.Multer.File[]): Promise<Express.Multer.File[]> {
  const good: Express.Multer.File[] = [];
  for (const f of files) {
    if (await readImageSize(f.path)) good.push(f);
    else fs.rmSync(f.path, { force: true });
  }
  return good;
}

export const uploadMultipleImages = async (req: Request, res: Response) => {
  try {
    const files = await keepOnlyRealImages((req.files as Express.Multer.File[]) || []);

    if (files.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Không tìm thấy file ảnh nào được tải lên',
      });
    }

    const urls = files.map((file) => `/uploads/posts/${file.filename}`);

    res.json({
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
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const uploadSingleImage = async (req: Request, res: Response) => {
  try {
    const [file] = await keepOnlyRealImages(req.file ? [req.file as Express.Multer.File] : []);

    if (!file) {
      return res.status(400).json({
        success: false,
        message: 'Không tìm thấy file ảnh nào được tải lên',
      });
    }

    const url = `/uploads/posts/${file.filename}`;
    const size = await readImageSize(file.path);

    res.json({
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
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ---------------------------------------------------------------------------- manga pages

const MANGA_MAX_WIDTH = 1600; // wider pages are scaled down; readers pick smaller copies via ?w=
const WEBP_MAX_SIDE = 16383; // WebP limit: very tall webtoon strips are kept as JPEG instead

/**
 * POST /upload/manga-pages  (multipart: story_id, then up to 20 "pages")
 * Each page is auto-rotated, scaled to at most 1600px wide and re-encoded (WebP, or JPEG for very
 * tall strips) into uploads/manga/<story_id>/. Results come back in the order the files were sent.
 */
export const uploadMangaPages = async (req: AuthenticatedRequest, res: Response) => {
  const files = (req.files as Express.Multer.File[]) || [];
  const cleanup = () => files.forEach((f) => fs.rmSync(f.path, { force: true }));
  try {
    const storyId = req.body?.story_id;
    if (!isUuid(storyId)) {
      cleanup();
      return res.status(400).json({ success: false, message: 'Thiếu hoặc sai story_id.' });
    }
    if (!req.user || !(await canUserManageStory(req.user.id, storyId, req.user.roles || []))) {
      cleanup();
      return res.status(403).json({ success: false, message: 'Bạn không có quyền đăng chương cho truyện này.' });
    }
    if (files.length === 0) {
      return res.status(400).json({ success: false, message: 'Không có trang nào được gửi lên.' });
    }

    const dir = path.resolve(process.cwd(), 'uploads', 'manga', storyId);
    fs.mkdirSync(dir, { recursive: true });

    const pages: Array<{ originalName: string; url?: string; width?: number; height?: number; size?: number; error?: string }> = [];
    for (const file of files) {
      try {
        const image = sharp(file.path, { failOn: 'none', limitInputPixels: 200_000_000 }).rotate();
        const meta = await image.metadata();
        if (!meta.width || !meta.height) throw new Error('not an image');
        // EXIF orientation 5-8 swaps the sides
        const [srcW, srcH] = (meta.orientation || 1) >= 5 ? [meta.height, meta.width] : [meta.width, meta.height];
        const width = Math.min(srcW, MANGA_MAX_WIDTH);
        const height = Math.round(srcH * (width / srcW));
        const asJpeg = height > WEBP_MAX_SIDE;
        const name = `${Date.now()}-${crypto.randomBytes(5).toString('hex')}${asJpeg ? '.jpg' : '.webp'}`;
        const target = path.join(dir, name);
        const resized = image.resize({ width, withoutEnlargement: true });
        await (asJpeg ? resized.jpeg({ quality: 85, mozjpeg: true }) : resized.webp({ quality: 85 })).toFile(target);
        pages.push({
          originalName: file.originalname,
          url: `/uploads/manga/${storyId}/${name}`,
          width,
          height,
          size: fs.statSync(target).size,
        });
      } catch {
        pages.push({ originalName: file.originalname, error: 'File không phải ảnh hợp lệ hoặc bị hỏng' });
      }
    }
    cleanup();

    const okCount = pages.filter((p) => p.url).length;
    res.status(okCount > 0 ? 200 : 400).json({
      success: okCount > 0,
      message: okCount === pages.length ? `Đã tải lên ${okCount} trang` : `Tải lên ${okCount}/${pages.length} trang`,
      data: { pages },
    });
  } catch (error: any) {
    cleanup();
    res.status(500).json({ success: false, message: error.message });
  }
};
