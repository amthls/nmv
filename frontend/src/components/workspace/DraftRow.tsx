'use client';

import React from 'react';
import Link from 'next/link';
import { GitMerge } from 'lucide-react';

/** One of my open drafts (workspace pages): where it stands against the official version. */

export function draftLabel(d: any) {
  const n = Number(d.meta?.chapter_number);
  const title = d.meta?.title || '(chưa có tiêu đề)';
  return `${Number.isFinite(n) && n > 0 ? `Chương ${n}: ` : ''}${title}`;
}

export function DraftRow({ d, storyTitle }: { d: any; storyTitle?: string }) {
  const behind = d.chapter_id && d.current_version && d.current_version !== d.base_version && !d.chapter_deleted;
  return (
    <Link
      href={`/dang-chuong?draft=${d.id}`}
      className="flex items-center justify-between gap-3 p-3.5 rounded-2xl bg-white/5 hover:bg-white/10 border border-white/10 transition"
    >
      <div className="min-w-0 space-y-1">
        <div className="text-sm font-bold text-white truncate">{draftLabel(d)}</div>
        <div className="text-[11px] text-gray-400 flex flex-wrap gap-x-2">
          {storyTitle && <span className="text-brand-300">{storyTitle}</span>}
          <span>{d.copied_from ? 'bản sao để sửa giúp' : d.chapter_id ? `sửa chương đã đăng (từ phiên bản ${d.base_version})` : 'chương mới'}</span>
          <span>· {d.block_count} đoạn</span>
          <span>· lưu {new Date(d.updated_at).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' })}</span>
        </div>
      </div>
      {d.status === 'scheduled' ? (
        <span className="shrink-0 text-[10px] font-bold text-violet-300 bg-violet-500/10 border border-violet-500/30 rounded-full px-2 py-0.5">
          Hẹn đăng {new Date(d.publish_at).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' })}
        </span>
      ) : d.status === 'offered' ? (
        <span className="shrink-0 text-[10px] font-bold text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 rounded-full px-2 py-0.5">Đã gửi cho chủ nháp</span>
      ) : d.status === 'submitted' ? (
        <span className="shrink-0 text-[10px] font-bold text-sky-300 bg-sky-500/10 border border-sky-500/30 rounded-full px-2 py-0.5">Chờ duyệt</span>
      ) : d.chapter_deleted ? (
        <span className="shrink-0 text-[10px] font-bold text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded-full px-2 py-0.5">Chương đã xóa</span>
      ) : behind ? (
        <span className="shrink-0 text-[10px] font-bold text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-full px-2 py-0.5 flex items-center gap-1">
          <GitMerge className="w-3 h-3" /> Bản chính đã đổi (v{d.current_version})
        </span>
      ) : null}
    </Link>
  );
}
