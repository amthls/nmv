'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Flag, Check, X, Lock, ExternalLink } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import PageLoader from '@/components/common/PageLoader';
import CodeBadge from '@/components/common/CodeBadge';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api/v1';

const REASON_LABELS: Record<string, string> = {
  spam: 'Spam / quảng cáo',
  inappropriate: 'Nội dung không phù hợp',
  copyright: 'Vi phạm bản quyền',
  harassment: 'Quấy rối / xúc phạm',
  wrong_info: 'Sai thông tin',
  other: 'Lý do khác',
};
const TARGET_LABELS: Record<string, string> = {
  story: 'Truyện',
  chapter: 'Chương',
  comment: 'Bình luận',
  post: 'Bài viết',
};
const STATUS_TABS: { value: string; label: string }[] = [
  { value: 'pending', label: 'Chờ xử lý' },
  { value: 'resolved', label: 'Đã xử lý' },
  { value: 'dismissed', label: 'Bỏ qua' },
  { value: 'all', label: 'Tất cả' },
];

function targetHref(r: any): string | null {
  if (!r.target_path) return null;
  if (r.target_type === 'story') return `/truyen/${r.target_path}`;
  if (r.target_type === 'chapter') return `/truyen/${r.target_path}`;
  if (r.target_type === 'post') return `/fandom/${r.target_path}`;
  return null;
}

export default function ReportsPage() {
  const { isAuthenticated, isLoading: isAuthLoading, hasRole, authFetch, openAuthModal } = useAuth();
  const [status, setStatus] = useState('pending');
  const [reports, setReports] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const isModerator = hasRole('admin', 'mod');

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await authFetch(`${API_BASE_URL}/reports?status=${status}&limit=100`);
      const json = await res.json();
      if (res.ok && json.success) {
        setReports(json.data || []);
        setTotal(json.pagination?.total ?? (json.data || []).length);
      } else {
        setError(json.message || 'Không tải được danh sách báo cáo.');
      }
    } catch (e: any) {
      setError('Lỗi kết nối: ' + e.message);
    } finally {
      setIsLoading(false);
    }
  }, [status, authFetch]);

  useEffect(() => {
    if (isAuthenticated && isModerator) load();
    else setIsLoading(false);
  }, [isAuthenticated, isModerator, load]);

  const resolve = async (id: string, newStatus: 'resolved' | 'dismissed') => {
    const note = window.prompt(
      newStatus === 'resolved' ? 'Ghi chú xử lý (không bắt buộc):' : 'Lý do bỏ qua báo cáo (không bắt buộc):',
      ''
    );
    if (note === null) return;
    setBusyId(id);
    try {
      const res = await authFetch(`${API_BASE_URL}/reports/${id}/resolve`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus, resolution_note: note.trim() || null }),
      });
      const json = await res.json();
      if (res.ok && json.success) await load();
      else alert(json.message || 'Cập nhật báo cáo thất bại.');
    } catch (e: any) {
      alert('Lỗi: ' + e.message);
    } finally {
      setBusyId(null);
    }
  };

  if (isAuthLoading) {
    return <PageLoader label="Đang kiểm tra quyền truy cập..." />;
  }

  if (!isAuthenticated || !isModerator) {
    return (
      <div className="max-w-md mx-auto px-4 py-24 text-center">
        <div className="w-16 h-16 rounded-3xl bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-center justify-center mx-auto mb-5">
          <Lock className="w-8 h-8" />
        </div>
        <h2 className="text-2xl font-bold text-white mb-2">Chỉ dành cho Admin/Mod</h2>
        <p className="text-sm text-gray-400 mb-6">Bạn cần đăng nhập bằng tài khoản quản trị hoặc kiểm duyệt viên để xem báo cáo vi phạm.</p>
        {!isAuthenticated && (
          <button onClick={() => openAuthModal('login')} className="px-6 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-snow font-semibold text-sm transition">
            Đăng nhập
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 space-y-6 pb-24">
      <div className="flex items-center gap-3">
        <div className="p-2.5 rounded-xl bg-amber-500/15 text-amber-400 border border-amber-500/25">
          <Flag className="w-5 h-5" />
        </div>
        <div>
          <h1 className="text-xl sm:text-2xl font-extrabold text-white">Báo cáo vi phạm</h1>
          <p className="text-xs text-gray-400">{total} báo cáo trong mục này</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {STATUS_TABS.map((t) => (
          <button
            key={t.value}
            onClick={() => setStatus(t.value)}
            className={`px-3.5 h-8 rounded-lg text-xs font-bold border transition ${
              status === t.value
                ? 'bg-brand-600 border-brand-500 text-snow'
                : 'bg-white/5 border-white/10 text-gray-300 hover:bg-white/10'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && <div className="p-3 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs font-semibold">{error}</div>}

      {isLoading ? (
        <div className="space-y-3 animate-pulse">
          {[1, 2, 3].map((i) => <div key={i} className="h-24 rounded-2xl bg-white/5" />)}
        </div>
      ) : reports.length === 0 ? (
        <div className="p-10 text-center glass-panel rounded-2xl text-xs text-gray-400">Không có báo cáo nào.</div>
      ) : (
        <div className="space-y-3">
          {reports.map((r) => {
            const href = targetHref(r);
            const pending = r.status === 'pending';
            return (
              <div key={r.id} className="p-4 rounded-2xl glass-panel border border-white/10 space-y-2.5">
                <div className="flex flex-wrap items-center gap-2 text-[11px]">
                  <CodeBadge code={r.code} />
                  <span className="px-2 py-0.5 rounded-md bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 font-bold uppercase">
                    {TARGET_LABELS[r.target_type] || r.target_type}
                  </span>
                  <span className="px-2 py-0.5 rounded-md bg-amber-500/15 text-amber-300 border border-amber-500/30 font-semibold">
                    {REASON_LABELS[r.reason] || r.reason}
                  </span>
                  {!pending && (
                    <span className={`px-2 py-0.5 rounded-md border font-semibold ${r.status === 'resolved' ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' : 'bg-gray-500/15 text-gray-300 border-gray-500/30'}`}>
                      {r.status === 'resolved' ? 'Đã xử lý' : 'Đã bỏ qua'}
                    </span>
                  )}
                  <span className="text-gray-500 ml-auto">
                    {new Date(r.created_at).toLocaleString('vi-VN')} · bởi {r.reporter_name || r.reporter_username}
                  </span>
                </div>

                <div className="text-sm text-white font-semibold break-words">
                  {r.target_preview ? (
                    href ? (
                      <Link href={href} className="hover:text-brand-400 inline-flex items-center gap-1.5">
                        {r.target_preview}
                        <ExternalLink className="w-3.5 h-3.5 shrink-0" />
                      </Link>
                    ) : (
                      r.target_preview
                    )
                  ) : (
                    <span className="italic text-gray-500">Nội dung đã bị xóa</span>
                  )}
                </div>

                {r.description && <p className="text-xs text-gray-300 whitespace-pre-line break-words">“{r.description}”</p>}
                {r.resolution_note && <p className="text-xs text-gray-400 italic">Ghi chú xử lý: {r.resolution_note}</p>}

                {pending && (
                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={() => resolve(r.id, 'resolved')}
                      disabled={busyId === r.id}
                      className="px-3.5 h-8 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/40 text-[11px] font-bold flex items-center gap-1.5 transition disabled:opacity-50"
                    >
                      <Check className="w-3.5 h-3.5" /> Đã xử lý
                    </button>
                    <button
                      onClick={() => resolve(r.id, 'dismissed')}
                      disabled={busyId === r.id}
                      className="px-3.5 h-8 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 border border-white/15 text-[11px] font-bold flex items-center gap-1.5 transition disabled:opacity-50"
                    >
                      <X className="w-3.5 h-3.5" /> Bỏ qua
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
