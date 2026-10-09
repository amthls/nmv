-- Smart codes: short readable ids shown to people, next to the UUID primary keys (which stay the real keys).
-- Each code = facts that may change (role, group, category...) + a fixed number `code_no`.
-- Lookups (GET /codes/:code) use only the number, so a code printed before a change still resolves.
--   users     U-AD-26-0007        top role · year joined · number
--   groups    G03                 number (never changes)
--   stories   LN-JA-G03-0042      type · original language · group (G00 = none) · number
--   chapters  LN-JA-G03-0042-C12  story code · chapter number (built in queries, not stored)
--   posts     P-RV-26-0015        category · year · number
--   albums    AL-0007-26-0184     owner number · year · number
--   reports   RP-CM-26-0001       target type · year · number

-- At least 4 digits, longer when needed (lpad alone would cut 12345 to 1234)
CREATE OR REPLACE FUNCTION code_num(n BIGINT, width INT DEFAULT 4) RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$ SELECT lpad(n::text, GREATEST(width, length(n::text)), '0') $$;

CREATE OR REPLACE FUNCTION code_year(t TIMESTAMPTZ) RETURNS TEXT
LANGUAGE sql STABLE AS $$ SELECT to_char(COALESCE(t, NOW()), 'YY') $$;

CREATE SEQUENCE IF NOT EXISTS users_code_seq;
CREATE SEQUENCE IF NOT EXISTS translation_groups_code_seq;
CREATE SEQUENCE IF NOT EXISTS stories_code_seq;
CREATE SEQUENCE IF NOT EXISTS posts_code_seq;
CREATE SEQUENCE IF NOT EXISTS albums_code_seq;
CREATE SEQUENCE IF NOT EXISTS reports_code_seq;

ALTER TABLE users              ADD COLUMN IF NOT EXISTS code_no BIGINT, ADD COLUMN IF NOT EXISTS code VARCHAR(40);
ALTER TABLE translation_groups ADD COLUMN IF NOT EXISTS code_no BIGINT, ADD COLUMN IF NOT EXISTS code VARCHAR(40);
ALTER TABLE stories            ADD COLUMN IF NOT EXISTS code_no BIGINT, ADD COLUMN IF NOT EXISTS code VARCHAR(40);
ALTER TABLE posts              ADD COLUMN IF NOT EXISTS code_no BIGINT, ADD COLUMN IF NOT EXISTS code VARCHAR(40);
ALTER TABLE albums             ADD COLUMN IF NOT EXISTS code_no BIGINT, ADD COLUMN IF NOT EXISTS code VARCHAR(40);
ALTER TABLE reports            ADD COLUMN IF NOT EXISTS code_no BIGINT, ADD COLUMN IF NOT EXISTS code VARCHAR(40);

-- ---- users: role part follows user_roles (user_role enum order is admin < mod < translator < author < reader)
CREATE OR REPLACE FUNCTION user_code(no BIGINT, created TIMESTAMPTZ, top_role user_role) RETURNS TEXT
LANGUAGE sql STABLE AS $$
  SELECT 'U-' || CASE top_role WHEN 'admin' THEN 'AD' WHEN 'mod' THEN 'MO' WHEN 'translator' THEN 'TR'
                               WHEN 'author' THEN 'AU' ELSE 'RD' END
         || '-' || code_year(created) || '-' || code_num(no)
$$;

CREATE OR REPLACE FUNCTION users_set_code() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.code_no := COALESCE(NEW.code_no, nextval('users_code_seq'));
  NEW.code := user_code(NEW.code_no, NEW.created_at, (SELECT min(role) FROM user_roles WHERE user_id = NEW.id));
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION user_roles_refresh_code() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE users SET code = user_code(code_no, created_at, (SELECT min(role) FROM user_roles WHERE user_id = users.id))
  WHERE id = COALESCE(NEW.user_id, OLD.user_id) AND code_no IS NOT NULL;
  RETURN NULL;
END $$;

-- ---- groups
CREATE OR REPLACE FUNCTION groups_set_code() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.code_no := COALESCE(NEW.code_no, nextval('translation_groups_code_seq'));
  NEW.code := 'G' || code_num(NEW.code_no, 2);
  RETURN NEW;
END $$;

-- ---- stories: also re-runs when the group is removed (FK ON DELETE SET NULL fires update triggers)
CREATE OR REPLACE FUNCTION stories_set_code() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.code_no := COALESCE(NEW.code_no, nextval('stories_code_seq'));
  NEW.code := CASE NEW.story_type WHEN 'manga' THEN 'MG' ELSE 'LN' END
    || '-' || upper(left(COALESCE(NULLIF(NEW.original_language, ''), 'xx'), 2))
    || '-' || COALESCE((SELECT code FROM translation_groups WHERE id = NEW.group_id), 'G00')
    || '-' || code_num(NEW.code_no);
  RETURN NEW;
END $$;

-- ---- posts
CREATE OR REPLACE FUNCTION posts_set_code() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.code_no := COALESCE(NEW.code_no, nextval('posts_code_seq'));
  NEW.code := 'P-' || CASE NEW.category WHEN 'review' THEN 'RV' WHEN 'fanart' THEN 'FA' WHEN 'theory' THEN 'TH'
                                        WHEN 'news' THEN 'NW' WHEN 'question' THEN 'QA' ELSE 'DS' END
    || '-' || code_year(NEW.created_at) || '-' || code_num(NEW.code_no);
  RETURN NEW;
END $$;

-- ---- albums (the owner never changes: copying makes a new album)
CREATE OR REPLACE FUNCTION albums_set_code() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.code_no := COALESCE(NEW.code_no, nextval('albums_code_seq'));
  NEW.code := 'AL-' || COALESCE(code_num((SELECT code_no FROM users WHERE id = NEW.user_id)), '0000')
    || '-' || code_year(NEW.created_at) || '-' || code_num(NEW.code_no);
  RETURN NEW;
END $$;

-- ---- reports
CREATE OR REPLACE FUNCTION reports_set_code() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.code_no := COALESCE(NEW.code_no, nextval('reports_code_seq'));
  NEW.code := 'RP-' || CASE NEW.target_type WHEN 'story' THEN 'ST' WHEN 'chapter' THEN 'CH'
                                            WHEN 'comment' THEN 'CM' WHEN 'post' THEN 'PO' ELSE 'XX' END
    || '-' || code_year(NEW.created_at) || '-' || code_num(NEW.code_no);
  RETURN NEW;
END $$;

-- Triggers also run on UPDATE OF code_no so the backfill below fills `code` with the same expressions
DROP TRIGGER IF EXISTS trg_users_code ON users;
CREATE TRIGGER trg_users_code BEFORE INSERT OR UPDATE OF code_no ON users FOR EACH ROW EXECUTE FUNCTION users_set_code();
DROP TRIGGER IF EXISTS trg_user_roles_code ON user_roles;
CREATE TRIGGER trg_user_roles_code AFTER INSERT OR UPDATE OF role OR DELETE ON user_roles
  FOR EACH ROW EXECUTE FUNCTION user_roles_refresh_code();
DROP TRIGGER IF EXISTS trg_groups_code ON translation_groups;
CREATE TRIGGER trg_groups_code BEFORE INSERT OR UPDATE OF code_no ON translation_groups FOR EACH ROW EXECUTE FUNCTION groups_set_code();
DROP TRIGGER IF EXISTS trg_stories_code ON stories;
CREATE TRIGGER trg_stories_code BEFORE INSERT OR UPDATE OF code_no, story_type, original_language, group_id ON stories
  FOR EACH ROW EXECUTE FUNCTION stories_set_code();
DROP TRIGGER IF EXISTS trg_posts_code ON posts;
CREATE TRIGGER trg_posts_code BEFORE INSERT OR UPDATE OF code_no, category ON posts FOR EACH ROW EXECUTE FUNCTION posts_set_code();
DROP TRIGGER IF EXISTS trg_albums_code ON albums;
CREATE TRIGGER trg_albums_code BEFORE INSERT OR UPDATE OF code_no ON albums FOR EACH ROW EXECUTE FUNCTION albums_set_code();
DROP TRIGGER IF EXISTS trg_reports_code ON reports;
CREATE TRIGGER trg_reports_code BEFORE INSERT OR UPDATE OF code_no ON reports FOR EACH ROW EXECUTE FUNCTION reports_set_code();


-- Backfill existing rows: numbers in creation order; setting code_no fires the triggers above, which fill `code`.
-- Groups and users go first: story and album codes read them.
-- The updated_at triggers are paused meanwhile: "recently updated" lists sort by that column.
DO $$
DECLARE t TEXT; tg TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['translation_groups', 'users', 'stories', 'posts', 'albums', 'reports'] LOOP
    FOR tg IN SELECT tgname FROM pg_trigger WHERE tgrelid = t::regclass AND tgfoid = 'update_updated_at_column'::regproc LOOP
      EXECUTE format('ALTER TABLE %I DISABLE TRIGGER %I', t, tg);
    END LOOP;
    EXECUTE format(
      'UPDATE %1$I x SET code_no = n.base + n.rn
         FROM (SELECT id, row_number() OVER (ORDER BY created_at, id) AS rn,
                      (SELECT COALESCE(max(code_no), 0) FROM %1$I) AS base
                 FROM %1$I WHERE code_no IS NULL) n
        WHERE x.id = n.id', t);
    EXECUTE format('SELECT setval(%L, GREATEST((SELECT COALESCE(max(code_no), 0) FROM %I), 1), (SELECT count(*) > 0 FROM %I))',
                   t || '_code_seq', t, t);
    FOR tg IN SELECT tgname FROM pg_trigger WHERE tgrelid = t::regclass AND tgfoid = 'update_updated_at_column'::regproc LOOP
      EXECUTE format('ALTER TABLE %I ENABLE TRIGGER %I', t, tg);
    END LOOP;
  END LOOP;
END $$;

ALTER TABLE users              ALTER COLUMN code_no SET NOT NULL, ALTER COLUMN code SET NOT NULL;
ALTER TABLE translation_groups ALTER COLUMN code_no SET NOT NULL, ALTER COLUMN code SET NOT NULL;
ALTER TABLE stories            ALTER COLUMN code_no SET NOT NULL, ALTER COLUMN code SET NOT NULL;
ALTER TABLE posts              ALTER COLUMN code_no SET NOT NULL, ALTER COLUMN code SET NOT NULL;
ALTER TABLE albums             ALTER COLUMN code_no SET NOT NULL, ALTER COLUMN code SET NOT NULL;
ALTER TABLE reports            ALTER COLUMN code_no SET NOT NULL, ALTER COLUMN code SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_users_code_no   ON users(code_no);
CREATE UNIQUE INDEX IF NOT EXISTS uq_groups_code_no  ON translation_groups(code_no);
CREATE UNIQUE INDEX IF NOT EXISTS uq_stories_code_no ON stories(code_no);
CREATE UNIQUE INDEX IF NOT EXISTS uq_posts_code_no   ON posts(code_no);
CREATE UNIQUE INDEX IF NOT EXISTS uq_albums_code_no  ON albums(code_no);
CREATE UNIQUE INDEX IF NOT EXISTS uq_reports_code_no ON reports(code_no);
