'use client';

import React from 'react';
import Link from '@/components/common/Link';

/** Banner trang chủ của skin Aemeath: ảnh + hologram nhẹ, chữ là tiêu đề thường của web đọc truyện. */
export default function Hero() {
  return (
    <section className="sk-hero" aria-label="Giới thiệu">
      <span className="sk-hero__chip">
        <span className="sk-star" aria-hidden="true" /> LIGHT NOVEL · MANGA · FANDOM
      </span>
      <p className="sk-hero__title mt-3">Đọc truyện mỗi ngày</p>
      <p className="sk-hero__sub">Kho light novel và manga cập nhật liên tục, theo dõi dịch giả và thảo luận cùng cộng đồng.</p>
      <div className="mt-5 flex flex-wrap gap-3">
        <Link href="/kham-pha" className="px-5 py-2 rounded-xl bg-brand-500 text-snow text-sm font-bold">
          Khám phá ngay
        </Link>
        <Link href="/moi-cap-nhat" className="px-5 py-2 rounded-xl border border-white/30 text-sm font-semibold text-snow hover:bg-white/10 transition">
          Mới cập nhật
        </Link>
      </div>
    </section>
  );
}
