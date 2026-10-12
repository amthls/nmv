import React from 'react';
import Link from 'next/link';
import type { Metadata } from 'next';

/**
 * How a translation team makes a chapter in NovelHub, step by step with screenshots of the real pages
 * (images in public/huong-dan/). Linked from the task form, the group page and the group workspace.
 */

export const metadata: Metadata = { title: 'Hướng dẫn làm chương theo nhóm - NovelHub' };

type Section = { id: string; title: string; who: string; images?: [string, string][]; steps: React.ReactNode[]; tip?: React.ReactNode };

const SECTIONS: Section[] = [
  {
    id: 'vai-tro', title: 'Ai làm gì', who: 'Mọi người',
    steps: [
      <><b>Người giữ truyện</b> (chủ truyện, Trưởng nhóm và vai trò Trưởng nhóm chọn, mặc định Mod nhóm): giao việc, duyệt và gộp bản dịch, quay về bản cũ.</>,
      <><b>Thành viên</b> (dịch giả, biên tập, hiệu đính, cung cấp RAW): nhận việc đúng vai trò, làm trên bản nháp riêng rồi gửi lên.</>,
      <>Người đọc chỉ thấy chương khi người giữ truyện <b>gộp</b>. Nháp và bản đang chờ duyệt không ai ngoài nhóm thấy.</>,
    ],
  },
  {
    id: 'quy-trinh', title: 'Chọn quy trình của nhóm', who: 'Trưởng nhóm, Mod nhóm', images: [['/huong-dan/quy-trinh.webp', 'Tab Quy trình & nội quy của trang nhóm']],
    steps: [
      <>Vào trang nhóm → tab <b>Quy trình &amp; nội quy</b>.</>,
      <>Tích các bước nhóm dùng: RAW, DỊCH, BIÊN TẬP, HIỆU ĐÍNH. Bước cuối luôn là <b>GỘP</b>.</>,
      <>Chọn thêm vai trò nào được gộp (người giữ truyện), rồi bấm <b>Lưu quy trình</b>.</>,
    ],
    tip: 'Mỗi chương đi lần lượt qua các bước. Xong một bước, bước sau tự mở cho người đúng vai trò.',
  },
  {
    id: 'giao-viec', title: 'Giao việc cho một chương', who: 'Người giữ truyện', images: [['/huong-dan/giao-viec.webp', 'Khung Giao việc cho một chương']],
    steps: [
      <>Mở <b>Workspace nhóm</b> → ở thẻ truyện bấm <b>Giao việc &amp; duyệt</b> (hoặc nút cùng tên trong Workspace của tôi).</>,
      <><b>① Chương nào?</b> “Chương mới” (nhập số chương, tiêu đề nếu có) hoặc “Sửa chương đã đăng” (chọn chương).</>,
      <><b>② Ai làm?</b> “Để nhóm tự nhận” (ai đúng vai trò bước đầu bấm Nhận việc) hoặc “Giao cho một người”. Hạn không bắt buộc.</>,
      <><b>③ Dặn dò</b> nếu cần, đọc câu tóm tắt “Sẽ giao … cho …” rồi bấm <b>Giao việc</b>.</>,
    ],
    tip: 'Người được giao nhận thông báo ngay (chuông thông báo). Mỗi chương chỉ có một việc đang chạy.',
  },
  {
    id: 'nhan-viec', title: 'Nhận việc và làm', who: 'Thành viên', images: [['/huong-dan/nhan-viec.webp', 'Bảng việc trong workspace nhóm']],
    steps: [
      <>Mở <b>Workspace nhóm</b>: cột <b>Chưa nhận</b> là việc đang chờ người, cột <b>Đang làm</b> là việc đã có người. Bấm một bước trên dải quy trình để chỉ xem việc của bước đó.</>,
      <>Bấm <b>Nhận việc</b> ở việc đúng vai trò của bạn. Việc được giao thẳng cho bạn nằm ở <b>Việc của tôi</b> trong Workspace của tôi.</>,
      <>Bấm <b>Làm trên nháp</b> để mở bản nháp của chương. Nháp tự lưu khi gõ, chỉ bạn thấy.</>,
      <>Xong thì bấm <b>Xong bước</b>: bước sau mở cho người kế tiếp. Không làm được nữa thì bấm <b>Trả việc</b>.</>,
    ],
  },
  {
    id: 'gui-ban-dich', title: 'Gửi bản dịch để duyệt', who: 'Thành viên', images: [['/huong-dan/gui-ban-dich.webp', 'Trang soạn chương với nút Gửi đề xuất']],
    steps: [
      <>Xong bước cuối thì bản nháp tự thành <b>đề xuất</b> (bản dịch chờ duyệt). Bạn cũng có thể bấm <b>Gửi đề xuất</b> ngay trong trang soạn chương, kèm lời nhắn.</>,
      <>Đang chờ duyệt thì nháp bị khóa. Muốn sửa tiếp: <b>Rút lại để sửa</b>, sửa, rồi gửi lại.</>,
      <>Được <b>trả lại</b> thì bạn nhận thông báo kèm góp ý; sửa xong gửi lại, người duyệt thấy riêng phần bạn đổi so với lần trước.</>,
    ],
  },
  {
    id: 'duyet', title: 'Duyệt và gộp', who: 'Người giữ truyện', images: [['/huong-dan/duyet.webp', 'Trang xem một đề xuất']],
    steps: [
      <>Bản dịch chờ duyệt hiện ở cột <b>Chờ duyệt</b> của workspace nhóm và mục <b>Bản dịch chờ bạn duyệt</b> của trang Giao việc &amp; duyệt. Bạn cũng nhận thông báo.</>,
      <>Bấm vào để xem: đoạn thêm, đoạn bỏ và từng chữ đổi đều được tô màu. Bấm vào đoạn đã đổi để góp ý ngay chỗ đó, hoặc <b>Viết góp ý chung</b>.</>,
      <><b>Gộp vào bản chính</b>: thành phiên bản mới của chương, người đọc thấy ngay. <b>Trả lại</b>: người viết sửa tiếp theo góp ý.</>,
    ],
  },
  {
    id: 'phien-ban', title: 'Xem và dùng lại phiên bản cũ', who: 'Người giữ truyện', images: [['/huong-dan/phien-ban.webp', 'Dòng phiên bản của một chương']],
    steps: [
      <>Vào <b>Workspace của tôi</b>, chọn truyện trên kệ, bấm một chương trên dòng chảy.</>,
      <>Dòng phiên bản hiện ra, bản màu xanh lá là bản người đọc đang thấy. <b>So sánh các bản</b> để xem khác nhau.</>,
      <>Bấm <b>Dùng bản này</b> rồi <b>Chắc chắn</b>: tạo phiên bản mới có nội dung bản cũ, không mất bản nào.</>,
    ],
  },
  {
    id: 'thong-bao', title: 'Thông báo và tin nhắn', who: 'Mọi người',
    images: [['/huong-dan/thong-bao.webp', 'Chuông thông báo, nhóm Workspace'], ['/huong-dan/tin-nhan.webp', 'Bản nháp được chia sẻ hiện thành thẻ trong tin nhắn']],
    steps: [
      <>Chuông thông báo, nhóm <b>Workspace</b>: được giao việc, có bản dịch gửi lên (người giữ truyện), bản dịch bị trả lại hoặc được gộp (người viết), có người gửi bản sửa giúp hoặc chuyển nháp cho bạn.</>,
      <>Nhờ người khác xem hoặc sửa giúp: trong trang soạn chương bấm <b>Chia sẻ</b>, nháp được gửi thành một thẻ trong <b>tin nhắn</b>; người nhận bấm thẻ để mở.</>,
      <>Trao đổi chung của nhóm ở tab <b>Chat nhóm</b> trên trang nhóm.</>,
    ],
  },
];

export default function ChapterWorkflowGuide() {
  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 space-y-8 pb-24">
      <header className="space-y-2">
        <h1 className="text-2xl sm:text-3xl font-extrabold text-white">Hướng dẫn làm chương theo nhóm</h1>
        <p className="text-sm text-gray-400">Từ lúc giao việc tới lúc chương lên trang, kèm ảnh chụp từng màn hình.</p>
        <nav aria-label="Mục lục" className="flex flex-wrap gap-2 pt-2">
          {SECTIONS.map((s, i) => (
            <a key={s.id} href={`#${s.id}`} className="px-3 py-1.5 rounded-full border border-white/10 bg-white/5 text-xs text-gray-200 hover:border-brand-400/60">
              {i + 1}. {s.title}
            </a>
          ))}
        </nav>
      </header>

      {SECTIONS.map((s, i) => (
        <section key={s.id} id={s.id} className="scroll-mt-24 rounded-3xl border border-white/10 bg-white/[0.03] p-5 sm:p-6 space-y-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-lg font-bold text-white">{i + 1}. {s.title}</h2>
            <span className="rounded-full bg-brand-500/15 px-2.5 py-0.5 text-[11px] font-bold text-brand-300">{s.who}</span>
          </div>
          <ol className="space-y-2">
            {s.steps.map((step, j) => (
              <li key={j} className="flex gap-3 text-sm text-gray-200 leading-relaxed">
                <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-brand-600 text-[11px] font-bold text-snow">{j + 1}</span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
          {s.tip && <p className="rounded-xl bg-emerald-500/10 border border-emerald-500/20 px-3 py-2 text-xs text-emerald-200">{s.tip}</p>}
          {s.images && (
            <div className={`grid gap-3 ${s.images.length > 1 ? 'sm:grid-cols-2 items-start' : ''}`}>
              {s.images.map(([src, alt]) => (
                <figure key={src} className="space-y-1.5">
                  <img src={src} alt={alt} loading="lazy" className="w-full rounded-2xl border border-white/10" />
                  <figcaption className="text-[11px] text-gray-500">Ảnh: {alt}</figcaption>
                </figure>
              ))}
            </div>
          )}
        </section>
      ))}

      <p className="text-center text-sm">
        <Link href="/ws" className="text-brand-300 hover:text-brand-200 font-semibold">Mở Workspace của tôi →</Link>
      </p>
    </div>
  );
}
