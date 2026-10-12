'use client';

import Link from '@/components/common/Link';
import { FileText, Images } from 'lucide-react';
import { UploadMode, chapterUploadHref } from '@/lib/chapterUpload';

const MODES: { mode: UploadMode; label: string; hint: string; Icon: typeof FileText }[] = [
  { mode: 'novel', label: 'Truyện chữ', hint: 'Light Novel / Web Novel: soạn văn bản', Icon: FileText },
  { mode: 'manga', label: 'Truyện tranh', hint: 'Manga / Manhwa: kéo thả trang ảnh', Icon: Images },
];

/**
 * Picks between the two chapter uploaders (keeping the group filter). The jump replaces the history entry, so Back
 * leaves the uploader instead of bouncing between the two.
 */
export default function UploadModeSwitch({ mode, groupId }: { mode: UploadMode; groupId?: string | null }) {
  return (
    <div role="tablist" aria-label="Loại chương muốn đăng" className="grid grid-cols-2 gap-2 p-1 rounded-xl bg-white/5 border border-white/10">
      {MODES.map(({ mode: m, label, hint, Icon }) => {
        const active = m === mode;
        const body = (
          <>
            <Icon className={`w-5 h-5 shrink-0 ${active ? 'text-snow' : 'text-brand-400'}`} />
            <span className="min-w-0 text-left">
              <span className="block text-sm font-bold">{label}</span>
              <span className={`block text-[11px] truncate ${active ? 'text-snow/80' : 'text-gray-400'}`}>{hint}</span>
            </span>
          </>
        );
        const cls = `flex items-center gap-3 px-4 py-2.5 rounded-lg transition ${
          active ? 'bg-brand-600 text-snow shadow-md' : 'text-gray-300 hover:bg-white/5 hover:text-white'
        }`;
        return active ? (
          <div key={m} role="tab" aria-selected className={cls}>{body}</div>
        ) : (
          <Link key={m} role="tab" aria-selected={false} replace href={chapterUploadHref({ storyType: m, groupId, chosen: true })} className={cls}>{body}</Link>
        );
      })}
    </div>
  );
}
