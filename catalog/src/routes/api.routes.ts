import express, { Router } from 'express';
import { requireAuth, optionalAuth, requireRole } from '../middlewares/auth.middleware';
import { 
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

// Health check: modules/system (Nest)

// Account: sign-up/in, sessions, passwords, email, roles, bans, deletion live in the identity service (/api/identity/*).
// Here: the profile side of "who am I" and the optional demo-account list.

// File & Image Uploads (Multipart/Form-Data)

// Tags & Categories
// /tags: modules/tags (Nest)

// Stories: modules/stories (Nest); creating a story is still here
// Volumes: modules/volumes (Nest)

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

// Translation groups: modules/groups (Nest)

// Direct messages and group chat: the messaging service (/api/msg/*)

export default router;
