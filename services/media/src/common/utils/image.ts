import sharp from 'sharp';

/** Pixel size of an image file, or null when it cannot be read. */
export async function readImageSize(file: string): Promise<{ width: number; height: number } | null> {
  try {
    const meta = await sharp(file, { failOn: 'none' }).metadata();
    return meta.width && meta.height ? { width: meta.width, height: meta.height } : null;
  } catch {
    return null;
  }
}
