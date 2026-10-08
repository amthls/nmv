'use client';

import React, { useState, useEffect, useMemo, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  MessageSquare,
  Send,
  Save,
  Eye,
  Pencil,
  Check,
  ArrowLeft,
  Plus,
  X,
  Lock,
  LogIn
} from 'lucide-react';
import SmartImage from '@/components/common/SmartImage';
import ImageUploadDropzone from '@/components/common/ImageUploadDropzone';
import { useAuth } from '@/context/AuthContext';
import PageLoader from '@/components/common/PageLoader';
import UploadModeSwitch from '@/components/story/UploadModeSwitch';
import { CHOSEN_PARAM, chapterUploadHref } from '@/lib/chapterUpload';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api/v1';

interface Annotation {
  note?: string;
  image_url?: string;
}

function ChapterEditorContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialStoryId = searchParams?.get('story_id') || '';
  // ?group_id=<id> (from a group page) narrows the story list to that group
  const groupId = searchParams?.get('group_id') || '';
  const modeChosen = searchParams?.get(CHOSEN_PARAM) === '1';
  // ?edit=<chapterId> switches the editor to "edit a published chapter" mode
  const editId = searchParams?.get('edit') || '';
  const isEditMode = Boolean(editId);

  const { user, isAuthenticated, isLoading: isAuthLoading, openAuthModal, authFetch } = useAuth();

  const [stories, setStories] = useState<any[]>([]);
  const [isLoadingStories, setIsLoadingStories] = useState(true);
  const [selectedStoryId, setSelectedStoryId] = useState(initialStoryId);
  const [selectedStory, setSelectedStory] = useState<any>(null);

  const [volumes, setVolumes] = useState<any[]>([]);
  const [selectedVolumeId, setSelectedVolumeId] = useState('');
  const [newVolumeTitle, setNewVolumeTitle] = useState('');
  const [isCreatingNewVolume, setIsCreatingNewVolume] = useState(false);

  const [chapterNumber, setChapterNumber] = useState<number | string>(1);
  const [chapterTitle, setChapterTitle] = useState('');

  // Plain-text chapter body. Paragraphs are separated by a blank line, the
  // same way every writer already formats text in a word processor — no
  // custom "block" UI to learn.
  const [bodyText, setBodyText] = useState('');
  // Translator notes / inline illustrations are an optional, secondary
  // feature attached to a specific paragraph by number, not a mandatory
  // control shown on every single line.
  const [annotations, setAnnotations] = useState<Record<number, Annotation>>({});
  const [activeAnnotationIndices, setActiveAnnotationIndices] = useState<number[]>([]);
  const [showAnnotations, setShowAnnotations] = useState(false);
  const [annotationTargetIdx, setAnnotationTargetIdx] = useState<number | ''>('');

  const [activeTab, setActiveTab] = useState<'editor' | 'preview'>('editor');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [editLoadState, setEditLoadState] = useState<'idle' | 'loading' | 'ready' | 'error'>(isEditMode ? 'loading' : 'idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  // Editing a manga chapter: its pages are images, so only title / number / volume are editable here
  const [mangaPages, setMangaPages] = useState<string[] | null>(null);
  const isMangaEdit = isEditMode && mangaPages !== null;

  const paragraphs = useMemo(
    () => bodyText.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean),
    [bodyText]
  );

  const totalWords = useMemo(
    () => bodyText.split(/\s+/).filter(Boolean).length,
    [bodyText]
  );
  const readingTimeMin = Math.max(1, Math.ceil(totalWords / 220));

  const annotationEntries = [...activeAnnotationIndices].sort((a, b) => a - b);

  const setAnnotation = (idx: number, patch: Partial<Annotation>) => {
    setAnnotations((prev) => ({ ...prev, [idx]: { ...prev[idx], ...patch } }));
  };

  const addAnnotationTarget = (idx: number) => {
    setActiveAnnotationIndices((prev) => (prev.includes(idx) ? prev : [...prev, idx]));
    setAnnotations((prev) => (prev[idx] ? prev : { ...prev, [idx]: {} }));
  };

  const removeAnnotation = (idx: number) => {
    setActiveAnnotationIndices((prev) => prev.filter((i) => i !== idx));
    setAnnotations((prev) => {
      const next = { ...prev };
      delete next[idx];
      return next;
    });
  };

  // Local autosave: protects against losing a half-written chapter to an
  // accidental tab close / refresh / crash before it's submitted.
  const [restorableDraft, setRestorableDraft] = useState<any>(null);
  const dismissedDraftStoryRef = React.useRef<string | null>(null);

  const draftStorageKey = (storyId: string) => `novelhub_chapter_draft_${storyId}`;

  const clearDraftFromStorage = (storyId?: string) => {
    const id = storyId || selectedStoryId;
    if (!id) return;
    try { window.localStorage.removeItem(draftStorageKey(id)); } catch (e) {}
  };

  useEffect(() => {
    if (!selectedStoryId || isEditMode || dismissedDraftStoryRef.current === selectedStoryId) {
      setRestorableDraft(null);
      return;
    }
    try {
      const raw = window.localStorage.getItem(draftStorageKey(selectedStoryId));
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && (parsed.chapterTitle?.trim() || parsed.bodyText?.trim())) {
          setRestorableDraft(parsed);
          return;
        }
      }
    } catch (e) {}
    setRestorableDraft(null);
  }, [selectedStoryId]);

  useEffect(() => {
    if (!selectedStoryId || isEditMode) return;
    const hasContent = chapterTitle.trim() || bodyText.trim();
    if (!hasContent) return;

    const timer = setTimeout(() => {
      try {
        window.localStorage.setItem(draftStorageKey(selectedStoryId), JSON.stringify({
          chapterTitle,
          chapterNumber,
          selectedVolumeId,
          bodyText,
          annotations,
          activeAnnotationIndices,
          savedAt: new Date().toISOString(),
        }));
      } catch (e) {}
    }, 1500);

    return () => clearTimeout(timer);
  }, [selectedStoryId, chapterTitle, chapterNumber, selectedVolumeId, bodyText, annotations, activeAnnotationIndices]);

  const restoreDraft = () => {
    if (!restorableDraft) return;
    setChapterTitle(restorableDraft.chapterTitle || '');
    if (restorableDraft.chapterNumber !== undefined) setChapterNumber(restorableDraft.chapterNumber);
    if (restorableDraft.selectedVolumeId !== undefined) setSelectedVolumeId(restorableDraft.selectedVolumeId);
    setBodyText(restorableDraft.bodyText || '');
    setAnnotations(restorableDraft.annotations || {});
    setActiveAnnotationIndices(restorableDraft.activeAnnotationIndices || []);
    setRestorableDraft(null);
  };

  const dismissDraft = () => {
    dismissedDraftStoryRef.current = selectedStoryId;
    clearDraftFromStorage(selectedStoryId);
    setRestorableDraft(null);
  };

  // Warn before an accidental tab close / navigation away from unsaved work.
  useEffect(() => {
    const hasContent = chapterTitle.trim() || bodyText.trim();
    if (!hasContent) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [chapterTitle, bodyText]);

  // Load stories the current user is actually allowed to manage
  // (uploader, translation-group member, or added collaborator) — resolved
  // server-side so group members see every story their group owns, not just
  // the ones they personally uploaded.
  useEffect(() => {
    if (!isAuthenticated) {
      setIsLoadingStories(false);
      return;
    }
    async function fetchManageableStories() {
      setIsLoadingStories(true);
      try {
        const res = await authFetch(`${API_BASE_URL}/stories/manageable`);
        if (res.ok) {
          const json = await res.json();
          if (json.success) setStories(json.data || []);
        }
      } catch (e) {
      } finally {
        setIsLoadingStories(false);
      }
    }
    fetchManageableStories();
  }, [isAuthenticated]);

  const shownStories = useMemo(
    () => (groupId ? stories.filter((s) => s.group_id === groupId) : stories),
    [stories, groupId]
  );
  const novelStories = shownStories.filter((s) => s.story_type !== 'manga');
  const mangaStories = shownStories.filter((s) => s.story_type === 'manga');

  // A manga is uploaded as page images, not written here: hand it to the manga uploader
  const openMangaUploader = (storyId: string, replace = false) => {
    const href = chapterUploadHref({ storyType: 'manga', storyId, groupId });
    if (replace) router.replace(href);
    else router.push(href);
  };

  const pickStory = (storyId: string) => {
    const story = stories.find((s) => s.id === storyId);
    if (story?.story_type === 'manga') {
      if ((chapterTitle.trim() || bodyText.trim()) && !window.confirm('Đây là truyện tranh, sẽ chuyển sang trình đăng truyện tranh và bỏ nội dung đang soạn. Tiếp tục?')) return;
      openMangaUploader(storyId);
      return;
    }
    setSelectedStoryId(storyId);
  };

  // Pick the uploader automatically: a ?story_id= of a manga (old links, bookmarks), or only manga to choose from
  useEffect(() => {
    if (isEditMode || isLoadingStories) return;
    if (initialStoryId) {
      const story = stories.find((s) => s.id === initialStoryId);
      if (story?.story_type === 'manga') openMangaUploader(initialStoryId, true);
      return;
    }
    if (!modeChosen && novelStories.length === 0 && mangaStories.length > 0) {
      router.replace(chapterUploadHref({ storyType: 'manga', groupId }));
    }
  }, [stories, isLoadingStories]); // eslint-disable-line react-hooks/exhaustive-deps

  // When story changes, load story detail (volumes & latest chapter number)
  useEffect(() => {
    if (!selectedStoryId || isEditMode) return;

    async function fetchStoryDetail() {
      try {
        const found = stories.find(s => s.id === selectedStoryId);
        if (found && found.story_type !== 'manga') {
          const res = await fetch(`${API_BASE_URL}/stories/${found.slug}`);
          if (res.ok) {
            const json = await res.json();
            if (json.success) {
              setSelectedStory(json.data);
              setVolumes(json.data.volumes || []);
              setSelectedVolumeId('');
              // Next number after the highest published chapter (the count is wrong when numbers have gaps)
              const latest = Number(json.data.latest_chapter?.chapter_number);
              setChapterNumber(Number.isFinite(latest) ? Math.floor(latest) + 1 : 1);
            }
          }
        }
      } catch (e) {}
    }
    fetchStoryDetail();
  }, [selectedStoryId, stories]);

  // Edit mode: load the published chapter (and its story's volumes) into the form
  useEffect(() => {
    if (!isEditMode || !isAuthenticated) return;
    let cancelled = false;
    async function loadChapter() {
      setEditLoadState('loading');
      try {
        const res = await authFetch(`${API_BASE_URL}/chapters/${editId}`);
        const json = await res.json();
        if (!res.ok || !json.success) {
          if (!cancelled) {
            setErrorMsg(json.message || 'Không tải được chương để sửa.');
            setEditLoadState('error');
          }
          return;
        }
        const d = json.data;
        const blocks: any[] = (d.content_blocks || []).filter((b: any) => b.text && b.text.trim());
        const nextAnnotations: Record<number, Annotation> = {};
        const nextActive: number[] = [];
        blocks.forEach((b, idx) => {
          if (b.note || b.image_url) {
            nextAnnotations[idx] = { note: b.note || undefined, image_url: b.image_url || undefined };
            nextActive.push(idx);
          }
        });

        let storyDetail: any = null;
        const storyRes = await fetch(`${API_BASE_URL}/stories/${d.story_slug}`);
        if (storyRes.ok) {
          const storyJson = await storyRes.json();
          if (storyJson.success) storyDetail = storyJson.data;
        }
        if (cancelled) return;

        const storyType = d.story_type || storyDetail?.story_type;
        setMangaPages(
          storyType === 'manga'
            ? (d.pages?.length ? d.pages : (d.content_blocks || []).filter((b: any) => b.image_url).map((b: any) => b.image_url as string))
            : null
        );
        setSelectedStoryId(d.story_id);
        setSelectedStory(storyDetail || { id: d.story_id, slug: d.story_slug, title: d.story_title });
        setVolumes(storyDetail?.volumes || []);
        setSelectedVolumeId(d.volume_id || '');
        setChapterNumber(Number(d.chapter_number));
        setChapterTitle(d.title || '');
        setBodyText(blocks.length > 0 ? blocks.map((b) => b.text).join('\n\n') : (d.content || ''));
        setAnnotations(nextAnnotations);
        setActiveAnnotationIndices(nextActive);
        setEditLoadState('ready');
      } catch (e: any) {
        if (!cancelled) {
          setErrorMsg('Lỗi: ' + e.message);
          setEditLoadState('error');
        }
      }
    }
    loadChapter();
    return () => { cancelled = true; };
  }, [isEditMode, isAuthenticated, editId]);

  // Handle Create New Volume
  const handleCreateVolume = async () => {
    if (!newVolumeTitle.trim() || !selectedStoryId) return;
    setErrorMsg(null);
    try {
      // No volume_number: the server takes the next free number, so an existing volume is never overwritten
      const res = await authFetch(`${API_BASE_URL}/stories/${selectedStoryId}/volumes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: newVolumeTitle.trim() }),
      });
      const json = await res.json().catch(() => null);
      if (res.ok && json?.success) {
        setVolumes([...volumes, json.data]);
        setSelectedVolumeId(json.data.id);
        setIsCreatingNewVolume(false);
        setNewVolumeTitle('');
      } else {
        setErrorMsg(json?.message || 'Tạo tập mới thất bại.');
      }
    } catch (e: any) {
      setErrorMsg('Lỗi: ' + e.message);
    }
  };

  // Handle Submit / Save
  const handleSaveOrSubmit = async (isDraft: boolean) => {
    if (!isAuthenticated) {
      openAuthModal('login');
      return;
    }
    if (!selectedStoryId || !chapterTitle.trim() || isSubmitting) return;
    const parsedNumber = Number(chapterNumber);
    if (String(chapterNumber).trim() === '' || !Number.isFinite(parsedNumber) || parsedNumber < 0) {
      setErrorMsg('Số chương phải là số từ 0 trở lên.');
      return;
    }

    if (!isMangaEdit && !isDraft && paragraphs.length === 0) {
      setErrorMsg('Nội dung chương đang trống.');
      return;
    }

    setIsSubmitting(true);
    setErrorMsg(null);
    try {
      const formattedBlocks = paragraphs.map((text, idx) => ({
        block_order: idx + 1,
        text,
        note: annotations[idx]?.note || null,
        image_url: annotations[idx]?.image_url || null,
      }));

      if (isEditMode) {
        const editRes = await authFetch(`${API_BASE_URL}/chapters/${editId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: chapterTitle.trim(),
            chapter_number: parsedNumber,
            volume_id: selectedVolumeId || null,
            // manga pages are left untouched (sending no content keeps them)
            ...(isMangaEdit ? {} : { content_blocks: formattedBlocks }),
          }),
        });
        const editJson = await editRes.json();
        if (editRes.ok && editJson.success) {
          setFeedback(editJson.message || 'Đã cập nhật chương');
          setTimeout(() => {
            const storySlug = editJson.data?.story_slug || selectedStory?.slug;
            const chapterSlug = editJson.data?.slug;
            router.push(storySlug && chapterSlug ? `/truyen/${storySlug}/${chapterSlug}` : '/nhom-dich');
          }, 1200);
        } else {
          setErrorMsg(editJson.message || 'Cập nhật chương thất bại.');
        }
        return;
      }

      const res = await authFetch(`${API_BASE_URL}/chapters/submissions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          story_id: selectedStoryId,
          volume_id: selectedVolumeId || null,
          title: chapterTitle.trim(),
          chapter_number: parsedNumber,
          content: paragraphs.join('\n\n'),
          content_blocks: formattedBlocks,
          word_count: totalWords,
          is_draft: isDraft,
        }),
      });

      const json = await res.json();
      if (res.ok && json.success) {
        setFeedback(json.message || 'Đăng chương thành công');
        clearDraftFromStorage();
        if (!isDraft) {
          setTimeout(() => {
            if (selectedStory?.slug) {
              router.push(`/truyen/${selectedStory.slug}`);
            } else {
              router.push('/nhom-dich');
            }
          }, 1500);
        }
      } else {
        setErrorMsg(json.message || 'Đăng chương thất bại.');
      }
    } catch (e: any) {
      setErrorMsg('Lỗi: ' + e.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isAuthLoading) {
    return (
      <PageLoader label="Đang kiểm tra quyền đăng chương..." />
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="max-w-md mx-auto px-4 py-24 text-center">
        <div className="w-16 h-16 rounded-3xl bg-brand-500/10 border border-brand-500/20 text-brand-400 flex items-center justify-center mx-auto mb-5 shadow-xl">
          <Lock className="w-8 h-8" />
        </div>
        <h2 className="text-2xl font-bold text-white mb-2">Yêu Cầu Đăng Nhập</h2>
        <p className="text-sm text-gray-400 mb-6">
          Chỉ có chủ thầu truyện, dịch giả hoặc Mod/Admin mới có quyền đăng chương truyện mới. Vui lòng đăng nhập.
        </p>
        <button
          onClick={() => openAuthModal('login')}
          className="px-6 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-snow font-semibold text-sm shadow-lg shadow-brand-500/25 transition flex items-center justify-center gap-2 mx-auto"
        >
          <LogIn className="w-4 h-4" />
          Đăng nhập ngay
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 space-y-6 pb-32">

      {/* Back Button */}
      <div>
        <Link
          href="/nhom-dich"
          className="inline-flex items-center gap-2 text-xs font-semibold text-gray-400 hover:text-white transition"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Quay lại Quản Lý Nhóm Dịch</span>
        </Link>
      </div>

      {!isEditMode && <UploadModeSwitch mode="novel" groupId={groupId} />}

      {/* Header */}
      <div className="rounded-3xl p-6 sm:p-7 glass-panel border border-white/10 bg-glass shadow-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
        <div className="space-y-1.5">
          <h1 className="text-xl sm:text-2xl font-extrabold text-white tracking-wide flex items-center gap-2">
            <Pencil className="w-5 h-5 text-brand-400" />
            {isEditMode ? 'Sửa Chương' : 'Đăng Chương Mới'}
          </h1>
          <p className="text-xs sm:text-sm text-gray-400">
            {isMangaEdit
              ? 'Chương truyện tranh: sửa tiêu đề, số chương hoặc tập. Các trang ảnh được giữ nguyên.'
              : isEditMode
              ? 'Chỉnh sửa chương đã xuất bản. Thay đổi có hiệu lực ngay và không gửi lại thông báo cho người theo dõi.'
              : 'Viết nội dung chương, để trống một dòng giữa các đoạn văn để tách đoạn.'}
          </p>
        </div>

        {!isMangaEdit && (
        <div className="p-3.5 rounded-2xl bg-black/40 border border-white/10 flex items-center gap-4 text-xs shrink-0">
          <div>
            <div className="text-gray-400 text-[10px] uppercase font-bold">Số Từ</div>
            <div className="text-base font-extrabold text-brand-300">{totalWords.toLocaleString()}</div>
          </div>
          <div className="w-[1px] h-8 bg-white/15" />
          <div>
            <div className="text-gray-400 text-[10px] uppercase font-bold">Thời Gian Đọc</div>
            <div className="text-base font-extrabold text-cyan-300">~{readingTimeMin} phút</div>
          </div>
        </div>
        )}
      </div>

      {feedback && (
        <div className="p-4 rounded-2xl bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 text-xs font-bold flex items-center gap-2 animate-in fade-in">
          <Check className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{feedback}</span>
        </div>
      )}

      {errorMsg && (
        <div className="p-4 rounded-2xl bg-rose-500/20 border border-rose-500/30 text-rose-300 text-xs font-bold flex items-center gap-2 animate-in fade-in">
          <span>{errorMsg}</span>
        </div>
      )}

      {restorableDraft && (
        <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-200 text-xs font-semibold flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 animate-in fade-in">
          <div className="flex items-center gap-2">
            <Save className="w-4 h-4 text-amber-400 shrink-0" />
            <span>
              Phát hiện bản nháp tự động lưu lúc{' '}
              {new Date(restorableDraft.savedAt).toLocaleString('vi-VN')} cho truyện này. Khôi phục lại?
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button type="button" onClick={restoreDraft} className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-ink font-bold text-[11px] transition">
              Khôi phục
            </button>
            <button type="button" onClick={dismissDraft} className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 font-bold text-[11px] transition">
              Bỏ qua
            </button>
          </div>
        </div>
      )}

      {/* 1. PUBLICATION METADATA */}
      <div className="p-6 rounded-3xl glass-panel border border-white/10 bg-glass space-y-4 shadow-xl">
        <h2 className="text-xs font-bold text-brand-400 uppercase tracking-wider">Thông Tin Chương</h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-gray-200">Bộ Truyện *</label>
            <select
              value={selectedStoryId}
              disabled={isEditMode}
              onChange={(e) => pickStory(e.target.value)}
              className="w-full h-10 px-3 rounded-xl bg-surface-3 border border-white/10 text-xs text-white focus:outline-none focus:border-brand-500 font-semibold"
              required
            >
              <option value="">-- Chọn bộ truyện để đăng chương --</option>
              {novelStories.length > 0 && (
                <optgroup label="Truyện chữ">
                  {novelStories.map((s) => (
                    <option key={s.id} value={s.id}>{s.title}{s.group_name ? ` (${s.group_name})` : ''}</option>
                  ))}
                </optgroup>
              )}
              {!isEditMode && mangaStories.length > 0 && (
                <optgroup label="Truyện tranh (mở trình đăng truyện tranh)">
                  {mangaStories.map((s) => (
                    <option key={s.id} value={s.id}>{s.title}{s.group_name ? ` (${s.group_name})` : ''}</option>
                  ))}
                </optgroup>
              )}
              {isEditMode && selectedStory && !novelStories.some((s) => s.id === selectedStoryId) && (
                <option value={selectedStoryId}>{selectedStory.title}</option>
              )}
            </select>
            {isLoadingStories ? (
              <p className="text-[10px] text-gray-500 mt-1">Đang tải danh sách truyện bạn có quyền quản lý...</p>
            ) : groupId && novelStories.length === 0 ? (
              <p className="text-[10px] text-amber-400 mt-1">Nhóm dịch này chưa có truyện chữ nào bạn quản lý.</p>
            ) : shownStories.length === 0 && (
              <p className="text-[10px] text-amber-400 mt-1">
                Bạn chưa sở hữu, chưa là thành viên nhóm dịch, hoặc chưa là cộng tác viên của bộ truyện nào. Hãy <Link href="/dang-truyen" className="underline">Đăng truyện mới</Link> trước.
              </p>
            )}
            {!isEditMode && groupId && (
              <p className="text-[10px] text-gray-500 mt-1">
                Đang lọc theo nhóm dịch. <Link href={chapterUploadHref()} className="underline">Xem mọi truyện bạn quản lý</Link>
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-bold text-gray-200">Tiêu Đề Chương *</label>
            <input
              type="text"
              placeholder="e.g. Chương 1: Khởi đầu..."
              value={chapterTitle}
              onChange={(e) => setChapterTitle(e.target.value)}
              className="w-full h-10 px-4 rounded-xl bg-white/5 border border-white/10 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-brand-500 font-bold transition"
              required
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-gray-200">Số Chương *</label>
            <input
              type="number"
              step="0.1"
              value={chapterNumber}
              onChange={(e) => setChapterNumber(e.target.value)}
              className="w-full h-10 px-3 rounded-xl bg-surface-3 border border-white/10 text-xs text-white font-bold text-center focus:outline-none focus:border-brand-500"
              required
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-gray-200">Tập (tùy chọn)</label>
              <button
                type="button"
                onClick={() => setIsCreatingNewVolume(!isCreatingNewVolume)}
                className="text-[10px] text-cyan-400 hover:underline font-semibold"
              >
                + Thêm tập mới
              </button>
            </div>

            {isCreatingNewVolume ? (
              <div className="flex items-center gap-1.5 animate-in fade-in">
                <input
                  type="text"
                  placeholder="Tên tập mới (e.g. Quyển 2)..."
                  value={newVolumeTitle}
                  onChange={(e) => setNewVolumeTitle(e.target.value)}
                  className="flex-1 h-10 px-3 rounded-xl bg-surface-3 border border-white/10 text-xs text-white"
                />
                <button
                  type="button"
                  onClick={handleCreateVolume}
                  className="px-3 h-10 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-snow text-xs font-bold"
                >
                  Tạo
                </button>
              </div>
            ) : (
              <select
                value={selectedVolumeId}
                onChange={(e) => setSelectedVolumeId(e.target.value)}
                className="w-full h-10 px-3 rounded-xl bg-surface-3 border border-white/10 text-xs text-white focus:outline-none focus:border-brand-500 font-semibold"
              >
                <option value="">Không thuộc tập nào</option>
                {volumes.map((v) => (
                  <option key={v.id} value={v.id}>{v.title}</option>
                ))}
              </select>
            )}
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-bold text-gray-200">Nhóm Dịch</label>
            <div className="h-10 px-3 rounded-xl bg-white/5 border border-white/10 text-xs text-brand-300 font-bold flex items-center truncate">
              {selectedStory?.group_name || 'Độc lập'}
            </div>
          </div>
        </div>
      </div>

      {/* 2. EDITOR & PREVIEW (manga chapters: their pages, read-only here) */}
      <div className="p-6 rounded-3xl glass-panel border border-white/10 bg-glass space-y-4 shadow-2xl">

        {isMangaEdit && (
          <div className="space-y-3">
            <h2 className="text-xs font-bold text-brand-400 uppercase tracking-wider">Trang ảnh ({mangaPages!.length} trang)</h2>
            <div className="flex gap-2 overflow-x-auto pb-2">
              {mangaPages!.slice(0, 12).map((url, i) => (
                <div key={i} className="relative w-20 shrink-0 aspect-[2/3] rounded-lg overflow-hidden bg-black/40 border border-white/10">
                  <SmartImage src={url} alt={`Trang ${i + 1}`} className="w-full h-full object-cover" />
                  <span className="absolute bottom-0 inset-x-0 bg-black/60 text-[10px] text-snow text-center">{i + 1}</span>
                </div>
              ))}
              {mangaPages!.length > 12 && (
                <div className="w-20 shrink-0 aspect-[2/3] rounded-lg bg-white/5 border border-white/10 grid place-items-center text-xs text-gray-400">+{mangaPages!.length - 12}</div>
              )}
            </div>
            <p className="text-[11px] text-gray-400">
              Muốn thay trang ảnh, hãy đăng lại chương số {String(chapterNumber)} trong{' '}
              <Link href={chapterUploadHref({ storyType: 'manga', storyId: selectedStoryId })} className="text-brand-400 font-semibold underline">trình đăng truyện tranh</Link>{' '}
              (bản mới sẽ thay thế bản cũ).
            </p>
          </div>
        )}

        {!isMangaEdit && (<>

        <div className="flex items-center gap-1 p-1 rounded-xl bg-white/5 border border-white/10 text-xs font-bold w-fit">
          <button
            type="button"
            onClick={() => setActiveTab('editor')}
            className={`px-4 py-1.5 rounded-lg transition flex items-center gap-1.5 ${
              activeTab === 'editor' ? 'bg-brand-600 text-snow shadow-md' : 'text-gray-400 hover:text-white'
            }`}
          >
            <Pencil className="w-3.5 h-3.5" />
            <span>Soạn Thảo</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('preview')}
            className={`px-4 py-1.5 rounded-lg transition flex items-center gap-1.5 ${
              activeTab === 'preview' ? 'bg-brand-600 text-snow shadow-md' : 'text-gray-400 hover:text-white'
            }`}
          >
            <Eye className="w-3.5 h-3.5" />
            <span>Xem Trước</span>
          </button>
        </div>

        {/* EDITOR TAB */}
        {activeTab === 'editor' && (
          <div className="space-y-4">
            <textarea
              rows={18}
              placeholder={'Viết nội dung chương tại đây...\n\nĐể trống một dòng giữa các đoạn văn để tách thành đoạn riêng biệt.'}
              value={bodyText}
              onChange={(e) => setBodyText(e.target.value)}
              className="w-full p-4 rounded-2xl bg-black/30 border border-white/10 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-brand-500 transition leading-relaxed font-serif"
            />
            <div className="text-[11px] text-gray-500 flex items-center justify-between">
              <span>{paragraphs.length} đoạn văn</span>
              <span>{totalWords.toLocaleString()} chữ · ~{readingTimeMin} phút đọc</span>
            </div>

            {/* Advanced: translator notes & inline images, opt-in */}
            <div className="pt-3 border-t border-white/10">
              <button
                type="button"
                onClick={() => setShowAnnotations(!showAnnotations)}
                className="text-xs font-bold text-gray-400 hover:text-white flex items-center gap-1.5 transition"
              >
                <MessageSquare className="w-3.5 h-3.5" />
                <span>Chú thích dịch giả & ảnh minh họa (tùy chọn)</span>
                <span className="text-[10px] font-normal text-gray-500">
                  {annotationEntries.length > 0 ? `— ${annotationEntries.length} mục` : ''}
                </span>
              </button>

              {showAnnotations && (
                <div className="mt-3 space-y-3 animate-in fade-in">
                  {paragraphs.length === 0 ? (
                    <p className="text-[11px] text-gray-500">Nhập nội dung chương trước để có thể chèn chú thích/ảnh vào từng đoạn.</p>
                  ) : (
                    <>
                      <div className="flex items-center gap-2">
                        <select
                          value={annotationTargetIdx}
                          onChange={(e) => setAnnotationTargetIdx(e.target.value === '' ? '' : Number(e.target.value))}
                          className="h-9 px-3 rounded-xl bg-surface-3 border border-white/10 text-xs text-white"
                        >
                          <option value="">Chọn đoạn văn...</option>
                          {paragraphs.map((p, idx) => (
                            <option key={idx} value={idx} disabled={activeAnnotationIndices.includes(idx)}>
                              Đoạn #{idx + 1}: {p.slice(0, 40)}{p.length > 40 ? '…' : ''}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => {
                            if (annotationTargetIdx === '') return;
                            addAnnotationTarget(annotationTargetIdx);
                            setAnnotationTargetIdx('');
                          }}
                          disabled={annotationTargetIdx === ''}
                          className="px-3 h-9 rounded-xl bg-white/5 hover:bg-white/10 disabled:opacity-40 border border-white/10 text-xs font-bold text-gray-200 flex items-center gap-1.5 transition"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          <span>Thêm</span>
                        </button>
                      </div>

                      {annotationEntries.length === 0 && (
                        <p className="text-[11px] text-gray-500">Chưa có chú thích hoặc ảnh minh họa nào được chèn.</p>
                      )}

                      {annotationEntries.map((idx) => (
                        <div key={idx} className="p-3.5 rounded-xl bg-white/5 border border-white/10 space-y-2.5">
                          <div className="flex items-center justify-between text-[10px] font-bold text-gray-400 uppercase">
                            <span>Đoạn #{idx + 1}: {paragraphs[idx]?.slice(0, 60) || ''}{(paragraphs[idx]?.length || 0) > 60 ? '…' : ''}</span>
                            <button type="button" onClick={() => removeAnnotation(idx)} className="text-rose-400 hover:underline flex items-center gap-1">
                              <X className="w-3 h-3" /> Gỡ
                            </button>
                          </div>

                          <input
                            type="text"
                            placeholder="Ghi chú dịch giả cho đoạn này (tùy chọn)..."
                            value={annotations[idx]?.note || ''}
                            onChange={(e) => setAnnotation(idx, { note: e.target.value })}
                            className="w-full px-3 py-1.5 rounded-lg bg-black/40 border border-amber-500/20 text-xs text-amber-200 placeholder-amber-500/40 focus:outline-none focus:border-amber-400"
                          />

                          <ImageUploadDropzone
                            images={annotations[idx]?.image_url ? [annotations[idx]!.image_url!] : []}
                            onChange={(imgs) => setAnnotation(idx, { image_url: imgs[0] || undefined })}
                            maxFiles={1}
                            label={`Ảnh minh họa cho đoạn #${idx + 1}`}
                          />
                        </div>
                      ))}
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* PREVIEW TAB */}
        {activeTab === 'preview' && (
          <div className="p-6 sm:p-8 rounded-2xl bg-surface border border-white/10 space-y-6 max-w-3xl mx-auto font-serif text-gray-200 text-base leading-loose shadow-inner">

            <div className="text-center pb-6 border-b border-white/10 space-y-2 font-sans">
              <div className="text-xs uppercase font-bold tracking-wider text-brand-400">
                {selectedStory?.title || 'Tên bộ truyện'}
                {selectedVolumeId && ` • ${volumes.find(v => v.id === selectedVolumeId)?.title || ''}`}
              </div>
              <h1 className="text-xl sm:text-2xl font-extrabold text-white">
                Chương {chapterNumber}: {chapterTitle || 'Tiêu đề chương'}
              </h1>
              <div className="flex items-center justify-center gap-3 text-xs text-gray-400 pt-1">
                <span>{totalWords.toLocaleString()} chữ</span>
                <span>•</span>
                <span>Nhóm: {selectedStory?.group_name || 'Độc lập'}</span>
                <span>•</span>
                <span>Người đăng: {user?.display_name || user?.username}</span>
              </div>
            </div>

            {paragraphs.length === 0 ? (
              <p className="text-center text-gray-500 text-sm font-sans">Chưa có nội dung để xem trước.</p>
            ) : (
              <div className="space-y-6">
                {paragraphs.map((text, idx) => (
                  <div key={idx} className="space-y-4">
                    <p className="hover:bg-white/5 rounded-lg px-2 py-1 transition">{text}</p>

                    {annotations[idx]?.note && (
                      <div className="p-3 rounded-xl bg-amber-500/10 border-l-4 border-amber-500 text-xs font-sans text-amber-200 italic space-y-0.5">
                        <span className="font-bold text-[10px] uppercase text-amber-400 block not-italic">Chú thích dịch giả:</span>
                        {annotations[idx]?.note}
                      </div>
                    )}

                    {annotations[idx]?.image_url && (
                      <div className="my-6 flex flex-col items-center">
                        <div className="rounded-2xl overflow-hidden shadow-2xl border border-white/15 max-w-lg bg-black/40">
                          <SmartImage src={annotations[idx]!.image_url!} alt={`Minh họa đoạn ${idx + 1}`} className="w-full h-auto" />
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        </>)}

        {/* Action Toolbar */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-4 border-t border-white/10">
          <div className="text-xs text-gray-400">
            * Chỉ chủ thầu bộ truyện, thành viên nhóm dịch hoặc Mod/Admin mới có thể xuất bản chương.
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
            {!isEditMode && (
            <button
              type="button"
              onClick={() => handleSaveOrSubmit(true)}
              disabled={!selectedStoryId || !chapterTitle.trim() || isSubmitting}
              className="px-5 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 disabled:opacity-40 text-white font-bold text-xs border border-white/15 flex items-center gap-1.5 transition"
              title="Lưu riêng tư, chưa hiển thị cho độc giả"
            >
              <Save className="w-3.5 h-3.5" />
              <span>Lưu Bản Nháp</span>
            </button>
            )}

            <button
              type="button"
              onClick={() => handleSaveOrSubmit(false)}
              disabled={!selectedStoryId || !chapterTitle.trim() || isSubmitting || (isEditMode && editLoadState !== 'ready')}
              className="px-8 py-2.5 rounded-xl bg-gradient-to-r from-brand-600 to-indigo-600 hover:from-brand-500 hover:to-indigo-500 disabled:opacity-40 text-snow font-bold text-xs shadow-xl shadow-brand-500/25 flex items-center gap-2 transition hover:scale-105"
            >
              <Send className="w-4 h-4" />
              <span>{isSubmitting ? 'Đang gửi...' : (isEditMode ? 'Lưu Thay Đổi' : 'Nộp & Xuất Bản Chương')}</span>
            </button>
          </div>
        </div>

      </div>

    </div>
  );
}

export default function ChapterEditorPage() {
  return (
    <Suspense fallback={<PageLoader label="Đang tải trình soạn thảo chương..." />}>
      <ChapterEditorContent />
    </Suspense>
  );
}
