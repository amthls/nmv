'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { 
  Search, 
  LayoutGrid, 
  List as ListIcon, 
  ArrowUpDown, 
  Filter, 
  Sparkles, 
  X,
  Compass,
  AlertCircle
} from 'lucide-react';
import FilterSidebar, { FilterState, TagCategoryItem } from '@/components/explore/FilterSidebar';
import StoryCardGrid, { Story } from '@/components/explore/StoryCardGrid';
import StoryCardList from '@/components/explore/StoryCardList';
import Pagination from '@/components/explore/Pagination';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api/v1';

export default function ExplorePage() {
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [isMobileFilterOpen, setIsMobileFilterOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('relevance');
  const [currentPage, setCurrentPage] = useState(1);

  const [categories, setCategories] = useState<TagCategoryItem[]>([]);
  const [stories, setStories] = useState<Story[]>([]);
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 24,
    total: 0,
    totalPages: 1,
  });

  const [isLoading, setIsLoading] = useState(true);

  const [filters, setFilters] = useState<FilterState>({
    type: 'all',
    status: 'all',
    language: 'all',
    min_chapters: '0',
    tags: [],
    exclude_tags: [],
  });

  // 1. Fetch categories & tags
  useEffect(() => {
    async function fetchTags() {
      try {
        const res = await fetch(`${API_BASE_URL}/tags`);
        if (res.ok) {
          const json = await res.json();
          if (json.success) {
            setCategories(json.data);
          }
        }
      } catch (err) {
        console.error('Failed to fetch tags:', err);
      }
    }
    fetchTags();
  }, []);

  // 2. Fetch stories with query params
  const fetchStories = useCallback(async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams();
      if (searchQuery.trim()) params.append('q', searchQuery.trim());
      if (filters.type !== 'all') params.append('type', filters.type);
      if (filters.status !== 'all') params.append('status', filters.status);
      if (filters.language !== 'all') params.append('language', filters.language);
      if (parseInt(filters.min_chapters) > 0) params.append('min_chapters', filters.min_chapters);
      if (filters.tags.length > 0) params.append('tags', filters.tags.join(','));
      if (filters.exclude_tags.length > 0) params.append('exclude_tags', filters.exclude_tags.join(','));
      params.append('sort', sortBy);
      params.append('page', currentPage.toString());
      params.append('limit', '24');

      const res = await fetch(`${API_BASE_URL}/stories/explore?${params.toString()}`);
      if (res.ok) {
        const json = await res.json();
        if (json.success) {
          setStories(json.data || []);
          setPagination(json.pagination || { page: 1, limit: 24, total: 0, totalPages: 1 });
        }
      }
    } catch (err) {
      console.error('Failed to fetch stories:', err);
    } finally {
      setIsLoading(false);
    }
  }, [searchQuery, filters, sortBy, currentPage]);

  useEffect(() => {
    fetchStories();
  }, [fetchStories]);

  const handleFilterChange = (newFilters: FilterState) => {
    setFilters(newFilters);
    setCurrentPage(1);
  };

  const handleResetFilters = () => {
    setFilters({
      type: 'all',
      status: 'all',
      language: 'all',
      min_chapters: '0',
      tags: [],
      exclude_tags: [],
    });
    setSearchQuery('');
    setCurrentPage(1);
  };

  const removeTag = (tagSlug: string) => {
    setFilters(prev => ({
      ...prev,
      tags: prev.tags.filter(t => t !== tagSlug),
      exclude_tags: prev.exclude_tags.filter(t => t !== tagSlug),
    }));
  };

  const activeFiltersCount = 
    (filters.type !== 'all' ? 1 : 0) +
    (filters.status !== 'all' ? 1 : 0) +
    (filters.language !== 'all' ? 1 : 0) +
    (parseInt(filters.min_chapters) > 0 ? 1 : 0) +
    filters.tags.length +
    filters.exclude_tags.length;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-white/10">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-brand-600/20 text-brand-400 border border-brand-500/20">
              <Compass className="w-5 h-5" />
            </div>
            <h1 className="text-2xl font-extrabold text-white tracking-wide">
              Khám Phá & Bộ Lọc Truyện
            </h1>
          </div>
          <p className="text-xs text-gray-400 mt-1">
            Tìm kiếm không giới hạn truyện chữ và truyện tranh theo hàng chục thể loại, chủ đề và trạng thái
          </p>
        </div>

        {/* Search bar on top header */}
        <div className="w-full md:w-80 relative">
          <input
            type="text"
            placeholder="Tìm theo tên truyện, tác giả..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setCurrentPage(1);
            }}
            className="w-full h-10 pl-10 pr-4 rounded-xl bg-white/5 border border-white/10 text-sm text-white placeholder-gray-400 focus:outline-none focus:border-brand-500 transition"
          />
          <Search className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Main Content: Sidebar + Story Grid/List */}
      <div className="flex items-start gap-8">
        
        {/* Left Filter Sidebar */}
        <FilterSidebar
          categories={categories}
          filters={filters}
          onFilterChange={handleFilterChange}
          onReset={handleResetFilters}
          isOpenMobile={isMobileFilterOpen}
          onCloseMobile={() => setIsMobileFilterOpen(false)}
        />

        {/* Right Main Panel */}
        <div className="flex-1 w-full space-y-5">
          
          {/* Controls Bar: Mobile filter button, Sorting, View mode */}
          <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-2xl glass-panel border border-white/10">
            
            {/* Left: Mobile Filter trigger & Count */}
            <div className="flex items-center gap-3">
              <button
                onClick={() => setIsMobileFilterOpen(true)}
                className="lg:hidden flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-xs font-semibold shadow-md transition"
              >
                <Filter className="w-3.5 h-3.5" />
                <span>Bộ lọc {activeFiltersCount > 0 && `(${activeFiltersCount})`}</span>
              </button>

              <span className="text-xs text-gray-400">
                Tìm thấy <strong className="text-white font-bold">{pagination.total}</strong> bộ truyện
              </span>
            </div>

            {/* Right: Sort By & View Mode */}
            <div className="flex items-center gap-3">
              {/* Sort Dropdown */}
              <div className="flex items-center gap-1.5 text-xs text-gray-400">
                <ArrowUpDown className="w-3.5 h-3.5 text-brand-400 hidden sm:inline" />
                <span className="hidden sm:inline">Sắp xếp:</span>
                <select
                  value={sortBy}
                  onChange={(e) => {
                    setSortBy(e.target.value);
                    setCurrentPage(1);
                  }}
                  className="h-8 px-2.5 rounded-lg bg-[#141420] border border-white/10 text-xs text-white focus:outline-none focus:border-brand-500"
                >
                  <option value="relevance">Liên quan / Mới cập nhật</option>
                  <option value="updated">Mới cập nhật</option>
                  <option value="views">Lượt xem nhiều nhất</option>
                  <option value="rating">Đánh giá cao nhất</option>
                  <option value="favorites">Yêu thích nhiều nhất</option>
                  <option value="newest">Mới đăng tải</option>
                  <option value="title_asc">Tên A → Z</option>
                </select>
              </div>

              {/* View Switcher */}
              <div className="flex items-center gap-1 p-1 rounded-lg bg-black/40 border border-white/5">
                <button
                  onClick={() => setViewMode('grid')}
                  className={`p-1.5 rounded-md transition ${
                    viewMode === 'grid'
                      ? 'bg-brand-600 text-white shadow-sm'
                      : 'text-gray-400 hover:text-white'
                  }`}
                  title="Dạng lưới thẻ"
                >
                  <LayoutGrid className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setViewMode('list')}
                  className={`p-1.5 rounded-md transition ${
                    viewMode === 'list'
                      ? 'bg-brand-600 text-white shadow-sm'
                      : 'text-gray-400 hover:text-white'
                  }`}
                  title="Dạng danh sách chi tiết"
                >
                  <ListIcon className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>

          {/* Active Filter Chips */}
          {activeFiltersCount > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              <span className="text-xs text-gray-500 mr-1">Đang lọc:</span>

              {filters.type !== 'all' && (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-brand-600/20 border border-brand-500/30 text-brand-300 text-xs font-medium">
                  {filters.type === 'novel' ? 'Truyện chữ' : 'Truyện tranh'}
                  <button onClick={() => setFilters({ ...filters, type: 'all' })}><X className="w-3 h-3" /></button>
                </span>
              )}

              {filters.status !== 'all' && (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white/5 border border-white/10 text-gray-300 text-xs font-medium">
                  Trạng thái: {filters.status}
                  <button onClick={() => setFilters({ ...filters, status: 'all' })}><X className="w-3 h-3" /></button>
                </span>
              )}

              {filters.tags.map(slug => (
                <span key={slug} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-brand-600/20 border border-brand-500/30 text-brand-300 text-xs font-medium">
                  + {slug}
                  <button onClick={() => removeTag(slug)}><X className="w-3 h-3" /></button>
                </span>
              ))}

              {filters.exclude_tags.map(slug => (
                <span key={slug} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-rose-600/20 border border-rose-500/30 text-rose-300 text-xs font-medium line-through">
                  - {slug}
                  <button onClick={() => removeTag(slug)}><X className="w-3 h-3" /></button>
                </span>
              ))}

              <button
                onClick={handleResetFilters}
                className="text-xs text-gray-400 hover:text-rose-400 underline ml-2 transition"
              >
                Xóa tất cả
              </button>
            </div>
          )}

          {/* Stories Result List/Grid */}
          {isLoading ? (
            <div className={`grid gap-4 ${viewMode === 'grid' ? 'grid-cols-2 sm:grid-cols-3 xl:grid-cols-4' : 'grid-cols-1'}`}>
              {[...Array(8)].map((_, i) => (
                <div key={i} className="rounded-2xl glass-panel border border-white/5 p-4 animate-pulse space-y-3">
                  <div className="aspect-[3/4] bg-white/5 rounded-xl w-full" />
                  <div className="h-4 bg-white/5 rounded w-3/4" />
                  <div className="h-3 bg-white/5 rounded w-1/2" />
                </div>
              ))}
            </div>
          ) : stories.length === 0 ? (
            <div className="p-12 text-center rounded-2xl glass-panel border border-white/10 space-y-4">
              <div className="w-12 h-12 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center text-gray-400 mx-auto">
                <AlertCircle className="w-6 h-6 text-brand-400" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">Không tìm thấy bộ truyện nào phù hợp</h3>
                <p className="text-xs text-gray-400 mt-1 max-w-sm mx-auto">
                  Hãy thử nới lỏng các tiêu chí lọc hoặc tìm kiếm bằng từ khóa khác.
                </p>
              </div>
              <button
                onClick={handleResetFilters}
                className="px-4 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-xs font-semibold transition"
              >
                Đặt lại bộ lọc
              </button>
            </div>
          ) : (
            <div className={`grid gap-4 ${
              viewMode === 'grid'
                ? 'grid-cols-2 sm:grid-cols-3 xl:grid-cols-4'
                : 'grid-cols-1'
            }`}>
              {stories.map(story => (
                viewMode === 'grid' ? (
                  <StoryCardGrid key={story.id} story={story} />
                ) : (
                  <StoryCardList key={story.id} story={story} />
                )
              ))}
            </div>
          )}

          {/* Pagination */}
          <Pagination
            currentPage={pagination.page}
            totalPages={pagination.totalPages}
            onPageChange={(page) => {
              setCurrentPage(page);
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
          />

        </div>

      </div>

    </div>
  );
}
