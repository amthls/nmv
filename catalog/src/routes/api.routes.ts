import express, { Router } from 'express';
import { 
  getStories, 
  exploreStories, 
  getTrendingStories, 
  getRecentlyUpdatedStories, 
  getFeaturedIllustrations,
  getStoryBySlug,
  getChapterBySlug,
  updateStory,
  deleteStory,
  removeStory,
  restoreStory,
  getStoryCollaborators,
  addStoryCollaborator,
  removeStoryCollaborator,
  getManageableStories,
} from '../controllers/story.controller';
import { requireAuth, optionalAuth, requireRole } from '../middlewares/auth.middleware';
import { 
  getGroups, 
  getGroupBySlug, 
  createGroup, 
  updateGroup,
  updateGroupWorkflow,
  addGroupMember,
  updateGroupMemberRole,
  removeGroupMember,
  requestToJoinGroup,
  cancelMyJoinRequest,
  getGroupJoinRequests,
  approveJoinRequest,
  rejectJoinRequest,
} from '../controllers/group.controller';
import { 
  createStory, 
  createVolume, 
  updateVolume,
  deleteVolume,
  reorderVolumes,
  submitChapter, 
  getChapterForEdit,
  updateChapter,
  deleteChapter,
  createDraft,
  saveDraft,
  publishDraft,
  submitDraft,
  withdrawDraft,
  returnDraft,
  shareDraft,
  transferDraft,
  offerDraft,
} from '../controllers/chapter.controller';

import { cacheJson } from '../middlewares/cache';
import { searchLimiter, perUserLimiter } from '../middlewares/security';

const router = Router();

// Spam control for user-generated content, per signed-in user
const albumLimiter = perUserLimiter({ windowMs: 60 * 60_000, limit: 60, message: 'Bạn tạo/sao chép album quá nhiều. Vui lòng thử lại sau.' });
const joinRequestLimiter = perUserLimiter({ windowMs: 60 * 60_000, limit: 10, message: 'Bạn gửi quá nhiều yêu cầu gia nhập. Vui lòng thử lại sau.' });

// Health check: modules/system (Nest)

// Account: sign-up/in, sessions, passwords, email, roles, bans, deletion live in the identity service (/api/identity/*).
// Here: the profile side of "who am I" and the optional demo-account list.

// File & Image Uploads (Multipart/Form-Data)

// Tags & Categories
// /tags: modules/tags (Nest)

// Stories
router.get('/stories', searchLimiter, getStories);
// same answer for everyone: popular queries (and the search-as-you-type suggestions) hit Redis, not Elasticsearch
router.get('/stories/explore', searchLimiter, cacheJson(30), exploreStories);
router.get('/stories/trending', cacheJson(120), getTrendingStories);
router.get('/stories/recently-updated', cacheJson(60), getRecentlyUpdatedStories);
router.get('/stories/illustrations', cacheJson(300), getFeaturedIllustrations);
router.get('/stories/manageable', requireAuth, getManageableStories);
router.get('/stories/:slug', optionalAuth, getStoryBySlug);
router.get('/stories/:slug/chapters/:chapterSlug', optionalAuth, getChapterBySlug);
router.post('/stories', requireAuth, createStory);
router.put('/stories/:id', requireAuth, updateStory);
router.delete('/stories/:id', requireAuth, deleteStory);
// Admin/Mod take a story down (soft) or restore it; listed at GET /moderation/removed
router.post('/stories/:id/remove', requireAuth, removeStory);
router.post('/stories/:id/restore', requireAuth, restoreStory);
router.get('/stories/:id/collaborators', getStoryCollaborators);
router.post('/stories/:id/collaborators', requireAuth, addStoryCollaborator);
router.delete('/stories/:id/collaborators/:userId', requireAuth, removeStoryCollaborator);
router.post('/stories/:storyId/volumes', requireAuth, createVolume);
router.put('/stories/:storyId/volumes/reorder', requireAuth, reorderVolumes);
router.put('/volumes/:id', requireAuth, updateVolume);
router.delete('/volumes/:id', requireAuth, deleteVolume);

// Chapters (published straight away, no review)
router.post('/chapters/submissions', requireAuth, submitChapter);
router.get('/chapters/:id', requireAuth, getChapterForEdit);
router.put('/chapters/:id', requireAuth, updateChapter);
router.delete('/chapters/:id', requireAuth, deleteChapter);
// Drafts (workspace): content passes the HTML filter here; reading/pulling/discarding is on /api/ws
router.post('/drafts', requireAuth, createDraft);
router.put('/drafts/:id', requireAuth, saveDraft);
router.post('/drafts/:id/publish', requireAuth, publishDraft);
router.post('/drafts/:id/submit', requireAuth, submitDraft);
router.post('/drafts/:id/withdraw', requireAuth, withdrawDraft);
router.post('/drafts/:id/return', requireAuth, returnDraft);
router.post('/drafts/:id/share', requireAuth, shareDraft);
router.post('/drafts/:id/transfer', requireAuth, transferDraft);
router.post('/drafts/:id/offer', requireAuth, offerDraft);


// Notifications
// Notifications: the messaging service (/api/msg/notifications*)

// Reading History

// Bookmarks & Favorites

// Albums: named story lists, shareable by link, saveable and copyable by other users


// Comments, violation reports, removed content, Fandom posts: the community service (/api/community/*)

// Users & Profile Settings

// Translation Groups
router.get('/groups', optionalAuth, getGroups);
router.get('/groups/:slug', optionalAuth, getGroupBySlug);
router.post('/groups', requireAuth, createGroup);
router.put('/groups/:id', requireAuth, updateGroup);
router.put('/groups/:id/workflow', requireAuth, updateGroupWorkflow);
router.post('/groups/:id/members', requireAuth, addGroupMember);
router.put('/groups/:id/members/:memberUserId', requireAuth, updateGroupMemberRole);
router.delete('/groups/:id/members/:memberUserId', requireAuth, removeGroupMember);
// Join requests: user asks, group leader/mod (or admin) approves or rejects
router.post('/groups/:id/join-requests', requireAuth, joinRequestLimiter, requestToJoinGroup);
router.delete('/groups/:id/join-requests/me', requireAuth, cancelMyJoinRequest);
router.get('/groups/:id/join-requests', requireAuth, getGroupJoinRequests);
router.post('/groups/:id/join-requests/:requestId/approve', requireAuth, approveJoinRequest);
router.post('/groups/:id/join-requests/:requestId/reject', requireAuth, rejectJoinRequest);

// Direct messages and group chat: the messaging service (/api/msg/*)

export default router;
