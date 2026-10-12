'use client';

import React, { useEffect, useState } from 'react';
import Link from '@/components/common/Link';
import { useRouter } from 'next/navigation';
import { Copy, FileText, Lock } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { draftLabel } from './DraftRow';

/**
 * A workspace draft shared in a direct message (Plan/chapter-workspace.md, stage 4a). The message only carries the id;
 * the workspace says what this reader may do: view, make their own copy, edit in turn, or nothing.
 */

const WS_URL = '/api/ws';

export default function DraftCard({ id, mine }: { id: string; mine: boolean }) {
  const { authFetch } = useAuth();
  const router = useRouter();
  const [card, setCard] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    authFetch(`${WS_URL}/drafts/${id}/card`).then((r) => r.json())
      .then((j) => (j.success ? setCard(j.data) : setError(j.message || 'Bản nháp không còn.')))
      .catch(() => setError('Không tải được bản nháp.'));
  }, [authFetch, id]);

  const [busy, setBusy] = useState(false); // a second click while copying would make a second copy (Plan/load.md B3)
  const copy = async () => {
    if (busy) return;
    setBusy(true);
    const res = await authFetch(`${WS_URL}/drafts/${id}/copy`, { method: 'POST' });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.success) {
      setBusy(false);
      return setError(json.message || 'Không tạo được bản sao.');
    }
    router.push(`/dang-chuong?draft=${json.data.id}`);
  };

  const box = `mt-2 p-3 rounded-xl text-xs whitespace-normal ${mine ? 'bg-black/20' : 'bg-black/30 border border-white/10'}`;
  if (error) return <div className={box}>{error}</div>;
  if (!card) return <div className={box}>Đang tải bản nháp...</div>;
  if (card.access === 'none') {
    return <div className={`${box} flex items-center gap-1.5 text-gray-400`}><Lock className="w-3.5 h-3.5" /> Bản nháp: bạn không có quyền xem (chỉ người tham gia truyện được chia sẻ mới mở được).</div>;
  }
  const open = card.status === 'open' || card.status === 'submitted';
  return (
    <div className={box}>
      <div className="font-bold flex items-center gap-1.5"><FileText className="w-3.5 h-3.5" /> {draftLabel(card)}</div>
      <div className="opacity-70 mt-0.5">
        Nháp của {card.owner_name || 'người viết'} · {card.block_count} đoạn
        {card.status === 'published' ? ' · đã đăng' : card.status === 'discarded' ? ' · đã bỏ' : card.status === 'submitted' ? ' · đang chờ duyệt' : ''}
      </div>
      <div className="flex flex-wrap gap-1.5 mt-2">
        <Link href={`/dang-chuong?draft=${id}`} className="px-2.5 py-1 rounded-lg bg-white/15 hover:bg-white/25 font-bold">
          {card.access === 'owner' ? 'Mở nháp' : card.access === 'editor' ? 'Sửa' : 'Xem'}
        </Link>
        {card.access !== 'owner' && open && (
          <button type="button" onClick={copy} disabled={busy} className="px-2.5 py-1 rounded-lg bg-white/15 hover:bg-white/25 font-bold flex items-center gap-1 disabled:opacity-50">
            <Copy className="w-3 h-3" /> {busy ? 'Đang tạo...' : 'Tạo bản sao của tôi'}
          </button>
        )}
      </div>
    </div>
  );
}
