-- Events for the recommender (Plan/recommender.md): follows, albums, bookmarks. Written by triggers in the same
-- transaction as the change (transactional outbox), published by publishLoop (events.go) to novelhub.events.
CREATE TABLE outbox (
    id            BIGSERIAL PRIMARY KEY,
    event_id      UUID NOT NULL UNIQUE,
    routing_key   TEXT NOT NULL,
    payload       JSONB NOT NULL,
    request_id    TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    published_at  TIMESTAMPTZ
);
CREATE INDEX idx_outbox_pending ON outbox(id) WHERE published_at IS NULL;

CREATE FUNCTION enqueue_event(routing_key TEXT, data JSONB) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE id UUID := gen_random_uuid();
BEGIN
  INSERT INTO outbox (event_id, routing_key, payload) VALUES (id, routing_key, jsonb_build_object(
    'event_id', id, 'type', routing_key, 'version', 1, 'occurred_at', to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'data', data));
END $$;

-- "at": when it happened; consumers keep the newest state per row, so events arriving out of order can't undo a later one
CREATE FUNCTION favorites_event() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM enqueue_event('library.story.followed', jsonb_build_object('user_id', NEW.user_id, 'story_id', NEW.story_id, 'at', NEW.created_at));
  ELSE
    PERFORM enqueue_event('library.story.unfollowed', jsonb_build_object('user_id', OLD.user_id, 'story_id', OLD.story_id, 'at', clock_timestamp()));
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER trg_favorites_event AFTER INSERT OR DELETE ON user_favorites FOR EACH ROW EXECUTE FUNCTION favorites_event();

CREATE FUNCTION album_stories_event() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE owner UUID;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT user_id INTO owner FROM albums WHERE id = NEW.album_id;
    PERFORM enqueue_event('library.album.story_added', jsonb_build_object('user_id', owner, 'album_id', NEW.album_id,
      'story_id', NEW.story_id, 'at', NEW.added_at));
  ELSE
    SELECT user_id INTO owner FROM albums WHERE id = OLD.album_id;
    IF owner IS NOT NULL THEN -- a deleted album announces its stories itself (albums_deleted_event)
      PERFORM enqueue_event('library.album.story_removed', jsonb_build_object('user_id', owner, 'album_id', OLD.album_id,
        'story_id', OLD.story_id, 'at', clock_timestamp()));
    END IF;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER trg_album_stories_event AFTER INSERT OR DELETE ON album_stories FOR EACH ROW EXECUTE FUNCTION album_stories_event();

CREATE FUNCTION albums_deleted_event() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  PERFORM enqueue_event('library.album.story_removed', jsonb_build_object('user_id', OLD.user_id, 'album_id', OLD.id,
    'story_id', s.story_id, 'at', clock_timestamp())) FROM album_stories s WHERE s.album_id = OLD.id;
  RETURN OLD;
END $$;
CREATE TRIGGER trg_albums_deleted_event BEFORE DELETE ON albums FOR EACH ROW EXECUTE FUNCTION albums_deleted_event();

CREATE FUNCTION bookmarks_event() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM enqueue_event('library.bookmark.created', jsonb_build_object('bookmark_id', NEW.id, 'user_id', NEW.user_id,
      'story_id', NEW.story_id, 'at', NEW.created_at));
  ELSE
    PERFORM enqueue_event('library.bookmark.deleted', jsonb_build_object('bookmark_id', OLD.id, 'user_id', OLD.user_id,
      'story_id', OLD.story_id, 'at', clock_timestamp()));
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER trg_bookmarks_event AFTER INSERT OR DELETE ON bookmarks FOR EACH ROW EXECUTE FUNCTION bookmarks_event();
