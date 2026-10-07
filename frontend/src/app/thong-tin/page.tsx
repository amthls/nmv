import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Thông tin - NovelHub',
  description: 'Nội quy cộng đồng, điều khoản sử dụng, chính sách bảo mật và cách liên hệ quản trị NovelHub.',
};

const SECTIONS = [
  {
    id: 'noi-quy',
    title: 'Nội quy cộng đồng',
    items: [
      'Tôn trọng người đọc, dịch giả và tác giả. Không công kích cá nhân, không phân biệt đối xử.',
      'Không đăng nội dung khiêu dâm, bạo lực cực đoan hoặc vi phạm pháp luật.',
      'Bình luận có tiết lộ nội dung (spoiler) cần ghi rõ ở đầu bài.',
      'Không spam, quảng cáo hoặc đăng lại nội dung của người khác khi chưa được phép.',
    ],
  },
  {
    id: 'dieu-khoan',
    title: 'Điều khoản sử dụng',
    items: [
      'Người đăng truyện chịu trách nhiệm về quyền đăng tải nội dung của mình.',
      'Truyện và chương mới có thể cần Quản trị viên hoặc Trưởng nhóm dịch duyệt trước khi hiển thị.',
      'Nội dung vi phạm nội quy có thể bị ẩn hoặc xóa, tài khoản vi phạm nhiều lần có thể bị khóa.',
      'Truyện được nhập từ nguồn khác luôn ghi rõ nguồn trên trang truyện.',
    ],
  },
  {
    id: 'chinh-sach',
    title: 'Chính sách bảo mật',
    items: [
      'NovelHub lưu tên đăng nhập, email, ảnh đại diện, lịch sử đọc, bookmark và bình luận để phục vụ tài khoản của bạn.',
      'Cookie đăng nhập chỉ dùng để giữ phiên đăng nhập. Mật khẩu được mã hóa một chiều (bcrypt), không ai đọc được.',
      'Cài đặt giao diện (sáng/tối, độ phân giải ảnh) chỉ lưu trên trình duyệt của bạn.',
      'Chúng tôi không bán hay chia sẻ dữ liệu cá nhân cho bên thứ ba.',
    ],
  },
  {
    id: 'lien-he',
    title: 'Liên hệ quản trị',
    items: [
      'Báo nội dung vi phạm: dùng nút “Báo cáo” trên trang truyện, chương hoặc bài viết; Quản trị viên sẽ xem trong mục Báo cáo vi phạm.',
      'Hỗ trợ đăng truyện, nhóm dịch: nhắn trong không gian nhóm dịch hoặc đăng bài ở mục Fandom.',
    ],
  },
];

export default function InfoPage() {
  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10 space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-white">Thông tin</h1>
        <p className="mt-1 text-sm text-gray-400">Nội quy, điều khoản, quyền riêng tư và cách liên hệ.</p>
        <nav className="mt-4 flex flex-wrap gap-2 text-xs">
          {SECTIONS.map((s) => (
            <a key={s.id} href={`#${s.id}`} className="px-3 py-1.5 rounded-full bg-white/5 hover:bg-white/10 text-gray-300 transition">
              {s.title}
            </a>
          ))}
        </nav>
      </div>

      {SECTIONS.map((s) => (
        <section key={s.id} id={s.id} className="glass-panel rounded-xl p-5 scroll-mt-24">
          <h2 className="text-lg font-bold text-white">{s.title}</h2>
          <ul className="mt-3 list-disc pl-5 space-y-1.5 text-sm text-gray-300 leading-relaxed">
            {s.items.map((t) => <li key={t}>{t}</li>)}
          </ul>
          {s.id === 'lien-he' && (
            <div className="mt-4 flex gap-2">
              <Link href="/bao-cao" className="px-3 py-2 rounded-lg bg-brand-600 hover:bg-brand-500 text-snow text-xs font-semibold">Báo cáo vi phạm</Link>
              <Link href="/fandom" className="px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-white text-xs font-semibold">Mục Fandom</Link>
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
