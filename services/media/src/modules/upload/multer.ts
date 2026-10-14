import multer from 'multer';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { UPLOAD_DIR } from '../../config';

const uploadsDir = path.join(UPLOAD_DIR, 'posts');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/avif': '.avif',
  'image/bmp': '.bmp',
};

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    // Extension comes from the (validated) MIME type, never from the client's file name:
    // an "evil.html" sent as image/png would otherwise be stored and served as HTML from our origin.
    const ext = MIME_TO_EXT[file.mimetype] || '.bin';
    const cleanName = path
      .basename(file.originalname, path.extname(file.originalname))
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '-')
      .slice(0, 60) || 'image';
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `${cleanName}-${uniqueSuffix}${ext}`);
  },
});

const fileFilter = (req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  const allowedMimeTypes = [
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'image/avif',
    'image/bmp',
  ];

  if (allowedMimeTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Chỉ chấp nhận các định dạng file ảnh (JPEG, PNG, WebP, GIF, AVIF)'));
  }
};

// Manga pages land in a temp dir first; the controller re-encodes them into uploads/manga/<story>/
const mangaTmpDir = path.join(os.tmpdir(), 'novelhub-manga');
fs.mkdirSync(mangaTmpDir, { recursive: true });
fs.mkdirSync(path.resolve(process.cwd(), 'uploads', 'manga'), { recursive: true });

export const uploadMangaPageFiles = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, mangaTmpDir),
    filename: (req, file, cb) => cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${MIME_TO_EXT[file.mimetype] || '.bin'}`),
  }),
  // Every page is decoded by sharp in the controller, which reports bad files one by one; filtering
  // on the browser-supplied MIME type here would reject the whole batch for one odd file type.
  fileFilter: (req, file, cb) => cb(null, true),
  limits: {
    fileSize: 25 * 1024 * 1024,
    files: 20,
  },
});

export const uploadImages = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 25 * 1024 * 1024, // 25MB max per file
    files: 10, // Max 10 images per upload
  },
});
