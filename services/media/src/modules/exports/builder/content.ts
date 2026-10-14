import dns from 'dns';
import fs from 'fs';
import net from 'net';
import path from 'path';
import sharp from 'sharp';
import { UPLOAD_DIR } from '../../../config';

/**
 * What an export contains, as the backend sends it (POST /internal/exports/book, already normalised:
 * plain text only, NFC Unicode, nothing illegal in XML), plus fetching the images the writers embed.
 */

export type Block =
  | { kind: 'paragraph'; text: string; note?: string }
  | { kind: 'heading'; text: string }
  | { kind: 'separator' }
  | { kind: 'image'; url: string; note?: string };

export interface ExportChapter {
  id: string;
  title: string;
  number: number;
  updatedAt: string;
  volumeKey: string | null; // chapters of one volume share it (null: no volume)
  volumeTitle: string | null;
  blocks: Block[]; // novel
  pages: string[]; // manga page image URLs, in order
}

export interface ExportStory {
  id: string;
  title: string;
  slug: string;
  type: 'novel' | 'manga';
  author: string | null;
  artist: string | null;
  group: string | null;
  synopsis: string | null;
  coverUrl: string | null;
  updatedAt: string;
}

export interface ExportBook {
  story: ExportStory;
  chapters: ExportChapter[];
}

// ---------------------------------------------------------------------------- images

function localUpload(url: string): string | null {
  const rel = decodeURIComponent(url.replace(/^\/uploads\//, '').split(/[?#]/)[0]);
  const candidate = path.resolve(UPLOAD_DIR, '.' + path.sep + rel);
  if (!candidate.startsWith(UPLOAD_DIR + path.sep)) return null;
  return fs.existsSync(candidate) ? candidate : null;
}

const MAX_REMOTE_BYTES = 25 * 1024 * 1024;

// Remote images (e.g. a cover URL typed by a user) must not let the worker reach internal services
// (postgres, rabbitmq, search, cloud metadata...): only public addresses, re-checked on each redirect.
const PRIVATE = new net.BlockList();
for (const [net4, bits] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 4], ['240.0.0.0', 4]] as const) {
  PRIVATE.addSubnet(net4, bits, 'ipv4');
}
for (const [net6, bits] of [['::', 127], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8], ['64:ff9b::', 96]] as const) {
  PRIVATE.addSubnet(net6, bits, 'ipv6');
}

function isPublicIp(ip: string): boolean {
  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mapped) ip = mapped[1];
  const family = net.isIP(ip);
  if (!family) return false;
  return !PRIVATE.check(ip, family === 4 ? 'ipv4' : 'ipv6');
}

async function isPublicHost(hostname: string): Promise<boolean> {
  const host = hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host)) return isPublicIp(host);
  try {
    const addrs = await dns.promises.lookup(host, { all: true, verbatim: true });
    return addrs.length > 0 && addrs.every((a) => isPublicIp(a.address));
  } catch {
    return false;
  }
}

async function fetchRemote(url: string): Promise<Buffer | null> {
  let current = url;
  for (let hop = 0; hop < 4; hop++) {
    let parsed: URL;
    try {
      parsed = new URL(current);
    } catch {
      return null;
    }
    if (!/^https?:$/.test(parsed.protocol) || parsed.username || parsed.password) return null;
    if (!(await isPublicHost(parsed.hostname))) return null;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20_000);
    try {
      const res = await fetch(parsed, { signal: ctrl.signal, redirect: 'manual', headers: { 'User-Agent': 'NovelHub-export/1.0' } });
      if (res.status >= 300 && res.status < 400) {
        const next = res.headers.get('location');
        if (!next) return null;
        current = new URL(next, parsed).toString();
        continue;
      }
      if (!res.ok || !res.body) return null;
      if (Number(res.headers.get('content-length') || 0) > MAX_REMOTE_BYTES) return null;
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of res.body as any as AsyncIterable<Uint8Array>) {
        size += chunk.length;
        if (size > MAX_REMOTE_BYTES) {
          ctrl.abort();
          return null;
        }
        chunks.push(Buffer.from(chunk));
      }
      return Buffer.concat(chunks);
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

/** Raw bytes of a site image (/uploads/...) or a public http(s) image; null when unavailable. */
export async function fetchImage(url: string | null | undefined): Promise<Buffer | null> {
  if (!url) return null;
  try {
    if (url.startsWith('/uploads/')) {
      const file = localUpload(url);
      return file ? await fs.promises.readFile(file) : null;
    }
    return await fetchRemote(url);
  } catch {
    return null;
  }
}

export interface PreparedImage {
  data: Buffer; // baseline-compatible JPEG, sRGB
  width: number;
  height: number;
}

/**
 * Turn any uploaded image into JPEG pieces every EPUB reader and PDF viewer can show:
 * WebP/AVIF/PNG/GIF are re-encoded (quality 92, 4:4:4 chroma), sRGB JPEGs are kept byte for byte,
 * and very tall strips (webtoons) are cut into readable pages.
 */
export async function prepareImage(
  input: Buffer,
  opts: { maxWidth: number; sliceTall: boolean }
): Promise<PreparedImage[]> {
  const meta = await sharp(input, { failOn: 'none', limitInputPixels: 100_000_000 }).metadata();
  let width = meta.width || 0;
  let height = meta.height || 0;
  if (!width || !height) throw new Error('ảnh hỏng');
  if ((meta.orientation || 1) >= 5) [width, height] = [height, width];

  const keepAsIs =
    meta.format === 'jpeg' && (meta.space === 'srgb' || meta.space === 'b-w') && (meta.orientation || 1) === 1 &&
    width <= opts.maxWidth && !(opts.sliceTall && height > width * 3);
  if (keepAsIs) return [{ data: input, width, height }];

  const scale = width > opts.maxWidth ? opts.maxWidth / width : 1;
  const outW = Math.round(width * scale);
  const outH = Math.round(height * scale);

  const encode = (img: ReturnType<typeof sharp>) =>
    img.flatten({ background: '#ffffff' }).toColourspace('srgb')
      .jpeg({ quality: 92, chromaSubsampling: '4:4:4', progressive: false, mozjpeg: false })
      .toBuffer();

  // Rotated, scaled, flattened full image first; slices are cut from that
  const base = sharp(input, { failOn: 'none', limitInputPixels: 100_000_000 }).rotate();
  if (!(opts.sliceTall && outH > outW * 3)) {
    const data = await encode(scale < 1 ? base.resize({ width: outW }) : base);
    return [{ data, width: outW, height: outH }];
  }

  // Webtoon strip: pages about 1.6x as tall as wide, equal heights
  const full = await (scale < 1 ? base.resize({ width: outW }) : base).png({ compressionLevel: 1 }).toBuffer();
  const count = Math.ceil(outH / (outW * 1.6));
  const sliceH = Math.ceil(outH / count);
  const pieces: PreparedImage[] = [];
  for (let top = 0; top < outH; top += sliceH) {
    const h = Math.min(sliceH, outH - top);
    const data = await encode(sharp(full).extract({ left: 0, top, width: outW, height: h }));
    pieces.push({ data, width: outW, height: h });
  }
  return pieces;
}
