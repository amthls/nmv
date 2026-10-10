-- ws_db, stage 4b: tasks along a group's workflow, and a feed of what happened (Plan/chapter-workspace.md).
-- A job is one chapter going through the steps (raw, translate, edit, proofread) and then the keepers' merge; each step
-- is a task row. Only one task of a chapter is active at a time.
CREATE TABLE chapter_tasks (
    id             UUID PRIMARY KEY,
    job_id         UUID NOT NULL,
    story_id       UUID NOT NULL,
    chapter_id     UUID,                          -- an existing chapter, or NULL for a new one
    chapter_number NUMERIC(10,2) NOT NULL,
    title          TEXT,
    steps          TEXT[] NOT NULL,               -- the workflow when the job started
    step           INT NOT NULL,                  -- index in steps; = cardinality(steps) for the merge step
    kind           TEXT NOT NULL CHECK (kind IN ('raw', 'translate', 'edit', 'proofread', 'merge')),
    status         TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'claimed', 'done', 'cancelled')),
    assignee_id    UUID,
    assignee_name  TEXT,
    created_by     UUID,
    created_name   TEXT,
    due_at         TIMESTAMPTZ,
    note           TEXT,
    draft_id       UUID REFERENCES chapter_drafts(id),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    done_at        TIMESTAMPTZ
);
CREATE UNIQUE INDEX chapter_tasks_one_active ON chapter_tasks(story_id, chapter_number) WHERE status IN ('open', 'claimed');
CREATE INDEX chapter_tasks_story ON chapter_tasks(story_id, status, updated_at DESC);
CREATE INDEX chapter_tasks_assignee ON chapter_tasks(assignee_id, status);
CREATE INDEX chapter_tasks_draft ON chapter_tasks(draft_id) WHERE draft_id IS NOT NULL;

CREATE TABLE ws_activity (
    id          BIGSERIAL PRIMARY KEY,
    story_id    UUID NOT NULL,
    actor_id    UUID,
    actor_name  TEXT,
    action      TEXT NOT NULL,                    -- task_created, task_claimed, task_done, proposal_merged, ...
    detail      JSONB NOT NULL DEFAULT '{}',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX ws_activity_story ON ws_activity(story_id, id DESC);
