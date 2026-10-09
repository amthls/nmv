export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api/v1';

export interface AlbumPreviewStory {
  id: string;
  slug: string;
  title: string;
  cover_image_url: string | null;
}

export interface AlbumSummary {
  id: string;
  code: string;
  name: string;
  description: string | null;
  is_public: boolean;
  owner_id: string;
  owner_username: string;
  owner_name: string | null;
  owner_avatar: string | null;
  story_count: number;
  save_count: number;
  preview: AlbumPreviewStory[];
  updated_at: string;
  /** owner only */
  share_token?: string;
  /** /albums/me?story_id= : the album already holds that story */
  has_story?: boolean;
  /** the viewer saved this album */
  is_saved?: boolean;
  /** /albums/saved : key needed to open a private album saved through its link */
  share_key?: string | null;
}

export interface AlbumDetail extends AlbumSummary {
  is_owner: boolean;
  copied_from: string | null;
  copied_from_name: string | null;
  stories: Array<AlbumPreviewStory & {
    author_name: string | null;
    story_type: string;
    status: string;
    total_chapters: number;
    added_at: string;
  }>;
}

/** Page path of an album; a private album needs its share key in the link. */
export const albumPath = (album: { id: string; is_public?: boolean; share_token?: string; share_key?: string | null }) => {
  const key = album.is_public ? null : album.share_token || album.share_key;
  return `/album/${album.id}${key ? `?key=${encodeURIComponent(key)}` : ''}`;
};

/** Full link to hand out: public albums open for everyone, private ones only with the key. */
export const albumShareUrl = (album: { id: string; is_public?: boolean; share_token?: string }) =>
  `${typeof window !== 'undefined' ? window.location.origin : ''}${albumPath(album)}`;

/** Copies text to the clipboard; returns false when the browser refuses (caller shows the text). */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Reads `{success, message, data}` and throws the server's message on failure. */
export async function readJson(res: Response) {
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.success) throw new Error(json?.message || `HTTP ${res.status}`);
  return json;
}
