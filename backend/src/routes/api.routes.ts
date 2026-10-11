import {
  getNotifications,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  deleteNotification
} from '../controllers/notification.controller';
﻿import express, { Router } from 'express';
import { getTags } from '../controllers/tag.controller';
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
import { 
  getUsers, 
  getUserProfile, 
  getCurrentUserProfile, 
  updateUserProfile, 
  updateUserSettings,
} from '../controllers/user.controller';
import { getMe, getDemoAccounts } from '../controllers/auth.controller';
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
  getPosts, 
  getPostBySlug, 
  createPost, 
  updatePost,
  deletePost,
  approvePost,
  rejectPost,
  reactToPost,
  getFandomSidebar,
  togglePinPost,
  togglePostMute
} from '../controllers/post.controller';
import { getComments, createComment, likeComment, updateComment, deleteComment } from '../controllers/comment.controller';
import { createReport, getReports, resolveReport } from '../controllers/report.controller';
import { getRemovedContent } from '../controllers/moderation.controller';
import { resolveCode } from '../controllers/code.controller';
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
import { 
  getReadingHistory, 
  saveReadingHistory, 
  deleteReadingHistoryItem, 
  clearReadingHistory 
} from '../controllers/history.controller';
import { 
  getBookmarks, 
  createBookmark, 
  deleteBookmark, 
  getFavorites, 
  toggleFavorite,
  checkFavoriteStatus
} from '../controllers/bookmark.controller';
import {
  getMyAlbums,
  getSavedAlbums,
  getAlbumsByStory,
  getAlbum,
  createAlbum,
  updateAlbum,
  setAllAlbumsVisibility,
  deleteAlbum,
  resetShareLink,
  addStoryToAlbum,
  removeStoryFromAlbum,
  toggleSaveAlbum,
  copyAlbum
} from '../controllers/album.controller';

import {
  getHomeRecommendations,
  getRelatedStories,
  postRecEvents,
  trainNow,
  getRecStatus
} from '../controllers/recommendation.controller';
import { getBackupStatus } from '../controllers/backup.controller';
import { queueStatus } from '../services/queue.service';
import { cacheJson } from '../middlewares/cache';
import { searchLimiter, perUserLimiter } from '../middlewares/security';

const router = Router();

// Spam control for user-generated content, per signed-in user
const commentLimiter = perUserLimiter({ windowMs: 5 * 60_000, limit: 30, message: 'Bạn bình luận quá nhanh. Vui lòng chờ một chút.' });
const postLimiter = perUserLimiter({ windowMs: 60 * 60_000, limit: 20, message: 'Bạn đăng bài quá nhiều. Vui lòng thử lại sau.' });
const reactLimiter = perUserLimiter({ windowMs: 60_000, limit: 60, message: 'Bạn thả cảm xúc quá nhanh.' });
const reportLimiter = perUserLimiter({ windowMs: 60 * 60_000, limit: 10, message: 'Bạn gửi quá nhiều báo cáo. Vui lòng thử lại sau.' });
const albumLimiter = perUserLimiter({ windowMs: 60 * 60_000, limit: 60, message: 'Bạn tạo/sao chép album quá nhiều. Vui lòng thử lại sau.' });
const joinRequestLimiter = perUserLimiter({ windowMs: 60 * 60_000, limit: 10, message: 'Bạn gửi quá nhiều yêu cầu gia nhập. Vui lòng thử lại sau.' });

// Health Check
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'NovelHub RESTful API',
    version: '1.0.0',
    queue: queueStatus(), // 'up' | 'down' | 'disabled' (RabbitMQ publisher connection)
  });
});

// Account: sign-up/in, sessions, passwords, email, roles, bans, deletion live in the identity service (/api/identity/*).
// Here: the profile side of "who am I" and the optional demo-account list.
router.get('/auth/me', requireAuth, getMe);
router.get('/auth/accounts', getDemoAccounts);

// File & Image Uploads (Multipart/Form-Data)

// Tags & Categories
router.get('/tags', cacheJson(600), getTags);

// Stories
router.get('/stories', searchLimiter, getStories);
router.get('/stories/explore', searchLimiter, exploreStories);
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
router.get('/notifications', requireAuth, getNotifications);
router.put('/notifications/read-all', requireAuth, markAllNotificationsAsRead);
router.put('/notifications/:id/read', requireAuth, markNotificationAsRead);
router.delete('/notifications/:id', requireAuth, deleteNotification);

// Reading History
router.get('/history', requireAuth, getReadingHistory);
router.post('/history', requireAuth, saveReadingHistory);
router.delete('/history/:id', requireAuth, deleteReadingHistoryItem);
router.delete('/history', requireAuth, clearReadingHistory);

// Bookmarks & Favorites
router.get('/bookmarks', requireAuth, getBookmarks);
router.post('/bookmarks', requireAuth, createBookmark);
router.delete('/bookmarks/:id', requireAuth, deleteBookmark);
router.get('/favorites', requireAuth, getFavorites);
router.post('/favorites/toggle', requireAuth, toggleFavorite);
router.get('/favorites/status/:storyId', optionalAuth, checkFavoriteStatus);

// Albums: named story lists, shareable by link, saveable and copyable by other users
router.get('/albums/me', requireAuth, getMyAlbums);
router.get('/albums/saved', requireAuth, getSavedAlbums);
router.get('/albums/by-story/:storyId', optionalAuth, getAlbumsByStory);
router.post('/albums', requireAuth, albumLimiter, createAlbum);
router.put('/albums/me/visibility', requireAuth, setAllAlbumsVisibility); // before /albums/:id
router.get('/albums/:id', optionalAuth, getAlbum);
router.put('/albums/:id', requireAuth, updateAlbum);
router.delete('/albums/:id', requireAuth, deleteAlbum);
router.post('/albums/:id/share-link/reset', requireAuth, resetShareLink);
router.post('/albums/:id/stories', requireAuth, addStoryToAlbum);
router.delete('/albums/:id/stories/:storyId', requireAuth, removeStoryFromAlbum);
router.post('/albums/:id/save', requireAuth, toggleSaveAlbum);
router.post('/albums/:id/copy', requireAuth, albumLimiter, copyAlbum);

// Recommendations (trained by the worker; see services/recommender)
const recEventLimiter = perUserLimiter({ windowMs: 60_000, limit: 120, message: 'Quá nhiều yêu cầu.' });
router.get('/recommendations/home', optionalAuth, getHomeRecommendations);
router.get('/recommendations/related/:storyId', optionalAuth, getRelatedStories);
router.post('/recommendations/events', optionalAuth, recEventLimiter, postRecEvents);
router.post('/recommendations/train', requireAuth, requireRole('admin'), trainNow);
router.get('/recommendations/status', requireAuth, requireRole('admin'), getRecStatus);
router.get('/admin/backup-status', requireAuth, requireRole('admin'), getBackupStatus);

// Comments
router.get('/comments', getComments);
router.post('/comments', requireAuth, commentLimiter, createComment);
router.post('/comments/:id/like', requireAuth, likeComment);
router.put('/comments/:id', requireAuth, updateComment);
router.delete('/comments/:id', requireAuth, deleteComment);

// Violation reports
router.post('/reports', requireAuth, reportLimiter, createReport);
router.get('/reports', requireAuth, getReports);
router.get('/moderation/removed', requireAuth, getRemovedContent);
router.put('/reports/:id/resolve', requireAuth, resolveReport);

// Fandom / Community Posts
router.get('/posts', optionalAuth, getPosts);
router.get('/posts/sidebar', optionalAuth, getFandomSidebar);
router.get('/posts/:slug', optionalAuth, getPostBySlug);
router.post('/posts', requireAuth, postLimiter, createPost);
router.put('/posts/:id', requireAuth, updatePost);
router.delete('/posts/:id', requireAuth, deletePost);
router.post('/posts/:id/approve', requireAuth, approvePost);
router.post('/posts/:id/reject', requireAuth, rejectPost);
router.post('/posts/:id/react', requireAuth, reactLimiter, reactToPost);
router.post('/posts/:id/pin', requireAuth, togglePinPost);
router.post('/posts/:id/mute', requireAuth, togglePostMute);

// Users & Profile Settings
router.get('/profile/me', requireAuth, getCurrentUserProfile);
router.put('/profile/me', requireAuth, updateUserProfile);
router.put('/profile/me/settings', requireAuth, updateUserSettings);
router.get('/users', getUsers);
router.get('/codes/:code', optionalAuth, resolveCode);
router.get('/users/:username', optionalAuth, getUserProfile);

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
