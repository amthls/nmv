-- Report spam guard (2026-10-09): one pending report per person per item, enforced by the database
-- (two quick clicks used to pass the app's check). Older duplicates are closed, not deleted.
UPDATE reports a SET status = 'dismissed', resolved_at = NOW(), resolution_note = 'Báo cáo trùng (tự động đóng)'
FROM reports b
WHERE a.status = 'pending' AND b.status = 'pending' AND a.id <> b.id
  AND a.reporter_id = b.reporter_id AND a.target_type = b.target_type AND a.target_id = b.target_id
  AND (a.created_at, a.id) > (b.created_at, b.id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_reports_pending ON reports(reporter_id, target_type, target_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_reports_target ON reports(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_reports_reporter_time ON reports(reporter_id, created_at DESC);
