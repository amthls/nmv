/**
 * What to notify whom. Controllers build NotifyItems here and hand them to the queue (queue.service.ts); the messaging
 * service stores them (Plan/messaging.md, E3): it drops kinds people switched off, merges same-kind unread ones and
 * never delivers a dedupeKey twice.
 */

/** Must be registered in services/messaging/notify.go (category, can it be switched off, does it merge). */
export type NotifyType =
  | 'chapter_update' | 'comment_reply' | 'post_comment' | 'post_reaction'
  | 'group_join_request' | 'group_member_add' | 'group_join_rejected'
  | 'draft_submitted' | 'draft_returned' | 'draft_merged' | 'draft_offered' | 'draft_transferred' | 'task_opened'
  | 'story_removed' | 'story_restored' | 'post_removed' | 'post_restored' | 'admin_alert';

export interface NotifyItem {
  userId: string;
  type: NotifyType;
  title: string;
  message: string | null;
  // draft: a workspace proposal (/ws/de-xuat/:id); draft_edit: a draft to open in the editor (/dang-chuong?draft=:id)
  // ws_story: the story's workspace page (/ws/truyen/:slug), e.g. a task. Turned into `link` before queuing.
  referenceType: 'chapter' | 'post' | 'story' | 'group' | 'draft' | 'draft_edit' | 'ws_story' | null;
  referenceId: string | null;
  senderId: string | null;
  /** shown when several people's notifications merge ("Yuki và 3 người khác…") */
  actorName?: string;
  /** snapshot for merged titles: story_title, group_name */
  data?: Record<string, string>;
  dedupeKey: string;
  /** set by queue.service.ts */
  link?: string | null;
  image?: string | null;
}

export interface ChapterPublishedJob {
  kind: 'chapter_published';
  storyId: string;
  chapterId: string;
  chapterTitle: string;
  uploaderId: string | null;
  /** set by queue.service.ts */
  storyTitle?: string;
  link?: string | null;
  image?: string | null;
}

export interface NotifyJob {
  kind: 'notify';
  items: NotifyItem[];
}

export type NotificationJob = ChapterPublishedJob | NotifyJob;

// ---------------------------------------------------------------------------
// Builders used by controllers: describe *what happened*; delivery is the queue's business.
// ---------------------------------------------------------------------------

const snippet = (text: string, n = 80) => {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
};

export function commentNotifications(input: {
  commentId: string;
  actorId: string;
  actorName: string;
  content: string;
  targetType: 'chapter' | 'post' | 'story';
  targetId: string;
  postOwnerId?: string | null;
  postTitle?: string | null;
  parentAuthorId?: string | null;
}): NotifyItem[] {
  const items: NotifyItem[] = [];
  const seen = new Set<string>([input.actorId]); // never notify yourself, never twice
  const ref = { referenceType: input.targetType, referenceId: input.targetId, senderId: input.actorId } as const;

  if (input.parentAuthorId && !seen.has(input.parentAuthorId)) {
    seen.add(input.parentAuthorId);
    items.push({
      userId: input.parentAuthorId, type: 'comment_reply', ...ref, actorName: input.actorName,
      title: `${input.actorName} đã trả lời bình luận của bạn`,
      message: snippet(input.content),
      dedupeKey: `comment:${input.commentId}:${input.parentAuthorId}`,
    });
  }
  if (input.targetType === 'post' && input.postOwnerId && !seen.has(input.postOwnerId)) {
    seen.add(input.postOwnerId);
    items.push({
      userId: input.postOwnerId, type: 'post_comment', ...ref, actorName: input.actorName,
      title: `${input.actorName} đã bình luận bài viết của bạn`,
      message: `${input.postTitle ? `"${snippet(input.postTitle, 60)}": ` : ''}${snippet(input.content)}`,
      dedupeKey: `comment:${input.commentId}:${input.postOwnerId}`,
    });
  }
  return items;
}

export function postReactionNotification(input: {
  postId: string; postTitle: string; postOwnerId: string; actorId: string; actorName: string; reaction: string;
}): NotifyItem[] {
  if (input.postOwnerId === input.actorId) return [];
  return [{
    userId: input.postOwnerId, type: 'post_reaction',
    title: `${input.actorName} đã bày tỏ cảm xúc về bài viết của bạn`,
    message: `"${snippet(input.postTitle, 80)}" (${input.reaction})`,
    referenceType: 'post', referenceId: input.postId, senderId: input.actorId, actorName: input.actorName,
    // one notification per person per post, however often they change or toggle the reaction
    dedupeKey: `reaction:${input.postId}:${input.actorId}`,
  }];
}

export function postReviewNotifications(
  posts: { id: string; user_id: string; title: string }[], approved: boolean, moderatorId: string, reason?: string | null,
): NotifyItem[] {
  const at = Date.now(); // a post can be taken down again after a restore: each action is its own notification
  return posts
    .filter((p) => p.user_id && p.user_id !== moderatorId)
    .map((p) => ({
      userId: p.user_id, type: approved ? 'post_restored' as const : 'post_removed' as const,
      title: approved ? 'Bài viết của bạn đã được khôi phục' : 'Bài viết của bạn đã bị Ban quản trị gỡ',
      message: `"${snippet(p.title, 100)}"${!approved && reason ? ` · Lý do: ${snippet(reason, 200)}` : ''}`,
      referenceType: 'post' as const, referenceId: p.id, senderId: moderatorId,
      dedupeKey: `post-review:${p.id}:${approved ? 'approved' : 'rejected'}:${at}`,
    }));
}

/** Tell every leader/mod of a group that someone asked to join. */
export function groupJoinRequestNotifications(input: {
  requestId: string; groupId: string; groupName: string; managerIds: string[]; requesterId: string; requesterName: string; message: string | null;
}): NotifyItem[] {
  return input.managerIds
    .filter((id) => id !== input.requesterId)
    .map((managerId) => ({
      userId: managerId, type: 'group_join_request' as const,
      title: `${input.requesterName} muốn gia nhập nhóm ${input.groupName}`,
      message: input.message ? `"${snippet(input.message, 120)}"` : null,
      referenceType: 'group' as const, referenceId: input.groupId, senderId: input.requesterId,
      actorName: input.requesterName, data: { group_name: input.groupName },
      dedupeKey: `group-join:${input.requestId}:${managerId}`,
    }));
}

/** Tell the requester the leader's decision. */
export function groupJoinDecisionNotification(input: {
  requestId: string; groupId: string; groupName: string; requesterId: string; reviewerId: string; approved: boolean;
}): NotifyItem[] {
  return [{
    userId: input.requesterId,
    type: input.approved ? 'group_member_add' : 'group_join_rejected',
    title: input.approved
      ? `Bạn đã được duyệt vào nhóm ${input.groupName}`
      : `Yêu cầu gia nhập nhóm ${input.groupName} không được chấp nhận`,
    message: null,
    referenceType: 'group', referenceId: input.groupId, senderId: input.reviewerId,
    dedupeKey: `group-join-decision:${input.requestId}`,
  }];
}

/**
 * Workspace proposals (Plan/chapter-workspace.md, stage 3): a submitted draft goes to the story keepers;
 * a return or a merge goes back to its author. Opens the review page /ws/de-xuat/:draftId.
 */
export function draftNotifications(input: {
  event: 'submitted' | 'returned' | 'merged' | 'offered' | 'transferred'; draftId: string; round: number; recipientIds: string[]; actorId: string;
  actorName: string; chapterLabel: string; storyTitle: string; note?: string | null;
}): NotifyItem[] {
  const title = {
    submitted: `${input.actorName} gửi đề xuất ${input.chapterLabel} (${input.storyTitle})`,
    returned: `Đề xuất ${input.chapterLabel} được trả lại để sửa`,
    merged: `Đề xuất ${input.chapterLabel} đã được gộp vào bản chính`,
    offered: `${input.actorName} gửi lại bản sửa giúp cho nháp ${input.chapterLabel}`,
    transferred: `${input.actorName} giao cho bạn bản nháp ${input.chapterLabel} (${input.storyTitle})`,
  }[input.event];
  return [...new Set(input.recipientIds)]
    .filter((id) => id && id !== input.actorId)
    .map((userId) => ({
      userId, type: `draft_${input.event}` as NotifyType, title, actorName: input.actorName,
      message: input.note ? `"${snippet(input.note, 160)}"` : input.event === 'submitted' ? 'Mở để xem thay đổi và gộp hoặc trả lại.' : null,
      referenceType: input.event === 'offered' || input.event === 'transferred' ? 'draft_edit' as const : 'draft' as const,
      referenceId: input.draftId, senderId: input.actorId,
      // a proposal round is notified once; offers and hand-overs can repeat
      dedupeKey: `draft:${input.draftId}:${input.event === 'offered' || input.event === 'transferred' ? Date.now() : input.round}:${input.event}:${userId}`,
    }));
}
