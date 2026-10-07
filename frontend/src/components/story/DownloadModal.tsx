'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X, Download, FileText, BookOpen, Check, Minus, ChevronDown, Loader2, AlertTriangle, Files, File } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api/v1';

type Format = 'epub' | 'pdf';
type Mode = 'merged' | 'single';

interface ChapterItem { id: string; title: string; chapter_number: number | string }
interface Group { key: string; title: string; chapters: ChapterItem[] }

interface ExportJob {
  id: string;
  status: 'queued' | 'processing' | 'ready' | 'failed';
  progress: number;
  file_name: string | null;
  file_size: number | null;
  error: string | null;
}

function formatSize(bytes: number | null) {
  if (!bytes) return '';
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

interface DownloadModalProps {
  isOpen: boolean;
  onClose: () => void;
  storySlug: string;
  /** Story detail (volumes + unassigned_chapters); fetched when not given */
  story?: any;
  /** Chapters ticked when the dialog opens (default: all) */
  initialChapterIds?: string[];
}

/**
 * Download a story as EPUB or PDF: pick the format, the chapters (by volume or one by one),
 * and either one merged file or one file per chapter (zipped). The server builds it in the
 * background; this dialog polls the job and starts the download when the file is ready.
 */
export default function DownloadModal({ isOpen, onClose, storySlug, story: storyProp, initialChapterIds }: DownloadModalProps) {
  const { authFetch } = useAuth();
  const [story, setStory] = useState<any>(storyProp || null);
  const [format, setFormat] = useState<Format>('epub');
  const [mode, setMode] = useState<Mode>('merged');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [job, setJob] = useState<ExportJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const pollRef = useRef<ReturnType<typeof setTimeout>>();
  const autoDownloaded = useRef<string | null>(null);
  // Bumped whenever polling must stop (dialog closed, new request): stale responses are ignored
  const pollGen = useRef(0);

  useEffect(() => {
    if (storyProp) setStory(storyProp);
  }, [storyProp]);

  useEffect(() => {
    if (!isOpen || storyProp || story) return;
    fetch(`${API_BASE_URL}/stories/${storySlug}`)
      .then((r) => r.json())
      .then((j) => j.success && setStory(j.data))
      .catch(() => setError('Không tải được danh sách chương.'));
  }, [isOpen, storyProp, story, storySlug]);

  const groups: Group[] = useMemo(() => {
    if (!story) return [];
    const out: Group[] = (story.volumes || [])
      .filter((v: any) => v.chapters && v.chapters.length > 0)
      .map((v: any) => ({ key: v.id, title: v.title || `Tập ${v.volume_number}`, chapters: v.chapters }));
    if (story.unassigned_chapters?.length) out.push({ key: 'none', title: 'Chương lẻ', chapters: story.unassigned_chapters });
    return out;
  }, [story]);
  const allIds = useMemo(() => groups.flatMap((g) => g.chapters.map((c) => c.id)), [groups]);

  // Reset the selection each time the dialog opens
  useEffect(() => {
    if (!isOpen || allIds.length === 0) return;
    const initial = initialChapterIds?.filter((id) => allIds.includes(id));
    setSelected(new Set(initial && initial.length ? initial : allIds));
    setJob(null);
    setError(null);
    // a single preselected chapter: show only its volume open
    if (initial && initial.length) {
      setCollapsed(new Set(groups.filter((g) => !g.chapters.some((c) => initial.includes(c.id))).map((g) => g.key)));
    } else {
      setCollapsed(new Set(groups.length > 3 ? groups.slice(1).map((g) => g.key) : []));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, allIds.length]);

  useEffect(() => {
    if (!isOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
      pollGen.current++;
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, [isOpen, onClose]);

  const downloadUrl = (id: string) => `${API_BASE_URL}/exports/${id}/download`;

  const startDownload = (j: ExportJob) => {
    if (autoDownloaded.current === j.id) return;
    autoDownloaded.current = j.id;
    const a = document.createElement('a');
    a.href = downloadUrl(j.id);
    a.download = j.file_name || '';
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const poll = (id: string, gen: number, failures = 0) => {
    pollRef.current = setTimeout(async () => {
      if (gen !== pollGen.current) return;
      try {
        const res = await fetch(`${API_BASE_URL}/exports/${id}`);
        const json = await res.json();
        if (gen !== pollGen.current) return; // dialog closed or a new request started meanwhile
        if (!json.success) throw new Error(json.message);
        setJob(json.data);
        if (json.data.status === 'ready') startDownload(json.data);
        else if (json.data.status !== 'failed') poll(id, gen);
      } catch {
        if (gen !== pollGen.current) return;
        if (failures >= 20) setError('Mất kết nối khi chờ tạo tệp. Hãy thử lại.');
        else poll(id, gen, failures + 1); // network hiccup: keep trying a while
      }
    }, 1200);
  };

  const submit = async () => {
    if (selected.size === 0 || submitting) return;
    setSubmitting(true);
    setError(null);
    setJob(null);
    autoDownloaded.current = null;
    const gen = ++pollGen.current;
    if (pollRef.current) clearTimeout(pollRef.current);
    try {
      const ordered = allIds.filter((id) => selected.has(id));
      const res = await authFetch(`${API_BASE_URL}/stories/${storySlug}/exports`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ format, mode, chapter_ids: ordered.length === allIds.length ? 'all' : ordered }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.message || 'Không thể tạo tệp.');
      if (gen !== pollGen.current) return;
      setJob(json.data);
      if (json.data.status === 'ready') startDownload(json.data);
      else if (json.data.status !== 'failed') poll(json.data.id, gen);
    } catch (e: any) {
      setError(e.message || 'Không thể tạo tệp.');
    } finally {
      setSubmitting(false);
    }
  };

  const toggle = (ids: string[], on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => (on ? next.add(id) : next.delete(id)));
      return next;
    });

  if (!isOpen) return null;

  const busy = submitting || (job && (job.status === 'queued' || job.status === 'processing'));
  const isManga = story?.story_type === 'manga';
  const effectiveMode: Mode = selected.size <= 1 ? 'merged' : mode;

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center sm:p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="absolute inset-0" onClick={onClose} />
      <div className="relative w-full sm:max-w-lg max-h-[92vh] flex flex-col rounded-t-2xl sm:rounded-2xl bg-glass border border-white/10 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-white/10">
          <div className="min-w-0">
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <Download className="w-5 h-5 text-brand-400" /> Tải truyện về máy
            </h2>
            {story && <p className="text-xs text-gray-400 truncate mt-0.5">{story.title}</p>}
          </div>
          <button type="button" onClick={onClose} className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition" title="Đóng">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {/* Format */}
          <div className="space-y-2">
            <div className="text-xs font-semibold text-gray-300">Định dạng</div>
            <div className="grid grid-cols-2 gap-2">
              {([
                { id: 'epub', icon: BookOpen, title: 'EPUB', desc: 'Cho app đọc sách: Apple Books, Google Play Sách, Moon+ Reader, Kobo…' },
                { id: 'pdf', icon: FileText, title: 'PDF', desc: 'Mở được trên mọi thiết bị, giữ nguyên bố cục, in được.' },
              ] as const).map((f) => (
                <button
                  key={f.id}
                  type="button"
                  disabled={!!busy}
                  onClick={() => setFormat(f.id)}
                  className={`text-left p-3 rounded-xl border transition disabled:opacity-60 ${
                    format === f.id ? 'bg-brand-600/15 border-brand-500 ring-1 ring-brand-500/40' : 'bg-white/5 border-white/10 hover:bg-white/10'
                  }`}
                >
                  <div className="flex items-center gap-2 text-sm font-bold text-white">
                    <f.icon className={`w-4 h-4 ${format === f.id ? 'text-brand-400' : 'text-gray-400'}`} /> {f.title}
                  </div>
                  <p className="text-[11px] text-gray-400 mt-1 leading-snug">{f.desc}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Mode */}
          <div className="space-y-2">
            <div className="text-xs font-semibold text-gray-300">Cách đóng gói</div>
            <div className="grid grid-cols-2 gap-2">
              {([
                { id: 'merged', icon: File, title: 'Gộp thành 1 tệp', desc: 'Tất cả chương đã chọn trong một cuốn, có mục lục.' },
                { id: 'single', icon: Files, title: 'Mỗi chương 1 tệp', desc: 'Mỗi chương một tệp riêng, gói trong 1 file .zip.' },
              ] as const).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  disabled={!!busy || selected.size <= 1}
                  onClick={() => setMode(m.id)}
                  className={`text-left p-3 rounded-xl border transition disabled:opacity-50 ${
                    effectiveMode === m.id ? 'bg-brand-600/15 border-brand-500 ring-1 ring-brand-500/40' : 'bg-white/5 border-white/10 hover:bg-white/10'
                  }`}
                >
                  <div className="flex items-center gap-2 text-sm font-bold text-white">
                    <m.icon className={`w-4 h-4 ${effectiveMode === m.id ? 'text-brand-400' : 'text-gray-400'}`} /> {m.title}
                  </div>
                  <p className="text-[11px] text-gray-400 mt-1 leading-snug">{m.desc}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Chapters */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold text-gray-300">
                Chương <span className="text-gray-500 font-normal">({selected.size}/{allIds.length} đã chọn)</span>
              </div>
              <div className="flex gap-3 text-[11px] font-semibold">
                <button type="button" disabled={!!busy} onClick={() => setSelected(new Set(allIds))} className="text-brand-400 hover:text-brand-300 disabled:opacity-50">
                  Chọn tất cả
                </button>
                <button type="button" disabled={!!busy} onClick={() => setSelected(new Set())} className="text-gray-400 hover:text-white disabled:opacity-50">
                  Bỏ chọn
                </button>
              </div>
            </div>

            {!story ? (
              <div className="py-6 flex justify-center text-gray-400"><Loader2 className="w-5 h-5 animate-spin" /></div>
            ) : allIds.length === 0 ? (
              <p className="text-xs text-gray-400 py-4 text-center">Truyện chưa có chương nào.</p>
            ) : (
              <div className="rounded-xl border border-white/10 divide-y divide-white/5 overflow-hidden">
                {groups.map((g) => {
                  const ids = g.chapters.map((c) => c.id);
                  const count = ids.filter((id) => selected.has(id)).length;
                  const state = count === 0 ? 'none' : count === ids.length ? 'all' : 'some';
                  const open = !collapsed.has(g.key);
                  return (
                    <div key={g.key}>
                      <div className="flex items-center gap-2 px-3 py-2 bg-white/[0.03]">
                        <CheckBox state={state} disabled={!!busy} onClick={() => toggle(ids, state !== 'all')} />
                        <button
                          type="button"
                          onClick={() => setCollapsed((p) => { const n = new Set(p); open ? n.add(g.key) : n.delete(g.key); return n; })}
                          className="flex-1 min-w-0 flex items-center justify-between gap-2 text-left"
                        >
                          <span className="text-xs font-bold text-white truncate">{g.title}</span>
                          <span className="flex items-center gap-1 text-[11px] text-gray-400 shrink-0">
                            {count}/{ids.length}
                            <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? '' : '-rotate-90'}`} />
                          </span>
                        </button>
                      </div>
                      {open && (
                        <div className="max-h-56 overflow-y-auto">
                          {g.chapters.map((c) => (
                            <label key={c.id} className={`flex items-center gap-2.5 px-3 py-1.5 pl-8 text-xs cursor-pointer hover:bg-white/5 ${busy ? 'pointer-events-none opacity-70' : ''}`}>
                              <CheckBox state={selected.has(c.id) ? 'all' : 'none'} onClick={() => toggle([c.id], !selected.has(c.id))} />
                              <span className="truncate text-gray-200">{c.title}</span>
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Job status */}
          {job && (
            <div className={`rounded-xl border p-3 text-xs ${job.status === 'failed' ? 'border-rose-500/40 bg-rose-500/10' : job.status === 'ready' ? 'border-emerald-500/40 bg-emerald-500/10' : 'border-white/10 bg-white/5'}`}>
              {job.status === 'ready' ? (
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-bold text-emerald-300 flex items-center gap-1.5"><Check className="w-4 h-4" /> Tệp đã sẵn sàng</div>
                    <div className="text-gray-300 truncate mt-0.5">{job.file_name} · {formatSize(job.file_size)}</div>
                  </div>
                  <a href={downloadUrl(job.id)} download={job.file_name || undefined} className="shrink-0 px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-snow font-bold transition">
                    Tải lại
                  </a>
                </div>
              ) : job.status === 'failed' ? (
                <div className="flex items-start gap-2 text-rose-300">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{job.error || 'Tạo tệp thất bại.'} Bạn có thể bấm tạo lại.</span>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-gray-300">
                    <span className="flex items-center gap-1.5">
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-brand-400" />
                      {job.status === 'queued' ? 'Đang xếp hàng…' : `Đang tạo tệp${isManga ? ' (truyện tranh có thể mất một lúc)' : ''}…`}
                    </span>
                    <span className="font-bold">{job.progress}%</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                    <div className="h-full bg-brand-500 transition-all duration-500" style={{ width: `${Math.max(job.progress, 3)}%` }} />
                  </div>
                </div>
              )}
            </div>
          )}
          {error && (
            <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-300 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /> {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-white/10 flex items-center justify-between gap-3">
          <p className="text-[11px] text-gray-400 leading-snug">
            {effectiveMode === 'single' && selected.size > 1 ? `${selected.size} tệp ${format.toUpperCase()} trong 1 file .zip` : `1 tệp ${format.toUpperCase()}`}
          </p>
          <button
            type="button"
            onClick={submit}
            disabled={selected.size === 0 || !!busy}
            className="px-5 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-snow text-sm font-bold flex items-center gap-2 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            {job?.status === 'failed' ? 'Thử lại' : 'Tạo tệp & tải'}
          </button>
        </div>
      </div>
    </div>
  );
}

function CheckBox({ state, onClick, disabled }: { state: 'all' | 'some' | 'none'; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={state === 'all' ? true : state === 'some' ? 'mixed' : false}
      disabled={disabled}
      onClick={(e) => {
        e.preventDefault();
        onClick();
      }}
      className={`w-4 h-4 shrink-0 rounded border flex items-center justify-center transition disabled:opacity-50 ${
        state === 'none' ? 'border-white/25 bg-transparent' : 'border-brand-500 bg-brand-600 text-snow'
      }`}
    >
      {state === 'all' && <Check className="w-3 h-3" strokeWidth={3} />}
      {state === 'some' && <Minus className="w-3 h-3" strokeWidth={3} />}
    </button>
  );
}
