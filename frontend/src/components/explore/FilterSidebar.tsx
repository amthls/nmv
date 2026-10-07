'use client';

import React, { useState } from 'react';
import { 
  Filter, 
  RotateCcw, 
  ChevronDown, 
  ChevronUp, 
  X, 
  Check, 
  Minus,
  Sparkles 
} from 'lucide-react';

export interface TagCategoryItem {
  category_id: string;
  category_name: string;
  category_label: string;
  tags: {
    id: string;
    name: string;
    slug: string;
    description?: string;
  }[];
}

export interface FilterState {
  type: string;
  status: string;
  language: string;
  min_chapters: string;
  tags: string[]; // included tags slugs
  exclude_tags: string[]; // excluded tags slugs
}

interface FilterSidebarProps {
  categories: TagCategoryItem[];
  filters: FilterState;
  onFilterChange: (newFilters: FilterState) => void;
  onReset: () => void;
  isOpenMobile: boolean;
  onCloseMobile: () => void;
}

export default function FilterSidebar({
  categories,
  filters,
  onFilterChange,
  onReset,
  isOpenMobile,
  onCloseMobile,
}: FilterSidebarProps) {
  const [collapsedCategories, setCollapsedCategories] = useState<{ [key: string]: boolean }>({});

  const toggleCategory = (catName: string) => {
    setCollapsedCategories(prev => ({
      ...prev,
      [catName]: !prev[catName]
    }));
  };

  const handleTypeChange = (type: string) => {
    onFilterChange({ ...filters, type });
  };

  const handleStatusChange = (status: string) => {
    onFilterChange({ ...filters, status });
  };

  const handleLanguageChange = (language: string) => {
    onFilterChange({ ...filters, language });
  };

  const handleMinChaptersChange = (min_chapters: string) => {
    onFilterChange({ ...filters, min_chapters });
  };

  const toggleTag = (tagSlug: string) => {
    const isIncluded = filters.tags.includes(tagSlug);
    const isExcluded = filters.exclude_tags.includes(tagSlug);

    let newTags = [...filters.tags];
    let newExcludeTags = [...filters.exclude_tags];

    if (!isIncluded && !isExcluded) {
      // 1st click: Include
      newTags.push(tagSlug);
    } else if (isIncluded) {
      // 2nd click: Exclude
      newTags = newTags.filter(t => t !== tagSlug);
      newExcludeTags.push(tagSlug);
    } else {
      // 3rd click: Reset
      newExcludeTags = newExcludeTags.filter(t => t !== tagSlug);
    }

    onFilterChange({
      ...filters,
      tags: newTags,
      exclude_tags: newExcludeTags,
    });
  };

  const content = (
    <div className="space-y-6">
      {/* Filter Header */}
      <div className="flex items-center justify-between pb-3 border-b border-white/[0.04]">
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-brand-400" />
          <h3 className="font-bold text-sm text-white uppercase tracking-wider">Bộ Lọc Tìm Kiếm</h3>
        </div>
        <button
          onClick={onReset}
          className="flex items-center gap-1 text-xs text-gray-400 hover:text-brand-400 transition"
          title="Đặt lại toàn bộ bộ lọc"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span>Đặt lại</span>
        </button>
      </div>

      {/* 1. Loại Truyện (Story Type) */}
      <div className="space-y-2.5">
        <label className="text-xs font-semibold text-gray-300 uppercase tracking-wide">
          Loại truyện
        </label>
        <div className="grid grid-cols-3 gap-1.5 p-1 rounded-xl bg-black/40 border border-white/[0.03]">
          {[
            { value: 'all', label: 'Tất cả' },
            { value: 'novel', label: 'Truyện chữ' },
            { value: 'manga', label: 'Truyện tranh' },
          ].map(item => (
            <button
              key={item.value}
              onClick={() => handleTypeChange(item.value)}
              className={`py-1.5 px-2 rounded-lg text-xs font-medium transition-all ${
                filters.type === item.value
                  ? 'bg-brand-600 text-snow shadow-sm shadow-brand-500/30'
                  : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {/* 2. Tình Trạng (Status) */}
      <div className="space-y-2.5">
        <label className="text-xs font-semibold text-gray-300 uppercase tracking-wide">
          Tình trạng
        </label>
        <select
          value={filters.status}
          onChange={e => handleStatusChange(e.target.value)}
          className="w-full h-9 px-3 rounded-xl bg-glass border border-white/[0.04] text-xs text-white focus:outline-none focus:border-brand-500"
        >
          <option value="all">Tất cả tình trạng</option>
          <option value="ongoing">Đang tiến hành</option>
          <option value="completed">Đã hoàn thành</option>
          <option value="hiatus">Tạm ngưng</option>
          <option value="dropped">Ngừng phát hành</option>
        </select>
      </div>

      {/* 3. Ngôn Ngữ Gốc & Số Chương */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <label className="text-[11px] font-semibold text-gray-400 uppercase">
            Ngôn ngữ gốc
          </label>
          <select
            value={filters.language}
            onChange={e => handleLanguageChange(e.target.value)}
            className="w-full h-9 px-2.5 rounded-xl bg-glass border border-white/[0.04] text-xs text-white focus:outline-none focus:border-brand-500"
          >
            <option value="all">Tất cả</option>
            <option value="ja">🇯🇵 Nhật Bản</option>
            <option value="ko">🇰🇷 Hàn Quốc</option>
            <option value="zh">🇨🇳 Trung Quốc</option>
            <option value="vi">🇻🇳 Việt Nam</option>
            <option value="en">🇺🇸 Tiếng Anh</option>
          </select>
        </div>

        <div className="space-y-1.5">
          <label className="text-[11px] font-semibold text-gray-400 uppercase">
            Số chương
          </label>
          <select
            value={filters.min_chapters}
            onChange={e => handleMinChaptersChange(e.target.value)}
            className="w-full h-9 px-2.5 rounded-xl bg-glass border border-white/[0.04] text-xs text-white focus:outline-none focus:border-brand-500"
          >
            <option value="0">Tất cả</option>
            <option value="1">≥ 1 chương</option>
            <option value="10">≥ 10 chương</option>
            <option value="50">≥ 50 chương</option>
            <option value="100">≥ 100 chương</option>
          </select>
        </div>
      </div>

      {/* Tag Instructions */}
      <div className="p-2.5 rounded-xl bg-white/5 border border-white/[0.03] text-[11px] text-gray-400 space-y-1">
        <div className="flex items-center gap-1.5 text-gray-300 font-semibold">
          <Sparkles className="w-3.5 h-3.5 text-brand-400" />
          <span>Hướng dẫn chọn Tag:</span>
        </div>
        <div className="flex items-center gap-2 pt-0.5">
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-brand-600/30 text-brand-300 font-medium">
            <Check className="w-2.5 h-2.5" /> Có tag
          </span>
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-rose-600/30 text-rose-300 font-medium">
            <X className="w-2.5 h-2.5" /> Bỏ tag
          </span>
        </div>
      </div>

      {/* 4. Tag Categories Accordion */}
      <div className="space-y-4 pt-2">
        {categories.map(category => {
          const isCollapsed = collapsedCategories[category.category_name];

          return (
            <div key={category.category_id} className="space-y-2">
              <button
                type="button"
                onClick={() => toggleCategory(category.category_name)}
                className="w-full flex items-center justify-between text-xs font-bold text-gray-300 hover:text-white uppercase tracking-wider py-1"
              >
                <span>{category.category_label}</span>
                {isCollapsed ? (
                  <ChevronDown className="w-3.5 h-3.5 text-gray-500" />
                ) : (
                  <ChevronUp className="w-3.5 h-3.5 text-gray-500" />
                )}
              </button>

              {!isCollapsed && (
                <div className="flex flex-wrap gap-1.5 max-h-48 overflow-y-auto pr-1">
                  {category.tags.map(tag => {
                    const isIncluded = filters.tags.includes(tag.slug);
                    const isExcluded = filters.exclude_tags.includes(tag.slug);

                    let btnClass = 'bg-white/5 hover:bg-white/10 text-gray-400 border-white/[0.03]';
                    if (isIncluded) {
                      btnClass = 'bg-brand-600 text-snow border-brand-500 shadow-sm shadow-brand-500/30';
                    } else if (isExcluded) {
                      btnClass = 'bg-rose-600/80 text-snow border-rose-500 line-through';
                    }

                    return (
                      <button
                        key={tag.id}
                        type="button"
                        onClick={() => toggleTag(tag.slug)}
                        className={`text-[11px] font-medium px-2.5 py-1 rounded-lg border transition-all flex items-center gap-1 ${btnClass}`}
                        title={tag.description || tag.name}
                      >
                        {isIncluded && <Check className="w-3 h-3" />}
                        {isExcluded && <Minus className="w-3 h-3" />}
                        <span>{tag.name}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop Sidebar */}
      <aside className="hidden lg:block w-72 shrink-0 p-5 rounded-2xl glass-panel border border-white/[0.04] h-fit sticky top-20">
        {content}
      </aside>

      {/* Mobile Drawer */}
      {isOpenMobile && (
        <div className="lg:hidden fixed inset-0 z-50 flex justify-end bg-black/70 backdrop-blur-sm animate-in fade-in">
          <div 
            className="w-full max-w-xs h-full bg-surface p-5 border-l border-white/[0.04] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-4 mb-4 border-b border-white/[0.04]">
              <span className="font-bold text-base text-white">Bộ lọc</span>
              <button
                onClick={onCloseMobile}
                className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/5"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            {content}
          </div>
        </div>
      )}
    </>
  );
}
