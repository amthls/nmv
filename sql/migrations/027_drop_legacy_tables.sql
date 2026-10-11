-- Stage I1 (Plan/catalog.md): drop the tables whose data moved to other services (each service's import-legacy
-- copied them once): messaging (messages, notifications), community (posts, comments, reports), library
-- (follows, bookmarks, history, albums), recommender (rec_*), media (story_exports). Their triggers go with them.
-- Upgrading from before PR #77: deploy #77 and run scripts/migrate.sh first, or the copies never happen.
DROP TABLE IF EXISTS
  direct_messages, group_messages, user_blocks, dm_label_conversations, dm_labels, notifications, broadcast_notifications,
  post_notification_mutes, post_reactions, post_tags, comment_likes, comments, reports, posts,
  album_saves, album_stories, albums, bookmarks, reading_history, user_favorites, user_follows,
  rec_events, rec_item_factors, rec_item_similar, rec_model_runs, rec_user_factors, rec_user_scores,
  story_exports
  CASCADE;

DROP FUNCTION IF EXISTS update_story_favorites_count(), update_comment_counts(),
  posts_set_code(), albums_set_code(), reports_set_code();
DROP SEQUENCE IF EXISTS posts_code_seq, albums_code_seq, reports_code_seq;
DROP TYPE IF EXISTS notification_type, reaction_type, comment_target_type;
