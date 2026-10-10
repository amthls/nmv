-- 024: a direct message can carry a workspace draft card (Plan/chapter-workspace.md, stage 4a): sharing a draft sends
-- one. Only the id is kept here; the workspace decides who may open it.
ALTER TABLE direct_messages ADD COLUMN IF NOT EXISTS draft_id UUID;
