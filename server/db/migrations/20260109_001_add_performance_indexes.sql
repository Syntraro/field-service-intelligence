-- Performance Indexes Migration
-- Generated: 2026-01-09
-- Purpose: Add indexes for common query patterns (70% performance improvement expected)
--
-- IMPORTANT: Run this migration FIRST before other schema changes
-- Execute with: psql $DATABASE_URL -f server/db/migrations/20260109_001_add_performance_indexes.sql

-- ============================================================================
-- JOBS TABLE INDEXES
-- ============================================================================

-- Compound index for jobs filtered by company + status (most common query)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_jobs_company_status
ON jobs(company_id, status);

-- Compound index for jobs filtered by company + scheduled_start (calendar views)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_jobs_company_scheduled_start
ON jobs(company_id, scheduled_start);

-- Index for jobs by location (common filter)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_jobs_company_location
ON jobs(company_id, location_id);

-- Index for jobs by primary technician
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_jobs_company_technician
ON jobs(company_id, primary_technician_id);

-- Index for pagination queries (created_at DESC)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_jobs_company_created_desc
ON jobs(company_id, created_at DESC, id DESC);

-- Index for recurring series lookup
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_jobs_recurring_series
ON jobs(recurring_series_id) WHERE recurring_series_id IS NOT NULL;

-- Index for invoice linkage
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_jobs_invoice
ON jobs(invoice_id) WHERE invoice_id IS NOT NULL;

-- ============================================================================
-- INVOICES TABLE INDEXES
-- ============================================================================

-- Compound index for invoices filtered by company + status
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_invoices_company_status
ON invoices(company_id, status);

-- Compound index for invoices filtered by company + location
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_invoices_company_location
ON invoices(company_id, location_id);

-- Index for invoices by customer company
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_invoices_company_customer
ON invoices(company_id, customer_company_id) WHERE customer_company_id IS NOT NULL;

-- Index for invoices by due date (overdue queries)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_invoices_company_due_date
ON invoices(company_id, due_date);

-- Index for pagination queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_invoices_company_created_desc
ON invoices(company_id, created_at DESC, id DESC);

-- Index for job linkage
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_invoices_job
ON invoices(job_id) WHERE job_id IS NOT NULL;

-- ============================================================================
-- CLIENT_LOCATIONS TABLE INDEXES
-- ============================================================================

-- Compound index for locations filtered by company + inactive status
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_client_locations_company_inactive
ON client_locations(company_id, inactive);

-- Index for locations by parent company
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_client_locations_parent_company
ON client_locations(company_id, parent_company_id) WHERE parent_company_id IS NOT NULL;

-- Text search index for company name (LIKE queries)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_client_locations_company_name_pattern
ON client_locations(company_id, company_name text_pattern_ops);

-- ============================================================================
-- CUSTOMER_COMPANIES TABLE INDEXES
-- ============================================================================

-- Compound index for customer companies filtered by company + active status
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_customer_companies_company_active
ON customer_companies(company_id, is_active);

-- Text search index for name (LIKE queries)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_customer_companies_name_pattern
ON customer_companies(company_id, name text_pattern_ops);

-- ============================================================================
-- EQUIPMENT TABLE INDEXES
-- ============================================================================

-- Compound index for equipment filtered by company + client
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_equipment_company_client
ON equipment(company_id, client_id);

-- Index for equipment by type
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_equipment_company_type
ON equipment(company_id, type) WHERE type IS NOT NULL;

-- ============================================================================
-- CALENDAR_ASSIGNMENTS TABLE INDEXES
-- ============================================================================

-- Compound index for calendar assignments by company + scheduled_date
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_calendar_assignments_company_date
ON calendar_assignments(company_id, scheduled_date);

-- Index for assignments by client
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_calendar_assignments_company_client
ON calendar_assignments(company_id, client_id);

-- Index for assignments by year/month (monthly views)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_calendar_assignments_company_year_month
ON calendar_assignments(company_id, year, month);

-- ============================================================================
-- USERS TABLE INDEXES
-- ============================================================================

-- Compound index for users filtered by company + role
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_company_role
ON users(company_id, role);

-- Partial index for active users only
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_company_active
ON users(company_id) WHERE disabled = false AND status = 'active';

-- ============================================================================
-- JOB_VISITS TABLE INDEXES
-- ============================================================================

-- Compound index for job visits by company + scheduled_date
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_job_visits_company_scheduled
ON job_visits(company_id, scheduled_date);

-- Index for visits by assigned technician
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_job_visits_technician
ON job_visits(assigned_technician_id) WHERE assigned_technician_id IS NOT NULL;

-- Index for visits by status
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_job_visits_company_status
ON job_visits(company_id, status);

-- ============================================================================
-- TASKS TABLE INDEXES
-- ============================================================================

-- Compound index for tasks by company + status
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tasks_company_status_v2
ON tasks(company_id, status);

-- Index for tasks by assigned user
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tasks_company_assigned_v2
ON tasks(company_id, assigned_to_user_id) WHERE assigned_to_user_id IS NOT NULL;

-- Index for tasks by scheduled start
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tasks_company_scheduled
ON tasks(company_id, scheduled_start_at) WHERE scheduled_start_at IS NOT NULL;

-- ============================================================================
-- DETAIL TABLE INDEXES (for foreign key joins)
-- ============================================================================

-- Invoice lines by invoice
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_invoice_lines_invoice
ON invoice_lines(invoice_id);

-- Job parts by job
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_job_parts_job
ON job_parts(job_id);

-- Job equipment by job
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_job_equipment_job
ON job_equipment(job_id);

-- Payments by invoice
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payments_invoice
ON payments(invoice_id);

-- Location equipment by location
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_location_equipment_location
ON location_equipment(location_id);

-- Location PM plans by location
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_location_pm_plans_location
ON location_pm_plans(location_id);

-- Location PM part templates by location
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_location_pm_part_templates_location
ON location_pm_part_templates(location_id);

-- Job notes by job
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_job_notes_job
ON job_notes(job_id);

-- Client notes by client
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_client_notes_client
ON client_notes(client_id);

-- Labor entries by job
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_labor_entries_job
ON labor_entries(job_id);

-- Job template line items by template
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_job_template_line_items_template
ON job_template_line_items(template_id);

-- ============================================================================
-- ITEMS TABLE INDEXES
-- ============================================================================

-- Compound index for items by company + type
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_items_company_type
ON items(company_id, type);

-- Compound index for items by company + active status
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_items_company_active
ON items(company_id, is_active);

-- Text search index for name (LIKE queries)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_items_company_name_pattern
ON items(company_id, name text_pattern_ops);

-- ============================================================================
-- VERIFICATION QUERY
-- ============================================================================

-- Run this to verify indexes were created:
-- SELECT tablename, indexname, indexdef
-- FROM pg_indexes
-- WHERE schemaname = 'public'
--   AND indexname LIKE 'idx_%'
-- ORDER BY tablename, indexname;

-- ============================================================================
-- ROLLBACK COMMANDS (uncomment if needed)
-- ============================================================================

-- DROP INDEX CONCURRENTLY IF EXISTS idx_jobs_company_status;
-- DROP INDEX CONCURRENTLY IF EXISTS idx_jobs_company_scheduled_start;
-- DROP INDEX CONCURRENTLY IF EXISTS idx_jobs_company_location;
-- DROP INDEX CONCURRENTLY IF EXISTS idx_jobs_company_technician;
-- DROP INDEX CONCURRENTLY IF EXISTS idx_jobs_company_created_desc;
-- DROP INDEX CONCURRENTLY IF EXISTS idx_jobs_recurring_series;
-- DROP INDEX CONCURRENTLY IF EXISTS idx_jobs_invoice;
-- DROP INDEX CONCURRENTLY IF EXISTS idx_invoices_company_status;
-- DROP INDEX CONCURRENTLY IF EXISTS idx_invoices_company_location;
-- DROP INDEX CONCURRENTLY IF EXISTS idx_invoices_company_customer;
-- DROP INDEX CONCURRENTLY IF EXISTS idx_invoices_company_due_date;
-- DROP INDEX CONCURRENTLY IF EXISTS idx_invoices_company_created_desc;
-- DROP INDEX CONCURRENTLY IF EXISTS idx_invoices_job;
-- DROP INDEX CONCURRENTLY IF EXISTS idx_client_locations_company_inactive;
-- DROP INDEX CONCURRENTLY IF EXISTS idx_client_locations_parent_company;
-- DROP INDEX CONCURRENTLY IF EXISTS idx_client_locations_company_name_pattern;
-- DROP INDEX CONCURRENTLY IF EXISTS idx_customer_companies_company_active;
-- DROP INDEX CONCURRENTLY IF EXISTS idx_customer_companies_name_pattern;
-- DROP INDEX CONCURRENTLY IF EXISTS idx_equipment_company_client;
-- DROP INDEX CONCURRENTLY IF EXISTS idx_equipment_company_type;
-- DROP INDEX CONCURRENTLY IF EXISTS idx_calendar_assignments_company_date;
-- DROP INDEX CONCURRENTLY IF EXISTS idx_calendar_assignments_company_client;
-- DROP INDEX CONCURRENTLY IF EXISTS idx_calendar_assignments_company_year_month;
-- DROP INDEX CONCURRENTLY IF EXISTS idx_users_company_role;
-- DROP INDEX CONCURRENTLY IF EXISTS idx_users_company_active;
-- DROP INDEX CONCURRENTLY IF EXISTS idx_job_visits_company_scheduled;
-- DROP INDEX CONCURRENTLY IF EXISTS idx_job_visits_technician;
-- DROP INDEX CONCURRENTLY IF EXISTS idx_job_visits_company_status;
-- DROP INDEX CONCURRENTLY IF EXISTS idx_tasks_company_status_v2;
-- DROP INDEX CONCURRENTLY IF EXISTS idx_tasks_company_assigned_v2;
-- DROP INDEX CONCURRENTLY IF EXISTS idx_tasks_company_scheduled;
-- DROP INDEX CONCURRENTLY IF EXISTS idx_invoice_lines_invoice;
-- DROP INDEX CONCURRENTLY IF EXISTS idx_job_parts_job;
-- DROP INDEX CONCURRENTLY IF EXISTS idx_job_equipment_job;
-- DROP INDEX CONCURRENTLY IF EXISTS idx_payments_invoice;
-- DROP INDEX CONCURRENTLY IF EXISTS idx_location_equipment_location;
-- DROP INDEX CONCURRENTLY IF EXISTS idx_location_pm_plans_location;
-- DROP INDEX CONCURRENTLY IF EXISTS idx_location_pm_part_templates_location;
-- DROP INDEX CONCURRENTLY IF EXISTS idx_job_notes_job;
-- DROP INDEX CONCURRENTLY IF EXISTS idx_client_notes_client;
-- DROP INDEX CONCURRENTLY IF EXISTS idx_labor_entries_job;
-- DROP INDEX CONCURRENTLY IF EXISTS idx_job_template_line_items_template;
-- DROP INDEX CONCURRENTLY IF EXISTS idx_items_company_type;
-- DROP INDEX CONCURRENTLY IF EXISTS idx_items_company_active;
-- DROP INDEX CONCURRENTLY IF EXISTS idx_items_company_name_pattern;
