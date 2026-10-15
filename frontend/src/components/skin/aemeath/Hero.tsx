'use client';

import React from 'react';
import Link from '@/components/common/Link';

/** Banner chào của skin Aemeath ở trang chủ. */
export default function Hero() {
  return (
    <section className="sk-hero" aria-label="Chào mừng">
      <div className="sk-hero__crystal" aria-hidden="true">
        <i />
        <i />
        <i />
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/backgrounds/aemeath/sprite.webp" alt="" className="sk-hero__sprite" loading="lazy" />
      <span className="sk-hero__chip">
        <span className="sk-star" aria-hidden="true" /> DIGITAL GHOST
      </span>
      <p className="sk-hero__title mt-3">
        Chào mừng đến NovelHub
      </p>
      <p className="sk-hero__sub">Cùng Aemeath lướt qua những trang truyện mới nhất, tỏa sáng như ánh Fusion giữa đêm Startorch.</p>
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
