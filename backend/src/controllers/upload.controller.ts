import { Request, Response } from 'express';
import fs from 'fs';
import { readImageSize } from '../services/image.service';

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
