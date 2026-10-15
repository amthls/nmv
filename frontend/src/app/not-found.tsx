import Link from '@/components/common/Link';
import { ChibiSay } from '@/components/skin/aemeath/SkinChibi';
import Skin404Crystal from '@/components/skin/aemeath/Skin404Crystal';

export const metadata = { title: 'Không tìm thấy trang - NovelHub' };

export default function NotFound() {
  return (
    <div className="sk-404 max-w-xl mx-auto px-4 py-24 text-center">
      {/* Sprite chỉ hiện khi skin Aemeath bật (html.skin-aemeath .sk-404__sprite) */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/backgrounds/aemeath/sprite.webp" alt="" className="sk-404__sprite hidden [html.skin-aemeath_&]:block" loading="lazy" />
      <ChibiSay pose="hi" mood="surprised" size={120} line="Ơ, lạc đường rồi sao? Để mình dẫn bạn về nhé!" />
      <Skin404Crystal />
      <h1 className="text-5xl font-extrabold">404</h1>
      <p className="text-gray-300">Trang bạn tìm không tồn tại hoặc đã được chuyển đi.</p>
      <p className="text-xs text-gray-400 hidden [html.skin-aemeath_&]:block">Aemeath: &quot;Lạc đường rồi sao? Để mình dẫn bạn về nhé!&quot;</p>
      <Link href="/" className="mt-2 px-5 py-2 rounded-xl bg-brand-500 text-snow text-sm font-bold">
        Về trang chủ
      </Link>
    </div>
  );
}
