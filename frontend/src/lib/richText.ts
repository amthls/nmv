// Helpers for content saved from the rich-text editor (sanitized HTML on the server)
// or written as plain text before the editor existed.

const HAS_TAG = /<\/?[a-z][^>]*>/i;
const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ' };

export const isHtmlContent = (value?: string | null): boolean => Boolean(value && HAS_TAG.test(value));

/** Visible text only (for cards, line-clamped previews, emptiness checks). */
export function stripHtml(value?: string | null): string {
  if (!value) return '';
  if (!HAS_TAG.test(value)) return value.trim();
  return value
    .replace(/<\/(p|h[1-6]|li|blockquote)>|<br\s*\/?>|<hr\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (m) => ENTITIES[m] ?? m)
    .replace(/\s+/g, ' ')
    .trim();
}

/** True when there is visible text or at least one image (a post may be image-only). */
export const hasRichContent = (value?: string | null): boolean => stripHtml(value).length > 0 || /<img\s/i.test(value || '');
