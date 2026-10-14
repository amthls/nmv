import { Injectable } from '@nestjs/common';
import { canUserManageStory, clientErrors } from '../stories/story-access';
import { InputError, optionalUrl } from '../../utils/validation';
import { VolumesRepository } from './volumes.repository';

export type VolumeUser = { id: string };

/** Volumes (tập) of a story; only the story team edits them. */
@Injectable()
export class VolumesService {
  constructor(private readonly repo: VolumesRepository) {}

  create(storyId: string, user: VolumeUser, body: any) {
    return clientErrors(async () => {
      const { title, volume_number, cover_image_url, description } = body;

      if (!(await canUserManageStory(user.id, storyId))) {
        throw new InputError('Bạn không phải chủ thầu của truyện này để thêm tập mới.', 403);
      }

      // No number given: take the next free one. A taken number is refused (update edits volumes).
      let num: number;
      if (volume_number === undefined || volume_number === null || volume_number === '') {
        num = await this.repo.nextNumber(storyId);
      } else {
        num = Number(volume_number);
        if (!Number.isInteger(num) || num < 1 || num > 100000) throw new InputError('Số tập không hợp lệ.', 400);
      }
      const volTitle = (typeof title === 'string' && title.trim()) ? title.trim().slice(0, 500) : `Tập ${num}`;
      const coverUrl = optionalUrl(cover_image_url, 'Ảnh bìa tập') ?? null;
      const desc = typeof description === 'string' ? description.trim() || null : null;

      const volume = await this.repo.insert(storyId, volTitle, num, coverUrl, desc);
      if (!volume) throw new InputError(`Tập ${num} đã tồn tại trong bộ truyện này.`, 409);
      return { title: volTitle, volume };
    });
  }

  async update(id: string, user: VolumeUser, body: any) {
    const vol = await this.repo.byId(id);
    if (!vol) throw new InputError('Tập không tồn tại.', 404);
    if (!(await canUserManageStory(user.id, vol.story_id))) throw new InputError('Bạn không có quyền sửa tập của truyện này.', 403);

    const { title, description, cover_image_url } = body;
    if (title !== undefined && !String(title).trim()) throw new InputError('Tên tập không được để trống.', 400);
    return this.repo.update(
      id,
      title === undefined ? vol.title : String(title).trim(),
      description === undefined ? vol.description : (description || null),
      cover_image_url === undefined ? vol.cover_image_url : (cover_image_url || null),
    );
  }

  /** Delete a volume. Its chapters are kept and simply become "unassigned" (volume_id = NULL). */
  async remove(id: string, user: VolumeUser) {
    const vol = await this.repo.byId(id);
    if (!vol) throw new InputError('Tập không tồn tại.', 404);
    if (!(await canUserManageStory(user.id, vol.story_id))) throw new InputError('Bạn không có quyền xóa tập của truyện này.', 403);

    const moved = await this.repo.deleteKeepingChapters(id, vol.story_id);
    return `Đã xóa "${vol.title}". ${moved} chương của tập được giữ lại và chuyển sang "chưa phân tập".`;
  }

  /**
   * Re-order volumes of a story. Body: { order: [volumeId, ...] } (must list every volume once).
   * volume_number and sort_order are rewritten as 1..n in that order.
   */
  async reorder(storyId: string, user: VolumeUser, body: any) {
    const { order } = body;
    if (!(await canUserManageStory(user.id, storyId))) throw new InputError('Bạn không có quyền sắp xếp tập của truyện này.', 403);
    if (!Array.isArray(order) || order.length === 0) throw new InputError('Thiếu danh sách thứ tự tập (order).', 400);

    await this.repo.reorder(storyId, order, (existingIds) => {
      if (order.length !== existingIds.size || new Set(order).size !== order.length || !order.every((v: string) => existingIds.has(v))) {
        throw new InputError('Danh sách phải gồm đúng tất cả các tập của truyện, mỗi tập một lần.', 400);
      }
    });
    return this.repo.listByStory(storyId);
  }
}
