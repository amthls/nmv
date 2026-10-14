import { sanitizeRichText } from '../../../utils/richText';
import { InputError, isUuid, optionalEnum, optionalText, optionalUrl, requiredText } from '../../../utils/validation';

const STORY_TYPES = ['novel', 'manga'] as const;
const STORY_STATUSES = ['ongoing', 'completed', 'hiatus', 'dropped'] as const;

/** Story fields from a create/update body. A field left undefined was not sent; null clears it. */
export interface StoryInput {
  title?: string;
  original_title?: string | null;
  synopsis?: string | null;
  cover_image_url?: string | null;
  banner_image_url?: string | null;
  story_type?: typeof STORY_TYPES[number];
  status?: typeof STORY_STATUSES[number];
  author_name?: string | null;
  artist_name?: string | null;
  original_language?: string | null;
  group_id?: string | null;
  tags?: string[];
  allow_download?: boolean; // readers may download EPUB/PDF
}

/** Validates the story fields of a request body (throws InputError). */
export function parseStoryInput(body: any, isCreate: boolean): StoryInput {
  const input: StoryInput = {};
  if (isCreate || body.title !== undefined) input.title = requiredText(body.title, 500, 'Tên truyện');
  input.original_title = optionalText(body.original_title, 500, 'Tên gốc');
  if (body.synopsis !== undefined) {
    if (body.synopsis !== null && typeof body.synopsis !== 'string') throw new InputError('Tóm tắt không hợp lệ.');
    input.synopsis = sanitizeRichText(body.synopsis) || null;
  }
  input.cover_image_url = optionalUrl(body.cover_image_url, 'Ảnh bìa');
  input.banner_image_url = optionalUrl(body.banner_image_url, 'Ảnh banner');
  input.story_type = optionalEnum(body.story_type, STORY_TYPES, 'Loại truyện');
  input.status = optionalEnum(body.status, STORY_STATUSES, 'Tình trạng');
  input.author_name = optionalText(body.author_name, 200, 'Tác giả');
  input.artist_name = optionalText(body.artist_name, 200, 'Họa sĩ');
  input.original_language = optionalText(body.original_language, 10, 'Ngôn ngữ gốc');
  if (body.group_id !== undefined) {
    if (body.group_id !== null && body.group_id !== '' && !isUuid(body.group_id)) throw new InputError('Nhóm dịch không hợp lệ.');
    input.group_id = body.group_id || null;
  }
  if (body.allow_download !== undefined) {
    if (typeof body.allow_download !== 'boolean') throw new InputError('Tùy chọn cho phép tải không hợp lệ.');
    input.allow_download = body.allow_download;
  }
  if (body.tags !== undefined) {
    if (!Array.isArray(body.tags) || body.tags.length > 50 || !body.tags.every(isUuid)) {
      throw new InputError('Danh sách thẻ tag không hợp lệ.');
    }
    input.tags = Array.from(new Set<string>(body.tags));
  }
  return input;
}
