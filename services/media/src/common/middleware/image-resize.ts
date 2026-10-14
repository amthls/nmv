import { Request, Response, NextFunction } from 'express';
import sharp from 'sharp';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { CACHE_DIR, UPLOAD_DIR } from '../../config';

/**
 * On-the-fly image resizing for uploaded images.
 *
 *   GET /uploads/posts/cover.png?w=800   -> WebP no wider than 800px (cached on disk)
 *
 * Only whitelisted widths are accepted (bounds the number of cached variants), originals are never
 * modified, and images already narrower than the requested width are served as they are.
 */
export const IMAGE_WIDTHS = [480, 800, 1280, 1920];

const RESIZABLE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif']);
function resolveUpload(relPath: string): string | null {
  const candidate = path.resolve(UPLOAD_DIR, '.' + path.sep + relPath);
  if (!candidate.startsWith(UPLOAD_DIR + path.sep)) return null; // path traversal
  return fs.existsSync(candidate) && fs.statSync(candidate).isFile() ? candidate : null;
}

const inFlight = new Map<string, Promise<void>>();

// At most a few resizes at once, so a burst of cache misses cannot pin every CPU core
const MAX_CONCURRENT_RESIZES = 3;
let activeResizes = 0;
const waiting: Array<() => void> = [];
async function withResizeSlot<T>(task: () => Promise<T>): Promise<T> {
  if (activeResizes >= MAX_CONCURRENT_RESIZES) await new Promise<void>((resolve) => waiting.push(resolve));
  activeResizes += 1;
  try {
    return await task();
  } finally {
    activeResizes -= 1;
    waiting.shift()?.();
  }
}

async function buildVariant(source: string, target: string, width: number) {
  const pending = inFlight.get(target);
  if (pending) return pending;
  const job = (async () => {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
    try {
      await withResizeSlot(() =>
        sharp(source, { failOn: 'none', limitInputPixels: 100_000_000 })
          .rotate()
          .resize({ width, withoutEnlargement: true })
          .webp({ quality: 80 })
          .toFile(tmp)
      );
      fs.renameSync(tmp, target);
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  })().finally(() => inFlight.delete(target));
  inFlight.set(target, job);
  return job;
}

export async function resizeUploadedImage(req: Request, res: Response, next: NextFunction) {
  const rawWidth = req.query.w;
  if (rawWidth === undefined) return next();

  const width = Number(rawWidth);
  if (!IMAGE_WIDTHS.includes(width)) {
    return res.status(400).json({ success: false, message: `w phải là một trong: ${IMAGE_WIDTHS.join(', ')}` });
  }

  let relPath: string;
  try {
    relPath = decodeURIComponent(req.path).replace(/^\/+/, '');
  } catch {
    return next();
  }
  if (!RESIZABLE_EXT.has(path.extname(relPath).toLowerCase())) return next(); // gif etc. stay untouched

  const source = resolveUpload(relPath);
  if (!source) return next(); // static handler answers 404

  try {
    const stat = fs.statSync(source);
    const meta = await sharp(source, { failOn: 'none' }).metadata();
    if (!meta.width || meta.width <= width) return next(); // nothing to gain

    const key = crypto.createHash('sha1').update(`${source}:${stat.mtimeMs}:${width}`).digest('hex');
    const target = path.join(CACHE_DIR, `${key}.webp`);
    if (!fs.existsSync(target)) await buildVariant(source, target, width);
    // a page barely wider than the target (820px for 800) can come out heavier as WebP: then the original is better
    if (fs.statSync(target).size >= stat.size) return next();

    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    res.type('image/webp');
    return res.sendFile(target);
  } catch (err: any) {
    console.error('[Image] resize failed, serving original:', err.message);
    return next();
  }
}

