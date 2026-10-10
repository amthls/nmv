'use client';

import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  AlertTriangle, ArrowDownAZ, BookOpenCheck, ChevronDown, Download, ArrowLeft, ArrowLeftRight, ArrowRight, CheckCircle2, ClipboardPaste, Eye,
  FileArchive, FolderOpen, Grid3x3, ImagePlus, Loader2, Plus, RotateCcw, Save, Send, Trash2, UploadCloud, X,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import PageLoader from '@/components/common/PageLoader';
import UploadModeSwitch from '@/components/story/UploadModeSwitch';
import { CHOSEN_PARAM, chapterUploadHref } from '@/lib/chapterUpload';
import MangaReader from '@/components/reader/MangaReader';
import {
  CollectResult, RejectedFile, UploadError, UploadedPage, filesFromDataTransfer, filesFromInput, formatBytes,
  groupByFolder, naturalCompare, readImageSize, sizeBatches, uploadPageBatch,
} from '@/lib/mangaUpload';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api/v1';
const BATCH_SIZE = 5; // pages per request: small enough for a smooth progress bar
const SMALL_WIDTH = 700; // narrower pages look blurry on most screens
const SERVER_MAX_WIDTH = 1600; // the server scales wider pages down to this
const STRIP_SPLIT_ABOVE = 5000; // ...and cuts strips taller than this (after scaling) into parts
const SAMPLE_ZIP = '/samples/mau-dang-truyen-tranh.zip';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type PageStatus = 'pending' | 'uploading' | 'done' | 'error';
interface PageItem {
  key: string;
  file: File;
  preview: string;
  width?: number;
  height?: number;
  status: PageStatus;
  progress: number;
  result?: { url: string; width?: number; height?: number; parts?: { url: string; width: number; height: number }[] };
  error?: string;
  /** set when the browser itself cannot decode the file: it is not a usable image */
  invalid?: string;
}
type ChapterStatus = 'editing' | 'uploading' | 'published' | 'draft' | 'error';
interface ChapterDraft {
  key: string;
  number: string;
  title: string;
  volumeId: string;
  pages: PageItem[];
  status: ChapterStatus;
  message?: string;
  link?: string;
}
interface MangaStory { id: string; title: string; slug: string; total_chapters: number; group_id?: string | null }
interface StoryDetail { volumes: { id: string; title: string; volume_number: number; chapters: any[] }[]; unassigned_chapters: any[] }

const uid = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
const fmtNum = (n: number) => String(Math.round(n * 100) / 100);

function MangaUploadContent() {
  const { isAuthenticated, isLoading: authLoading, openAuthModal, authFetch } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  // ?story_id= preselects a story, ?group_id= (from a group page) narrows the list to that group
  const initialStoryId = searchParams?.get('story_id') || '';
  const groupId = searchParams?.get('group_id') || '';
  const modeChosen = searchParams?.get(CHOSEN_PARAM) === '1';

  const [stories, setStories] = useState<MangaStory[]>([]);
  const [storyId, setStoryId] = useState('');
  const [detail, setDetail] = useState<StoryDetail | null>(null);
  const [chapters, setChapters] = useState<ChapterDraft[]>([]);
  const [activeKey, setActiveKey] = useState('');
  const [view, setView] = useState<'grid' | 'preview'>('grid');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'error' | 'info'; text: string } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [rejected, setRejected] = useState<RejectedFile[]>([]);
  const [showGuide, setShowGuide] = useState(false);

  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const zipInput = useRef<HTMLInputElement>(null);
  const chaptersRef = useRef(chapters);
  chaptersRef.current = chapters;

  const story = stories.find((s) => s.id === storyId);
  const active = chapters.find((c) => c.key === activeKey) || chapters[0];

  // ------------------------------------------------------------------ data
  useEffect(() => {
    if (!isAuthenticated) return;
    authFetch(`${API_BASE_URL}/stories/manageable`)
      .then((r) => r.json())
      .then((json) => {
        const all: any[] = json.data || [];
        // A novel is written in the text editor, not uploaded as pages: switch uploader
        const wanted = all.find((s) => s.id === initialStoryId);
        if (wanted && wanted.story_type !== 'manga') {
          router.replace(chapterUploadHref({ storyType: wanted.story_type, storyId: wanted.id, groupId }));
          return;
        }
        const inScope = all.filter((s) => !groupId || s.group_id === groupId);
        const list = inScope.filter((s) => s.story_type === 'manga');
        // Only novels to choose from: the text editor is the right place
        if (!modeChosen && !wanted && list.length === 0 && inScope.length > 0) {
          router.replace(chapterUploadHref({ storyType: 'novel', groupId }));
          return;
        }
        setStories(list);
        if (wanted) setStoryId(wanted.id);
        else if (list.length === 1) setStoryId(list[0].id);
      })
      .catch(() => setNotice({ kind: 'error', text: 'Không tải được danh sách truyện bạn quản lý.' }));
  }, [isAuthenticated]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setDetail(null);
    if (!story) return;
    fetch(`${API_BASE_URL}/stories/${story.slug}`)
      .then((r) => r.json())
      .then((json) => json.success && setDetail(json.data))
      .catch(() => {});
  }, [story?.slug]); // eslint-disable-line react-hooks/exhaustive-deps

  const existingNumbers = useMemo(() => {
    if (!detail) return new Set<number>();
    const all = [...detail.unassigned_chapters, ...detail.volumes.flatMap((v) => v.chapters || [])];
    return new Set(all.map((c) => Number(c.chapter_number)));
  }, [detail]);

  const nextNumber = useCallback(
    (taken: ChapterDraft[]) => {
      const nums = [...Array.from(existingNumbers), ...taken.map((c) => parseFloat(c.number)).filter(Number.isFinite)];
      return nums.length ? Math.floor(Math.max(...nums)) + 1 : 1;
    },
    [existingNumbers],
  );

  // Revoke thumbnails on unmount
  useEffect(() => () => chaptersRef.current.forEach((c) => c.pages.forEach((p) => URL.revokeObjectURL(p.preview))), []);

  // Warn before leaving with unpublished pages
  const unsaved = chapters.some((c) => c.pages.length > 0 && !['published', 'draft'].includes(c.status));
  useEffect(() => {
    if (!unsaved) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [unsaved]);

  // ------------------------------------------------------------------ state helpers
  const patchChapter = (key: string, patch: Partial<ChapterDraft> | ((c: ChapterDraft) => Partial<ChapterDraft>)) =>
    setChapters((list) => list.map((c) => (c.key === key ? { ...c, ...(typeof patch === 'function' ? patch(c) : patch) } : c)));

  const patchPages = (key: string, fn: (pages: PageItem[]) => PageItem[]) =>
    patchChapter(key, (c) => ({ pages: fn(c.pages), status: c.status === 'published' ? c.status : 'editing' }));

  const makePages = (files: File[]): PageItem[] =>
    files.map((file) => {
      const item: PageItem = { key: uid(), file, preview: URL.createObjectURL(file), status: 'pending', progress: 0 };
      return item;
    });

  // Read pixel sizes in the background (for the "small image" warning and layout); a file the
  // browser cannot decode is flagged right away instead of failing later on the server
  const measure = (pages: PageItem[]) => {
    pages.forEach(async (p) => {
      const size = await readImageSize(p.preview);
      const patch: Partial<PageItem> = size
        ? size
        : { invalid: 'Không mở được ảnh: file hỏng hoặc không phải ảnh thật (chỉ đổi đuôi file)' };
      setChapters((list) => list.map((c) => ({
        ...c,
        pages: c.pages.map((x) => (x.key === p.key ? { ...x, ...patch } : x)),
      })));
    });
  };

  const newChapter = (number: number, pages: PageItem[] = [], title = ''): ChapterDraft => ({
    key: uid(), number: fmtNum(number), title, volumeId: '', pages, status: 'editing',
  });

  // ------------------------------------------------------------------ adding files
  const addSources = ({ sources, rejected: skipped }: CollectResult) => {
    if (busy) {
      setNotice({ kind: 'error', text: 'Đang tải lên, hãy đợi xong rồi mới thêm trang.' });
      return;
    }
    setRejected(skipped);
    if (sources.length === 0) {
      setNotice({
        kind: 'error',
        text: skipped.length
          ? `Không có ảnh nào được thêm: ${skipped.length} tệp bị bỏ qua (xem lý do bên dưới).`
          : 'Không tìm thấy ảnh nào (hỗ trợ JPG, PNG, WebP, GIF, AVIF, BMP và file ZIP/CBZ).',
      });
      return;
    }
    setNotice(null);
    const groups = groupByFolder(sources);
    const unnumbered = groups.filter((g) => g.dir && g.number === null).map((g) => g.dir);
    const current = chaptersRef.current;
    const target = current.find((c) => c.key === activeKey) || current[0];

    // One folder (or loose files): append to the open chapter. Several folders: one chapter each.
    if (groups.length === 1 && target && target.status !== 'published') {
      const pages = makePages(groups[0].files);
      patchPages(target.key, (old) => [...old, ...pages]);
      measure(pages);
      return;
    }

    let list = current.filter((c) => c.pages.length > 0 || c.status === 'published');
    const created: ChapterDraft[] = [];
    for (const g of groups) {
      const number = g.number ?? nextNumber([...list, ...created]);
      const pages = makePages(g.files);
      created.push(newChapter(number, pages));
      measure(pages);
    }
    list = [...list, ...created];
    setChapters(list);
    setActiveKey(created[0].key);
    if (groups.length > 1) {
      setNotice({
        kind: unnumbered.length ? 'error' : 'info',
        text: `Đã tách thành ${groups.length} chương theo tên thư mục.` + (unnumbered.length
          ? ` Không đọc được số chương từ tên thư mục: ${unnumbered.map((d) => `“${d}”`).join(', ')}. Đã tự đặt số, hãy kiểm tra lại (nên đặt tên như “Chap 12”).`
          : ' Kiểm tra lại số chương trước khi đăng.'),
      });
    }
  };

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (dragIndex !== null) return; // a page reorder, not a file drop
    try {
      addSources(await filesFromDataTransfer(e.dataTransfer));
    } catch {
      setNotice({ kind: 'error', text: 'Không đọc được file (ZIP có thể bị hỏng hoặc có mật khẩu).' });
    }
  };

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    try {
      addSources(await filesFromInput(e.target.files));
    } catch {
      setNotice({ kind: 'error', text: 'Không đọc được file (ZIP có thể bị hỏng hoặc có mật khẩu).' });
    }
    e.target.value = '';
  };

  // Ctrl+V screenshots / copied images
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && /^(INPUT|TEXTAREA)$/.test(t.tagName)) return;
      const files = Array.from(e.clipboardData?.files || []).filter((f) => f.type.startsWith('image/'));
      if (files.length) addSources({ sources: files.map((f, i) => ({ file: new File([f], f.name || `dan-${Date.now()}-${i}.png`, { type: f.type }), dir: '' })), rejected: [] });
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  });

  // ------------------------------------------------------------------ editing pages
  const movePage = (from: number, to: number) => {
    if (!active || to < 0 || to >= active.pages.length || from === to) return;
    patchPages(active.key, (pages) => {
      const next = [...pages];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
  };

  const removePage = (key: string) => {
    if (!active) return;
    const page = active.pages.find((p) => p.key === key);
    if (page) URL.revokeObjectURL(page.preview);
    patchPages(active.key, (pages) => pages.filter((p) => p.key !== key));
  };

  const removeChapter = (key: string) => {
    const ch = chapters.find((c) => c.key === key);
    ch?.pages.forEach((p) => URL.revokeObjectURL(p.preview));
    const rest = chapters.filter((c) => c.key !== key);
    setChapters(rest);
    if (activeKey === key) setActiveKey(rest[0]?.key || '');
  };

  const addEmptyChapter = () => {
    const ch = newChapter(nextNumber(chapters));
    setChapters([...chapters, ch]);
    setActiveKey(ch.key);
  };

  // Start with one empty chapter once the story's chapter list is known
  useEffect(() => {
    if (storyId && chapters.length === 0 && detail) {
      const ch = newChapter(nextNumber([]));
      setChapters([ch]);
      setActiveKey(ch.key);
    }
  }, [storyId, detail]); // eslint-disable-line react-hooks/exhaustive-deps

  // ------------------------------------------------------------------ publishing
  const chapterProblems = (c: ChapterDraft): string[] => {
    const out: string[] = [];
    const n = parseFloat(c.number);
    if (c.pages.length === 0) out.push('Chưa có trang nào');
    c.pages.forEach((p, i) => {
      if (p.invalid) out.push(`trang ${i + 1} (${p.file.name}): ${p.invalid}. Hãy xóa hoặc thay trang này`);
    });
    if (!Number.isFinite(n) || n < 0) out.push('Số chương không hợp lệ');
    else if (chapters.some((o) => o.key !== c.key && parseFloat(o.number) === n)) out.push(`Trùng số chương ${fmtNum(n)} trong danh sách`);
    return out;
  };

  const uploadChapter = async (key: string, asDraft: boolean): Promise<boolean> => {
    const ch = chaptersRef.current.find((c) => c.key === key);
    if (!ch || !story) return false;
    patchChapter(key, { status: 'uploading', message: undefined });

    // 1) pages that are not on the server yet. Outcomes are kept in a local map because React
    //    state (and chaptersRef) may not have caught up yet when the loop ends.
    const outcome = new Map<string, { result?: PageItem['result']; error?: string }>();
    ch.pages.filter((p) => p.status === 'done').forEach((p) => outcome.set(p.key, { result: p.result }));
    const todo = ch.pages.filter((p) => p.status !== 'done');
    for (const batch of sizeBatches(todo, BATCH_SIZE)) {
      const keys = new Set(batch.map((p) => p.key));
      patchChapter(key, (c) => ({ pages: c.pages.map((p) => (keys.has(p.key) ? { ...p, status: 'uploading', progress: 0, error: undefined } : p)) }));
      let results: UploadedPage[] | null = null;
      let failure = '';
      for (let attempt = 1; attempt <= 4 && !results; attempt++) {
        try {
          results = await uploadPageBatch(API_BASE_URL, story.id, batch.map((p) => p.file), (f) =>
            patchChapter(key, (c) => ({ pages: c.pages.map((p) => (keys.has(p.key) ? { ...p, progress: f } : p)) })),
          );
        } catch (err: any) {
          failure = err.message;
          if (!(err instanceof UploadError && err.transient) || attempt === 4) break;
          const wait = Math.min(60, err.retryAfter || 5 * attempt);
          patchChapter(key, { message: `${err.message}. Tự thử lại sau ${wait} giây (lần ${attempt}/3)...` });
          await sleep(wait * 1000);
        }
      }
      batch.forEach((p, idx) => {
        const r = results?.[idx];
        outcome.set(p.key, r?.url
          ? { result: { url: r.url, width: r.width, height: r.height, parts: r.parts } }
          : { error: r?.error || failure || 'Tải lên thất bại' });
      });
      patchChapter(key, (c) => ({
        message: undefined,
        pages: c.pages.map((p) => {
          if (!keys.has(p.key)) return p;
          const o = outcome.get(p.key)!;
          return o.result ? { ...p, status: 'done', progress: 1, result: o.result, error: undefined } : { ...p, status: 'error', error: o.error };
        }),
      }));
    }

    const failedPages = ch.pages
      .map((p, i) => ({ page: i + 1, name: p.file.name, error: outcome.get(p.key)?.error }))
      .filter((x) => x.error);
    if (failedPages.length > 0) {
      const list = failedPages.slice(0, 6).map((x) => `trang ${x.page} (${x.name}): ${x.error}`).join('; ');
      patchChapter(key, {
        status: 'error',
        message: `${failedPages.length} trang tải lên lỗi: ${list}${failedPages.length > 6 ? '…' : ''}. Sửa hoặc xóa các trang đó rồi bấm "Thử lại".`,
      });
      return false;
    }

    // 2) the chapter itself: one image block per page, in the order shown
    const latest = chaptersRef.current.find((c) => c.key === key) || ch;
    const number = parseFloat(latest.number);
    try {
      const res = await authFetch(`${API_BASE_URL}/chapters/submissions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          story_id: story.id,
          volume_id: latest.volumeId || null,
          chapter_number: number,
          title: latest.title.trim() || `Chương ${fmtNum(number)}`,
          is_draft: asDraft,
          // one image block per page; a long strip cut by the server adds one block per part
          content_blocks: ch.pages
            .flatMap((p) => {
              const r = outcome.get(p.key)!.result!;
              return r.parts?.length ? r.parts : [{ url: r.url, width: r.width, height: r.height }];
            })
            .map((r, i) => ({ id: `p${i + 1}`, type: 'image', image_url: r.url, ...(r.width && r.height ? { width: r.width, height: r.height } : {}) })),
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.message || 'Không đăng được chương');
      const status: ChapterStatus = asDraft ? 'draft' : 'published';
      patchChapter(key, {
        status,
        message: json.message,
        link: status === 'published' ? `/truyen/${story.slug}/${json.data.slug}` : undefined,
      });
      return true;
    } catch (err: any) {
      patchChapter(key, { status: 'error', message: err.message });
      return false;
    }
  };

  const publish = async (keys: string[], asDraft: boolean) => {
    const problems = keys.flatMap((k) => {
      const c = chapters.find((x) => x.key === k)!;
      return chapterProblems(c).map((p) => `Chương ${c.number}: ${p}`);
    });
    if (problems.length) {
      setNotice({ kind: 'error', text: problems.join(' · ') });
      return;
    }
    const overwrite = keys
      .map((k) => chapters.find((x) => x.key === k)!)
      .filter((c) => existingNumbers.has(parseFloat(c.number)));
    if (overwrite.length && !window.confirm(`Chương ${overwrite.map((c) => c.number).join(', ')} đã có trên truyện. Đăng tiếp sẽ THAY THẾ nội dung chương cũ. Tiếp tục?`)) return;

    setBusy(true);
    setNotice(null);
    let okCount = 0;
    for (const k of keys) if (await uploadChapter(k, asDraft)) okCount += 1;
    setBusy(false);
    if (okCount === keys.length) setNotice({ kind: 'info', text: asDraft ? `Đã lưu nháp ${okCount} chương.` : `Đã gửi ${okCount} chương.` });
  };

  // ------------------------------------------------------------------ render
  if (authLoading) return <div className="max-w-6xl mx-auto px-4 py-20 text-center text-gray-400">Đang tải...</div>;
  if (!isAuthenticated) {
    return (
      <div className="max-w-xl mx-auto px-4 py-24 text-center space-y-4">
        <h1 className="text-2xl font-bold text-white">Đăng chương mới</h1>
        <p className="text-sm text-gray-400">Bạn cần đăng nhập để đăng truyện.</p>
        <button onClick={() => openAuthModal('login')} className="px-5 py-2.5 rounded-lg bg-brand-600 hover:bg-brand-500 text-snow text-sm font-semibold">Đăng nhập</button>
      </div>
    );
  }

  const pages = active?.pages || [];
  const totalSize = pages.reduce((s, p) => s + p.file.size, 0);
  const smallPages = pages.filter((p) => p.width && p.width < SMALL_WIDTH).length;
  const tallPages = pages.filter((p) => p.width && p.height && p.height * (Math.min(p.width, SERVER_MAX_WIDTH) / p.width) > STRIP_SPLIT_ABOVE).length;
  const dupNames = pages.length - new Set(pages.map((p) => `${p.file.name}|${p.file.size}`)).size;
  const editable = active && !['uploading', 'published'].includes(active.status) && !busy;
  const uploadedCount = pages.filter((p) => p.status === 'done').length;
  const readyKeys = chapters.filter((c) => c.pages.length > 0 && !['published', 'draft'].includes(c.status)).map((c) => c.key);

  return (
    <div
      className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-8 pb-32"
      onDragOver={(e) => { if (dragIndex === null && storyId) { e.preventDefault(); setDragOver(true); } }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDragOver(false); }}
      onDrop={storyId ? onDrop : undefined}
    >
      <input ref={fileInput} type="file" accept="image/*,.zip,.cbz" multiple hidden onChange={onPick} />
      <input ref={folderInput} type="file" multiple hidden onChange={onPick} {...({ webkitdirectory: '', directory: '' } as any)} />
      <input ref={zipInput} type="file" accept=".zip,.cbz,application/zip" multiple hidden onChange={onPick} />

      {dragOver && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-brand-600/15 backdrop-blur-sm border-4 border-dashed border-brand-500 pointer-events-none">
          <div className="text-center text-brand-500">
            <UploadCloud className="w-14 h-14 mx-auto" />
            <p className="mt-2 text-lg font-bold">Thả ảnh, thư mục hoặc file ZIP/CBZ vào đây</p>
            <p className="text-sm">Nhiều thư mục sẽ được tách thành nhiều chương</p>
          </div>
        </div>
      )}

      <div className="mb-6 max-w-2xl">
        <UploadModeSwitch mode="manga" groupId={groupId} />
      </div>

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">Đăng chương mới</h1>
          <p className="mt-1 text-sm text-gray-400">Kéo thả cả chương (ảnh, thư mục, ZIP/CBZ). Trang tự xếp theo tên file, ảnh được nén và thu nhỏ trên máy chủ.</p>
        </div>
        <Link href="/dang-truyen" className="text-xs font-semibold text-brand-500 hover:underline">+ Tạo bộ truyện tranh mới</Link>
      </div>

      {/* Story */}
      <div className="mt-6 glass-panel rounded-xl p-4 flex flex-wrap items-center gap-3">
        <label className="text-xs font-semibold text-gray-300">Bộ truyện</label>
        <select
          value={storyId}
          onChange={(e) => {
            if (unsaved && !window.confirm('Đổi truyện sẽ bỏ các trang chưa đăng. Tiếp tục?')) return;
            chapters.forEach((c) => c.pages.forEach((p) => URL.revokeObjectURL(p.preview)));
            setChapters([]);
            setStoryId(e.target.value);
          }}
          className="flex-1 min-w-[220px] h-10 px-3 rounded-lg bg-surface-3 border border-white/10 text-sm text-white focus:outline-none focus:border-brand-500"
        >
          <option value="">— Chọn truyện tranh bạn quản lý —</option>
          {stories.map((s) => (
            <option key={s.id} value={s.id}>{s.title} ({s.total_chapters || 0} chương)</option>
          ))}
        </select>
        {stories.length === 0 && <span className="text-xs text-gray-400">{groupId ? 'Nhóm dịch này chưa có truyện tranh nào bạn quản lý.' : 'Bạn chưa quản lý truyện tranh nào.'}</span>}
        {story && detail && (
          <span className="text-xs text-gray-400">
            Đã có {existingNumbers.size} chương{existingNumbers.size ? `, mới nhất: ${fmtNum(Math.max(...Array.from(existingNumbers)))}` : ''}
          </span>
        )}
      </div>

      {notice && (
        <div className={`mt-4 flex items-start gap-2 rounded-lg px-3 py-2.5 text-sm ${notice.kind === 'error' ? 'bg-rose-500/10 text-rose-400' : 'bg-brand-500/10 text-brand-500'}`}>
          {notice.kind === 'error' ? <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /> : <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />}
          <span className="flex-1">{notice.text}</span>
          <button onClick={() => setNotice(null)} aria-label="Đóng"><X className="w-4 h-4" /></button>
        </div>
      )}

      {rejected.length > 0 && (
        <div className="mt-3 rounded-lg bg-amber-500/10 px-3 py-2.5 text-sm">
          <div className="flex items-center gap-2 font-semibold text-amber-600 dark:text-amber-400">
            <AlertTriangle className="w-4 h-4" /> {rejected.length} tệp không được thêm
            <button onClick={() => setRejected([])} className="ml-auto" aria-label="Đóng"><X className="w-4 h-4" /></button>
          </div>
          <ul className="mt-1.5 max-h-48 overflow-y-auto space-y-1 text-xs">
            {rejected.map((r, i) => (
              <li key={i} className="flex gap-2">
                <span className="font-mono text-white break-all">{r.name}</span>
                <span className="text-gray-400">— {r.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Upload rules + sample archive */}
      <div className="mt-4 glass-panel rounded-xl">
        <button onClick={() => setShowGuide(!showGuide)} className="w-full flex items-center gap-2 px-4 py-3 text-sm font-semibold text-white">
          <BookOpenCheck className="w-4 h-4 text-brand-500" /> Hướng dẫn định dạng file & tải file mẫu
          <ChevronDown className={`ml-auto w-4 h-4 transition-transform ${showGuide ? 'rotate-180' : ''}`} />
        </button>
        {showGuide && (
          <div className="px-4 pb-4 grid md:grid-cols-2 gap-5 text-xs text-gray-300 leading-relaxed">
            <div className="space-y-2">
              <p className="font-semibold text-white">Mỗi trang là một ảnh</p>
              <ul className="list-disc pl-4 space-y-1">
                <li>Nhận: <b>JPG, PNG, WebP, GIF, AVIF, BMP</b>. Không nhận PDF, PSD, HEIC: hãy xuất từng trang ra JPG/PNG.</li>
                <li>Tối đa <b>25 MB</b> mỗi ảnh. Nên rộng <b>800–1600px</b>; ảnh hẹp dưới 700px sẽ bị mờ.</li>
                <li>Truyện cuộn dọc (webtoon) cắt thành nhiều ảnh, mỗi ảnh cao không quá ~15.000px.</li>
                <li>Đặt tên có số thứ tự để trang tự xếp đúng: <code className="text-brand-500">001.jpg, 002.jpg, …</code> (“2” đứng trước “10”).</li>
              </ul>
              <p className="font-semibold text-white pt-1">Đăng nhiều chương một lần</p>
              <p>Mỗi chương một thư mục (hoặc một file ZIP/CBZ), tên có số chương:</p>
              <pre className="rounded-md bg-black/40 p-2.5 font-mono text-[11px] text-gray-200 whitespace-pre">{`Ten-truyen/
├─ Chap 1/
│   ├─ 001.jpg
│   └─ 002.jpg
├─ Chap 2/
│   └─ 001.jpg
└─ Chuong 3.5.zip`}</pre>
              <p>Tên được hiểu: “Chap 12”, “Chapter 12”, “Chương 12”, “Ch.12”, “c012”, “12.5”.</p>
            </div>
            <div className="space-y-2">
              <p className="font-semibold text-white">Lỗi thường gặp</p>
              <ul className="list-disc pl-4 space-y-1">
                <li><b>“Không giải nén được”</b>: file RAR/7z hoặc ZIP có mật khẩu. Nén lại bằng ZIP thường.</li>
                <li><b>“Không đọc được số chương”</b>: tên thư mục không có số. Đổi tên thành “Chap N”.</li>
                <li><b>“Trùng số chương”</b>: hai thư mục cùng số. Sửa số ở ô “Số chương”.</li>
                <li><b>Trang lỗi khi tải lên</b>: ảnh hỏng hoặc không phải ảnh thật. Xóa trang đó, thêm lại rồi bấm “Thử lại”.</li>
                <li>Mạng chập chờn hoặc tải quá nhanh: trang tự thử lại, không cần làm gì.</li>
              </ul>
              <a href={SAMPLE_ZIP} download className="inline-flex items-center gap-2 mt-2 px-3 py-2 rounded-lg bg-brand-600 hover:bg-brand-500 text-snow font-semibold">
                <Download className="w-4 h-4" /> Tải file mẫu (2 chương, ZIP)
              </a>
              <p className="text-gray-500">Kéo thả nguyên file mẫu vào trang này để xem nó được tách thành 2 chương như thế nào.</p>
            </div>
          </div>
        )}
      </div>

      {storyId && active && (
        <div className="mt-6 grid lg:grid-cols-[240px_1fr] gap-6">
          {/* Chapter queue */}
          <aside className="space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-bold uppercase tracking-wider text-gray-400">Chương sẽ đăng</h2>
              <button onClick={addEmptyChapter} disabled={busy} className="text-xs font-semibold text-brand-500 hover:underline disabled:opacity-40 flex items-center gap-1">
                <Plus className="w-3.5 h-3.5" /> Thêm
              </button>
            </div>
            {chapters.map((c) => {
              const done = c.pages.filter((p) => p.status === 'done').length;
              return (
                <button
                  key={c.key}
                  onClick={() => setActiveKey(c.key)}
                  className={`w-full text-left rounded-lg px-3 py-2.5 transition ${c.key === active.key ? 'bg-brand-500/15 ring-1 ring-brand-500/50' : 'bg-white/5 hover:bg-white/10'}`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-white">Chương {c.number || '?'}</span>
                    {existingNumbers.has(parseFloat(c.number)) && c.status === 'editing' && (
                      <span title="Số chương này đã có trên truyện"><AlertTriangle className="w-3.5 h-3.5 text-amber-500" /></span>
                    )}
                    <span className="ml-auto text-[11px] text-gray-400">{c.pages.length} trang</span>
                  </div>
                  <div className="mt-1 text-[11px]">
                    {c.status === 'uploading' && <span className="text-brand-500 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Đang tải {done}/{c.pages.length}</span>}
                    {c.status === 'published' && <span className="text-emerald-500">Đã đăng</span>}
                    {c.status === 'draft' && <span className="text-gray-400">Đã lưu nháp</span>}
                    {c.status === 'error' && <span className="text-rose-500">Có lỗi</span>}
                    {c.status === 'editing' && <span className="text-gray-500">{c.title || 'Chưa đăng'}</span>}
                  </div>
                </button>
              );
            })}
            <p className="pt-2 text-[11px] leading-relaxed text-gray-500">
              Mẹo: kéo thả một thư mục chứa nhiều thư mục con (“Chap 1”, “Chap 2”…) hoặc nhiều file ZIP để tạo nhiều chương cùng lúc.
            </p>
          </aside>

          {/* Active chapter */}
          <section className="min-w-0 space-y-4">
            <div className="glass-panel rounded-xl p-4 grid sm:grid-cols-[120px_1fr_200px] gap-3">
              <label className="space-y-1">
                <span className="text-[11px] font-semibold text-gray-400">Số chương</span>
                <input
                  value={active.number}
                  disabled={!editable}
                  onChange={(e) => patchChapter(active.key, { number: e.target.value.replace(',', '.') })}
                  inputMode="decimal"
                  className="w-full h-10 px-3 rounded-lg bg-surface-3 border border-white/10 text-sm font-bold text-white focus:outline-none focus:border-brand-500 disabled:opacity-60"
                />
              </label>
              <label className="space-y-1">
                <span className="text-[11px] font-semibold text-gray-400">Tên chương (không bắt buộc)</span>
                <input
                  value={active.title}
                  disabled={!editable}
                  onChange={(e) => patchChapter(active.key, { title: e.target.value })}
                  placeholder={`Chương ${active.number || '?'}`}
                  maxLength={500}
                  className="w-full h-10 px-3 rounded-lg bg-surface-3 border border-white/10 text-sm text-white focus:outline-none focus:border-brand-500 disabled:opacity-60"
                />
              </label>
              <label className="space-y-1">
                <span className="text-[11px] font-semibold text-gray-400">Tập</span>
                <select
                  value={active.volumeId}
                  disabled={!editable}
                  onChange={(e) => patchChapter(active.key, { volumeId: e.target.value })}
                  className="w-full h-10 px-3 rounded-lg bg-surface-3 border border-white/10 text-sm text-white focus:outline-none focus:border-brand-500 disabled:opacity-60"
                >
                  <option value="">Chưa phân tập</option>
                  {detail?.volumes.map((v) => <option key={v.id} value={v.id}>{v.title}</option>)}
                </select>
              </label>
              {existingNumbers.has(parseFloat(active.number)) && active.status === 'editing' && (
                <p className="sm:col-span-3 text-xs text-amber-500 flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5" /> Chương {active.number} đã có trên truyện, đăng sẽ thay thế chương cũ.
                </p>
              )}
            </div>

            {/* Add pages */}
            {editable && (
              <div
                className={`rounded-xl border-2 border-dashed border-white/15 hover:border-brand-500/60 transition text-center ${pages.length ? 'p-4' : 'p-10'}`}
              >
                {!pages.length && (
                  <>
                    <ImagePlus className="w-10 h-10 mx-auto text-brand-500" />
                    <p className="mt-2 text-sm font-semibold text-white">Kéo thả trang truyện vào đây</p>
                    <p className="text-xs text-gray-400">Ảnh lẻ, cả thư mục, hoặc file ZIP/CBZ. Có thể dán ảnh bằng Ctrl+V.</p>
                  </>
                )}
                <div className={`flex flex-wrap justify-center gap-2 ${pages.length ? '' : 'mt-4'}`}>
                  <button onClick={() => fileInput.current?.click()} className="px-3 py-2 rounded-lg bg-brand-600 hover:bg-brand-500 text-snow text-xs font-semibold flex items-center gap-1.5">
                    <ImagePlus className="w-4 h-4" /> Chọn ảnh
                  </button>
                  <button onClick={() => folderInput.current?.click()} className="px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-white text-xs font-semibold flex items-center gap-1.5">
                    <FolderOpen className="w-4 h-4" /> Chọn thư mục
                  </button>
                  <button onClick={() => zipInput.current?.click()} className="px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-white text-xs font-semibold flex items-center gap-1.5">
                    <FileArchive className="w-4 h-4" /> File ZIP / CBZ
                  </button>
                  <span className="px-3 py-2 text-xs text-gray-400 flex items-center gap-1.5"><ClipboardPaste className="w-4 h-4" /> Ctrl+V để dán</span>
                </div>
              </div>
            )}

            {pages.length > 0 && (
              <>
                {/* Toolbar */}
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="font-semibold text-white">{pages.length} trang</span>
                  <span className="text-gray-400">· {formatBytes(totalSize)}</span>
                  {active.status !== 'editing' && <span className="text-gray-400">· đã tải {uploadedCount}/{pages.length}</span>}
                  <div className="ml-auto flex flex-wrap gap-1.5">
                    {editable && (
                      <>
                        <button onClick={() => patchPages(active.key, (p) => [...p].sort((a, b) => naturalCompare(a.file.name, b.file.name)))} className="px-2.5 py-1.5 rounded-md bg-white/5 hover:bg-white/10 text-gray-300 flex items-center gap-1">
                          <ArrowDownAZ className="w-3.5 h-3.5" /> Xếp theo tên
                        </button>
                        <button onClick={() => patchPages(active.key, (p) => [...p].reverse())} className="px-2.5 py-1.5 rounded-md bg-white/5 hover:bg-white/10 text-gray-300 flex items-center gap-1">
                          <ArrowLeftRight className="w-3.5 h-3.5" /> Đảo thứ tự
                        </button>
                      </>
                    )}
                    <button onClick={() => setView(view === 'grid' ? 'preview' : 'grid')} className="px-2.5 py-1.5 rounded-md bg-white/5 hover:bg-white/10 text-gray-300 flex items-center gap-1">
                      {view === 'grid' ? <><Eye className="w-3.5 h-3.5" /> Xem như người đọc</> : <><Grid3x3 className="w-3.5 h-3.5" /> Lưới sắp xếp</>}
                    </button>
                    {editable && (
                      <button onClick={() => removeChapter(active.key)} className="px-2.5 py-1.5 rounded-md bg-rose-500/10 hover:bg-rose-500/20 text-rose-500 flex items-center gap-1">
                        <Trash2 className="w-3.5 h-3.5" /> Bỏ chương này
                      </button>
                    )}
                  </div>
                </div>

                {tallPages > 0 && (
                  <p className="text-xs text-sky-500">
                    {tallPages} trang là dải dài (webtoon): máy chủ sẽ tự cắt thành các đoạn cao tối đa 4000px để máy yếu đọc mượt. Trong chế độ cuộn dọc các đoạn nối liền, không lộ vết cắt.
                  </p>
                )}
                {(smallPages > 0 || dupNames > 0) && (
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-amber-500">
                    {smallPages > 0 && <span className="flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" /> {smallPages} trang rộng dưới {SMALL_WIDTH}px, có thể bị mờ</span>}
                    {dupNames > 0 && <span className="flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" /> {dupNames} trang có vẻ bị trùng</span>}
                  </div>
                )}

                {active.message && (
                  <div className={`rounded-lg px-3 py-2 text-sm flex flex-wrap items-center gap-2 ${active.status === 'error' ? 'bg-rose-500/10 text-rose-500' : 'bg-emerald-500/10 text-emerald-500'}`}>
                    <span>{active.message}</span>
                    {active.link && <Link href={active.link} className="font-semibold underline">Xem chương →</Link>}
                    {active.status === 'error' && (
                      <button onClick={() => publish([active.key], false)} disabled={busy} className="ml-auto px-2.5 py-1 rounded-md bg-rose-500 text-snow text-xs font-semibold flex items-center gap-1">
                        <RotateCcw className="w-3.5 h-3.5" /> Thử lại
                      </button>
                    )}
                  </div>
                )}

                {view === 'grid' ? (
                  <ol className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 xl:grid-cols-6 gap-3">
                    {pages.map((p, i) => (
                      <li
                        key={p.key}
                        draggable={!!editable}
                        onDragStart={() => setDragIndex(i)}
                        onDragEnd={() => setDragIndex(null)}
                        onDragOver={(e) => { if (dragIndex !== null) { e.preventDefault(); e.stopPropagation(); } }}
                        onDrop={(e) => { if (dragIndex !== null) { e.preventDefault(); e.stopPropagation(); movePage(dragIndex, i); setDragIndex(null); } }}
                        className={`group relative ${editable ? 'cursor-grab active:cursor-grabbing' : ''} ${dragIndex === i ? 'opacity-40' : ''}`}
                      >
                        <div className={`relative aspect-[2/3] overflow-hidden rounded-[4px] bg-surface-3 ring-1 ${p.status === 'error' || p.invalid ? 'ring-rose-500 ring-2' : 'ring-white/5'}`}>
                          <img src={p.preview} alt={p.file.name} className="w-full h-full object-cover" draggable={false} />
                          <span className="absolute top-1 left-1 min-w-[22px] px-1.5 py-0.5 rounded-[3px] bg-black/70 text-snow text-[10px] font-bold text-center">{i + 1}</span>
                          {p.status === 'uploading' && (
                            <div className="absolute inset-0 bg-black/40 grid place-items-center">
                              <Loader2 className="w-6 h-6 text-snow animate-spin" />
                              <div className="absolute bottom-0 inset-x-0 h-1 bg-snow/20"><div className="h-full bg-brand-500 transition-all" style={{ width: `${Math.round(p.progress * 100)}%` }} /></div>
                            </div>
                          )}
                          {p.status === 'done' && <CheckCircle2 className="absolute top-1 right-1 w-5 h-5 text-emerald-400 drop-shadow" />}
                          {p.status === 'error' && <span title={p.error}><AlertTriangle className="absolute top-1 right-1 w-5 h-5 text-rose-500 drop-shadow" /></span>}
                          {editable && (
                            <div className="absolute inset-x-0 bottom-0 flex justify-between p-1 opacity-0 group-hover:opacity-100 transition bg-gradient-to-t from-black/70 to-transparent">
                              <button onClick={() => movePage(i, i - 1)} disabled={i === 0} aria-label="Lên trước" className="w-7 h-7 grid place-items-center rounded bg-black/60 text-snow disabled:opacity-30"><ArrowLeft className="w-3.5 h-3.5" /></button>
                              <button onClick={() => removePage(p.key)} aria-label="Xóa trang" className="w-7 h-7 grid place-items-center rounded bg-rose-600 text-snow"><Trash2 className="w-3.5 h-3.5" /></button>
                              <button onClick={() => movePage(i, i + 1)} disabled={i === pages.length - 1} aria-label="Ra sau" className="w-7 h-7 grid place-items-center rounded bg-black/60 text-snow disabled:opacity-30"><ArrowRight className="w-3.5 h-3.5" /></button>
                            </div>
                          )}
                        </div>
                        <p className="mt-1 text-[10px] text-gray-400 truncate" title={p.file.name}>{p.file.name}</p>
                        {(p.invalid || p.error) && <p className="text-[10px] leading-snug text-rose-500">{p.invalid || p.error}</p>}
                        <p className={`text-[10px] ${p.width && p.width < SMALL_WIDTH ? 'text-amber-500' : 'text-gray-500'}`}>
                          {p.width ? `${p.width}×${p.height}` : '…'} · {formatBytes(p.file.size)}
                        </p>
                      </li>
                    ))}
                  </ol>
                ) : (
                  // exactly the reader people will use, with the same layout / fit options
                  <div className="rounded-[4px] bg-black/40 py-2">
                    <MangaReader
                      local
                      pages={pages.map((p, i) => ({ page_number: i + 1, image_url: p.preview, width: p.width, height: p.height }))}
                    />
                  </div>
                )}
              </>
            )}
          </section>
        </div>
      )}

      {/* Sticky publish bar */}
      {storyId && chapters.some((c) => c.pages.length > 0) && (
        <div className="fixed bottom-0 inset-x-0 z-40 glass-strong !rounded-none !border-x-0 !border-b-0">
          <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-3 flex flex-wrap items-center gap-3">
            <div className="text-xs text-gray-400">
              {readyKeys.length > 0 ? `${readyKeys.length} chương sẵn sàng · ${chapters.reduce((s, c) => s + c.pages.length, 0)} trang` : 'Không còn chương nào chờ đăng'}
            </div>
            {busy && (
              <div className="flex-1 min-w-[160px] h-1.5 rounded-full bg-white/10 overflow-hidden">
                <div
                  className="h-full bg-brand-500 transition-all"
                  style={{
                    width: `${Math.round(
                      (chapters.reduce((s, c) => s + c.pages.filter((p) => p.status === 'done').length, 0) /
                        Math.max(1, chapters.reduce((s, c) => s + c.pages.length, 0))) * 100,
                    )}%`,
                  }}
                />
              </div>
            )}
            <div className="ml-auto flex gap-2">
              <button
                onClick={() => active && publish([active.key], true)}
                disabled={busy || !active || !readyKeys.includes(active.key)}
                className="px-4 py-2.5 rounded-lg bg-white/5 hover:bg-white/10 text-white text-xs font-semibold flex items-center gap-1.5 disabled:opacity-40"
              >
                <Save className="w-4 h-4" /> Lưu nháp chương này
              </button>
              <button
                onClick={() => publish(readyKeys, false)}
                disabled={busy || readyKeys.length === 0}
                className="px-5 py-2.5 rounded-lg bg-brand-600 hover:bg-brand-500 text-snow text-xs font-bold flex items-center gap-1.5 disabled:opacity-40"
              >
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                {readyKeys.length > 1 ? `Đăng ${readyKeys.length} chương` : 'Đăng chương'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function MangaUploadPage() {
  return (
    <Suspense fallback={<PageLoader label="Đang tải trình đăng chương..." />}>
      <MangaUploadContent />
    </Suspense>
  );
}
