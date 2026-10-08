'use client';

import { unzip } from 'fflate';

/**
 * Helpers for the manga chapter uploader: collecting image files from drops / folders / zip
 * archives (with their folder path, so one drop can hold several chapters), natural sorting,
 * guessing chapter numbers from folder names and uploading pages with progress.
 */

export interface SourceFile {
  file: File;
  /** folder path inside the drop / archive ("" for loose files) */
  dir: string;
}

/** A file that was not added, and why (shown to the uploader so they can fix it). */
export interface RejectedFile {
  name: string;
  reason: string;
}

export interface CollectResult {
  sources: SourceFile[];
  rejected: RejectedFile[];
}

/** Same limit as the server (multer, 25MB per page). */
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
/** Stay under the gateway's 26MB request limit when several pages share one request. */
const MAX_BATCH_BYTES = 24 * 1024 * 1024;

const IMAGE_EXT = /\.(jpe?g|png|webp|gif|avif|bmp)$/i;
const ARCHIVE_EXT = /\.(zip|cbz)$/i;
const MIME: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
  gif: 'image/gif', avif: 'image/avif', bmp: 'image/bmp',
};

export const isImageFile = (f: File) => f.type.startsWith('image/') || IMAGE_EXT.test(f.name);
export const isArchive = (f: File) => ARCHIVE_EXT.test(f.name) || f.type === 'application/zip' || f.type === 'application/x-cbz';

const collator = new Intl.Collator('vi', { numeric: true, sensitivity: 'base' });
/** "2.jpg" before "10.jpg", "Chap 9" before "Chap 10". */
export const naturalCompare = (a: string, b: string) => collator.compare(a, b);

/** Chapter number written in a folder / archive name: "Chap 12", "chuong-3.5", "Ch.7", "012". */
export function guessChapterNumber(name: string): number | null {
  const base = name.split('/').pop() || name;
  const tagged = base.match(/(?:chap(?:ter)?|ch\.?|chương|chuong|chuơng|episode|ep\.?|c)[\s._-]*(\d+(?:[.,]\d+)?)/i);
  const any = tagged || base.match(/(\d+(?:[.,]\d+)?)(?!.*\d)/);
  if (!any) return null;
  const n = parseFloat(any[1].replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

const dirOf = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');

async function extractArchive(file: File, parentDir: string): Promise<SourceFile[]> {
  const data = new Uint8Array(await file.arrayBuffer());
  const entries = await new Promise<Record<string, Uint8Array>>((resolve, reject) =>
    unzip(data, { filter: (f) => IMAGE_EXT.test(f.name) && !f.name.startsWith('__MACOSX/') && !(f.name.split('/').pop() || '').startsWith('.') }, (err, out) => (err ? reject(err) : resolve(out))),
  );
  // An archive is one chapter unless it holds sub-folders; name the chapter after the archive
  const archiveName = file.name.replace(ARCHIVE_EXT, '');
  return Object.entries(entries).map(([path, bytes]) => {
    const name = path.split('/').pop() || path;
    const ext = (name.split('.').pop() || '').toLowerCase();
    const inner = dirOf(path);
    return {
      file: new File([bytes as BlobPart], name, { type: MIME[ext] || 'application/octet-stream' }),
      dir: [parentDir, archiveName, inner].filter(Boolean).join('/'),
    };
  });
}

/** Walk a dropped folder (DataTransfer entries). */
async function walkEntry(entry: any, path: string, out: File[], paths: string[]) {
  if (entry.isFile) {
    const file: File = await new Promise((resolve, reject) => entry.file(resolve, reject));
    out.push(file);
    paths.push(path);
  } else if (entry.isDirectory) {
    const reader = entry.createReader();
    // readEntries returns at most ~100 entries per call
    for (;;) {
      const batch: any[] = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
      if (batch.length === 0) break;
      for (const child of batch) await walkEntry(child, path ? `${path}/${child.name}` : child.name, out, paths);
    }
  }
}

const IGNORED = /^(\.ds_store|thumbs\.db|desktop\.ini)$|^\._/i;

/** Turn plain files (with optional relative paths) into image SourceFiles, expanding archives. */
async function expand(files: File[], paths: string[]): Promise<CollectResult> {
  const sources: SourceFile[] = [];
  const rejected: RejectedFile[] = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const path = paths[i] || f.name;
    const dir = dirOf(path);
    if (IGNORED.test(f.name)) continue; // OS metadata files
    if (isArchive(f)) {
      try {
        const inner = await extractArchive(f, dir);
        if (inner.length === 0) rejected.push({ name: path, reason: 'File nén không chứa ảnh nào (chỉ nhận JPG, PNG, WebP, GIF, AVIF, BMP bên trong)' });
        for (const s of inner) {
          if (s.file.size > MAX_FILE_BYTES) rejected.push({ name: `${path} › ${s.dir ? s.dir + '/' : ''}${s.file.name}`, reason: `Ảnh nặng ${formatBytes(s.file.size)}, vượt giới hạn 25 MB mỗi trang` });
          else sources.push(s);
        }
      } catch {
        rejected.push({ name: path, reason: 'Không giải nén được: file bị hỏng, có mật khẩu hoặc không phải ZIP/CBZ (RAR/7z chưa hỗ trợ, hãy nén lại bằng ZIP)' });
      }
    } else if (isImageFile(f)) {
      if (f.size === 0) rejected.push({ name: path, reason: 'File rỗng (0 byte)' });
      else if (f.size > MAX_FILE_BYTES) rejected.push({ name: path, reason: `Ảnh nặng ${formatBytes(f.size)}, vượt giới hạn 25 MB mỗi trang. Hãy giảm chất lượng hoặc chia nhỏ ảnh` });
      else sources.push({ file: f, dir });
    } else if (/\.(rar|7z|tar|gz)$/i.test(f.name)) {
      rejected.push({ name: path, reason: 'Định dạng nén này chưa hỗ trợ. Hãy nén lại thành ZIP hoặc CBZ' });
    } else if (/\.(pdf|psd|tiff?|heic|clip|kra)$/i.test(f.name)) {
      rejected.push({ name: path, reason: 'Không phải ảnh web. Hãy xuất từng trang ra JPG, PNG hoặc WebP' });
    } else {
      rejected.push({ name: path, reason: 'Không phải ảnh (chỉ nhận JPG, PNG, WebP, GIF, AVIF, BMP và file ZIP/CBZ)' });
    }
  }
  return { sources, rejected };
}

export async function filesFromDataTransfer(dt: DataTransfer): Promise<CollectResult> {
  const items = Array.from(dt.items || []);
  const entries = items.map((it) => (it.kind === 'file' && (it as any).webkitGetAsEntry ? (it as any).webkitGetAsEntry() : null));
  if (entries.some(Boolean)) {
    const files: File[] = [];
    const paths: string[] = [];
    for (const entry of entries) if (entry) await walkEntry(entry, entry.name, files, paths);
    return expand(files, paths);
  }
  const files = Array.from(dt.files || []);
  return expand(files, files.map((f) => f.name));
}

export async function filesFromInput(list: FileList | null): Promise<CollectResult> {
  const files = Array.from(list || []);
  return expand(files, files.map((f) => (f as any).webkitRelativePath || f.name));
}

/** Group files by folder: one group per chapter, sorted by guessed number then name. */
export function groupByFolder(sources: SourceFile[]) {
  const groups = new Map<string, File[]>();
  for (const s of sources) {
    if (!groups.has(s.dir)) groups.set(s.dir, []);
    groups.get(s.dir)!.push(s.file);
  }
  return Array.from(groups.entries())
    .map(([dir, files]) => ({
      dir,
      number: guessChapterNumber(dir),
      files: files.sort((a, b) => naturalCompare(a.name, b.name)),
    }))
    .sort((a, b) => (a.number ?? Infinity) - (b.number ?? Infinity) || naturalCompare(a.dir, b.dir));
}

export function readImageSize(url: string): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

export interface UploadedPart {
  url: string;
  width: number;
  height: number;
}

export interface UploadedPage {
  originalName: string;
  url?: string;
  width?: number;
  height?: number;
  size?: number;
  /** a very tall webtoon strip comes back cut into several parts, in reading order */
  parts?: UploadedPart[];
  error?: string;
}

/** Split pages into requests of at most `maxCount` files and ~24MB (the gateway's body limit). */
export function sizeBatches<T extends { file: File }>(items: T[], maxCount: number): T[][] {
  const batches: T[][] = [];
  let current: T[] = [];
  let bytes = 0;
  for (const item of items) {
    if (current.length && (current.length >= maxCount || bytes + item.file.size > MAX_BATCH_BYTES)) {
      batches.push(current);
      current = [];
      bytes = 0;
    }
    current.push(item);
    bytes += item.file.size;
  }
  if (current.length) batches.push(current);
  return batches;
}

export class UploadError extends Error {
  status: number;
  retryAfter: number;
  constructor(message: string, status: number, retryAfter = 0) {
    super(message);
    this.status = status;
    this.retryAfter = retryAfter;
  }
  /** Worth retrying automatically (rate limit, network blip, server restarting). */
  get transient() {
    return [0, 429, 502, 503, 504].includes(this.status);
  }
}

function explainStatus(status: number, serverMessage?: string): string {
  if (status === 0) return 'Mất kết nối mạng khi đang tải lên';
  if (status === 401) return 'Phiên đăng nhập đã hết hạn, hãy đăng nhập lại rồi bấm Thử lại';
  if (status === 403) return serverMessage || 'Tài khoản không có quyền đăng chương cho truyện này';
  if (status === 413) return 'Một lần gửi quá lớn so với giới hạn máy chủ. Hãy giảm dung lượng ảnh';
  if (status === 429) return 'Tải lên quá nhanh, máy chủ yêu cầu chờ một chút';
  if (status >= 500) return serverMessage || `Máy chủ gặp lỗi (${status}), hãy thử lại sau`;
  return serverMessage || `Lỗi không xác định (${status})`;
}

/** POST pages to /upload/manga-pages with byte-level progress (fetch cannot report upload progress). */
export function uploadPageBatch(
  apiBase: string,
  storyId: string,
  files: File[],
  onProgress: (fraction: number) => void,
): Promise<UploadedPage[]> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append('story_id', storyId); // must precede the files so the server sees it first
    files.forEach((f) => form.append('pages', f, f.name));

    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${apiBase}/upload/manga-pages`);
    xhr.withCredentials = true;
    try {
      const token = localStorage.getItem('novelhub_token');
      if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    } catch {}
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      let json: any = null;
      try { json = JSON.parse(xhr.responseText); } catch {}
      if (json?.data?.pages) resolve(json.data.pages);
      else {
        const retryAfter = parseInt(xhr.getResponseHeader('Retry-After') || '0', 10) || 0;
        reject(new UploadError(explainStatus(xhr.status, json?.message), xhr.status, retryAfter));
      }
    };
    xhr.onerror = () => reject(new UploadError(explainStatus(0), 0));
    xhr.send(form);
  });
}

export const formatBytes = (n: number) =>
  n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
