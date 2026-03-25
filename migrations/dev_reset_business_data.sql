-- ============================================================================
-- DEV DATA RESET — One-time wipe of all business/tenant data
-- Run: npm run db:migrate:one -- migrations/dev_reset_business_data.sql
--
-- Preserves: schema, users, sessions, roles, permissions, settings,
--            tenant_subscriptions, subscription_plans, feature flags
-- Clears:    all client, job, financial, scheduling, equipment, and log data
-- ============================================================================

-- Preview counts (uncomment to verify before running):
-- SELECT
--   (SELECT count(*) FROM customer_companies) AS customer_companies,
--   (SELECT count(*) FROM client_locations)   AS client_locations,
--   (SELECT count(*) FROM jobs)               AS jobs,
--   (SELECT count(*) FROM job_visits)          AS job_visits,
--   (SELECT count(*) FROM invoices)            AS invoices,
--   (SELECT count(*) FROM quotes)              AS quotes;

BEGIN;

TRUNCATE TABLE

  -- Jobs & related
  jobs,
  job_visits,
  job_notes,
  job_parts,
  job_equipment,
  job_status_events,
  job_schedule_audit,
  job_templates,
  job_template_line_items,

  -- Recurring jobs
  recurring_job_series,
  recurring_job_templates,
  recurring_job_phases,
  recurring_job_instances,

  -- Financial
  invoices,
  invoice_lines,
  quotes,
  quote_lines,
  quote_templates,
  quote_template_lines,
  payments,
  labor_entries,
  pm_billing_events,

  -- Time tracking
  time_entries,
  time_approvals,
  time_entry_lock_overrides,
  work_sessions,

  -- Equipment & PM
  equipment_legacy_deprecated,
  equipment_catalog_items,
  location_equipment,
  maintenance_records,
  location_pm_plans,
  location_pm_part_templates,
  pm_templates,

  -- Scheduling / dispatch
  events,
  technician_job_status_events,
  technician_live_positions,
  technician_positions,

  -- Suppliers
  suppliers,
  supplier_locations,
  supplier_visit_details,
  tasks,

  -- Client / location data
  client_contacts,
  client_notes,
  client_parts,
  client_tags,
  client_tag_assignments,
  location_tag_assignments,
  client_locations,
  customer_companies,

  -- Files & notes
  files,
  note_attachments,

  -- QBO sync
  qbo_connections,
  qbo_sync_events,
  qbo_sync_queue,
  qbo_webhook_events,

  -- System / logging
  attention_items,
  audit_events,
  audit_logs,
  company_audit_logs,
  notifications,
  notification_snoozes,
  feedback,

  -- Company config (tenant business data, not system config)
  company_counters,
  company_tax_rates,
  company_tax_groups,
  company_tax_group_rates,
  company_business_hours,
  time_alert_settings,
  time_billing_rules

RESTART IDENTITY CASCADE;

COMMIT;
