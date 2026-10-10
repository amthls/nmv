-- 026: identity owns credentials since PR #56 (Plan/identity.md). Drop the backend's unused copies so the site
-- database no longer holds password hashes, emails or account tokens.
DROP TABLE IF EXISTS auth_tokens;
DROP INDEX IF EXISTS idx_users_email;
ALTER TABLE users DROP COLUMN IF EXISTS email;
ALTER TABLE users DROP COLUMN IF EXISTS password_hash;
ALTER TABLE users DROP COLUMN IF EXISTS tokens_valid_after;
ALTER TABLE users DROP COLUMN IF EXISTS last_login_at;
