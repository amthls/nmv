// Display-time touches for novel chapter text. Nothing here is required from the writer: plain
// text stays plain, and the optional web-novel notations (Narou / Kakuyomu style) just work.
//
//   ｜Ma Vương《Demon Lord》   or  |Ma Vương《Demon Lord》   -> ruby (small reading above the words)
//   漢字《かんじ》                                           -> ruby on the kanji just before 《》
//   《《nhấn mạnh》》                                       -> emphasis dots above the words

export const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const ruby = (base: string, reading: string) => `<ruby>${base}<rp>(</rp><rt>${reading}</rt><rp>)</rp></ruby>`;

function enhanceText(text: string): string {
  if (!text.includes('《')) return text;
  return text
    .replace(/《《([^《》]{1,100})》》/g, '<em class="nh-dots">$1</em>')
    .replace(/[｜|]([^｜|《》]{1,40})《([^《》]{1,60})》/g, (_m, base, reading) => ruby(base, reading))
    .replace(/([㐀-鿿々〆ヵヶ]{1,20})《([^《》]{1,60})》/g, (_m, base, reading) => ruby(base, reading));
}

/** Applies the notations to the text between tags of sanitized chapter HTML. */
export function enhanceChapterHtml(html: string): string {
  if (!html || !html.includes('《')) return html;
  return html
    .split(/(<[^>]+>)/)
    .map((part) => (part.startsWith('<') ? part : enhanceText(part)))
    .join('');
}

/** Plain-text paragraph (older chapters) -> HTML with the notations applied. */
export const enhancePlainText = (text: string) => enhanceText(escapeHtml(text));

/** Footnote marker [n] at the end of the block's last line of text (inside its <p>/<h*>/<li>). */
export function withFootnoteMarker(html: string, n: number): string {
  const marker = `<sup class="nh-fn"><a href="#fn-${n}" data-fn="${n}" aria-label="Chú thích ${n}">[${n}]</a></sup>`;
  const re = /<\/(p|h[2-4]|li|td|th|figcaption)>/gi;
  let last = -1;
  for (let m = re.exec(html); m; m = re.exec(html)) last = m.index;
  return last >= 0 ? html.slice(0, last) + marker + html.slice(last) : html + marker;
}
