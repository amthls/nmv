'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { 
  BookOpen, 
  Star, 
  Eye, 
  Heart, 
  User, 
  ShieldCheck, 
  Layers, 
  ChevronRight, 
  MessageSquare,
  Sparkles,
  AlertCircle,
  Trash2,
  PlusCircle,
  Shield,
  Clock,
  CheckCircle2,
  Pencil,
  ArrowUp,
  ArrowDown,
  Download
} from 'lucide-react';
import SmartImage from '@/components/common/SmartImage';
import CommentSection from '@/components/comments/CommentSection';
import ReportButton from '@/components/common/ReportButton';
import DownloadModal from '@/components/story/DownloadModal';
import { useAuth } from '@/context/AuthContext';
import RichContent from '@/components/common/RichContent';
import { stripHtml } from '@/lib/richText';
import { getGuestHistory } from '@/lib/readingHistory';
import { chapterUploadHref } from '@/lib/chapterUpload';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api/v1';

export default function StoryDetailPage() {
  const params = useParams();
  const router = useRouter();
  const slug = params?.slug as string;
  const { user, hasRole, authFetch, isAuthenticated, openAuthModal } = useAuth();

  const [story, setStory] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isFollowing, setIsFollowing] = useState(false);
  const [isRatingOpen, setIsRatingOpen] = useState(false);
  const [isDownloadOpen, setIsDownloadOpen] = useState(false);
  const [selectedRating, setSelectedRating] = useState(10);
  const [isDeleting, setIsDeleting] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [lastReadChapter, setLastReadChapter] = useState<{ slug: string; title?: string; chapter_number?: number } | null>(null);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 2800);
  };

  const fetchStory = async () => {
    if (!slug) return;
    setIsLoading(true);
    try {
      const fetcher = isAuthenticated ? authFetch : fetch;
      const res = await fetcher(`${API_BASE_URL}/stories/${slug}`, { credentials: 'include' });
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
  }, [slug, isAuthenticated]);

  useEffect(() => {
    if (!slug) return;
    const checkHistory = async () => {
      let found: any = null;
      if (!isAuthenticated) {
        found = getGuestHistory().find((h: any) => h.story_slug === slug || (story?.id && h.story_id === story.id));
      } else {
        try {
          const res = await authFetch(`${API_BASE_URL}/history`);
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
        });
      } else {
        setLastReadChapter(null); // e.g. after logout, don't keep the previous account's position
      }
    };
    checkHistory();
  }, [slug, story?.id, isAuthenticated, authFetch]);

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
        total_favorites: Math.max(0, (prev.total_favorites || 0) + (following ? 1 : -1))
      } : prev);
    };
    applyStatus(nextStatus);

    try {
      const res = await authFetch(`${API_BASE_URL}/favorites/toggle`, {
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
      showToast(removed ? 'Đã hủy theo dõi truyện.' : 'Đã thêm truyện vào Tủ sách đã lưu!');
    } catch (err) {
      console.error('Failed to update follow state:', err);
      applyStatus(!nextStatus);
      showToast('Không thể cập nhật theo dõi. Vui lòng thử lại.');
    }
  };

  // Check if current user is owner ("chủ thầu"), collaborator, translation-group
  // member, or Admin/Mod. Resolved server-side (story.can_manage) so group
  // members see the same management controls the backend actually authorizes;
  // the local check below is only a fallback for stale/unauthenticated data.
  const isOwner = Boolean(
    user && story && (
      user.id === story.uploader_id ||
      (story.collaborators && story.collaborators.some((c: any) => c.user_id === user.id))
    )
  );
  const canManage = story?.can_manage ?? (hasRole('admin', 'mod') || isOwner);
  const [isReviewing, setIsReviewing] = useState(false);

  // Group story waiting for the group's leader/vice leader
  const handleReviewStory = async (approve: boolean) => {
    if (!story || isReviewing) return;
    let reason: string | null = null;
    if (!approve) {
      reason = prompt('Lý do từ chối (không bắt buộc):');
      if (reason === null) return;
    }
    setIsReviewing(true);
    try {
      const res = await authFetch(`${API_BASE_URL}/stories/${story.id}/${approve ? 'approve' : 'reject'}`, {
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
      setIsReviewing(false);
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
        router.push('/kham-pha');
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
        className="p-3.5 flex items-center justify-between hover:bg-white/5 transition group px-5"
      >
        <Link
          href={`/truyen/${story.slug}/${ch.slug}`}
          className="flex items-center gap-3 truncate flex-1"
        >
          <BookOpen className="w-4 h-4 text-gray-500 group-hover:text-brand-400 transition-colors shrink-0" />
          <span className="text-xs font-semibold text-gray-200 group-hover:text-brand-400 transition-colors truncate">
            {ch.title}
          </span>
        </Link>

        <div className="flex items-center gap-4 text-[11px] text-gray-400 shrink-0 ml-3">
          {ch.word_count > 0 && (
            <span className="hidden sm:inline">{ch.word_count.toLocaleString()} chữ</span>
          )}
          <span className="flex items-center gap-1">
            <Eye className="w-3 h-3 text-cyan-400" />
            {typeof ch.total_views === 'number' ? ch.total_views.toLocaleString() : ch.total_views || 0}
          </span>
          
          <Link
            href={`/truyen/${story.slug}/${ch.slug}`}
            className="text-brand-400 font-medium group-hover:translate-x-1 transition-transform"
          >
            Đọc ngay
          </Link>

          {/* Edit / Delete Chapter for Owner / Admin / Mod */}
          {canManage && (
            <Link
              href={`/dang-chuong?edit=${ch.id}`}
              onClick={(e) => e.stopPropagation()}
              className="p-1 rounded-lg text-gray-500 hover:text-cyan-400 hover:bg-cyan-500/10 transition"
              title="Sửa chương này"
            >
              <Pencil className="w-3.5 h-3.5" />
            </Link>
          )}
          {canManage && (
            <button
              type="button"
              onClick={(e) => handleDeleteChapter(ch.id, ch.title, e)}
              className="p-1 rounded-lg text-gray-500 hover:text-rose-400 hover:bg-rose-500/10 transition"
              title="Xóa chương này"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
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

  const handleRate = async () => {
    if (!isAuthenticated) {
      openAuthModal('login');
      return;
    }
    try {
      const res = await authFetch(`${API_BASE_URL}/stories/${slug}/rate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating: selectedRating }),
      });
      if (res.ok) {
        setIsRatingOpen(false);
        fetchStory();
      }
    } catch (e) {
      console.error(e);
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
        <AlertCircle className="w-12 h-12 text-brand-400 mx-auto" />
        <h2 className="text-xl font-bold text-white">Không tìm thấy bộ truyện này</h2>
        <Link href="/kham-pha" className="inline-block px-4 py-2 rounded-xl bg-brand-600 text-snow text-xs font-semibold">
          Quay lại trang Khám Phá
        </Link>
      </div>
    );
  }

  const isNovel = story.story_type === 'novel';
  const ratingAvg = typeof story.rating_avg === 'number' ? story.rating_avg.toFixed(1) : parseFloat(story.rating_avg || '0').toFixed(1);

  return (
    <div className="min-h-screen pb-20">
      
      {/* 1. Hero header: story art in a card aligned with the content below, like the home banner */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pt-6">
      <div className="relative isolate overflow-hidden rounded-xl border border-white/10 bg-surface-3 shadow-[0_24px_60px_-28px_rgba(0,0,0,0.8)]">
        <div className="pointer-events-none absolute inset-0 -z-10">
          <SmartImage
            src={story.banner_image_url || story.cover_image_url}
            alt=""
            aria-hidden
            className="w-full h-full object-cover object-[50%_25%]"
          />
          {/* dark wash only behind the text */}
          <div className="absolute inset-0 bg-[linear-gradient(68deg,rgba(0,0,0,0.72)_30%,rgba(0,0,0,0.15)_100%)]" />
          {/* thin top highlight, like the glass panels */}
          <div className="absolute inset-0 rounded-xl shadow-[inset_0_1px_0_0_rgba(255,255,255,0.12)]" />
        </div>

        {/* header content always uses the dark palette: white text on the darkened art */}
        <div className="dark relative px-5 sm:px-8 lg:px-10 pt-6 pb-8 md:pt-8 md:pb-10 [text-shadow:0_1px_8px_rgba(0,0,0,0.45)]">
          
          {/* Breadcrumbs */}
          <div className="flex items-center gap-2 text-xs text-gray-400 mb-6">
            <Link href="/" className="hover:text-white transition">Trang chủ</Link>
            <ChevronRight className="w-3.5 h-3.5 text-gray-600" />
            <Link href="/kham-pha" className="hover:text-white transition">Khám phá</Link>
            <ChevronRight className="w-3.5 h-3.5 text-gray-600" />
            <span className="text-gray-200 font-medium truncate max-w-xs">{story.title}</span>
          </div>

          {story.approval_status && story.approval_status !== 'approved' && (
            <div className={`mb-6 p-4 rounded-2xl border text-xs flex flex-col sm:flex-row sm:items-center gap-3 [text-shadow:none] ${
              story.approval_status === 'rejected'
                ? 'bg-rose-500/20 border-rose-500/30 text-rose-200'
                : 'bg-amber-500/20 border-amber-500/30 text-amber-100'
            }`}>
              <div className="flex-1">
                {story.approval_status === 'rejected' ? (
                  <>
                    <b>Truyện không được nhóm duyệt.</b>
                    {story.rejection_reason && <> Lý do: {story.rejection_reason}.</>} Bạn có thể sửa thông tin truyện để gửi duyệt lại.
                  </>
                ) : (
                  <>
                    <b>Truyện đang chờ duyệt.</b> Chỉ hiển thị công khai sau khi Trưởng nhóm hoặc Phó nhóm{' '}
                    {story.group_name ? <>của <b>{story.group_name}</b> </> : ''}duyệt.
                  </>
                )}
              </div>
              {story.can_review && story.approval_status === 'pending' && (
                <div className="flex gap-2 shrink-0">
                  <button
                    onClick={() => handleReviewStory(true)}
                    disabled={isReviewing}
                    className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold disabled:opacity-50"
                  >
                    Duyệt
                  </button>
                  <button
                    onClick={() => handleReviewStory(false)}
                    disabled={isReviewing}
                    className="px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-bold disabled:opacity-50"
                  >
                    Từ chối
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Main Story Hero Grid */}
          <div className="flex flex-col md:flex-row gap-8 items-start">
            
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
            <div className="flex-1 space-y-4 text-center md:text-left">
              
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

                {canManage && (
                  <div className="px-2.5 py-1 rounded-full bg-amber-500/20 border border-amber-500/40 text-[11px] font-bold text-amber-300 flex items-center gap-1">
                    <Shield className="w-3 h-3" /> Chủ thầu / Quản lý
                  </div>
                )}
              </div>

              {/* Stats Bar (Views, Rating, Favorites, Chapters) */}
              <div className="grid grid-cols-4 gap-2 p-3 rounded-2xl bg-white/5 border border-white/10 max-w-lg mx-auto md:mx-0 text-center">
                <div className="space-y-0.5">
                  <div className="flex items-center justify-center gap-1 text-amber-300 font-extrabold text-sm">
                    <Star className="w-4 h-4 fill-amber-300" />
                    <span>{ratingAvg}</span>
                  </div>
                  <div className="text-[10px] text-gray-400">{story.rating_count || 0} đánh giá</div>
                </div>

                <div className="space-y-0.5 border-l border-white/10">
                  <div className="flex items-center justify-center gap-1 text-cyan-300 font-extrabold text-sm">
                    <Eye className="w-4 h-4" />
                    <span>{typeof story.total_views === 'number' ? story.total_views.toLocaleString() : story.total_views}</span>
                  </div>
                  <div className="text-[10px] text-gray-400">Lượt xem</div>
                </div>

                <div className="space-y-0.5 border-l border-white/10">
                  <div className="flex items-center justify-center gap-1 text-rose-300 font-extrabold text-sm">
                    <Heart className="w-4 h-4 text-rose-400 fill-rose-400" />
                    <span>{typeof story.total_favorites === 'number' ? story.total_favorites.toLocaleString() : story.total_favorites}</span>
                  </div>
                  <div className="text-[10px] text-gray-400">Yêu thích</div>
                </div>

                <div className="space-y-0.5 border-l border-white/10">
                  <div className="flex items-center justify-center gap-1 text-brand-300 font-extrabold text-sm">
                    <BookOpen className="w-4 h-4" />
                    <span>{story.total_chapters || 0}</span>
                  </div>
                  <div className="text-[10px] text-gray-400">Chương</div>
                </div>
              </div>

              {/* Tag Badges */}
              {story.tags && story.tags.length > 0 && (
                <div className="flex flex-wrap items-center justify-center md:justify-start gap-1.5 pt-1">
                  {story.tags.map((tag: any) => (
                    <Link
                      key={tag.id}
                      href={`/kham-pha?tags=${tag.slug}`}
                      className="px-2.5 py-1 rounded-lg text-xs font-medium bg-white/5 hover:bg-brand-600/30 text-gray-300 hover:text-brand-300 border border-white/10 transition"
                    >
                      {tag.name}
                    </Link>
                  ))}
                </div>
              )}

              {/* Actions: 1) reading  2) reader tools  3) management (team only) */}
              <div className="pt-3 space-y-3">
                {/* 1. Reading */}
                <div className="flex flex-wrap items-center justify-center md:justify-start gap-2.5">
                  {lastReadChapter ? (
                    <Link
                      href={`/truyen/${story.slug}/${lastReadChapter.slug}`}
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
                          ? 'px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 text-white font-semibold text-sm border border-white/10 flex items-center gap-2 transition'
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
                      className="px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 text-white font-semibold text-sm border border-white/10 transition"
                    >
                      Chương mới nhất
                    </Link>
                  ) : null}
                </div>

                {/* 2. Reader tools, one compact toolbar */}
                <div className="flex justify-center md:justify-start">
                  <div className="inline-flex items-stretch rounded-xl bg-black/30 border border-white/10 backdrop-blur-sm divide-x divide-white/10 overflow-hidden text-xs font-semibold">
                    <button
                      type="button"
                      onClick={handleToggleFollow}
                      className={`px-3.5 py-2 flex items-center gap-1.5 transition select-none active:scale-95 ${
                        isFollowing ? 'text-rose-300 bg-rose-600/20 hover:bg-rose-600/30' : 'text-gray-300 hover:text-white hover:bg-white/10'
                      }`}
                      title={isFollowing ? 'Bỏ theo dõi truyện này' : 'Theo dõi truyện để nhận thông báo'}
                    >
                      <Heart className={`w-3.5 h-3.5 ${isFollowing ? 'fill-rose-500 text-rose-500' : ''}`} />
                      <span>{isFollowing ? 'Đang theo dõi' : 'Theo dõi'}</span>
                    </button>

                    {story.allow_download && (story.total_chapters || story.first_chapter) ? (
                      <button
                        type="button"
                        onClick={() => setIsDownloadOpen(true)}
                        className="px-3.5 py-2 flex items-center gap-1.5 text-gray-300 hover:text-white hover:bg-white/10 transition"
                        title="Tải truyện dạng EPUB hoặc PDF"
                      >
                        <Download className="w-3.5 h-3.5 text-brand-400" />
                        <span>Tải xuống</span>
                      </button>
                    ) : null}

                    <button
                      type="button"
                      onClick={() => setIsRatingOpen(true)}
                      className="px-3.5 py-2 flex items-center gap-1.5 text-gray-300 hover:text-white hover:bg-white/10 transition"
                      title="Đánh giá truyện"
                    >
                      <Star className="w-3.5 h-3.5 text-amber-400" />
                      <span>Đánh giá</span>
                    </button>

                    <ReportButton
                      targetType="story"
                      targetId={story.id}
                      className="px-3.5 py-2 flex items-center gap-1.5 text-gray-400 hover:text-amber-400 hover:bg-white/10 transition"
                    />
                  </div>
                </div>

                {/* 3. Management, only for the story's team / Admin / Mod */}
                {canManage && (
                  <div className="flex flex-wrap items-center justify-center md:justify-start gap-2 pt-3 border-t border-white/10">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500 mr-1">Quản lý</span>
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
                    <button
                      onClick={handleDeleteStory}
                      disabled={isDeleting}
                      className="px-3 py-1.5 rounded-lg bg-rose-600/15 hover:bg-rose-600/25 text-rose-300 border border-rose-500/30 text-xs font-bold flex items-center gap-1.5 transition"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>{isDeleting ? 'Đang xóa...' : 'Xóa truyện'}</span>
                    </button>
                  </div>
                )}
              </div>

            </div>

          </div>

        </div>
      </div>
      </div>

      {/* 2. Main Content Body: Synopsis, Chapter Tree & Comments */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-10">
        
        {/* Synopsis / Summary */}
        <section className="p-6 rounded-3xl glass-panel border border-white/10 space-y-3">
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
        <section className="space-y-6">
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

        {/* 3. Story Comments Section */}
        <CommentSection
          targetType="story"
          targetId={story.id}
          title={`Thảo luận về "${story.title}"`}
        />

      </div>

      {/* 4. Rating Modal */}
      {isRatingOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in">
          <div className="w-full max-w-sm bg-glass border border-white/10 rounded-2xl p-6 shadow-2xl space-y-4">
            <h3 className="text-base font-bold text-white text-center">Đánh Giá Bộ Truyện</h3>
            <p className="text-xs text-gray-400 text-center">Chọn số điểm từ 1 đến 10 cho bộ truyện này</p>

            <div className="flex items-center justify-center gap-1.5 py-4">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((star) => (
                <button
                  key={star}
                  onClick={() => setSelectedRating(star)}
                  className={`p-1 transition-transform hover:scale-125 ${
                    selectedRating >= star ? 'text-amber-400' : 'text-gray-600'
                  }`}
                >
                  <Star className={`w-5 h-5 ${selectedRating >= star ? 'fill-amber-400' : ''}`} />
                </button>
              ))}
            </div>
            <div className="text-center font-bold text-lg text-amber-400">{selectedRating} / 10 Điểm</div>

            <div className="flex items-center gap-2 pt-2">
              <button
                onClick={() => setIsRatingOpen(false)}
                className="flex-1 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-gray-400 text-xs font-semibold transition"
              >
                Hủy
              </button>
              <button
                onClick={handleRate}
                className="flex-1 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-snow text-xs font-semibold shadow-md transition"
              >
                Gửi Đánh Giá
              </button>
            </div>
          </div>
        </div>
      )}

    
      {/* Floating Instant Toast Notification */}
      {toastMsg && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2.5 px-4 py-3 rounded-2xl bg-zinc-900/95 border border-white/20 text-white shadow-2xl backdrop-blur-md animate-in fade-in slide-in-from-bottom-5">
          <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
          <span className="text-xs font-semibold">{toastMsg}</span>
        </div>
      )}

      {story && (
        <DownloadModal isOpen={isDownloadOpen} onClose={() => setIsDownloadOpen(false)} storySlug={story.slug} story={story} />
      )}
    </div>
  );
}
