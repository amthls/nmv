-- Change of email: a one-time link to the NEW address carries the address it confirms (Plan/identity.md, branch 4).
ALTER TABLE account_tokens DROP CONSTRAINT IF EXISTS account_tokens_purpose_check;
ALTER TABLE account_tokens ADD CONSTRAINT account_tokens_purpose_check CHECK (purpose IN ('reset_password', 'verify_email', 'change_email'));
ALTER TABLE account_tokens ADD COLUMN IF NOT EXISTS new_email CITEXT;

-- At most 10 mails a day per address (enqueueMail counts them)
CREATE INDEX IF NOT EXISTS mail_outbox_to ON mail_outbox(to_addr, created_at);
