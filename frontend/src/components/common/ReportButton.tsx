'use client';

import React, { useState } from 'react';
import { Flag, X, Check } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api/v1';

export type ReportTargetType = 'story' | 'chapter' | 'comment' | 'post';

const REASONS: { value: string; label: string }[] = [
  { value: 'spam', label: 'Spam / quảng cáo' },
  { value: 'inappropriate', label: 'Nội dung không phù hợp' },
  { value: 'copyright', label: 'Vi phạm bản quyền' },
  { value: 'harassment', label: 'Quấy rối / xúc phạm' },
  { value: 'wrong_info', label: 'Sai thông tin' },
  { value: 'other', label: 'Lý do khác' },
];

interface ReportButtonProps {
  targetType: ReportTargetType;
  targetId: string;
  /** 'icon' = small flag for inline use (comments); 'button' = labelled button */
  variant?: 'icon' | 'button';
  className?: string;
}

export default function ReportButton({ targetType, targetId, variant = 'button', className = '' }: ReportButtonProps) {
  const { isAuthenticated, openAuthModal, authFetch } = useAuth();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('spam');
  const [description, setDescription] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const openDialog = () => {
    if (!isAuthenticated) {
      openAuthModal('login');
      return;
    }
    setResult(null);
    setOpen(true);
  };

  const close = () => {
    setOpen(false);
    setDescription('');
    setReason('spam');
  };

  const send = async () => {
    if (isSending) return;
    setIsSending(true);
    try {
      const res = await authFetch(`${API_BASE_URL}/reports`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_type: targetType, target_id: targetId, reason, description: description.trim() || null }),
      });
      const json = await res.json();
      setResult({ ok: res.ok && json.success, message: json.message || (res.ok ? 'Đã gửi báo cáo.' : 'Gửi báo cáo thất bại.') });
    } catch (e: any) {
      setResult({ ok: false, message: 'Lỗi kết nối: ' + e.message });
    } finally {
      setIsSending(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={openDialog}
        title="Báo cáo vi phạm"
        className={
          className ||
          (variant === 'icon'
            ? 'flex items-center gap-1 hover:text-amber-400 transition'
            : 'px-3.5 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-gray-300 text-xs font-semibold flex items-center gap-1.5 transition')
        }
      >
        <Flag className="w-3.5 h-3.5" />
        <span>Báo cáo</span>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[100] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={close}
        >
          <div
            className="w-full max-w-md rounded-3xl bg-[#12121e] border border-white/10 shadow-2xl p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Flag className="w-4 h-4 text-amber-400" />
                Báo cáo vi phạm
              </h3>
              <button type="button" onClick={close} className="text-gray-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            {result?.ok ? (
              <div className="space-y-4">
                <div className="p-4 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs font-semibold flex items-start gap-2">
                  <Check className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{result.message}</span>
                </div>
                <button type="button" onClick={close} className="w-full h-10 rounded-xl bg-white/10 hover:bg-white/15 text-white text-xs font-bold transition">
                  Đóng
                </button>
              </div>
            ) : (
              <>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-gray-200">Lý do</label>
                  <select
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    className="w-full h-10 px-3 rounded-xl bg-[#0f0f18] border border-white/10 text-xs text-white focus:outline-none focus:border-brand-500"
                  >
                    {REASONS.map((r) => (
                      <option key={r.value} value={r.value}>{r.label}</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-gray-200">Mô tả thêm (không bắt buộc)</label>
                  <textarea
                    rows={3}
                    maxLength={1000}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Cho ban quản trị biết cụ thể vấn đề..."
                    className="w-full p-3 rounded-xl bg-[#0f0f18] border border-white/10 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-brand-500 resize-none"
                  />
                </div>

                {result && !result.ok && (
                  <div className="p-3 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs font-semibold">
                    {result.message}
                  </div>
                )}

                <div className="flex gap-2 pt-1">
                  <button type="button" onClick={close} className="flex-1 h-10 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 text-xs font-bold transition">
                    Hủy
                  </button>
                  <button
                    type="button"
                    onClick={send}
                    disabled={isSending}
                    className="flex-1 h-10 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-black text-xs font-bold transition"
                  >
                    {isSending ? 'Đang gửi...' : 'Gửi báo cáo'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
