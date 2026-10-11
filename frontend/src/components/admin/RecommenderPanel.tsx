'use client';

import React, { useEffect, useState } from 'react';
import { Brain, Loader2, RefreshCw } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';

import { REC_URL } from '@/lib/apiJson';

const LABELS: Record<string, string> = {
  blend: 'Mô hình trộn (đang dùng)',
  knn: 'Lọc cộng tác theo truyện',
  als: 'Matrix factorization (ALS)',
  content: 'Theo nội dung',
  co_read_only: 'Chỉ "cũng đọc"',
  next_read_only: 'Chỉ "đọc tiếp theo"',
  content_only: 'Theo nội dung',
  popularity: 'Chỉ độ phổ biến (mốc so sánh)',
};

function MetricTable({ title, rows }: { title: string; rows: Record<string, any> }) {
  const entries = Object.entries(rows).filter(([k]) => k !== 'weights');
  const best = Math.max(...entries.map(([, v]) => v.ndcg_at_10 || 0));
  return (
    <div className="space-y-2">
      <p className="text-xs font-bold text-gray-300">{title}</p>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-gray-500 text-left">
            <th className="font-semibold py-1">Phương pháp</th>
            <th className="font-semibold py-1 text-right">Recall@10</th>
            <th className="font-semibold py-1 text-right">NDCG@10</th>
          </tr>
        </thead>
        <tbody>
          {entries.map(([k, v]) => (
            <tr key={k} className={`border-t border-white/5 ${v.ndcg_at_10 === best ? 'text-emerald-300 font-semibold' : 'text-gray-300'}`}>
              <td className="py-1.5">{LABELS[k] || k}</td>
              <td className="py-1.5 text-right">{(v.recall_at_10 * 100).toFixed(1)}%</td>
              <td className="py-1.5 text-right">{v.ndcg_at_10.toFixed(3)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.weights && (
        <p className="text-[11px] text-gray-500">
          Trọng số học được: {Object.entries(rows.weights).map(([k, v]) => `${k}=${v}`).join(' · ')}
        </p>
      )}
    </div>
  );
}

/** Admin view of the recommender: last training runs, offline quality, CTR, retrain button. */
export default function RecommenderPanel() {
  const { authFetch } = useAuth();
  const [runs, setRuns] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = () =>
    authFetch(`${REC_URL}/status`).then((r) => r.json()).then((j) => j.success && setRuns(j.data)).catch(() => {});
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const train = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const j = await (await authFetch(`${REC_URL}/train`, { method: 'POST' })).json();
      setMsg(j.message || (j.success ? 'Đã huấn luyện.' : 'Thất bại.'));
      load();
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  };

  const last = runs.find((r) => r.status === 'ok');
  const offline = last?.metrics?.offline;
  const ctr = last?.metrics?.ctr_7d || {};

  return (
    <div className="glass-panel p-6 rounded-3xl border border-brand-500/30 bg-glass space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-bold text-white flex items-center gap-2">
            <Brain className="w-5 h-5 text-brand-400" /> Mô hình gợi ý truyện
          </h3>
          <p className="text-xs text-gray-400 mt-1">
            Tự huấn luyện lại mỗi 30 phút (service recommender). Điểm đo bằng cách giấu truyện đọc gần nhất của mỗi người rồi xem mô hình có đoán ra trong top 10 không.
          </p>
        </div>
        <button
          onClick={train}
          disabled={busy}
          className="px-4 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-snow text-xs font-bold flex items-center gap-1.5 disabled:opacity-50 shrink-0"
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          Huấn luyện lại ngay
        </button>
      </div>

      {msg && <p className="text-xs text-emerald-300">{msg}</p>}

      {!last ? (
        <p className="text-xs text-gray-400">Chưa có lần huấn luyện nào.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
            {[
              ['Lần chạy gần nhất', new Date(last.started_at).toLocaleString('vi-VN')],
              ['Thời gian', `${last.duration_ms} ms`],
              ['Người đọc / truyện', `${last.users} / ${last.stories}`],
              ['Tương tác', Number(last.interactions).toLocaleString('vi-VN')],
            ].map(([k, v]) => (
              <div key={k} className="p-3 rounded-xl bg-white/5 border border-white/10">
                <div className="text-sm font-bold text-white">{v}</div>
                <div className="text-[11px] text-gray-400">{k}</div>
              </div>
            ))}
          </div>
          {offline ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <MetricTable title={`"Đề xuất cho bạn" (${offline.evaluated_readers} người đọc)`} rows={offline.home} />
              <MetricTable title='"Truyện liên quan"' rows={offline.related} />
            </div>
          ) : (
            <p className="text-xs text-gray-400">Chưa đủ dữ liệu để đánh giá (cần ít nhất 5 người đọc từ 3 truyện).</p>
          )}
          <div className="text-xs text-gray-400 flex flex-wrap gap-x-6 gap-y-1">
            <span className="font-semibold text-gray-300">Tỉ lệ bấm (7 ngày):</span>
            {['home_rec', 'related'].map((k) => (
              <span key={k}>
                {k === 'home_rec' ? 'Đề xuất cho bạn' : 'Truyện liên quan'}: {ctr[k] ? `${(ctr[k].ctr * 100).toFixed(1)}% (${ctr[k].clicks}/${ctr[k].impressions})` : 'chưa có'}
              </span>
            ))}
          </div>
        </>
      )}
      {runs.some((r) => r.status === 'error') && (
        <p className="text-[11px] text-rose-300">Có lần chạy lỗi gần đây: {runs.find((r) => r.status === 'error')?.error?.split('\n')[0]}</p>
      )}
    </div>
  );
}
