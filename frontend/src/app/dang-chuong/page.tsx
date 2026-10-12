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
  Plus,
  X,
  Lock,
  LogIn,
  GitMerge,
  Trash2,
  Share2,
  Copy,
} from 'lucide-react';
import PullDialog from '@/components/workspace/PullDialog';
import ShareDialog from '@/components/workspace/ShareDialog';
import SmartImage from '@/components/common/SmartImage';
import ChapterEditor from '@/components/chapter/ChapterEditor';
import RichTextEditor from '@/components/common/RichTextEditor';
import RichContent from '@/components/common/RichContent';
import { enhanceChapterHtml, withFootnoteMarker } from '@/lib/chapterRender';
import { blocksToHtml, countWords, htmlToBlocks, plainTextToHtml } from '@/lib/chapterBlocks';
import { rewriteHtmlImages, useImageQuality } from '@/lib/imageQuality';
import { useAuth } from '@/context/AuthContext';
import { csrfToken } from '@/lib/session';
import PageLoader from '@/components/common/PageLoader';
import UploadHeader from '@/components/story/UploadHeader';
import { chapterUploadHref } from '@/lib/chapterUpload';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api/v1';
const WS_URL = '/api/ws';
// Autosave to the server draft this long after the last keystroke
const AUTOSAVE_MS = 3000;

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
  // ?edit=<chapterId>: a novel chapter opens (or reopens) the caller's draft of it and moves to ?draft=;
  // a manga chapter stays here to edit its title / number / volume
  const editId = searchParams?.get('edit') || '';
  const isEditMode = Boolean(editId);
  // ?draft=<id>: the editor works on a workspace draft (Plan/chapter-workspace.md, stage 2), saved as you type
  const draftParam = searchParams?.get('draft') || '';

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

  // Chapter body as HTML from the chapter editor (headings, emphasis, alignment, highlights,
  // scene breaks, illustrations...). It is saved as one block per top-level element.
  const [bodyHtml, setBodyHtml] = useState('');
  const [imageQuality] = useImageQuality();
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
  const [editLoadState, setEditLoadState] = useState<'idle' | 'loading' | 'ready' | 'error'>(isEditMode || draftParam ? 'loading' : 'idle');
  // Version of the chapter this edit started from: the server refuses the save if someone saved in between
  const [editVersion, setEditVersion] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  // Editing a manga chapter: its pages are images, so only title / number / volume are editable here
  const [mangaPages, setMangaPages] = useState<string[] | null>(null);
  const isMangaEdit = isEditMode && mangaPages !== null;

  const editorBlocks = useMemo(() => htmlToBlocks(bodyHtml), [bodyHtml]);
  // plain text of each block ('' for scene breaks / illustrations): notes attach to these by index
  const paragraphs = useMemo(() => editorBlocks.map((b) => b.text), [editorBlocks]);
  const hasText = paragraphs.some(Boolean);
  const totalWords = useMemo(() => countWords(editorBlocks), [editorBlocks]);
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

  // Optional translator messages shown in a box before / after the chapter
  const [introNote, setIntroNote] = useState('');
  const [outroNote, setOutroNote] = useState('');
  const [showMessages, setShowMessages] = useState(false);

  // The server draft this editor writes to (none yet for a new chapter: made on the first autosave)
  const [draft, setDraft] = useState<any>(null);
  const draftRef = React.useRef<any>(null);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [showPull, setShowPull] = useState(false);
  // Stage 3: the latest round of my proposal (returned with a note?) and the note I send with the next one
  const [lastRound, setLastRound] = useState<any>(null);
  const [proposalNote, setProposalNote] = useState('');
  // Stage 4a: sharing, a helper's copy being taken in, the edit lock (one editor at a time)
  const [showShare, setShowShare] = useState(false);
  const [offerShown, setOfferShown] = useState<{ id: string; name: string } | null>(null);
  const [lockBlockedBy, setLockBlockedBy] = useState<string | null>(null);
  // Stage 4c: publish at a chosen time instead of now (keepers)
  const [publishAt, setPublishAt] = useState('');
  const setDraftInfo = (d: any) => { draftRef.current = d; setDraft(d); };

  const formattedBlocks = useMemo(() => editorBlocks.map((b, idx) => ({
    html: b.html,
    text: b.text,
    image_url: b.image_url || null,
    note: annotations[idx]?.note || null,
  })), [editorBlocks, annotations]);
  const draftPayload = {
    title: chapterTitle.trim(),
    chapter_number: chapterNumber,
    volume_id: selectedVolumeId || null,
    intro_note: introNote,
    outro_note: outroNote,
    content_blocks: formattedBlocks,
  };
  const snapshot = JSON.stringify(draftPayload);
  const payloadRef = React.useRef(draftPayload);
  payloadRef.current = draftPayload;
  const snapshotRef = React.useRef(snapshot);
  snapshotRef.current = snapshot;
  const lastSaved = React.useRef(snapshot);
  // The editor normalises HTML it is given for a moment after loading: that is not a change to save
  const loadedAt = React.useRef(0);
  const [, rerender] = useState(0);
  const lastTyped = React.useRef(0);
  useEffect(() => {
    if (Date.now() - loadedAt.current < 2000 && lastSaved.current !== snapshot) {
      lastSaved.current = snapshot;
      rerender((n) => n + 1); // the status line reads `dirty` from this ref
    } else lastTyped.current = Date.now();
  }, [snapshot]);
  const dirty = snapshot !== lastSaved.current;

  // Warn before an accidental tab close / navigation away from work not saved yet
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  /** Fill the form from stored chapter blocks + fields (a draft or a published chapter). */
  const fillForm = (stored: any[], meta: any, fallbackText = '') => {
    const loadedHtml = stored.length > 0 ? blocksToHtml(stored) : plainTextToHtml(fallbackText);
    // notes follow their paragraph (older chapters split into paragraph + illustration blocks)
    const converted = htmlToBlocks(loadedHtml);
    const nextAnnotations: Record<number, Annotation> = {};
    const nextActive: number[] = [];
    stored.filter((b) => b.note).forEach((b) => {
      const text = (b.text || '').replace(/\s+/g, ' ').trim();
      const idx = converted.findIndex((c, i) => c.text === text && !nextActive.includes(i));
      if (idx >= 0) {
        nextAnnotations[idx] = { note: b.note };
        nextActive.push(idx);
      }
    });
    setSelectedVolumeId(meta.volume_id || '');
    setChapterNumber(Number(meta.chapter_number));
    setChapterTitle(meta.title || '');
    setBodyHtml(loadedHtml);
    setAnnotations(nextAnnotations);
    setActiveAnnotationIndices(nextActive);
    setIntroNote(meta.intro_note || '');
    setOutroNote(meta.outro_note || '');
    if (nextActive.length > 0) setShowAnnotations(true);
    if (meta.intro_note || meta.outro_note) setShowMessages(true);
    loadedAt.current = Date.now();
  };

  // One save at a time, in order; resolves false when it did not save
  const inflight = React.useRef<Promise<boolean>>(Promise.resolve(true));
  const stopSaving = React.useRef(false);
  const saveDraftNow = (): Promise<boolean> => {
    inflight.current = inflight.current.then(async () => {
      const snap = snapshotRef.current;
      if (snap === lastSaved.current && draftRef.current) return true;
      if (stopSaving.current) return false;
      setSaveState('saving');
      try {
        const d = draftRef.current;
        const res = d
          ? await authFetch(`${API_BASE_URL}/drafts/${d.id}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ ...payloadRef.current, expected_version: d.version }),
            })
          : await authFetch(`${API_BASE_URL}/drafts`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ story_id: selectedStoryId, ...payloadRef.current }),
            });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json.success) {
          if (res.status === 409) stopSaving.current = true; // saved elsewhere or closed: reload instead of overwriting
          setErrorMsg(json.message || 'Không lưu được bản nháp.');
          setSaveState('error');
          return false;
        }
        if (d) setDraftInfo({ ...d, version: json.data.version });
        else {
          setDraftInfo(json.data);
          authFetch(`${WS_URL}/drafts/${json.data.id}`).then((r) => r.json())
            .then((j) => j.success && draftRef.current?.id === j.data.id && setDraftInfo({ ...draftRef.current, can_merge: j.data.can_merge }))
            .catch(() => {});
          // keep typing undisturbed: only the address changes, so a reload reopens this draft
          window.history.replaceState(null, '', `/dang-chuong?draft=${json.data.id}`);
        }
        lastSaved.current = snap;
        setSavedAt(new Date());
        setSaveState('saved');
        return true;
      } catch (e: any) {
        setErrorMsg('Lỗi khi lưu nháp: ' + e.message);
        setSaveState('error');
        return false;
      }
    });
    return inflight.current;
  };

  // Autosave a few seconds after the last change (a new chapter only once it has a title or some text)
  useEffect(() => {
    if (isEditMode || !selectedStoryId || !dirty || stopSaving.current) return;
    if (!draftRef.current && !chapterTitle.trim() && !hasText) return;
    const timer = setTimeout(() => { saveDraftNow(); }, AUTOSAVE_MS);
    return () => clearTimeout(timer);
  }, [snapshot, selectedStoryId]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const pickStory = (storyId: string) => setSelectedStoryId(storyId);

  // A manga is uploaded as page images in its own route; say so instead of jumping there
  const wrongTypeStory = !isEditMode && !draft ? mangaStories.find((s) => s.id === selectedStoryId) : undefined;

  // Back goes where the user came from (workspace, group page, story page...), not to a fixed page

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
              if (draftRef.current || draftParam) return; // a draft keeps its own volume and number
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
        if (d.story_type !== 'manga') {
          // Text chapters are edited on a draft: open (or reopen) mine, then work there
          const dr = await authFetch(`${API_BASE_URL}/drafts`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chapter_id: editId }),
          });
          const dj = await dr.json().catch(() => ({}));
          if (cancelled) return;
          if (!dr.ok || !dj.success) {
            setErrorMsg(dj.message || 'Không mở được bản nháp để sửa chương.');
            setEditLoadState('error');
            return;
          }
          router.replace(`/dang-chuong?draft=${dj.data.id}`);
          return;
        }
        setEditVersion(d.ws_version || 0);

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
        fillForm(d.content_blocks || [], d, d.content || '');
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

  /** Load draft {id} from the workspace into the form (also after a pull). */
  const loadDraft = async (id: string) => {
    setEditLoadState('loading');
    try {
      const res = await authFetch(`${WS_URL}/drafts/${id}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) {
        setErrorMsg(json.message || 'Không mở được bản nháp.');
        setEditLoadState('error');
        return;
      }
      showDraft(json.data);
    } catch (e: any) {
      setErrorMsg('Lỗi: ' + e.message);
      setEditLoadState('error');
    }
  };
  const showDraft = (d: any) => {
    setDraftInfo({ ...d, blocks: undefined, access: d.access || draftRef.current?.access, can_merge: d.can_merge ?? draftRef.current?.can_merge });
    stopSaving.current = d.status !== 'open' || d.access === 'viewer';
    if (d.status === 'published' || d.status === 'discarded') setErrorMsg('Bản nháp này đã đăng hoặc đã bỏ, chỉ xem được.');
    setLastRound(null);
    if (d.last_round > 0) {
      authFetch(`${WS_URL}/drafts/${d.id}/review`).then((r) => r.json())
        .then((j) => j.success && setLastRound({ ...j.data.rounds[j.data.rounds.length - 1], comments: j.data.comments.length }))
        .catch(() => {});
    }
    setSelectedStoryId(d.story_id);
    fillForm(d.blocks || [], d.meta);
    setEditLoadState('ready');
  };

  const draftId = draft?.id;
  const canTakeLock = draft?.status === 'open' && (draft?.access === 'owner' || draft?.access === 'editor');
  useEffect(() => {
    if (!draftId || !canTakeLock) return;
    let blocked = false;
    let first = true;
    const take = async () => {
      // keep the lock only while typing: idle for 2 minutes and it lapses for the next editor
      if (!first && !blocked && Date.now() - lastTyped.current > 120000) return;
      first = false;
      const res = await authFetch(`${WS_URL}/drafts/${draftId}/lock`, { method: 'POST' });
      const json = await res.json().catch(() => ({}));
      if (res.ok) {
        if (blocked) {
          blocked = false;
          setLockBlockedBy(null);
          if (snapshotRef.current !== lastSaved.current) {
            // typed while someone else held the lock: never overwrite that silently
            setErrorMsg('Người khác đã sửa nháp trong lúc bạn chờ. Phần bạn gõ khi đó chưa lưu: chép ra trước rồi tải lại trang để lấy bản mới.');
            return;
          }
          loadDraft(draftId); // the other editor's work
        }
        stopSaving.current = false;
      } else if (res.status === 409) {
        blocked = true;
        stopSaving.current = true;
        setLockBlockedBy(String(json.message || '').split(' đang sửa')[0] || 'Người khác');
      }
    };
    take();
    const timer = setInterval(take, 30000);
    const release = () => { fetch(`${WS_URL}/drafts/${draftId}/lock`, { method: 'DELETE', keepalive: true, credentials: 'include', headers: { 'X-CSRF-Token': csrfToken() } }); };
    window.addEventListener('pagehide', release);
    return () => {
      clearInterval(timer);
      window.removeEventListener('pagehide', release);
      release();
    };
  }, [draftId, canTakeLock]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    // our own first autosave also puts ?draft= in the address: that draft is already on screen
    if (!draftParam || !isAuthenticated || draftRef.current?.id === draftParam) return;
    loadDraft(draftParam);
  }, [draftParam, isAuthenticated]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // Publish: save what is on screen, then the draft becomes the official chapter (manga: save the fields directly)
  const handlePublish = async () => {
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
    if (!isMangaEdit && !hasText) {
      setErrorMsg('Nội dung chương đang trống.');
      return;
    }

    setIsSubmitting(true);
    setErrorMsg(null);
    try {
      if (isMangaEdit) {
        const editRes = await authFetch(`${API_BASE_URL}/chapters/${editId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: chapterTitle.trim(),
            chapter_number: parsedNumber,
            volume_id: selectedVolumeId || null,
            intro_note: introNote,
            outro_note: outroNote,
            expected_version: editVersion,
            // manga pages are left untouched (sending no content keeps them)
          }),
        });
        const editJson = await editRes.json();
        if (editRes.ok && editJson.success) {
          lastSaved.current = snapshot;
          setFeedback(editJson.message || 'Đã cập nhật chương');
          setTimeout(() => {
            const storySlug = editJson.data?.story_slug || selectedStory?.slug;
            const chapterSlug = editJson.data?.slug;
            router.push(storySlug && chapterSlug ? `/truyen/${storySlug}/${chapterSlug}` : '/ws');
          }, 1200);
        } else {
          setErrorMsg(editJson.message || 'Cập nhật chương thất bại.');
        }
        return;
      }

      if (!(await saveDraftNow()) || !draftRef.current) return;
      const res = await authFetch(`${API_BASE_URL}/drafts/${draftRef.current.id}/publish`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(publishAt ? { publish_at: new Date(publishAt).toISOString() } : {}),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json.success && json.data?.status === 'scheduled') {
        setPublishAt('');
        setFeedback(json.message || 'Đã hẹn giờ đăng.');
        showDraft(json.data);
      } else if (res.ok && json.success) {
        stopSaving.current = true; // the draft is closed now
        setFeedback(json.message || 'Đăng chương thành công');
        setTimeout(() => {
          const { story_slug, slug } = json.data || {};
          router.push(story_slug && slug ? `/truyen/${story_slug}/${slug}` : '/ws');
        }, 1200);
      } else {
        setErrorMsg(json.message || 'Đăng chương thất bại.');
        // the official version may have moved: refresh what the banner knows
        if (res.status === 409) {
          const fresh = await authFetch(`${WS_URL}/drafts/${draftRef.current.id}`).then((r) => r.json()).catch(() => null);
          if (fresh?.success) setDraftInfo({ ...fresh.data, blocks: undefined });
        }
      }
    } catch (e: any) {
      setErrorMsg('Lỗi: ' + e.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Contributors: send the draft to the story keepers (it is locked until they decide or I withdraw it)
  const handlePropose = async () => {
    if (!chapterTitle.trim() || isSubmitting) return;
    if (!hasText) {
      setErrorMsg('Nội dung chương đang trống.');
      return;
    }
    setIsSubmitting(true);
    setErrorMsg(null);
    try {
      if (!(await saveDraftNow()) || !draftRef.current) return;
      const res = await authFetch(`${API_BASE_URL}/drafts/${draftRef.current.id}/submit`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ note: proposalNote }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) {
        setErrorMsg(json.message || 'Không gửi được đề xuất.');
        return;
      }
      setProposalNote('');
      setFeedback(json.message || 'Đã gửi đề xuất.');
      showDraft({ ...json.data, can_merge: draftRef.current.can_merge });
    } catch (e: any) {
      setErrorMsg('Lỗi: ' + e.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Someone the draft is shared with: their own copy to edit and send back
  const makeCopy = async () => {
    const res = await authFetch(`${WS_URL}/drafts/${draftRef.current.id}/copy`, { method: 'POST' });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.success) return setErrorMsg(json.message || 'Không tạo được bản sao.');
    router.push(`/dang-chuong?draft=${json.data.id}`);
  };

  const offerCopy = async () => {
    if (!(await saveDraftNow()) || !draftRef.current) return;
    const res = await authFetch(`${API_BASE_URL}/drafts/${draftRef.current.id}/offer`, { method: 'POST' });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.success) return setErrorMsg(json.message || 'Không gửi được.');
    setFeedback(json.message || 'Đã gửi cho chủ nháp.');
    loadDraft(draftRef.current.id);
  };

  const declineOffer = async (copyId: string) => {
    await authFetch(`${WS_URL}/drafts/${draftRef.current.id}/offers/${copyId}`, { method: 'DELETE' });
    setOfferShown(null);
    loadDraft(draftRef.current.id);
  };

  const unschedule = async () => {
    const d = draftRef.current;
    const res = await authFetch(`${WS_URL}/drafts/${d.id}/schedule`, { method: 'DELETE' });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.success) return setErrorMsg(json.message || 'Không hủy được hẹn đăng.');
    setFeedback('Đã hủy hẹn đăng.');
    showDraft(json.data);
  };

  const withdrawProposal = async () => {
    const d = draftRef.current;
    if (!d) return;
    const res = await authFetch(`${API_BASE_URL}/drafts/${d.id}/withdraw`, { method: 'POST' });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.success) {
      setErrorMsg(json.message || 'Không rút được đề xuất.');
      return;
    }
    setFeedback(json.message || 'Đã rút đề xuất.');
    showDraft({ ...json.data, can_merge: d.can_merge });
  };

  const discardDraft = async () => {
    const d = draftRef.current;
    if (!d || !window.confirm('Bỏ bản nháp này? Nội dung chưa đăng sẽ không còn trong danh sách nháp của bạn.')) return;
    const res = await authFetch(`${WS_URL}/drafts/${d.id}`, { method: 'DELETE' });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.success) {
      setErrorMsg(json.message || 'Không bỏ được bản nháp.');
      return;
    }
    stopSaving.current = true;
    lastSaved.current = snapshot;
    router.push('/ws');
  };

  // Before pulling, the draft on the server must hold what is on screen
  const openPull = async () => {
    if (await saveDraftNow()) setShowPull(true);
  };
  const behind = Boolean(draft?.chapter_id && draft.current_version && draft.current_version !== draft.base_version && !draft.chapter_deleted);

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
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 space-y-6 pb-32">
      <UploadHeader
        mode="novel"
        groupId={groupId}
        showSwitch={!isEditMode && !draft && !draftParam}
        title={isEditMode || draft?.chapter_id ? 'Sửa chương' : 'Đăng chương mới'}
        description={isMangaEdit
          ? 'Chương truyện tranh: sửa tiêu đề, số chương hoặc tập. Các trang ảnh được giữ nguyên.'
          : draft?.chapter_id
          ? 'Bạn đang sửa trên bản nháp riêng, tự lưu khi gõ. Độc giả chỉ thấy thay đổi khi bạn bấm Đăng (thành phiên bản mới, không gửi lại thông báo).'
          : 'Soạn chương như trong Word: tiêu đề, in đậm, căn lề, tô màu chữ, ngắt cảnh, chèn ảnh minh họa. Dán từ Word / Google Docs vẫn giữ định dạng.'}
        aside={!isMangaEdit && (
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
      />

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

      {/* Draft status: autosave, discard; the official version moved since the draft was opened */}
      {!isMangaEdit && selectedStoryId && (
        <div className="px-4 py-3 rounded-2xl bg-white/5 border border-white/10 text-xs flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-gray-300">
            <Save className="w-4 h-4 text-brand-400 shrink-0" />
            <span>
              {draft
                ? draft.chapter_id ? `Bản nháp sửa chương (dựa trên phiên bản ${draft.base_version})` : 'Bản nháp chương mới'
                : 'Bản nháp được tạo khi bạn bắt đầu viết'}
              {' · '}
              <span className={saveState === 'error' ? 'text-rose-300' : 'text-gray-400'}>
                {saveState === 'saving' ? 'Đang lưu...'
                  : saveState === 'error' ? 'Chưa lưu được'
                  : dirty ? 'Có thay đổi chưa lưu'
                  : savedAt ? `Đã lưu lúc ${savedAt.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}`
                  : draft ? 'Đã lưu' : ''}
              </span>
            </span>
          </div>
          {draft?.access === 'owner' && (
            <div className="flex items-center gap-3">
              {!draft.copied_from && (draft.status === 'open' || draft.status === 'submitted') && (
                <button type="button" onClick={() => setShowShare(true)} className="text-[11px] font-bold text-gray-400 hover:text-sky-300 flex items-center gap-1 transition">
                  <Share2 className="w-3.5 h-3.5" /> Chia sẻ{draft.shares?.length ? ` (${draft.shares.length})` : ''}
                </button>
              )}
              {draft.status === 'open' && (
                <button type="button" onClick={discardDraft} className="text-[11px] font-bold text-gray-400 hover:text-rose-300 flex items-center gap-1 transition">
                  <Trash2 className="w-3.5 h-3.5" /> Bỏ nháp
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {behind && (
        <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-200 text-xs font-semibold flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <GitMerge className="w-4 h-4 text-amber-400 shrink-0" />
            <span>
              Bản chính thức đã thay đổi từ khi bạn mở nháp (phiên bản {draft.base_version} → {draft.current_version}).
              Cập nhật để lấy phần người khác đã sửa trước khi đăng.
            </span>
          </div>
          <button type="button" onClick={openPull} className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-ink font-bold text-[11px] transition shrink-0">
            Cập nhật theo bản chính
          </button>
        </div>
      )}

      {draft?.chapter_deleted && (
        <div className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-200 text-xs font-semibold">
          Chương này đã bị xóa khỏi bản chính thức nên bản nháp không đăng được nữa. Người giữ truyện có thể khôi phục chương trong lịch sử.
        </div>
      )}

      {(draft?.others?.length > 0 || draft?.claims?.length > 0) && draft?.status === 'open' && (
        <div className="px-4 py-3 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-100 text-xs font-semibold">
          Chương này đã có người khác làm:{' '}
          {[
            ...(draft.others || []).map((o: any) => `${o.name || 'ai đó'} có nháp ${o.status === 'submitted' ? 'đang chờ duyệt' : 'đang mở'}`),
            ...(draft.claims || []).map((t: any) => `${t.assignee_name || 'chưa ai'} ${t.status === 'claimed' ? 'đang nhận' : 'được mở'} việc ${t.kind}`),
          ].join(' · ')}
          . Hai bản cùng sửa thì người đăng sau phải cập nhật theo bản chính.
        </div>
      )}

      {draft?.access === 'viewer' && (
        <div className="p-4 rounded-2xl bg-sky-500/10 border border-sky-500/30 text-sky-100 text-xs font-semibold flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <span>Bản nháp của {draft.owner_name || 'người khác'} chia sẻ cho bạn (chỉ xem). Muốn sửa giúp: tạo bản sao của bạn, sửa rồi gửi lại cho họ.</span>
          {draft.status === 'open' || draft.status === 'submitted' ? (
            <button type="button" onClick={makeCopy} className="px-3 py-1.5 rounded-lg bg-sky-500 hover:bg-sky-400 text-ink font-bold text-[11px] shrink-0 flex items-center gap-1"><Copy className="w-3.5 h-3.5" /> Tạo bản sao của tôi</button>
          ) : null}
        </div>
      )}

      {draft?.access === 'editor' && (
        <div className="px-4 py-3 rounded-2xl bg-sky-500/10 border border-sky-500/30 text-sky-100 text-xs font-semibold flex flex-wrap items-center justify-between gap-2">
          <span>Bạn đang sửa bản nháp của {draft.owner_name || 'người khác'} (được chia sẻ quyền sửa). Chỉ chủ nháp đăng, gửi đề xuất hay giao nháp.</span>
          <button type="button" onClick={makeCopy} className="text-[11px] text-sky-200 hover:text-white underline">Hoặc tạo bản sao riêng</button>
        </div>
      )}

      {lockBlockedBy && (
        <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-100 text-xs font-semibold">
          {lockBlockedBy} đang sửa bản nháp này. Bạn đang xem; khi họ rời đi (hoặc 2 phút không gõ) trang tự lấy bản mới nhất và cho bạn sửa.
        </div>
      )}

      {draft?.copied_from && draft.access === 'owner' && (
        <div className="p-4 rounded-2xl bg-white/5 border border-white/10 text-gray-200 text-xs font-semibold flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <span>
            {draft.status === 'offered'
              ? 'Bản sao này đã gửi cho chủ nháp, đang chờ họ nhận. Họ không nhận thì bản sao mở lại cho bạn sửa.'
              : draft.status === 'accepted' ? 'Chủ nháp đã nhận bản sửa này.' : 'Đây là bản sao của bạn từ nháp của người khác. Sửa xong thì gửi lại cho chủ nháp.'}
          </span>
          {draft.status === 'open' && (
            <button type="button" onClick={offerCopy} className="px-3 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-500 text-snow font-bold text-[11px] shrink-0">Gửi cho chủ nháp</button>
          )}
        </div>
      )}

      {draft?.access === 'owner' && (draft.offers || []).map((o: any) => (
        <div key={o.id} className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-100 text-xs font-semibold flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <span>{o.owner_name || 'Một người'} gửi lại bản sửa giúp cho nháp này.</span>
          <button type="button" onClick={async () => { if (await saveDraftNow()) setOfferShown({ id: o.id, name: o.owner_name || 'người giúp' }); }} className="px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-ink font-bold text-[11px] shrink-0">Xem & nhận</button>
        </div>
      ))}

      {offerShown && draft && (
        <PullDialog
          draftId={draft.id}
          draftVersion={draft.version}
          authFetch={authFetch}
          offer={{ ...offerShown, onDecline: () => declineOffer(offerShown.id) }}
          onClose={() => setOfferShown(null)}
          onDone={(d) => { setOfferShown(null); setFeedback(`Đã nhận bản sửa của ${offerShown.name} vào nháp.`); showDraft({ ...d, access: 'owner' }); loadDraft(d.id); }}
        />
      )}

      {showShare && draft && (
        <ShareDialog
          draft={draft}
          authFetch={authFetch}
          onChanged={() => loadDraft(draft.id)}
          onTransferred={() => { stopSaving.current = true; router.push('/ws'); }}
          onClose={() => setShowShare(false)}
        />
      )}

      {draft?.status === 'scheduled' && (
        <div className="p-4 rounded-2xl bg-violet-500/10 border border-violet-500/30 text-violet-100 text-xs font-semibold flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <span>
            Sẽ đăng lúc {new Date(draft.publish_at).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' })}
            {draft.scheduled_name ? ` (hẹn bởi ${draft.scheduled_name})` : ''}. Bản nháp bị khóa tới khi đăng.
          </span>
          {draft.can_merge && (
            <button type="button" onClick={unschedule} className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-white font-bold text-[11px] shrink-0">Hủy hẹn</button>
          )}
        </div>
      )}

      {draft?.schedule_error && (draft.status === 'open' || draft.status === 'submitted') && (
        <div className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-100 text-xs font-semibold">
          Lần hẹn đăng trước không thực hiện được: {draft.schedule_error}
        </div>
      )}

      {draft?.status === 'submitted' && (
        <div className="p-4 rounded-2xl bg-sky-500/10 border border-sky-500/30 text-sky-100 text-xs font-semibold flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <span>Đã gửi đề xuất (lần {draft.last_round}), đang chờ người giữ truyện duyệt. Nháp bị khóa: muốn sửa tiếp thì rút lại.</span>
          <div className="flex items-center gap-2 shrink-0">
            <Link href={`/ws/de-xuat/${draft.id}`} className="px-3 py-1.5 rounded-lg bg-sky-500 hover:bg-sky-400 text-ink font-bold text-[11px]">Xem đề xuất</Link>
            <button type="button" onClick={withdrawProposal} className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-white font-bold text-[11px]">Rút lại để sửa</button>
          </div>
        </div>
      )}

      {draft?.status === 'open' && lastRound?.decision === 'returned' && (
        <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-100 text-xs font-semibold flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <span>
            {lastRound.decided_name || 'Người giữ truyện'} đã trả lại đề xuất{lastRound.decision_note ? `: “${lastRound.decision_note}”` : '.'}
            {lastRound.comments > 0 ? ` Có ${lastRound.comments} góp ý.` : ''} Sửa xong thì gửi lại.
          </span>
          <Link href={`/ws/de-xuat/${draft.id}`} className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-ink font-bold text-[11px] shrink-0">Xem góp ý</Link>
        </div>
      )}

      {showPull && draft && (
        <PullDialog
          draftId={draft.id}
          draftVersion={draft.version}
          authFetch={authFetch}
          onClose={() => setShowPull(false)}
          onDone={(d) => { setShowPull(false); setFeedback(`Đã cập nhật nháp theo bản chính (phiên bản ${d.base_version}).`); showDraft(d); }}
        />
      )}

      {/* 1. PUBLICATION METADATA */}
      <div className="p-6 rounded-3xl glass-panel border border-white/10 bg-glass space-y-4 shadow-xl">
        <h2 className="text-xs font-bold text-brand-400 uppercase tracking-wider">Thông Tin Chương</h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-gray-200">Bộ Truyện *</label>
            <select
              value={selectedStoryId}
              disabled={isEditMode || Boolean(draft) || Boolean(draftParam)}
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
              {(isEditMode || draft) && selectedStoryId && !novelStories.some((s) => s.id === selectedStoryId) && (
                <option value={selectedStoryId}>{selectedStory?.title || 'Truyện của bản nháp'}</option>
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
            {wrongTypeStory && (
              <p className="text-[11px] text-amber-400 mt-1">
                “{wrongTypeStory.title}” là truyện tranh, chương của nó đăng bằng trang riêng:{' '}
                <Link href={chapterUploadHref({ storyType: 'manga', storyId: wrongTypeStory.id, groupId })} className="underline font-semibold">mở trình đăng truyện tranh</Link>
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
            <ChapterEditor
              value={bodyHtml}
              onChange={setBodyHtml}
              placeholder="Viết nội dung chương tại đây... Gõ tắt: **đậm**, *nghiêng*, ### tiêu đề, > trích dẫn, --- ngắt cảnh."
            />
            <div className="text-[11px] text-gray-500 flex flex-wrap items-center justify-between gap-2">
              <span>{editorBlocks.length} khối nội dung · Ctrl+F tìm & thay thế · nút ⛶ viết toàn màn hình · tùy chọn: <code className="text-gray-400">｜Ma Vương《Demon Lord》</code> hiện chữ nhỏ phía trên, <code className="text-gray-400">《《từ》》</code> chấm nhấn mạnh</span>
              <span>{totalWords.toLocaleString()} chữ · ~{readingTimeMin} phút đọc</span>
            </div>

            {/* Translator messages before / after the chapter, opt-in */}
            <div className="pt-3 border-t border-white/10">
              <button
                type="button"
                onClick={() => setShowMessages(!showMessages)}
                className="text-xs font-bold text-gray-400 hover:text-white flex items-center gap-1.5 transition"
              >
                <MessageSquare className="w-3.5 h-3.5" />
                <span>Lời người dịch đầu / cuối chương (tùy chọn)</span>
                <span className="text-[10px] font-normal text-gray-500">
                  {[introNote && 'đầu chương', outroNote && 'cuối chương'].filter(Boolean).join(', ')}
                </span>
              </button>
              {showMessages && (
                <div className="mt-3 grid gap-3 md:grid-cols-2 animate-in fade-in">
                  <div className="space-y-1.5">
                    <div className="text-[11px] font-semibold text-gray-400">Hiện trước nội dung chương</div>
                    <RichTextEditor value={introNote} onChange={setIntroNote} minHeight={90} placeholder="Ví dụ: lịch ra chương, cảm ơn ủng hộ..." />
                  </div>
                  <div className="space-y-1.5">
                    <div className="text-[11px] font-semibold text-gray-400">Hiện sau nội dung chương</div>
                    <RichTextEditor value={outroNote} onChange={setOutroNote} minHeight={90} placeholder="Ví dụ: giải thích thuật ngữ, link nhóm..." />
                  </div>
                </div>
              )}
            </div>

            {/* Advanced: translator notes & inline images, opt-in */}
            <div className="pt-3 border-t border-white/10">
              <button
                type="button"
                onClick={() => setShowAnnotations(!showAnnotations)}
                className="text-xs font-bold text-gray-400 hover:text-white flex items-center gap-1.5 transition"
              >
                <MessageSquare className="w-3.5 h-3.5" />
                <span>Chú thích đánh số [1] theo đoạn (tùy chọn)</span>
                <span className="text-[10px] font-normal text-gray-500">
                  {annotationEntries.length > 0 ? `— ${annotationEntries.length} mục` : ''}
                </span>
              </button>

              {showAnnotations && (
                <div className="mt-3 space-y-3 animate-in fade-in">
                  {!hasText ? (
                    <p className="text-[11px] text-gray-500">Nhập nội dung chương trước để có thể gắn chú thích vào từng đoạn. Ảnh minh họa chèn thẳng trong trình soạn thảo.</p>
                  ) : (
                    <>
                      <div className="flex items-center gap-2">
                        <select
                          value={annotationTargetIdx}
                          onChange={(e) => setAnnotationTargetIdx(e.target.value === '' ? '' : Number(e.target.value))}
                          className="h-9 px-3 rounded-xl bg-surface-3 border border-white/10 text-xs text-white"
                        >
                          <option value="">Chọn đoạn văn...</option>
                          {paragraphs.map((p, idx) => p && (
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

            {introNote && (
              <aside className="nh-message">
                <div className="nh-message__label"><MessageSquare className="w-3.5 h-3.5" /> Lời người dịch</div>
                <RichContent content={introNote} />
              </aside>
            )}

            {editorBlocks.length === 0 ? (
              <p className="text-center text-gray-500 text-sm font-sans">Chưa có nội dung để xem trước.</p>
            ) : (
              <div className="space-y-4">
                {editorBlocks.map((block, idx) => (
                  <div key={idx} className="space-y-3">
                    <div
                      className="chapter-rich px-2"
                      dangerouslySetInnerHTML={{ __html: (() => {
                        const html = enhanceChapterHtml(rewriteHtmlImages(block.html, imageQuality));
                        const n = annotations[idx]?.note ? annotationEntries.indexOf(idx) + 1 : 0;
                        return n > 0 ? withFootnoteMarker(html, n) : html;
                      })() }}
                    />

                    {annotations[idx]?.note && (
                      <div className="nh-note">
                        <div className="nh-note__head"><span>Chú thích [{annotationEntries.indexOf(idx) + 1}]</span></div>
                        <div className="whitespace-pre-line">{annotations[idx]?.note}</div>
                      </div>
                    )}

                  </div>
                ))}
              </div>
            )}

            {outroNote && (
              <aside className="nh-message">
                <div className="nh-message__label"><MessageSquare className="w-3.5 h-3.5" /> Lời người dịch</div>
                <RichContent content={outroNote} />
              </aside>
            )}
          </div>
        )}

        </>)}

        {/* Action Toolbar */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-4 border-t border-white/10">
          <div className="text-xs text-gray-400">
            * Người giữ truyện (chủ truyện, Trưởng nhóm/Mod nhóm) đăng thẳng; thành viên nhóm và cộng tác viên gửi đề xuất để họ duyệt.
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
            {!isMangaEdit && draft?.access !== 'viewer' && (
            <button
              type="button"
              onClick={() => saveDraftNow()}
              disabled={!selectedStoryId || isSubmitting || saveState === 'saving' || Boolean(lockBlockedBy) || (draft && draft.status !== 'open') || (!draft && !chapterTitle.trim() && !hasText)}
              className="px-5 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 disabled:opacity-40 text-white font-bold text-xs border border-white/15 flex items-center gap-1.5 transition"
              title="Bản nháp tự lưu sau vài giây; bấm để lưu ngay. Độc giả chưa thấy."
            >
              <Save className="w-3.5 h-3.5" />
              <span>Lưu nháp</span>
            </button>
            )}

            {draft && (draft.access !== 'owner' || draft.copied_from) ? null : !isMangaEdit && draft?.can_merge === false ? (
              <>
                <input
                  value={proposalNote}
                  onChange={(e) => setProposalNote(e.target.value)}
                  maxLength={2000}
                  placeholder="Lời nhắn cho người duyệt (tùy chọn)"
                  className="h-10 min-w-0 flex-1 sm:w-64 px-3 rounded-xl bg-white/5 border border-white/10 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-brand-500"
                />
                <button
                  type="button"
                  onClick={handlePropose}
                  disabled={!chapterTitle.trim() || isSubmitting || Boolean(draft?.chapter_deleted) || draft.status !== 'open' || editLoadState !== 'ready'}
                  className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-brand-600 to-indigo-600 hover:from-brand-500 hover:to-indigo-500 disabled:opacity-40 text-snow font-bold text-xs shadow-xl shadow-brand-500/25 flex items-center gap-2 transition"
                  title="Người giữ truyện (chủ truyện, Trưởng nhóm/Mod nhóm) sẽ xem và gộp vào bản chính"
                >
                  <Send className="w-4 h-4" />
                  <span>{isSubmitting ? 'Đang gửi...' : draft.last_round > 0 ? 'Gửi lại đề xuất' : 'Gửi đề xuất'}</span>
                </button>
              </>
            ) : (
            <>
              {!isMangaEdit && draft?.can_merge && (
                <input
                  type="datetime-local"
                  value={publishAt}
                  onChange={(e) => setPublishAt(e.target.value)}
                  title="Hẹn giờ đăng (để trống = đăng ngay)"
                  aria-label="Hẹn giờ đăng"
                  className="h-10 px-3 rounded-xl bg-white/5 border border-white/10 text-xs text-white focus:outline-none focus:border-brand-500"
                />
              )}
            <button
                type="button"
                onClick={handlePublish}
                disabled={!selectedStoryId || !chapterTitle.trim() || isSubmitting || behind || Boolean(draft?.chapter_deleted) || (draft && draft.status !== 'open') || ((isEditMode || Boolean(draftParam)) && editLoadState !== 'ready')}
                title={behind ? 'Cập nhật theo bản chính trước khi đăng' : undefined}
                className="px-8 py-2.5 rounded-xl bg-gradient-to-r from-brand-600 to-indigo-600 hover:from-brand-500 hover:to-indigo-500 disabled:opacity-40 text-snow font-bold text-xs shadow-xl shadow-brand-500/25 flex items-center gap-2 transition hover:scale-105"
              >
                <Send className="w-4 h-4" />
                <span>{isSubmitting ? 'Đang gửi...' : isMangaEdit ? 'Lưu Thay Đổi' : publishAt ? 'Hẹn đăng' : draft?.chapter_id ? 'Đăng bản sửa' : 'Đăng Chương'}</span>
              </button>
            </>
            )}
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
