'use client';

import React, { useEffect, useState } from 'react';
import { DatabaseBackup } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api/v1';

const fmt = (iso?: string) => (iso ? new Date(iso).toLocaleString('vi-VN') : 'chưa có');

/** Admin view of the nightly backup: last run, last test restore, repository size. Read-only on purpose:
 *  restoring is done from the server with scripts/restore.sh, never from the web. */
export default function BackupPanel() {
  const { authFetch } = useAuth();
  const [s, setS] = useState<Record<string, string> | null | undefined>(undefined);

  useEffect(() => {
    authFetch(`${API_BASE_URL}/admin/backup-status`).then((r) => r.json()).then((j) => setS(j.data)).catch(() => setS(null));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const stale = !s?.last_backup_at || Date.now() - new Date(s.last_backup_at).getTime() > 26 * 3600_000;
  const bad = s && (s.last_backup_ok === 'false' || s.last_check_ok === 'false' || stale);

  return (
    <div className={`glass-panel p-6 rounded-3xl border bg-glass space-y-5 ${bad ? 'border-rose-500/40' : 'border-emerald-500/30'}`}>
      <div>
        <h3 className="text-lg font-bold text-white flex items-center gap-2">
          <DatabaseBackup className="w-5 h-5 text-emerald-400" /> Sao lưu dữ liệu
        </h3>
        <p className="text-xs text-gray-400 mt-1">
          3 giờ sáng mỗi ngày sao lưu toàn bộ database và ảnh tải lên; giữ 14 bản ngày, 8 bản tuần, 12 bản tháng.
          Sáng Chủ nhật tự thử khôi phục. Khôi phục làm trên máy chủ bằng <code>scripts/restore.sh</code>.
        </p>
      </div>

      {s === undefined ? null : !s ? (
        <p className="text-xs text-amber-300">Chưa có bản sao lưu nào (container <code>backup</code> chưa chạy lần nào).</p>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
            {[
              ['Bản gần nhất', fmt(s.last_backup_at), s.last_backup_ok === 'false' || stale],
              ['Thử khôi phục', fmt(s.last_check_at), s.last_check_ok === 'false'],
              ['Dung lượng kho', s.repo_size || '?', false],
              ['Số bản đang giữ', s.snapshots || '?', false],
            ].map(([k, v, warn]) => (
              <div key={k as string} className={`p-3 rounded-xl border ${warn ? 'bg-rose-500/10 border-rose-500/30' : 'bg-white/5 border-white/10'}`}>
                <div className="text-sm font-bold text-white">{v}</div>
                <div className="text-[11px] text-gray-400">{k}</div>
              </div>
            ))}
          </div>
          {s.last_check_detail && <p className="text-xs text-gray-400">Lần thử khôi phục: {s.last_check_detail}</p>}
          {s.last_backup_ok === 'false' && <p className="text-xs text-rose-300">Lần sao lưu gần nhất lỗi: {s.last_backup_error}</p>}
          {stale && s.last_backup_ok !== 'false' && <p className="text-xs text-rose-300">Quá 26 giờ chưa có bản sao lưu mới.</p>}
          <p className="text-[11px] text-gray-500">
            Kho sao lưu nằm cùng ổ đĩa với web: hỏng ổ hoặc mất máy là mất cả hai. Nên chép thư mục <code>backups/</code> và
            <code> RESTIC_PASSWORD</code> sang nơi khác định kỳ.
          </p>
        </>
      )}
    </div>
  );
}
