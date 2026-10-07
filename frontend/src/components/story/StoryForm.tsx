'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
  BookOpen,
  Send,
  Check,
  Tag as TagIcon,
  Search,
  X,
  AlertCircle,
} from 'lucide-react';
import ImageUploadDropzone from '@/components/common/ImageUploadDropzone';
import { useAuth } from '@/context/AuthContext';
import RichTextEditor from '@/components/common/RichTextEditor';
import { stripHtml } from '@/lib/richText';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api/v1';

interface TagItem {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
}

interface TagCategory {
  category_id: string;
  category_name: string;
  category_label: string;
  tags: TagItem[];
}

const STATUS_OPTIONS = [
  { value: 'ongoing', label: 'Đang tiến hành' },
  { value: 'completed', label: 'Đã hoàn thành' },
  { value: 'hiatus', label: 'Tạm ngưng' },
  { value: 'dropped', label: 'Đã drop' },
];

export interface StoryFormInitialValues {
  id?: string;
  title?: string;
  original_title?: string;
  author_name?: string;
  artist_name?: string;
  synopsis?: string;
  story_type?: 'novel' | 'manga';
  status?: 'ongoing' | 'completed' | 'hiatus' | 'dropped';
  group_id?: string | null;
  original_language?: string;
  cover_image_url?: string | null;
  banner_image_url?: string | null;
  slug?: string;
  tags?: { id: string }[];
}

interface StoryFormProps {
  mode: 'create' | 'edit';
  initialValues?: StoryFormInitialValues;
  preselectedGroupId?: string;
}

export default function StoryForm({ mode, initialValues, preselectedGroupId }: StoryFormProps) {
  const router = useRouter();
  const { authFetch, user, hasRole, refreshProfile } = useAuth();
  const iv = initialValues || {};

  const [title, setTitle] = useState(iv.title || '');
  const [originalTitle, setOriginalTitle] = useState(iv.original_title || '');
  const [authorName, setAuthorName] = useState(iv.author_name || '');
  const [artistName, setArtistName] = useState(iv.artist_name || '');
  const [synopsis, setSynopsis] = useState(iv.synopsis || '');
  const [storyType, setStoryType] = useState<'novel' | 'manga'>(iv.story_type || 'novel');
  const [status, setStatus] = useState<'ongoing' | 'completed' | 'hiatus' | 'dropped'>(iv.status || 'ongoing');
  const [selectedGroupId, setSelectedGroupId] = useState(iv.group_id || preselectedGroupId || '');
  const [originalLanguage, setOriginalLanguage] = useState(iv.original_language || 'ja');

  const [groups, setGroups] = useState<any[]>([]);
  const [tagCategories, setTagCategories] = useState<TagCategory[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>((iv.tags || []).map((t) => t.id));
  const [activeCategoryTab, setActiveCategoryTab] = useState<string>('all');
  const [tagSearch, setTagSearch] = useState('');
  const [coverImages, setCoverImages] = useState<string[]>(iv.cover_image_url ? [iv.cover_image_url] : []);
  const [bannerImages, setBannerImages] = useState<string[]>(iv.banner_image_url ? [iv.banner_image_url] : []);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    async function fetchData() {
      try {
        const [groupRes, tagRes] = await Promise.all([
          fetch(`${API_BASE_URL}/groups`),
          fetch(`${API_BASE_URL}/tags`),
        ]);
        if (groupRes.ok) {
          const json = await groupRes.json();
          if (json.success) setGroups(json.data || []);
        }
        if (tagRes.ok) {
          const json = await tagRes.json();
          if (json.success && Array.isArray(json.data)) {
            setTagCategories(json.data);
          }
        }
      } catch (e) {
        console.error('Lỗi khi tải dữ liệu nhóm/tag:', e);
      }
    }
    fetchData();
  }, []);

  // Only groups the user belongs to (the server enforces the same rule); admin/mod may pick any.
  // The story's current group stays selectable when editing.
  const selectableGroups = useMemo(() => {
    if (hasRole('mod')) return groups;
    return groups.filter((g: any) =>
      g.id === iv.group_id ||
      (Array.isArray(g.members) && g.members.some((m: any) => m.user_id === user?.id))
    );
  }, [groups, user?.id, iv.group_id]);

  // Group stories need the group's leader/vice leader ("mod") unless the poster is one (or site staff)
  const needsGroupReview = useMemo(() => {
    if (!selectedGroupId || hasRole('admin', 'mod')) return false;
    const g = groups.find((x: any) => x.id === selectedGroupId);
    const me = Array.isArray(g?.members) ? g.members.find((m: any) => m.user_id === user?.id) : null;
    return !['leader', 'mod'].includes(me?.role);
  }, [groups, selectedGroupId, user?.id]);

  const allTags = useMemo(() => {
    const list: TagItem[] = [];
    const seen = new Set<string>();
    tagCategories.forEach((cat) => {
      if (Array.isArray(cat.tags)) {
        cat.tags.forEach((t) => {
          if (!seen.has(t.id)) {
            seen.add(t.id);
            list.push(t);
          }
        });
      }
    });
    return list;
  }, [tagCategories]);

  const displayedCategories = useMemo(() => {
    const query = tagSearch.trim().toLowerCase();

    return tagCategories
      .filter((cat) => activeCategoryTab === 'all' || cat.category_name === activeCategoryTab)
      .map((cat) => {
        const filteredTags = (cat.tags || []).filter((t) => {
          if (!query) return true;
          return (
            t.name.toLowerCase().includes(query) ||
            t.slug.toLowerCase().includes(query) ||
            (t.description && t.description.toLowerCase().includes(query))
          );
        });
        return { ...cat, tags: filteredTags };
      })
      .filter((cat) => cat.tags.length > 0);
  }, [tagCategories, activeCategoryTab, tagSearch]);

  const handleTagToggle = (tagId: string) => {
    if (selectedTags.includes(tagId)) {
      setSelectedTags(selectedTags.filter((id) => id !== tagId));
    } else {
      setSelectedTags([...selectedTags, tagId]);
    }
  };

  const handleClearSelectedTags = () => setSelectedTags([]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || isSubmitting) return;

    if (selectedTags.length === 0) {
      setErrorMsg('Vui lòng chọn ít nhất một thể loại hoặc thẻ tag cho tác phẩm.');
      return;
    }

    setIsSubmitting(true);
    setErrorMsg(null);
    try {
      const payload = {
        title: title.trim(),
        original_title: originalTitle.trim() || null,
        author_name: authorName.trim() || null,
        artist_name: artistName.trim() || null,
        synopsis: stripHtml(synopsis) ? synopsis.trim() : null,
        story_type: storyType,
        status,
        group_id: selectedGroupId || null,
        original_language: originalLanguage,
        cover_image_url: coverImages.length > 0 ? coverImages[0] : null,
        banner_image_url: bannerImages.length > 0 ? bannerImages[0] : null,
        tags: selectedTags,
      };

      const res = await authFetch(
        mode === 'edit' ? `${API_BASE_URL}/stories/${iv.id}` : `${API_BASE_URL}/stories`,
        {
          method: mode === 'edit' ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }
      );

      const json = await res.json();
      if (res.ok && json.success) {
        if (mode === 'edit') {
          setFeedback('Cập nhật thông tin truyện thành công!');
          setTimeout(() => {
            router.push(`/truyen/${json.data.slug}`);
          }, 1200);
        } else if (json.data.approval_status === 'pending') {
          // Group story: goes live once the group's leader/vice leader approves it
          setFeedback(json.message || 'Truyện đang chờ Trưởng nhóm hoặc Phó nhóm duyệt.');
          setTimeout(() => {
            router.push(`/truyen/${json.data.slug}`);
          }, 2500);
        } else {
          refreshProfile().catch(() => {}); // the account just became an author/translator
          setFeedback('Đăng bộ truyện thành công! Đang chuyển hướng sang trang đăng chương...');
          setTimeout(() => {
            router.push(`/dang-chuong?story_id=${json.data.id}`);
          }, 1500);
        }
      } else {
        setErrorMsg(json.message || 'Thao tác thất bại.');
      }
    } catch (e: any) {
      setErrorMsg('Lỗi kết nối: ' + e.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-8">
      {feedback && (
        <div className="p-4 rounded-2xl bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 text-xs font-bold flex items-center gap-2 animate-in fade-in">
          <Check className="w-4 h-4 text-emerald-400" />
          <span>{feedback}</span>
        </div>
      )}

      {errorMsg && (
        <div className="p-4 rounded-2xl bg-rose-500/20 border border-rose-500/30 text-rose-300 text-xs font-bold flex items-center gap-2 animate-in fade-in">
          <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="p-6 sm:p-8 rounded-3xl border border-white/10 bg-glass shadow-2xl space-y-6">

        {/* Story Title & Type */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="md:col-span-2 space-y-1.5">
            <label className="text-xs font-bold text-gray-200">Tên Truyện *</label>
            <input
              type="text"
              placeholder="e.g. Vì Đã Trở Thành Kẻ Thù Của Oshi..."
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full h-11 px-4 rounded-xl bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-brand-500 font-semibold transition"
              required
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-bold text-gray-200">Loại Truyện</label>
            <select
              value={storyType}
              onChange={(e) => setStoryType(e.target.value as any)}
              className="w-full h-11 px-3 rounded-xl bg-surface border border-white/10 text-white text-xs focus:outline-none focus:border-brand-500 font-semibold"
            >
              <option value="novel">Light Novel / Web Novel</option>
              <option value="manga">Manga / Truyện Tranh</option>
            </select>
          </div>
        </div>

        {/* Publication Status */}
        <div className="space-y-1.5">
          <label className="text-xs font-bold text-gray-200">Tình Trạng Xuất Bản</label>
          <div className="flex flex-wrap gap-2">
            {STATUS_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setStatus(opt.value as any)}
                className={`px-3.5 py-2 rounded-xl text-xs font-semibold border transition cursor-pointer ${
                  status === opt.value
                    ? 'bg-brand-600 border-brand-500 text-snow shadow-md shadow-brand-500/25'
                    : 'bg-white/5 border-white/10 text-gray-300 hover:bg-white/10 hover:text-white'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Original Title & Group Selection */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-gray-200">Tên Gốc (Tiếng Nhật / Hàn / Trung)</label>
            <input
              type="text"
              placeholder="e.g. オシの敵になったので..."
              value={originalTitle}
              onChange={(e) => setOriginalTitle(e.target.value)}
              className="w-full h-11 px-4 rounded-xl bg-white/5 border border-white/10 text-white text-xs focus:outline-none focus:border-brand-500"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-bold text-gray-200">Nhóm Dịch Quản Lý</label>
            <select
              value={selectedGroupId}
              onChange={(e) => setSelectedGroupId(e.target.value)}
              className="w-full h-11 px-3 rounded-xl bg-surface border border-white/10 text-white text-xs focus:outline-none focus:border-brand-500"
            >
              <option value="">-- Đăng độc lập (Không thuộc nhóm nào) --</option>
              {selectableGroups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-gray-400">
              {selectedGroupId
                ? needsGroupReview
                  ? 'Truyện sẽ hiển thị sau khi Trưởng nhóm hoặc Phó nhóm duyệt.'
                  : 'Bạn là Trưởng/Phó nhóm nên truyện được đăng ngay.'
                : 'Đăng độc lập: truyện hiển thị ngay, không cần duyệt.'}
            </p>
          </div>
        </div>

        {/* Author & Artist & Language */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-gray-200">Tác Giả</label>
            <input
              type="text"
              placeholder="e.g. Nagatsuki Tappei"
              value={authorName}
              onChange={(e) => setAuthorName(e.target.value)}
              className="w-full h-10 px-3 rounded-xl bg-white/5 border border-white/10 text-white text-xs focus:outline-none focus:border-brand-500"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-bold text-gray-200">Họa Sĩ (Artist)</label>
            <input
              type="text"
              placeholder="e.g. Otsuka Shinichirou"
              value={artistName}
              onChange={(e) => setArtistName(e.target.value)}
              className="w-full h-10 px-3 rounded-xl bg-white/5 border border-white/10 text-white text-xs focus:outline-none focus:border-brand-500"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-bold text-gray-200">Ngôn Ngữ Gốc</label>
            <select
              value={originalLanguage}
              onChange={(e) => setOriginalLanguage(e.target.value)}
              className="w-full h-10 px-3 rounded-xl bg-surface border border-white/10 text-white text-xs focus:outline-none focus:border-brand-500"
            >
              <option value="ja">Tiếng Nhật (Japanese)</option>
              <option value="ko">Tiếng Hàn (Korean)</option>
              <option value="zh">Tiếng Trung (Chinese)</option>
              <option value="en">Tiếng Anh (English)</option>
              <option value="vi">Tiếng Việt (Sáng tác)</option>
            </select>
          </div>
        </div>

        {/* Synopsis */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="text-xs font-bold text-gray-200">Tóm Tắt Cốt Truyện</label>
            <span className="text-[10px] text-gray-500">{stripHtml(synopsis).length} ký tự</span>
          </div>
          <RichTextEditor
            value={synopsis}
            onChange={setSynopsis}
            placeholder="Nhập tóm tắt nội dung tác phẩm để thu hút độc giả..."
            minHeight={140}
          />
        </div>

        {/* Cover & Banner Image Dropzones */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <ImageUploadDropzone
            images={coverImages}
            onChange={setCoverImages}
            maxFiles={1}
            label="Ảnh bìa tác phẩm (Poster Cover)"
          />
          <ImageUploadDropzone
            images={bannerImages}
            onChange={setBannerImages}
            maxFiles={1}
            label="Ảnh banner đầu trang (tùy chọn)"
          />
        </div>

        {/* Tag Selection Section */}
        <div className="space-y-3 pt-2">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="text-xs font-bold text-gray-200 flex items-center gap-2">
              <TagIcon className="w-4 h-4 text-brand-400" />
              <span>Chọn Thể Loại / Thẻ Tag</span>
              <span className="text-rose-400">*</span>
              <span className="px-2 py-0.5 rounded-full bg-brand-500/20 text-brand-300 text-[10px] font-semibold">
                {selectedTags.length} đã chọn
              </span>
            </div>

            {selectedTags.length > 0 && (
              <button
                type="button"
                onClick={handleClearSelectedTags}
                className="text-[11px] text-gray-400 hover:text-rose-400 font-medium transition cursor-pointer self-start sm:self-auto"
              >
                Bỏ chọn tất cả
              </button>
            )}
          </div>

          {selectedTags.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 p-3 rounded-2xl bg-surface border border-brand-500/20">
              <span className="text-[11px] text-gray-400 font-medium mr-1">Đã chọn:</span>
              {selectedTags.map((tagId) => {
                const tagObj = allTags.find((t) => t.id === tagId);
                if (!tagObj) return null;
                return (
                  <span
                    key={tagId}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-brand-600 text-snow text-xs font-medium shadow-sm transition hover:bg-brand-700"
                  >
                    <span>{tagObj.name}</span>
                    <button
                      type="button"
                      onClick={() => handleTagToggle(tagId)}
                      className="p-0.5 rounded-full hover:bg-white/20 transition cursor-pointer"
                      title="Bỏ chọn"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                );
              })}
            </div>
          )}

          <div className="space-y-2.5 p-4 rounded-2xl bg-surface border border-white/10">
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5">
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setActiveCategoryTab('all')}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition cursor-pointer ${
                    activeCategoryTab === 'all'
                      ? 'bg-brand-600 text-snow shadow-md shadow-brand-500/25'
                      : 'bg-white/5 text-gray-300 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  Tất cả ({allTags.length})
                </button>
                {tagCategories.map((cat) => (
                  <button
                    key={cat.category_id}
                    type="button"
                    onClick={() => setActiveCategoryTab(cat.category_name)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition cursor-pointer ${
                      activeCategoryTab === cat.category_name
                        ? 'bg-brand-600 text-snow shadow-md shadow-brand-500/25'
                        : 'bg-white/5 text-gray-300 hover:bg-white/10 hover:text-white'
                    }`}
                  >
                    {cat.category_label} ({cat.tags?.length || 0})
                  </button>
                ))}
              </div>

              <div className="relative sm:w-56 shrink-0">
                <input
                  type="text"
                  placeholder="Tìm thể loại..."
                  value={tagSearch}
                  onChange={(e) => setTagSearch(e.target.value)}
                  className="w-full h-8 pl-8 pr-7 rounded-xl bg-white/5 border border-white/10 text-xs text-white placeholder-gray-400 focus:outline-none focus:border-brand-500 transition"
                />
                <Search className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                {tagSearch && (
                  <button
                    type="button"
                    onClick={() => setTagSearch('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>

            <div className="max-h-64 overflow-y-auto space-y-4 pt-2 pr-1 divide-y divide-white/5">
              {displayedCategories.length === 0 ? (
                <div className="py-6 text-center text-gray-400 text-xs">
                  Không tìm thấy thể loại nào phù hợp với từ khóa &ldquo;{tagSearch}&rdquo;
                </div>
              ) : (
                displayedCategories.map((cat) => (
                  <div key={cat.category_id} className="pt-3 first:pt-0 space-y-2">
                    {activeCategoryTab === 'all' && (
                      <div className="text-[11px] font-bold text-brand-300 uppercase tracking-wider">
                        {cat.category_label}
                      </div>
                    )}
                    <div className="flex flex-wrap gap-1.5">
                      {cat.tags.map((tag) => {
                        const isSelected = selectedTags.includes(tag.id);
                        return (
                          <button
                            key={tag.id}
                            type="button"
                            onClick={() => handleTagToggle(tag.id)}
                            title={tag.description || tag.name}
                            className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition cursor-pointer flex items-center gap-1.5 select-none ${
                              isSelected
                                ? 'bg-brand-600 border-brand-500 text-snow shadow-md shadow-brand-500/25 font-semibold'
                                : 'bg-white/5 border-white/10 text-gray-300 hover:bg-white/10 hover:border-white/20 hover:text-white'
                            }`}
                          >
                            {isSelected && <Check className="w-3.5 h-3.5 text-white" />}
                            <span>{tag.name}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="pt-4 border-t border-white/10 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-[11px] text-gray-400">
            {mode === 'edit'
              ? '* Các thay đổi sẽ được áp dụng ngay sau khi lưu.'
              : '* Sau khi tạo truyện, bạn sẽ được chuyển thẳng đến Trình Soạn Thảo Đăng Chương'}
          </p>

          <button
            type="submit"
            disabled={!title.trim() || isSubmitting}
            className="px-8 py-3 rounded-2xl bg-gradient-to-r from-brand-600 to-indigo-600 hover:from-brand-500 hover:to-indigo-500 disabled:opacity-40 text-snow font-bold text-xs shadow-xl shadow-brand-500/25 flex items-center gap-2 transition hover:scale-105 cursor-pointer"
          >
            <Send className="w-4 h-4" />
            <span>
              {isSubmitting
                ? 'Đang lưu...'
                : mode === 'edit'
                ? 'Lưu Thay Đổi'
                : 'Tạo Bộ Truyện & Sang Đăng Chương'}
            </span>
          </button>
        </div>

      </form>
    </div>
  );
}
