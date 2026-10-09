-- Token revocation: a login token issued (JWT iat) before this moment is rejected.
-- Set on password change/reset and "log out of every device".
ALTER TABLE users ADD COLUMN IF NOT EXISTS tokens_valid_after TIMESTAMPTZ;

-- One-time links sent by email (password reset, email verification). Only the SHA-256 of the
-- token is stored, so a database leak does not hand out working links.
CREATE TABLE IF NOT EXISTS auth_tokens (
    token_hash  TEXT PRIMARY KEY,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    purpose     VARCHAR(20) NOT NULL CHECK (purpose IN ('reset_password', 'verify_email')),
    expires_at  TIMESTAMPTZ NOT NULL,
    used_at     TIMESTAMPTZ,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auth_tokens_user ON auth_tokens(user_id, purpose);
