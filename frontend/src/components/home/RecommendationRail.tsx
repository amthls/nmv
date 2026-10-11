'use client';

import React, { useEffect, useState } from 'react';
import StoryRail from '@/components/home/StoryRail';
import { Story } from '@/components/explore/StoryCardGrid';
import { useAuth } from '@/context/AuthContext';

import { REC_URL } from '@/lib/apiJson';

type Source = 'home_rec' | 'related';

/**
 * A row filled by the recommender (/api/rec/*). Reports what was shown and what was
 * clicked, so the click-through rate of each row can be measured after model changes.
 */
export default function RecommendationRail({ title, subtitle, endpoint, source }: {
  title: string;
  subtitle?: string;
  endpoint: string;
  source: Source;
}) {
  const { isAuthenticated, isLoading: authLoading, authFetch } = useAuth();
  const [stories, setStories] = useState<Story[] | null>(null);

  const send = (kind: 'impression' | 'click', ids: string[]) => {
    const body = JSON.stringify({ kind, source, story_ids: ids });
    // keepalive survives the navigation a click starts (sendBeacon can't send the CSRF header signed-in writes need)
    const fetcher = isAuthenticated ? authFetch : fetch;
    fetcher(`${REC_URL}/events`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body, credentials: 'include', keepalive: true,
    }).catch(() => {});
  };

  useEffect(() => {
    if (authLoading) return;
    let cancelled = false;
    const fetcher = isAuthenticated ? authFetch : fetch;
    fetcher(`${REC_URL}${endpoint}`, { credentials: 'include' })
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return;
        const list: Story[] = json?.success ? json.data?.stories || [] : [];
        setStories(list);
        if (list.length) send('impression', list.slice(0, 12).map((s) => s.id));
      })
      .catch(() => !cancelled && setStories([]));
    return () => { cancelled = true; };
  }, [endpoint, isAuthenticated, authLoading]); // eslint-disable-line react-hooks/exhaustive-deps

  if (stories === null) {
    return (
      <section className="space-y-3">
        <div className="h-7 w-48 rounded bg-white/5 animate-pulse" />
        <div className="flex gap-4 overflow-hidden">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="shrink-0 w-[132px] sm:w-[156px] lg:w-[172px] aspect-[2/3] rounded-lg bg-white/5 animate-pulse" />
          ))}
        </div>
      </section>
    );
  }

  return (
    <StoryRail
      title={title}
      subtitle={subtitle}
      stories={stories}
      meta="stats"
      onItemClick={(s) => send('click', [s.id])}
    />
  );
}
