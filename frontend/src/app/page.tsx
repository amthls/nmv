'use client';

import React, { useState, useEffect } from 'react';
import { Story } from '@/components/explore/StoryCardGrid';
import FeaturedCarousel from '@/components/home/FeaturedCarousel';
import StoryRail from '@/components/home/StoryRail';
import RecommendationRail from '@/components/home/RecommendationRail';
import WorkflowGuide from '@/components/home/WorkflowGuide';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api/v1';

async function getList(url: string) {
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const json = await res.json();
    return json.success ? json.data || [] : [];
  } catch (err) {
    console.error('Failed to load', url, err);
    return [];
  }
}

export default function HomePage() {
  const [trendingStories, setTrendingStories] = useState<Story[]>([]);
  const [recentlyUpdated, setRecentlyUpdated] = useState<Story[]>([]);
  const [featuredIllustrations, setFeaturedIllustrations] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setIsLoading(true);
      // trending is ordered by total views
      const [trending, recent, illustrations] = await Promise.all([
        getList(`${API_BASE_URL}/stories/trending`),
        getList(`${API_BASE_URL}/stories/recently-updated`),
        getList(`${API_BASE_URL}/stories/illustrations`),
      ]);
      setTrendingStories(trending);
      setRecentlyUpdated(recent);
      setFeaturedIllustrations(illustrations);
      setIsLoading(false);
    })();
  }, []);

  return (
    <div className="pb-24">
      {/* 1. FEATURED THIS WEEK — banner card */}
      {isLoading && trendingStories.length === 0 ? (
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 pt-6">
          <div className="h-7 sm:h-8 w-56 rounded-[4px] bg-white/5 animate-pulse" />
          <div className="mt-3 h-[212px] sm:h-[308px] lg:h-[348px] rounded-xl bg-white/5 animate-pulse" />
        </div>
      ) : (
        <FeaturedCarousel stories={trendingStories} gallery={featuredIllustrations} />
      )}

      <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 mt-10 space-y-12">
        {/* 2. Rows */}
        <StoryRail title="Mới cập nhật" href="/kham-pha?sort=updated" stories={recentlyUpdated} meta="updated" />
        <StoryRail title="Nhiều người xem" href="/kham-pha?sort=views" stories={trendingStories} meta="views" ranked />
        <RecommendationRail
          title="Đề xuất cho bạn"
          subtitle="Truyện bạn đang đọc dở và truyện bạn có khả năng thích cao nhất"
          endpoint="/home"
          source="home_rec"
        />

        <WorkflowGuide />
      </div>
    </div>
  );
}
