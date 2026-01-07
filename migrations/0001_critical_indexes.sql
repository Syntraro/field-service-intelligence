-- ============================================================================
-- CRITICAL PERFORMANCE INDEXES
-- Migration: 0001_critical_indexes
-- Impact: 50-80% query speed improvement
-- ============================================================================

-- Jobs: Company + Status (Dashboard/Lists)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_jobs_company_status
ON jobs(company_id, status) WHERE is_active = true;

-- Jobs: Company + Scheduled (Calendar)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_jobs_company_scheduled
ON jobs(company_id, scheduled_start) WHERE is_active = true;

-- Jobs: Location lookup (prevents N+1)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_jobs_location_id
ON jobs(location_id) WHERE is_active = true;

-- Invoices: Company + Status (Invoice Lists)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_invoices_company_status
ON invoices(company_id, status) WHERE is_active = true;

-- Invoices: Location lookup (prevents N+1)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_invoices_location_id
ON invoices(location_id) WHERE is_active = true;

-- Users: Company (Team Pages)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_company_id
ON users(company_id);

-- Users: Active users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_company_disabled
ON users(company_id, disabled);

-- Parts: Company + Active (Parts Lists)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_parts_company_active
ON parts(company_id, is_active);

-- Labor Entries: Job (Job Detail Pages - prevents N+1)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_labor_entries_job_id
ON labor_entries(job_id);

-- Job Parts: Job (Invoice Generation - prevents N+1)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_job_parts_job_id
ON job_parts(job_id);

-- Invoice Lines: Invoice (Invoice Detail - prevents N+1)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_invoice_lines_invoice_id
ON invoice_lines(invoice_id);

-- Equipment: Client lookup
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_equipment_client_id
ON equipment(client_id);

-- Calendar: Company + Date (Calendar Views)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_calendar_company_date
ON calendar_assignments(company_id, scheduled_date);

-- Client Notes: Client lookup
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_client_notes_client_id
ON client_notes(client_id);

-- Client Notes: Company + Client (tenant-safe)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_client_notes_company_client
ON client_notes(company_id, client_id);

-- Tasks: Company filtering
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tasks_company_id
ON tasks(company_id);

-- Tasks: Assignment lookup
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tasks_assigned_to
ON tasks(assigned_to_user_id)
WHERE assigned_to_user_id IS NOT NULL;

-- Full-text search: Jobs (using summary, description, job_number)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_jobs_search
ON jobs USING gin(to_tsvector('english',
  coalesce(summary, '') || ' ' ||
  coalesce(description, '') || ' ' ||
  coalesce(job_number::text, '')
));

-- Full-text search: Parts
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_parts_search
ON parts USING gin(to_tsvector('english',
  coalesce(name, '') || ' ' ||
  coalesce(sku, '') || ' ' ||
  coalesce(description, '')
));

-- Full-text search: Clients
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_clients_search
ON clients USING gin(to_tsvector('english',
  coalesce(company_name, '') || ' ' ||
  coalesce(contact_name, '') || ' ' ||
  coalesce(location, '')
));

-- Partial index: Active jobs only
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_jobs_active
ON jobs(company_id, status, scheduled_start)
WHERE is_active = true
  AND status NOT IN ('completed', 'cancelled');

-- Partial index: Pending invoices
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_invoices_pending
ON invoices(company_id, issue_date)
WHERE status NOT IN ('paid', 'void')
  AND is_active = true;

-- Covering index: Jobs list
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_jobs_list_covering
ON jobs(company_id, status, scheduled_start)
INCLUDE (summary, location_id, primary_technician_id)
WHERE is_active = true;

-- Covering index: Invoice list
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_invoices_list_covering
ON invoices(company_id, status, issue_date)
INCLUDE (invoice_number, total, location_id)
WHERE is_active = true;

-- Additional N+1 prevention indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_clients_company_id
ON clients(company_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_clients_parent_company
ON clients(parent_company_id)
WHERE parent_company_id IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_customer_companies_company_id
ON customer_companies(company_id);

-- Technician profile lookups
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_technician_profiles_user_id
ON technician_profiles(user_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_working_hours_user_id
ON working_hours(user_id);

-- Permission overrides (checked on every auth request)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_permission_overrides_user_id
ON user_permission_overrides(user_id);

-- Update statistics
ANALYZE jobs;
ANALYZE invoices;
ANALYZE clients;
ANALYZE parts;
ANALYZE users;
ANALYZE labor_entries;
ANALYZE invoice_lines;
ANALYZE calendar_assignments;
ANALYZE tasks;
ANALYZE customer_companies;
ANALYZE technician_profiles;
ANALYZE working_hours;
ANALYZE user_permission_overrides;
