/** Câu thoại ngắn của chibi Aemeath theo ngữ cảnh đọc truyện. */
export const CHIBI_LINES = {
  tap: [
    'Hôm nay đọc tiếp bộ nào nhỉ?',
    'Nhớ uống nước nhé, đọc lâu dễ khát lắm!',
    'Mình ngồi đây canh tủ truyện cho bạn nè.',
    'Ơ, bạn gọi mình hả? Hihi.',
    'Cho mình đọc ké một chương nhé?',
    'Đọc xong chương này là nghỉ mắt 20 giây nha.',
    'Truyện hay thì phải bình luận nữa chứ!',
  ],
  notifyEmpty: ['Zzz... chưa có tin gì hết, mình ngủ chút nhé.', 'Yên ắng quá, mình ngủ gật mất thôi...'],
  notifyNew: ['Có thông báo mới nè!', 'Ting ting! Bạn có tin mới đó.'],
  notFound: ['Ơ, lạc đường rồi sao? Để mình dẫn bạn về nhé!', 'Mình tìm khắp nơi mà không thấy...'],
  noResult: ['Hừm, không thấy gì khớp cả. Thử từ khóa khác nha?', 'Mình lục hết kệ rồi mà chưa ra!'],
  emptyShelf: ['Tủ truyện còn trống, mình cùng chọn bộ đầu tiên nhé?', 'Chưa có gì ở đây hết, buồn ghê...'],
  emptyHistory: ['Chưa đọc bộ nào gần đây hả? Bắt đầu thôi!'],
  chapterEnd: ['Xong chương rồi! Chương tiếp thôi nào!', 'Mình háo hức lắm, đọc tiếp nha!'],
  loading: ['Đang lật trang, chờ mình xíu nhé...', 'Sắp xong rồi, chờ mình xíu nữa thôi.'],
} as const;

/** Chọn một câu theo seed (ổn định giữa các lần render) hoặc ngẫu nhiên nếu không có seed. */
export function pickLine(pool: readonly string[], seed?: string | number): string {
  if (seed === undefined) return pool[Math.floor(Math.random() * pool.length)];
  const s = String(seed);
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return pool[h % pool.length];
}
