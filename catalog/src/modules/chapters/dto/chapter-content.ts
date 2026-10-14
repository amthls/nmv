import { InputError, optionalUrl } from '../../../utils/validation';
import { sanitizeRichText, sanitizeChapterHtml, richTextToPlain } from '../../../utils/richText';

/** Chapter content from the editor: blocks, their checks and plain-text forms (messages stay as before). */

export interface ContentBlock {
  id: string;
  type: 'paragraph' | 'heading' | 'image' | 'separator';
  text?: string;
  note?: string; // Translator Note on this line
  image_url?: string; // Inline illustration at this line (or one manga page)
  html?: string; // formatted block from the chapter editor (sanitized); `text` is its plain text
  width?: number; // pixel size of image_url, when known
  height?: number;
}

const pixelSize = (v: unknown) => (Number.isInteger(v) && (v as number) > 0 && (v as number) <= 100000 ? (v as number) : undefined);


const BLOCK_TYPES = ['paragraph', 'heading', 'image', 'separator'];

/** Validates chapter content blocks from the editor and keeps only the fields the reader uses. */
export function normalizeContentBlocks(input: unknown): ContentBlock[] {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input) || input.length > 5000) throw new InputError('Nội dung chương không hợp lệ.');
  return input.map((raw: any, idx: number) => {
    if (!raw || typeof raw !== 'object') throw new InputError(`Đoạn ${idx + 1} không hợp lệ.`);
    const { text, note } = raw;
    if (text !== undefined && text !== null && typeof text !== 'string') throw new InputError(`Đoạn ${idx + 1} không hợp lệ.`);
    if (note !== undefined && note !== null && typeof note !== 'string') throw new InputError(`Ghi chú đoạn ${idx + 1} không hợp lệ.`);
    if ((text || '').length > 50000) throw new InputError(`Đoạn ${idx + 1} quá dài.`);
    const block: ContentBlock = {
      id: typeof raw.id === 'string' && raw.id.length <= 64 ? raw.id : `b${idx + 1}`,
      type: BLOCK_TYPES.includes(raw.type) ? raw.type : 'paragraph',
    };
    if (text) block.text = text;
    if (note && note.trim()) block.note = note.trim().slice(0, 5000);
    if (raw.html !== undefined && raw.html !== null) {
      if (typeof raw.html !== 'string' || raw.html.length > 100000) throw new InputError(`Đoạn ${idx + 1} không hợp lệ.`);
      let html = sanitizeChapterHtml(raw.html);
      const isTable = /^<figure[^>]*>\s*<table/i.test(html);
      if (/^<figure/i.test(html) && !isTable && !/<img\s/i.test(html)) html = ''; // its image was not one of ours
      if (html) {
        block.html = html;
        // the plain text always follows the formatted version (search, word count, bookmarks, exports)
        const plain = /^<figure/i.test(html) && !isTable ? '' : richTextToPlain(html);
        if (plain) block.text = plain;
        else delete block.text;
        const tag = (html.match(/^<([a-z0-9]+)/i)?.[1] || '').toLowerCase();
        block.type = tag === 'hr' ? 'separator' : tag === 'figure' && !isTable ? 'image' : /^h[2-4]$/.test(tag) ? 'heading' : 'paragraph';
        if (tag === 'figure' && !isTable && raw.image_url === undefined) raw.image_url = html.match(/<img[^>]*\ssrc="([^"]+)"/i)?.[1];
      }
    }
    const imageUrl = optionalUrl(raw.image_url, `Ảnh minh họa đoạn ${idx + 1}`);
    if (imageUrl) {
      block.image_url = imageUrl;
      const width = pixelSize(raw.width);
      const height = pixelSize(raw.height);
      if (width && height) { block.width = width; block.height = height; }
    }
    return block;
  });
}

/**
 * A manga chapter is a list of page images; a novel chapter is text (illustrations hang off paragraphs).
 * Stops a text chapter landing in a manga (the reader would show no pages) and the reverse.
 */
export function checkBlocksMatchStoryType(storyType: string, blocks: ContentBlock[], isDraft: boolean, rawText = '') {
  const hasText = (b: ContentBlock) => Boolean(b.text && b.text.trim());
  if (storyType === 'manga') {
    if (blocks.some((b) => !b.image_url || hasText(b))) {
      throw new InputError('Đây là truyện tranh: chương chỉ gồm các trang ảnh. Hãy dùng trình đăng truyện tranh.');
    }
    if (!isDraft && blocks.length === 0) throw new InputError('Chương truyện tranh cần ít nhất một trang ảnh.');
    return;
  }
  if (blocks.length > 0 && !blocks.some(hasText)) {
    throw new InputError('Đây là truyện chữ: chương cần có nội dung văn bản. Chương chỉ gồm trang ảnh hãy đăng vào truyện tranh.');
  }
  if (!isDraft && blocks.length === 0 && !rawText.trim()) throw new InputError('Nội dung chương đang trống.');
}

/** Plain text of the blocks (inline images as markdown) for search, word count and the `content` column. */
export function blocksToPlainText(blocks: ContentBlock[]): string {
  return blocks
    .map((b) => {
      let line = b.text || '';
      if (b.image_url) line += `\n![Minh Họa](${b.image_url})`;
      return line;
    })
    .filter(Boolean)
    .join('\n\n');
}

/** Old plain-text body (no blocks): one paragraph block per blank-line-separated paragraph. */
export function textToBlocks(text: string): ContentBlock[] {
  return text.split(/\n\s*\n/).map((t) => t.trim()).filter(Boolean)
    .map((t, i) => ({ id: `b${i + 1}`, type: 'paragraph' as const, text: t }));
}

/** Optional translator message shown before / after the chapter text (rich text, may be cleared). */
export function chapterMessage(value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || value.length > 50000) throw new InputError(`${label} không hợp lệ.`);
  return sanitizeRichText(value) || null;
}

/** Chapter numbers may be decimal (e.g. 10.5 for an extra) but never negative. */
export function parseChapterNumber(value: unknown): number {
  const num = typeof value === 'string' && value.trim() ? Number(value) : value;
  if (typeof num !== 'number' || !Number.isFinite(num) || num < 0 || num >= 1e8) {
    throw new InputError('Số chương phải là số từ 0 trở lên.');
  }
  return Math.round(num * 100) / 100;
}
