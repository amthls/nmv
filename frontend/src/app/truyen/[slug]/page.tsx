'use client';

import React, { useState, useEffect, useRef } from 'react';
import Link from '@/components/common/Link';
import { useParams, useRouter } from 'next/navigation';
import { 
  BookOpen, 
  Eye, 
  Heart, 
  User, 
  ShieldCheck, 
  Layers, 
  MessageSquare,
  Sparkles,
  AlertCircle,
  Trash2,
  PlusCircle,
  Clock,
  CheckCircle2,
  Pencil,
  ArrowUp,
  ArrowDown,
  Download,
  Library,
  List,
  EyeOff,
  RotateCcw
} from 'lucide-react';
import SmartImage from '@/components/common/SmartImage';
import SkinChibi, { ChibiSay } from '@/components/skin/aemeath/SkinChibi';
import { CHIBI_LINES } from '@/components/skin/aemeath/chibiLines';
import { goBack } from '@/lib/nav';
import CommentSection from '@/components/comments/CommentSection';
import ReportButton from '@/components/common/ReportButton';
import DownloadModal from '@/components/story/DownloadModal';
import SaveToAlbumModal from '@/components/album/SaveToAlbumModal';
import StoryAlbumsSection from '@/components/album/StoryAlbumsSection';
import RecommendationRail from '@/components/home/RecommendationRail';
import { useAuth } from '@/context/AuthContext';
import RichContent from '@/components/common/RichContent';
import { stripHtml } from '@/lib/richText';
import { getGuestHistory, positionHash } from '@/lib/readingHistory';
import { chapterUploadHref } from '@/lib/chapterUpload';
import CodeBadge from '@/components/common/CodeBadge';
import { LIBRARY_URL } from '@/lib/apiJson';
import { apiFetch } from '@/lib/session';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api/v1';

export default function StoryDetailPage() {
  const params = useParams();
  const router = useRouter();
  const slug = params?.slug as string;
  const { user, hasRole, authFetch, isAuthenticated, isLoading: authLoading, openAuthModal } = useAuth();

  const [story, setStory] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isFollowing, setIsFollowing] = useState(false);
  const [isDownloadOpen, setIsDownloadOpen] = useState(false);
  const [isAlbumOpen, setIsAlbumOpen] = useState(false);
  const [showAllTags, setShowAllTags] = useState(false);
  const [albumsChanged, setAlbumsChanged] = useState(0); // reloads the albums section
  const [isDeleting, setIsDeleting] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [lastReadChapter, setLastReadChapter] = useState<{ slug: string; title?: string; chapter_number?: number; hash: string } | null>(null);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 2800);
  };

  const fetchStory = async () => {
    if (!slug) return;
    setIsLoading(true);
    try {
      // the session cookie goes along either way, so the first answer is already right for a signed-in reader
      const res = await apiFetch(`${API_BASE_URL}/stories/${slug}`);
      if (res.ok) {
        const json = await res.json();
        if (json.success && json.data) {
          setStory(json.data);
          // Follow state is per account and comes only from the server (false for guests)
          setIsFollowing(json.data.is_favorite === true);
        }
      }
    } catch (err) {
      console.error('Failed to fetch story detail:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchStory();
  }, [slug]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reload only on a real sign-in / sign-out (follow state changes), not when the cached session appears on first render
  const signedIn = useRef<boolean | null>(null);
  useEffect(() => {
    if (authLoading) return;
    if (signedIn.current !== null && signedIn.current !== isAuthenticated) fetchStory();
    signedIn.current = isAuthenticated;
  }, [authLoading, isAuthenticated]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!slug || !story?.id || authLoading) return; // once, when both the story and the session are known
    const checkHistory = async () => {
      let found: any = null;
      if (!isAuthenticated) {
        found = getGuestHistory().find((h: any) => h.story_slug === slug || (story?.id && h.story_id === story.id));
      } else {
        try {
          const res = await authFetch(`${LIBRARY_URL}/history`);
          if (res.ok) {
            const json = await res.json();
            if (json.success && Array.isArray(json.data)) {
              found = json.data.find((h: any) => h.story_slug === slug || (story?.id && h.story_id === story.id));
            }
          }
        } catch (e) {}
      }
      if (found && (found.chapter_slug || found.slug)) {
        setLastReadChapter({
          slug: found.chapter_slug || found.slug,
          title: found.chapter_title,
          chapter_number: found.chapter_number,
          hash: positionHash(found),
        });
      } else {
        setLastReadChapter(null); // e.g. after logout, don't keep the previous account's position
      }
    };
    checkHistory();
  }, [slug, story?.id, isAuthenticated, authLoading]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleToggleFollow = async (e?: React.MouseEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (!story) return;
    if (!isAuthenticated) {
      openAuthModal('login');
      return;
    }

    // Optimistic update, rolled back if the server rejects it
    const nextStatus = !isFollowing;
    const applyStatus = (following: boolean) => {
      setIsFollowing(following);
      setStory((prev: any) => prev ? {
        ...prev,
        total_favorites: Math.max(0, Number(prev.total_favorites || 0) + (following ? 1 : -1))
      } : prev);
    };
    applyStatus(nextStatus);

    try {
      const res = await authFetch(`${LIBRARY_URL}/favorites/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Send the stored category: the server only removes when it matches (otherwise it re-categorizes)
        body: JSON.stringify({ story_id: story.id, category: story.favorite_category || 'reading' }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) throw new Error(json?.message || `HTTP ${res.status}`);
      const removed = json.action === 'removed';
      if (removed === nextStatus) applyStatus(!removed); // server ended in a different state than we guessed
      setStory((prev: any) => prev ? { ...prev, favorite_category: removed ? null : (prev.favorite_category || 'reading') } : prev);
      showToast(removed ? 'Đã hủy theo dõi truyện.' : 'Đã theo dõi truyện, bạn sẽ được báo khi có chương mới!');
    } catch (err) {
      console.error('Failed to update follow state:', err);
      applyStatus(!nextStatus);
      showToast('Không thể cập nhật theo dõi. Vui lòng thử lại.');
    }
  };

  // Check if current user is owner ("chủ thầu"), collaborator or translation-group
  // member. Resolved server-side (story.can_manage) so group
  // members see the same management controls the backend actually authorizes;
  // the local check below is only a fallback for stale/unauthenticated data.
  const isOwner = Boolean(
    user && story && (
      user.id === story.uploader_id ||
      (story.collaborators && story.collaborators.some((c: any) => c.user_id === user.id))
    )
  );
  const canManage = story?.can_manage ?? isOwner;
  // Only the uploader deletes a story for good; Admin/Mod don't edit it, they take it down (undoable)
  const isUploader = Boolean(user && story && user.id === story.uploader_id);
  const isStaff = hasRole('admin', 'mod');
  const isRemoved = story?.approval_status === 'rejected';
  const [isModerating, setIsModerating] = useState(false);

  const handleModerate = async (remove: boolean) => {
    if (!story || isModerating) return;
    let reason: string | null = null;
    if (remove) {
      reason = prompt(`Gỡ truyện "${story.title}"? Lý do (người đăng sẽ thấy, có thể để trống):`);
      if (reason === null) return;
    }
    setIsModerating(true);
    try {
      const res = await authFetch(`${API_BASE_URL}/stories/${story.id}/${remove ? 'remove' : 'restore'}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      });
      const json = await res.json();
      alert(json.message || (res.ok ? 'Đã xử lý.' : 'Thao tác thất bại.'));
      if (res.ok && json.success) fetchStory();
    } catch (err: any) {
      alert('Lỗi: ' + err.message);
    } finally {
      setIsModerating(false);
    }
  };

  const handleDeleteStory = async () => {
    if (!story || isDeleting) return;
    if (!confirm(`CẢNH BÁO: Bạn có chắc chắn muốn xóa bộ truyện "${story.title}" cùng toàn bộ tập và chương liên quan? Thao tác này không thể hoàn tác.`)) {
      return;
    }

    setIsDeleting(true);
    try {
      const res = await authFetch(`${API_BASE_URL}/stories/${story.id}`, {
        method: 'DELETE',
      });
      const json = await res.json();
      if (res.ok && json.success) {
        alert('Đã xóa bộ truyện thành công.');
        goBack(router, '/');
      } else {
        alert(json.message || 'Xóa truyện thất bại.');
      }
    } catch (err: any) {
      alert('Lỗi: ' + err.message);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleDeleteChapter = async (chapterId: string, chapterTitle: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm(`Bạn có chắc muốn xóa chương "${chapterTitle}"? Thao tác này không thể hoàn tác.`)) return;

    try {
      const res = await authFetch(`${API_BASE_URL}/chapters/${chapterId}`, {
        method: 'DELETE',
      });
      const json = await res.json();
      if (res.ok && json.success) {
        alert('Đã xóa chương thành công.');
        fetchStory();
      } else {
        alert(json.message || 'Xóa chương thất bại.');
      }
    } catch (err: any) {
      alert('Lỗi: ' + err.message);
    }
  };

  const renderChapterRow = (ch: any) => (
      <div
        key={ch.id}
        className="sk-chap-row min-h-12 lg:min-h-0 p-3.5 flex items-center justify-between hover:bg-white/5 transition group px-5"
      >
        <Link
          href={`/truyen/${story.slug}/${ch.slug}`}
          className="flex items-center gap-3 truncate flex-1 min-h-11 lg:min-h-0"
        >
          <BookOpen className="w-4 h-4 text-gray-500 group-hover:text-brand-400 transition-colors shrink-0" />
          <span className="text-sm lg:text-xs font-semibold text-gray-200 group-hover:text-brand-400 transition-colors truncate">
            {ch.title}
          </span>
        </Link>

        {/* same column widths in every row (word count | views | read | edit+delete), so nothing drifts from row to row */}
        <div className={`grid items-center gap-x-2 text-[11px] text-gray-400 shrink-0 ml-3 tabular-nums ${
          canManage ? 'grid-cols-[4.25rem_3.5rem_3.5rem] sm:grid-cols-[4.5rem_4.25rem_3.5rem_3.5rem]' : 'grid-cols-[4.25rem_3.5rem] sm:grid-cols-[4.5rem_4.25rem_3.5rem]'
        }`}>
          <span className="hidden sm:block text-right">{ch.word_count > 0 ? `${ch.word_count.toLocaleString()} chữ` : ''}</span>
          <span className="flex items-center justify-end gap-1">
            {typeof ch.total_views === 'number' ? ch.total_views.toLocaleString() : ch.total_views || 0}
            <Eye className="w-3 h-3 text-cyan-400 shrink-0" />
          </span>
          
          <Link
            href={`/truyen/${story.slug}/${ch.slug}`}
            className="text-right max-lg:py-3 text-brand-400 font-medium hover:text-brand-300 transition-colors"
          >
            Đọc ngay
          </Link>

          {/* Edit / delete chapter: the story's team */}
          {canManage && (
            <span className="flex items-center justify-end">
            <Link
              href={`/dang-chuong?edit=${ch.id}`}
              onClick={(e) => e.stopPropagation()}
              className="p-1 rounded-lg text-gray-500 hover:text-cyan-400 hover:bg-cyan-500/10 transition"
              title="Sửa chương này"
            >
              <Pencil className="w-3.5 h-3.5" />
            </Link>
            <button
              type="button"
              onClick={(e) => handleDeleteChapter(ch.id, ch.title, e)}
              className="p-1 rounded-lg text-gray-500 hover:text-rose-400 hover:bg-rose-500/10 transition"
              title="Xóa chương này"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
            </span>
          )}
        </div>
      </div>
  );

  const handleRenameVolume = async (volume: any) => {
    const title = window.prompt('Tên mới của tập:', volume.title);
    if (title === null || !title.trim() || title.trim() === volume.title) return;
    try {
      const res = await authFetch(`${API_BASE_URL}/volumes/${volume.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.trim() }),
      });
      const json = await res.json();
      if (res.ok && json.success) fetchStory();
      else alert(json.message || 'Đổi tên tập thất bại.');
    } catch (err: any) {
      alert('Lỗi: ' + err.message);
    }
  };

  const handleDeleteVolume = async (volume: any) => {
    const count = volume.chapters?.length || 0;
    const note = count > 0
      ? `${count} chương trong tập sẽ được giữ lại và chuyển sang mục "Chưa phân tập".`
      : 'Tập này chưa có chương nào.';
    if (!confirm(`Xóa tập "${volume.title}"?\n${note}`)) return;
    try {
      const res = await authFetch(`${API_BASE_URL}/volumes/${volume.id}`, { method: 'DELETE' });
      const json = await res.json();
      if (res.ok && json.success) fetchStory();
      else alert(json.message || 'Xóa tập thất bại.');
    } catch (err: any) {
      alert('Lỗi: ' + err.message);
    }
  };

  const handleMoveVolume = async (index: number, direction: -1 | 1) => {
    const list = story?.volumes || [];
    const target = index + direction;
    if (target < 0 || target >= list.length) return;
    const order = list.map((v: any) => v.id);
    [order[index], order[target]] = [order[target], order[index]];
    try {
      const res = await authFetch(`${API_BASE_URL}/stories/${story.id}/volumes/reorder`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order }),
      });
      const json = await res.json();
      if (res.ok && json.success) fetchStory();
      else alert(json.message || 'Sắp xếp tập thất bại.');
    } catch (err: any) {
      alert('Lỗi: ' + err.message);
    }
  };

  if (isLoading) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-12 space-y-8 animate-pulse">
        <div className="h-96 bg-white/5 rounded-3xl" />
        <div className="h-64 bg-white/5 rounded-3xl" />
      </div>
    );
  }

  if (!story) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-20 text-center space-y-4">
        <ChibiSay art="duo" size={96} line={CHIBI_LINES.notFound[1]} />
        <AlertCircle className="w-12 h-12 text-brand-400 mx-auto [html.skin-aemeath_&]:hidden" />
        <h2 className="text-xl font-bold text-white">Không tìm thấy bộ truyện này</h2>
        <Link href="/kham-pha" className="inline-block px-4 py-2 rounded-xl bg-brand-600 text-snow text-xs font-semibold">
          Quay lại trang Khám Phá
        </Link>
      </div>
    );
  }

  const isNovel = story.story_type === 'novel';

  return (
    <div className="min-h-screen pb-20 max-lg:pb-[calc(4rem+env(safe-area-inset-bottom)+1rem)]">
      
      {/* 1. Hero header: story art in a card aligned with the content below, like the home banner */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pt-6">
      <div className="sk-story-hero relative isolate overflow-hidden rounded-xl border border-white/10 bg-surface-3 shadow-[0_24px_60px_-28px_rgba(0,0,0,0.8)]">
        <div className="pointer-events-none absolute inset-0 -z-10">
          <SmartImage
            src={story.banner_image_url || story.cover_image_url}
            alt=""
            aria-hidden
            className="w-full h-full object-cover object-[50%_25%]"
          />
          {/* dark wash only behind the text */}
          <div className="absolute inset-0 bg-[linear-gradient(68deg,rgba(0,0,0,0.75)_30%,rgba(0,0,0,0.4)_100%)]" />
          {/* thin top highlight, like the glass panels */}
          <div className="absolute inset-0 rounded-xl shadow-[inset_0_1px_0_0_rgba(255,255,255,0.12)]" />
        </div>

        {/* Chibi Aemeath nhỏ ở góc hero (chỉ skin Aemeath, outfit ổn định theo slug) */}
        <SkinChibi free className="sk-chibi-hero" pose={story.slug.length % 2 ? 'read' : 'sit'} mood="happy" seed={story.slug} size={84} />

        {/* header content always uses the dark palette: white text on the darkened art */}
        <div className="dark relative px-5 sm:px-8 lg:px-10 pt-6 pb-8 md:pt-8 md:pb-10 [text-shadow:0_1px_8px_rgba(0,0,0,0.45)]">

          {isRemoved && (
            <div className="mb-6 p-4 rounded-2xl border text-xs flex flex-col sm:flex-row sm:items-center gap-3 [text-shadow:none] bg-rose-500/20 border-rose-500/30 text-rose-200">
              <div className="flex-1">
                <b>Truyện đã bị Ban quản trị gỡ.</b> Chỉ người đăng, nhóm dịch và Ban quản trị còn xem được.
                {story.rejection_reason && <> Lý do: {story.rejection_reason}.</>}
              </div>
              {isStaff && (
                <button
                  onClick={() => handleModerate(false)}
                  disabled={isModerating}
                  className="shrink-0 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold disabled:opacity-50 flex items-center gap-1.5"
                >
                  <RotateCcw className="w-3.5 h-3.5" /> Khôi phục
                </button>
              )}
            </div>
          )}

          {/* Main Story Hero Grid */}
          <div className="flex flex-col md:flex-row gap-8 items-start md:items-stretch">
            
            {/* Left: Poster Cover */}
            <div className="w-48 sm:w-60 shrink-0 mx-auto md:mx-0 relative aspect-[3/4] rounded-2xl overflow-hidden shadow-2xl ring-1 ring-white/20 bg-gray-900 group">
              <SmartImage
                src={story.cover_image_url}
                alt={story.title}
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
              />
              <span className={`absolute top-3 left-3 px-2.5 py-1 rounded-md text-[11px] font-bold uppercase tracking-wider text-snow backdrop-blur-md shadow-md ${
                isNovel ? 'bg-indigo-600/90' : 'bg-rose-600/90'
              }`}>
                {isNovel ? 'Light Novel' : 'Manga'}
              </span>
            </div>

            {/* Right: Story Info & Meta */}
            <div className="flex-1 w-full flex flex-col gap-4 text-center md:text-left">
              
              {/* Title & Original Title */}
              <div>
                <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-wide leading-tight">
                  {story.title}
                </h1>
                {story.original_title && (
                  <h2 className="text-sm text-gray-400 mt-1 font-medium italic">
                    {story.original_title}
                  </h2>
                )}
              </div>

              {/* Author & Group & Language Badges */}
              <div className="flex flex-wrap items-center justify-center md:justify-start gap-3 text-xs text-gray-300">
                <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/5 border border-white/10">
                  <User className="w-3.5 h-3.5 text-brand-400" />
                  <span>Tác giả: <strong className="text-white">{story.author_name || 'Chưa rõ'}</strong></span>
                </div>

                {story.group_name && (
                  <Link 
                    href={`/nhom-dich/${story.group_slug || ''}`}
                    className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-brand-600/20 border border-brand-500/30 text-brand-300 hover:bg-brand-600/30 transition"
                  >
                    <ShieldCheck className="w-3.5 h-3.5 text-brand-400" />
                    <span>Nhóm dịch: <strong className="text-white">{story.group_name}</strong></span>
                  </Link>
                )}

                <div className="px-2.5 py-1 rounded-full bg-white/5 border border-white/10 text-[11px] uppercase font-semibold text-gray-400">
                  {story.status === 'ongoing' ? 'Đang tiến hành' : 'Hoàn thành'}
                </div>

                {/* Imported stories credit where they came from (scripts/crawler.py) */}
                {story.source_url && (
                  <a
                    href={story.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-2.5 py-1 rounded-full bg-white/5 border border-white/10 text-[11px] font-semibold text-gray-400 hover:text-white transition"
                  >
                    Nguồn: {({ mangadex: 'MangaDex', toptruyen: 'TopTruyen', nettruyen: 'NetTruyen', valvrare: 'Valvrareteam', truyenyy: 'TruyenYY' } as Record<string, string>)[story.source_name] || story.source_name} ↗
                  </a>
                )}

              </div>

              {/* Stats Bar (Views, Followers, Chapters) */}
              <div className="grid grid-cols-3 gap-2 p-3 rounded-2xl bg-white/5 border border-white/10 max-w-lg mx-auto md:mx-0 text-center">
                <div className="space-y-0.5">
                  <div className="flex items-center justify-center gap-1 text-cyan-300 font-extrabold text-sm">
                    <Eye className="w-4 h-4" />
                    <span>{Number(story.total_views || 0).toLocaleString('vi-VN')}</span>
                  </div>
                  <div className="text-[10px] text-gray-400">Lượt xem</div>
                </div>

                <div className="space-y-0.5 border-l border-white/10">
                  <div className="flex items-center justify-center gap-1 text-rose-300 font-extrabold text-sm">
                    <Heart className="w-4 h-4 text-rose-400 fill-rose-400" />
                    <span>{Number(story.total_favorites || 0).toLocaleString('vi-VN')}</span>
                  </div>
                  <div className="text-[10px] text-gray-400">Người theo dõi</div>
                </div>

                <div className="space-y-0.5 border-l border-white/10">
                  <div className="flex items-center justify-center gap-1 text-brand-300 font-extrabold text-sm">
                    <BookOpen className="w-4 h-4" />
                    <span>{story.total_chapters || 0}</span>
                  </div>
                  <div className="text-[10px] text-gray-400">Chương</div>
                </div>
              </div>

              {/* Actions: 1) reading  2) reader tools */}
              <div className="pt-3 space-y-3 md:mt-auto">{/* bottom of the cover, whatever the title length */}
                {/* 1. Reading */}
                <div className="flex flex-wrap items-center justify-center md:justify-start gap-2.5 max-lg:hidden">
                  {lastReadChapter ? (
                    <Link
                      href={`/truyen/${story.slug}/${lastReadChapter.slug}${lastReadChapter.hash}`}
                      className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-snow font-bold text-sm shadow-lg shadow-emerald-500/25 flex items-center gap-2 transition-all hover:scale-[1.03]"
                    >
                      <BookOpen className="w-4 h-4" />
                      <span>
                        Đọc tiếp{lastReadChapter.chapter_number !== undefined && lastReadChapter.chapter_number !== null
                          ? ` · Chương ${Number(lastReadChapter.chapter_number)}`
                          : ''}
                      </span>
                    </Link>
                  ) : null}

                  {story.first_chapter ? (
                    <Link
                      href={`/truyen/${story.slug}/${story.first_chapter.slug}`}
                      className={
                        lastReadChapter
                          ? 'max-lg:hidden px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 text-white font-semibold text-sm border border-white/10 flex items-center gap-2 transition'
                          : 'px-5 py-2.5 rounded-xl bg-gradient-to-r from-brand-600 to-indigo-600 hover:from-brand-500 hover:to-indigo-500 text-snow font-bold text-sm shadow-lg shadow-brand-500/25 flex items-center gap-2 transition-all hover:scale-[1.03]'
                      }
                    >
                      <BookOpen className="w-4 h-4" />
                      <span>Đọc từ đầu</span>
                    </Link>
                  ) : null}

                  {story.latest_chapter && story.latest_chapter.slug !== story.first_chapter?.slug ? (
                    <Link
                      href={`/truyen/${story.slug}/${story.latest_chapter.slug}`}
                      className="max-lg:hidden px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 text-white font-semibold text-sm border border-white/10 transition"
                    >
                      Chương mới nhất
                    </Link>
                  ) : null}
                </div>

                {/* 2. Reader tools, one compact toolbar */}
                <div className="flex justify-center md:justify-start">
                  <div className="max-lg:grid max-lg:grid-flow-col max-lg:auto-cols-fr max-lg:w-full lg:inline-flex items-stretch rounded-xl bg-black/30 border border-white/10 backdrop-blur-sm divide-x divide-white/10 overflow-hidden text-xs font-semibold">
                    <button
                      type="button"
                      onClick={handleToggleFollow}
                      className={`px-3.5 py-2 flex items-center gap-1.5 whitespace-nowrap max-lg:flex-col max-lg:justify-center max-lg:gap-1 max-lg:px-1 max-lg:py-2.5 transition select-none active:scale-95 ${
                        isFollowing ? 'text-rose-300 bg-rose-600/20 hover:bg-rose-600/30' : 'text-gray-300 hover:text-white hover:bg-white/10'
                      }`}
                      title={isFollowing ? 'Bỏ theo dõi truyện này' : 'Theo dõi truyện để nhận thông báo'}
                    >
                      <Heart className={`w-3.5 h-3.5 ${isFollowing ? 'fill-rose-500 text-rose-500' : ''}`} />
                      <span><span className="sm:hidden">{isFollowing ? 'Đã theo dõi' : 'Theo dõi'}</span><span className="max-sm:hidden">{isFollowing ? 'Đang theo dõi' : 'Theo dõi'}</span></span>
                    </button>

                    <button
                      type="button"
                      onClick={() => (isAuthenticated ? setIsAlbumOpen(true) : openAuthModal('login'))}
                      className="px-3.5 py-2 flex items-center gap-1.5 whitespace-nowrap max-lg:flex-col max-lg:justify-center max-lg:gap-1 max-lg:px-1 max-lg:py-2.5 text-gray-300 hover:text-white hover:bg-white/10 transition"
                      title="Lưu truyện vào một hoặc nhiều album của bạn"
                    >
                      <Library className="w-3.5 h-3.5 text-brand-400" />
                      <span><span className="sm:hidden">Album</span><span className="max-sm:hidden">Lưu vào album</span></span>
                    </button>

                    <Link
                      href={`/fandom?story=${story.slug}`}
                      className="px-3.5 py-2 flex items-center gap-1.5 whitespace-nowrap max-lg:flex-col max-lg:justify-center max-lg:gap-1 max-lg:px-1 max-lg:py-2.5 text-gray-300 hover:text-white hover:bg-white/10 transition"
                      title="Review, fanart và thảo luận về truyện này trên Fandom"
                    >
                      <MessageSquare className="w-3.5 h-3.5 text-cyan-400" />
                      <span>Thảo luận</span>
                    </Link>

                    {story.allow_download && (story.total_chapters || story.first_chapter) ? (
                      <button
                        type="button"
                        onClick={() => setIsDownloadOpen(true)}
                        className="px-3.5 py-2 flex items-center gap-1.5 whitespace-nowrap max-lg:flex-col max-lg:justify-center max-lg:gap-1 max-lg:px-1 max-lg:py-2.5 text-gray-300 hover:text-white hover:bg-white/10 transition"
                        title="Tải truyện dạng EPUB hoặc PDF"
                      >
                        <Download className="w-3.5 h-3.5 text-brand-400" />
                        <span>Tải xuống</span>
                      </button>
                    ) : null}

                    <ReportButton
                      targetType="story"
                      targetId={story.id}
                      className="px-3.5 py-2 flex items-center gap-1.5 whitespace-nowrap max-lg:flex-col max-lg:justify-center max-lg:gap-1 max-lg:px-1 max-lg:py-2.5 text-gray-400 hover:text-amber-400 hover:bg-white/10 transition"
                    />
                  </div>
                </div>

              </div>

            </div>

          </div>

        </div>
      </div>
      </div>

      {/* 2. Main Content Body: Synopsis, Chapter Tree & Comments */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-10">
        
        {/* Management for the story's team; Admin/Mod only get "Gỡ truyện" (outside the banner: same banner for everyone) */}
        {(canManage || isStaff) && (
          <div className="flex flex-wrap items-center gap-2 px-4 py-3 rounded-2xl glass-panel border border-white/10">
            <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500 mr-1">Quản lý</span>
            <CodeBadge code={story.code} />
            {canManage && (
              <>
                <Link
                  href={chapterUploadHref({ storyType: story.story_type, storyId: story.id })}
                  className="px-3 py-1.5 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/40 text-xs font-bold flex items-center gap-1.5 transition"
                >
                  <PlusCircle className="w-3.5 h-3.5" />
                  <span>Thêm chương</span>
                </Link>
                <Link
                  href={`/dang-truyen/sua/${story.slug}`}
                  className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-gray-200 border border-white/15 text-xs font-bold flex items-center gap-1.5 transition"
                >
                  <Pencil className="w-3.5 h-3.5" />
                  <span>Sửa truyện</span>
                </Link>
              </>
            )}
            {isUploader && (
              <button
                onClick={handleDeleteStory}
                disabled={isDeleting}
                className="px-3 py-1.5 rounded-lg bg-rose-600/15 hover:bg-rose-600/25 text-rose-300 border border-rose-500/30 text-xs font-bold flex items-center gap-1.5 transition"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{isDeleting ? 'Đang xóa...' : 'Xóa truyện'}</span>
              </button>
            )}
            {isStaff && !isRemoved && (
              <button
                onClick={() => handleModerate(true)}
                disabled={isModerating}
                className="px-3 py-1.5 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 text-xs font-bold flex items-center gap-1.5 transition"
              >
                <EyeOff className="w-3.5 h-3.5" />
                <span>Gỡ truyện vi phạm</span>
              </button>
            )}
          </div>
        )}

        {/* Synopsis / Summary, genre tags first */}
        <section className="p-6 rounded-3xl glass-panel border border-white/10 space-y-3">
          {story.tags && story.tags.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 pb-3 border-b border-white/10">
              <span className="text-xs font-semibold text-gray-400 mr-1">Thể loại</span>
              {(showAllTags ? story.tags : story.tags.slice(0, 12)).map((tag: any) => (
                <Link
                  key={tag.id}
                  href={`/kham-pha?tags=${tag.slug}`}
                  className="px-2.5 py-0.5 rounded-full text-xs leading-5 text-gray-300 bg-white/5 hover:bg-white/10 hover:text-white border border-white/10 transition"
                >
                  {tag.name}
                </Link>
              ))}
              {story.tags.length > 12 && (
                <button
                  type="button"
                  onClick={() => setShowAllTags((v) => !v)}
                  className="px-2 py-0.5 text-xs font-semibold text-brand-400 hover:text-brand-300 transition"
                >
                  {showAllTags ? 'Thu gọn' : `+${story.tags.length - 12}`}
                </button>
              )}
            </div>
          )}
          <h3 className="text-base font-bold text-white uppercase tracking-wider flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-brand-400" />
            <span>Tóm Tắt Nội Dung</span>
          </h3>
          <div className="text-sm text-gray-300 leading-relaxed font-normal">
            {stripHtml(story.synopsis)
              ? <RichContent content={story.synopsis} />
              : 'Chưa có tóm tắt chi tiết cho bộ truyện này.'}
          </div>
        </section>

        {/* Volumes & Chapters List */}
        <section id="muc-luc" className="space-y-6 scroll-mt-20">
          <div className="flex items-center justify-between pb-3 border-b border-white/10">
            <div className="flex items-center gap-2">
              <Layers className="w-5 h-5 text-brand-400" />
              <h3 className="text-xl font-bold text-white tracking-wide">Mục Lục Chương</h3>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-gray-400">
                Tổng cộng <strong className="text-white">{story.total_chapters || 0}</strong> chương
              </span>
              {canManage && (
                <Link
                  href={chapterUploadHref({ storyType: story.story_type, storyId: story.id })}
                  className="px-3 py-1.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-snow text-xs font-bold transition flex items-center gap-1"
                >
                  <PlusCircle className="w-3.5 h-3.5" />
                  <span>Đăng chương</span>
                </Link>
              )}
            </div>
          </div>

          {/* Volume Accordion List */}
          {story.volumes && story.volumes.length > 0 ? (
            story.volumes.map((volume: any, volumeIndex: number) => (
              <div key={volume.id} className="rounded-2xl glass-panel border border-white/10 overflow-hidden space-y-0">
                {/* Volume Header */}
                <div className="p-4 bg-white/5 border-b border-white/5 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-brand-600/30 text-brand-300 font-bold text-xs flex items-center justify-center border border-brand-500/30">
                      T{volume.volume_number}
                    </div>
                    <div>
                      <h4 className="font-bold text-sm text-white">{volume.title}</h4>
                      {volume.description && (
                        <p className="text-xs text-gray-400 mt-0.5">{volume.description}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-400">{volume.chapters?.length || 0} chương</span>
                    {canManage && (
                      <div className="flex items-center gap-0.5 ml-1">
                        <button
                          type="button"
                          onClick={() => handleMoveVolume(volumeIndex, -1)}
                          disabled={volumeIndex === 0}
                          className="p-1 rounded-lg text-gray-500 hover:text-white hover:bg-white/10 disabled:opacity-25 disabled:hover:bg-transparent transition"
                          title="Chuyển tập lên"
                        >
                          <ArrowUp className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleMoveVolume(volumeIndex, 1)}
                          disabled={volumeIndex === story.volumes.length - 1}
                          className="p-1 rounded-lg text-gray-500 hover:text-white hover:bg-white/10 disabled:opacity-25 disabled:hover:bg-transparent transition"
                          title="Chuyển tập xuống"
                        >
                          <ArrowDown className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRenameVolume(volume)}
                          className="p-1 rounded-lg text-gray-500 hover:text-cyan-400 hover:bg-cyan-500/10 transition"
                          title="Đổi tên tập"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteVolume(volume)}
                          className="p-1 rounded-lg text-gray-500 hover:text-rose-400 hover:bg-rose-500/10 transition"
                          title="Xóa tập (giữ lại các chương)"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {/* Chapters list inside volume */}
                <div className="divide-y divide-white/5">
                  {volume.chapters && volume.chapters.length > 0 ? (
                    volume.chapters.map((ch: any) => renderChapterRow(ch))
                  ) : (
                    <div className="p-4 text-xs text-gray-500 italic text-center">
                      Tập này chưa có chương nào được đăng tải.
                    </div>
                  )}
                </div>
              </div>
            ))
          ) : (
            !(story.unassigned_chapters && story.unassigned_chapters.length > 0) && (
              <div className="p-8 text-center glass-panel rounded-2xl text-xs text-gray-400">
                Truyện chưa được phân tập hoặc chưa có chương nào.
              </div>
            )
          )}

          {/* Chapters that belong to no volume */}
          {story.unassigned_chapters && story.unassigned_chapters.length > 0 && (
            <div className="rounded-2xl glass-panel border border-white/10 overflow-hidden">
              <div className="p-4 bg-white/5 border-b border-white/5 flex items-center justify-between">
                <h4 className="font-bold text-sm text-white">Chưa phân tập</h4>
                <span className="text-xs text-gray-400">{story.unassigned_chapters.length} chương</span>
              </div>
              <div className="divide-y divide-white/5">
                {story.unassigned_chapters.map((ch: any) => renderChapterRow(ch))}
              </div>
            </div>
          )}
        </section>

        {/* Related stories: people who read this also read / usually read next (trained model) */}
        <RecommendationRail
          key={story.id}
          title="Truyện liên quan"
          subtitle="Người đọc truyện này cũng hay đọc, sắp theo gu của bạn"
          endpoint={`/related/${story.id}`}
          source="related"
        />

        {/* Albums holding this story: mine, then other users' public albums */}
        <StoryAlbumsSection
          storyId={story.id}
          refreshKey={albumsChanged}
          onOpenSave={() => setIsAlbumOpen(true)}
        />

        {/* 3. Story Comments Section */}
        <CommentSection
          targetType="story"
          targetId={story.id}
          title={`Thảo luận về "${story.title}"`}
        />

      </div>

      <div className="h-20 lg:hidden" aria-hidden />

      {/* Floating Instant Toast Notification */}
      {toastMsg && (
        <div className="fixed bottom-[calc(var(--bottom-nav-h,0px)+env(safe-area-inset-bottom)+5.5rem)] right-4 lg:bottom-6 lg:right-6 z-50 flex items-center gap-2.5 px-4 py-3 rounded-2xl bg-zinc-900/95 border border-white/20 text-white shadow-2xl backdrop-blur-md animate-in fade-in slide-in-from-bottom-5">
          <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
          <span className="text-xs font-semibold">{toastMsg}</span>
        </div>
      )}

      {story && (
        <SaveToAlbumModal
          isOpen={isAlbumOpen}
          onClose={() => setIsAlbumOpen(false)}
          storyId={story.id}
          storyTitle={story.title}
          onChange={(_, message) => {
            showToast(message);
            setAlbumsChanged((n) => n + 1);
          }}
        />
      )}

      {story && (
        <DownloadModal isOpen={isDownloadOpen} onClose={() => setIsDownloadOpen(false)} storySlug={story.slug} story={story} />
      )}
      {/* Mobile sticky action bar (replaces the bottom nav on this page): follow, table of contents, read */}
      {(lastReadChapter || story.first_chapter) && (
        <div className="lg:hidden fixed inset-x-0 bottom-0 z-30 bg-surface border-t border-black/10 dark:border-white/10 pb-[env(safe-area-inset-bottom)]">
          <div className="h-16 px-4 flex items-center gap-2">
            <button
              type="button"
              onClick={handleToggleFollow}
              aria-label={isFollowing ? 'Bỏ theo dõi truyện này' : 'Theo dõi truyện'}
              aria-pressed={isFollowing}
              className="w-11 h-11 shrink-0 flex items-center justify-center rounded-xl text-gray-300 active:scale-95 transition select-none"
            >
              <Heart className={`w-6 h-6 ${isFollowing ? 'fill-rose-500 text-rose-500' : ''}`} />
            </button>
            <button
              type="button"
              onClick={() => document.getElementById('muc-luc')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
              aria-label="Mục lục chương"
              className="w-11 h-11 shrink-0 flex items-center justify-center rounded-xl text-gray-300 active:scale-95 transition select-none"
            >
              <List className="w-6 h-6" />
            </button>
            <Link
              href={
                lastReadChapter
                  ? `/truyen/${story.slug}/${lastReadChapter.slug}${lastReadChapter.hash}`
                  : `/truyen/${story.slug}/${story.first_chapter.slug}`
              }
              className="flex-1 min-w-0 min-h-12 rounded-xl bg-brand-600 active:bg-brand-500 text-snow font-bold text-base flex items-center justify-center gap-2 transition"
            >
              <BookOpen className="w-5 h-5" />
              <span className="whitespace-nowrap">
                {lastReadChapter
                  ? <>Đọc tiếp{lastReadChapter.chapter_number !== undefined && lastReadChapter.chapter_number !== null ? <> · <span className="max-[359px]:hidden">Chương</span><span className="min-[360px]:hidden">Ch.</span> {Number(lastReadChapter.chapter_number)}</> : ''}</>
                  : 'Đọc từ đầu'}
              </span>
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
