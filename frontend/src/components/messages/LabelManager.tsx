'use client';

import React, { useEffect, useState } from 'react';
import { Check, Plus, Tag, Trash2, X } from 'lucide-react';
import { DmLabel, LABEL_STYLES, labelStyle } from './labels';

type Props = {
  isOpen: boolean;
  onClose: () => void;
  labels: DmLabel[];
  /** Calls the API; resolves to an error message, or null on success. */
  onCreate: (name: string, color: string) => Promise<string | null>;
  onUpdate: (id: string, patch: { name?: string; color?: string }) => Promise<string | null>;
  onDelete: (id: string) => Promise<string | null>;
};

const COLORS = Object.keys(LABEL_STYLES);

function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="flex items-center gap-1.5">
      {COLORS.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(c)}
          aria-label={`Màu ${c}`}
          className={`w-5 h-5 rounded-full ${LABEL_STYLES[c].dot} flex items-center justify-center ring-offset-2 ring-offset-surface-2 transition ${
            value === c ? 'ring-2 ring-white/70 scale-110' : 'hover:scale-110'
          }`}
        >
          {value === c && <Check className="w-3 h-3 text-ink" strokeWidth={3} />}
        </button>
      ))}
    </div>
  );
}

/** Create, rename, recolor and delete my message labels. */
export default function LabelManager({ isOpen, onClose, labels, onCreate, onUpdate, onDelete }: Props) {
  const [name, setName] = useState('');
  const [color, setColor] = useState('sky');
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setError(null);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    const err = await onCreate(name.trim(), color);
    setError(err);
    if (!err) setName('');
  };

  const saveName = async () => {
    if (!editing) return;
    const err = editing.name.trim() ? await onUpdate(editing.id, { name: editing.name.trim() }) : 'Tên nhãn không được để trống.';
    setError(err);
    if (!err) setEditing(null);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="label-manager-title"
        className="w-full max-w-md rounded-2xl bg-surface-2 border border-white/10 shadow-2xl p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 id="label-manager-title" className="flex items-center gap-2 text-base font-bold text-white">
            <Tag className="w-4 h-4 text-fuchsia-400" /> Quản lý nhãn
          </h2>
          <button onClick={onClose} aria-label="Đóng" className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/10">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={create} className="space-y-3 p-3 rounded-xl bg-white/[0.03] border border-white/[0.06]">
          <div className="flex gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={30}
              placeholder="Tên nhãn mới, ví dụ: Nhóm dịch"
              className="flex-1 h-9 px-3 rounded-lg bg-white/5 border border-white/10 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-brand-500"
            />
            <button
              type="submit"
              disabled={!name.trim()}
              className="h-9 px-3 rounded-lg bg-brand-600 hover:bg-brand-500 disabled:opacity-40 text-snow text-xs font-semibold flex items-center gap-1"
            >
              <Plus className="w-4 h-4" /> Tạo
            </button>
          </div>
          <ColorPicker value={color} onChange={setColor} />
        </form>

        {error && <p className="mt-3 text-xs text-rose-400">{error}</p>}

        <div className="mt-4 space-y-1.5 max-h-72 overflow-y-auto">
          {labels.length === 0 && <p className="text-xs text-gray-500 text-center py-4">Chưa có nhãn nào.</p>}
          {labels.map((l) => (
            <div key={l.id} className="p-2.5 rounded-xl hover:bg-white/[0.03] border border-transparent hover:border-white/[0.06] space-y-2">
              <div className="flex items-center gap-2">
                <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${labelStyle(l.color).dot}`} />
                {editing?.id === l.id ? (
                  <input
                    autoFocus
                    value={editing.name}
                    maxLength={30}
                    onChange={(e) => setEditing({ id: l.id, name: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') saveName();
                      if (e.key === 'Escape') { e.stopPropagation(); setEditing(null); }
                    }}
                    onBlur={saveName}
                    className="flex-1 h-7 px-2 rounded-md bg-white/5 border border-brand-500 text-sm text-white focus:outline-none"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => setEditing({ id: l.id, name: l.name })}
                    className="flex-1 text-left text-sm text-white truncate hover:text-brand-300"
                    title="Bấm để đổi tên"
                  >
                    {l.name}
                  </button>
                )}
                <span className="text-[11px] text-gray-500 shrink-0">{l.conversation_count} cuộc trò chuyện</span>
                <button
                  type="button"
                  onClick={async () => setError(await onDelete(l.id))}
                  aria-label={`Xóa nhãn ${l.name}`}
                  className="p-1 rounded-md text-gray-500 hover:text-rose-400 hover:bg-rose-500/10"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="pl-[18px]">
                <ColorPicker value={l.color} onChange={async (c) => setError(await onUpdate(l.id, { color: c }))} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
