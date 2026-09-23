/**
 * Pure derivation of "what to render" from a chapter API response
 * (GET /stories/:slug/chapters/:chapterSlug), mirroring the exact branching
 * logic in the full chapter reader page (content_blocks vs. raw content
 * paragraphs vs. manga pages), so the miniplayer's read-only reading view
 * can reuse it without depending on that page's bookmark-aware JSX.
 */

const MARKDOWN_IMAGE_RE = /^!\[(.*?)\]\((.*?)\)$/;

export function isMarkdownImage(text: string): boolean {
  return MARKDOWN_IMAGE_RE.test(text);
}

function getMarkdownImageUrl(text: string): string {
  const match = text.match(MARKDOWN_IMAGE_RE);
  return match ? match[2] : '';
}

export interface ChapterTextItem {
  kind: 'text';
  id: string;
  text: string;
  note?: string;
  inlineImageUrl?: string;
}

export interface ChapterImageItem {
  kind: 'image';
  id: string;
  imageUrl: string;
}

export type ChapterContentItem = ChapterTextItem | ChapterImageItem;

export interface MangaPage {
  pageNumber: number;
  imageUrl: string;
}

export interface NormalizedChapterContent {
  isManga: boolean;
  mangaPages: MangaPage[];
  textItems: ChapterContentItem[];
}

export function normalizeChapterContent(chapterData: any): NormalizedChapterContent {
  const isManga = chapterData?.story?.story_type === 'manga';

  if (isManga) {
    const mangaPages: MangaPage[] = Array.isArray(chapterData?.pages)
      ? chapterData.pages.map((p: any) => ({ pageNumber: p.page_number, imageUrl: p.image_url }))
      : [];
    return { isManga: true, mangaPages, textItems: [] };
  }

  const hasBlocks = Array.isArray(chapterData?.content_blocks) && chapterData.content_blocks.length > 0;

  if (hasBlocks) {
    const textItems: ChapterContentItem[] = chapterData.content_blocks.map((block: any, idx: number) => ({
      kind: 'text',
      id: block.id || String(idx),
      text: block.text || '',
      note: block.note || undefined,
      inlineImageUrl: block.image_url && block.image_url !== 'placeholder' ? block.image_url : undefined,
    }));
    return { isManga: false, mangaPages: [], textItems };
  }

  const rawParagraphs: string[] = chapterData?.content
    ? chapterData.content
        .split(/\n\s*\n/)
        .map((p: string) => p.trim())
        .filter(Boolean)
    : ['Nội dung chương này đang được dịch hoặc cập nhật.', 'Vui lòng quay lại sau hoặc đọc các chương khác.'];

  const textItems: ChapterContentItem[] = rawParagraphs.map((p, idx) =>
    isMarkdownImage(p)
      ? { kind: 'image', id: String(idx), imageUrl: getMarkdownImageUrl(p) }
      : { kind: 'text', id: String(idx), text: p }
  );

  return { isManga: false, mangaPages: [], textItems };
}
