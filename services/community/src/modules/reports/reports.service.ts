import { Injectable } from '@nestjs/common';
import { isStaff, Viewer } from '../../common/utils/auth';
import { InputError } from '../../common/utils/validation';
import { chapters, profiles, stories } from '../../infra/clients/backend';
import { ReportsRepository } from './reports.repository';

// Moved from the backend's report.controller.ts (Plan/community.md): same routes and JSON under /api/community.

const TARGETS = ['story', 'chapter', 'comment', 'post'];
const REASONS = ['spam', 'inappropriate', 'copyright', 'wrong_info', 'harassment', 'other'];
// Spam guard on top of the per-hour limiter in the routes and the one-pending-report unique index
const DAILY_REPORT_LIMIT = 30;
const REREPORT_COOLDOWN_HOURS = 24;

@Injectable()
export class ReportsService {
  constructor(private readonly repo: ReportsRepository) {}

  /** What a report points at as it is now: preview, code, path (story/chapter pages are /truyen/<path>, posts /fandom/<path>). */
  private async snapshot(type: string, id: string): Promise<{ preview: string | null; code: string | null; path: string | null } | null> {
    if (type === 'post') {
      const r = await this.repo.postBrief(id);
      return r ? { preview: r.title, code: r.code, path: r.slug } : null;
    }
    if (type === 'comment') {
      const r = await this.repo.commentBrief(id);
      return r ? { preview: r.preview, code: null, path: null } : null;
    }
    const ch = type === 'chapter' ? (await chapters([id])).get(id) : undefined;
    const st = (await stories([ch ? ch.story_id : id])).get(ch ? ch.story_id : id);
    if (!st || (type === 'chapter' && !ch)) return null;
    return ch
      ? { preview: `${st.title} · ${ch.title}`, code: `${st.code}-C${ch.chapter_number}`, path: `${st.slug}/${ch.slug}` }
      : { preview: st.title, code: st.code, path: st.slug };
  }

  /** File a violation report against a story, chapter, comment or post. */
  async create(viewer: Viewer, body: any) {
    const { target_type, target_id, reason, description } = body || {};
    if (!TARGETS.includes(target_type)) throw new InputError('target_type phải là story, chapter, comment hoặc post.');
    if (!REASONS.includes(reason)) throw new InputError(`Lý do không hợp lệ. Chọn một trong: ${REASONS.join(', ')}.`);
    if (typeof target_id !== 'string' || !/^[0-9a-f-]{36}$/i.test(target_id)) throw new InputError('target_id không hợp lệ.');
    const target = await this.snapshot(target_type, target_id);
    if (!target) throw new InputError('Nội dung bị báo cáo không tồn tại.', 404);

    const me = viewer.id;
    const g = await this.repo.guardCounts(me, target_type, target_id, REREPORT_COOLDOWN_HOURS);
    if (g.pending) throw new InputError('Bạn đã báo cáo nội dung này và đang chờ xử lý.', 409);
    if (g.recently_handled) {
      throw new InputError(`Báo cáo trước của bạn về nội dung này vừa được xử lý. Vui lòng chờ ${REREPORT_COOLDOWN_HOURS} giờ trước khi báo cáo lại.`, 429);
    }
    if (g.today >= DAILY_REPORT_LIMIT) {
      throw new InputError(`Mỗi ngày chỉ gửi được tối đa ${DAILY_REPORT_LIMIT} báo cáo. Vui lòng thử lại sau.`, 429);
    }

    let row;
    try {
      row = await this.repo.insert([me, target_type, target_id, reason, typeof description === 'string' ? description.trim().slice(0, 1000) || null : null,
        target.preview, target.code, target.path]);
    } catch (err: any) {
      // uq_reports_pending: a second click that raced past the check above
      if (err.code === '23505') throw new InputError('Bạn đã báo cáo nội dung này và đang chờ xử lý.', 409);
      throw err;
    }
    return { success: true, message: 'Đã gửi báo cáo. Cảm ơn bạn, ban quản trị sẽ xem xét.', data: row };
  }

  /**
   * List reports for moderators: `status` (pending|resolved|dismissed|all), `type` (story|chapter|comment|post),
   * `q` (report code, the reported item's code or title, the reporter's description). Each row carries a preview,
   * the reported item's code and link, whether it was taken down, and how many reports on it are still pending.
   */
  async list(viewer: Viewer, query: Record<string, any>) {
    if (!isStaff(viewer)) throw new InputError('Chỉ Admin/Mod mới xem được báo cáo.', 403);
    const status = typeof query.status === 'string' ? query.status : 'pending';
    const type = typeof query.type === 'string' && TARGETS.includes(query.type) ? query.type : null;
    const q = typeof query.q === 'string' ? query.q.trim().slice(0, 100) : '';
    const pageNum = Math.max(1, parseInt(query.page as string) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(query.limit as string) || 30));

    const params: any[] = [];
    const where: string[] = [];
    if (status !== 'all') { params.push(status); where.push(`r.status = $${params.length}`); }
    if (type) { params.push(type); where.push(`r.target_type = $${params.length}`); }
    if (q) {
      params.push(`%${q.replace(/[\\%_]/g, '\\$&')}%`);
      const n = params.length;
      where.push(`(r.code ILIKE $${n} OR r.description ILIKE $${n} OR t.code ILIKE $${n} OR t.preview ILIKE $${n})`);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const [total, rows] = await Promise.all([
      this.repo.count(whereSql, params),
      this.repo.list(whereSql, params, limitNum, (pageNum - 1) * limitNum),
    ]);

    // Reporter names, and whether a reported story (or a chapter's story) has been taken down
    const chs = await chapters(rows.filter((r) => r.target_type === 'chapter').map((r) => r.target_id));
    const [people, sts] = await Promise.all([
      profiles(rows.map((r) => r.reporter_id)),
      stories([...rows.filter((r) => r.target_type === 'story').map((r) => r.target_id), ...[...chs.values()].map((c) => c.story_id)]),
    ]);
    const data = rows.map(({ reporter_id, ...r }) => {
      const storyId = r.target_type === 'story' ? r.target_id : chs.get(r.target_id)?.story_id;
      const removed = r.target_type === 'story' || r.target_type === 'chapter'
        ? sts.get(storyId)?.approval_status === 'rejected'
        : r.target_removed;
      const u = people.get(reporter_id);
      return { ...r, target_removed: removed, reporter_username: u?.username ?? null, reporter_name: u?.display_name ?? null };
    });

    return { success: true, data, pagination: { page: pageNum, limit: limitNum, total } };
  }

  /** Close a report as resolved (action taken) or dismissed (no violation). */
  async resolve(viewer: Viewer, id: string, body: any) {
    if (!isStaff(viewer)) throw new InputError('Chỉ Admin/Mod mới xử lý được báo cáo.', 403);
    const { status, resolution_note } = body || {};
    if (!['resolved', 'dismissed'].includes(status)) throw new InputError('status phải là resolved hoặc dismissed.');
    let upd;
    try {
      upd = await this.repo.resolve(status, typeof resolution_note === 'string' ? resolution_note.trim().slice(0, 1000) || null : null, viewer.id, id);
    } catch (error: any) {
      if (error?.code === '22P02') throw new InputError('Báo cáo không tồn tại.', 404);
      throw error;
    }
    if (upd.length === 0) throw new InputError('Báo cáo không tồn tại.', 404);
    return { success: true, message: 'Đã cập nhật báo cáo.', data: upd[0] };
  }
}
