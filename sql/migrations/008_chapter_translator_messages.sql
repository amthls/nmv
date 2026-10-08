-- Optional translator / author message shown in a box before and after a chapter's text
-- (rich text, sanitized like story synopses). Kept on the submission too so approving a
-- translation publishes its messages with it.
ALTER TABLE chapters ADD COLUMN IF NOT EXISTS intro_note TEXT;
ALTER TABLE chapters ADD COLUMN IF NOT EXISTS outro_note TEXT;
ALTER TABLE chapter_submissions ADD COLUMN IF NOT EXISTS intro_note TEXT;
ALTER TABLE chapter_submissions ADD COLUMN IF NOT EXISTS outro_note TEXT;
