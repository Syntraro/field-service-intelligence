-- ============================================================================
-- DATE STORAGE FIX MIGRATION
-- ============================================================================

ALTER TABLE calendar_assignments ADD COLUMN scheduled_date_new DATE;
ALTER TABLE maintenance_records ADD COLUMN due_date_new DATE, ADD COLUMN completed_at_new TIMESTAMP;

UPDATE calendar_assignments 
SET scheduled_date_new = CASE WHEN scheduled_date ~ '^\d{4}-\d{2}-\d{2}$' THEN scheduled_date::DATE ELSE NULL END
WHERE scheduled_date IS NOT NULL;

UPDATE maintenance_records
SET due_date_new = CASE WHEN due_date ~ '^\d{4}-\d{2}-\d{2}$' THEN due_date::DATE ELSE NULL END
WHERE due_date IS NOT NULL;

UPDATE maintenance_records
SET completed_at_new = CASE WHEN completed_at ~ '^\d{4}-\d{2}-\d{2}' THEN completed_at::TIMESTAMP ELSE NULL END
WHERE completed_at IS NOT NULL;

SELECT 'calendar_assignments' as table_name, COUNT(*) as total_rows, COUNT(scheduled_date) as old_not_null, COUNT(scheduled_date_new) as new_not_null, COUNT(*) - COUNT(scheduled_date_new) as failed_conversions FROM calendar_assignments
UNION ALL
SELECT 'maintenance_records (due_date)', COUNT(*), COUNT(due_date), COUNT(due_date_new), COUNT(*) - COUNT(due_date_new) FROM maintenance_records
UNION ALL
SELECT 'maintenance_records (completed_at)', COUNT(*), COUNT(completed_at), COUNT(completed_at_new), COUNT(*) - COUNT(completed_at_new) FROM maintenance_records;

CREATE INDEX idx_calendar_scheduled_date ON calendar_assignments(scheduled_date_new);
CREATE INDEX idx_calendar_scheduled_date_completed ON calendar_assignments(scheduled_date_new, completed);
CREATE INDEX idx_maintenance_due_date ON maintenance_records(due_date_new);
CREATE INDEX idx_maintenance_completed_at ON maintenance_records(completed_at_new) WHERE completed_at_new IS NOT NULL;
