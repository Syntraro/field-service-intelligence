-- =====================================================================
-- Migration: 2026-05-18 — service_templates + service_template_components
-- =====================================================================
-- Phase 0/1 (RALPH): flat-rate service template entity.
--
-- A service_template is a single customer-facing line item with a
-- flat_rate_price. Internally it is composed of one or more
-- service_template_components that reference catalog items (services
-- and/or products). The components are used for estimated cost basis
-- and operational guidance only — they are NEVER exposed to QBO and
-- NEVER generate separate invoice lines.
--
-- This migration adds only the two new tables. No existing tables
-- (quoteLines, invoiceLines, jobParts) are touched in Phase 1.
--
-- Run with
-- --------
--   npm run db:migrate:one -- migrations/2026_05_18_service_templates.sql
-- =====================================================================

CREATE TABLE IF NOT EXISTS service_templates (
  id                          varchar       PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                  varchar       NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  -- nullable: consistent with pricebookGroups.userId (creator tracking)
  user_id                     varchar       REFERENCES users(id) ON DELETE SET NULL,

  name                        text          NOT NULL,
  internal_name               text,
  description                 text,
  internal_notes              text,
  category                    text,
  subcategory                 text,

  -- Customer-facing flat price charged on quotes/invoices.
  flat_rate_price             numeric(12,2) NOT NULL DEFAULT 0,
  -- Estimated labor time for dispatch planning and cost estimation.
  estimated_duration_minutes  integer,
  -- Skill tags for technician matching (same format as job required_skills).
  required_skill_tags         text[]        NOT NULL DEFAULT '{}',
  -- Minimum team size; default 1.
  team_size_required          integer       NOT NULL DEFAULT 1,

  is_active                   boolean       NOT NULL DEFAULT TRUE,
  -- Incremented atomically when template is applied to a quote/invoice/job.
  usage_count                 integer       NOT NULL DEFAULT 0,

  -- Soft-delete: deleted_at set → excluded from all active queries.
  deleted_at                  timestamptz,
  created_at                  timestamptz   NOT NULL DEFAULT NOW(),
  updated_at                  timestamptz,

  CONSTRAINT svc_templates_flat_rate_non_negative CHECK (flat_rate_price >= 0),
  CONSTRAINT svc_templates_duration_positive      CHECK (estimated_duration_minutes IS NULL OR estimated_duration_minutes > 0),
  CONSTRAINT svc_templates_team_size_positive     CHECK (team_size_required >= 1)
);

-- Tenant name uniqueness among active (non-deleted) templates.
CREATE UNIQUE INDEX IF NOT EXISTS idx_svc_templates_company_name_uq
  ON service_templates(company_id, name)
  WHERE deleted_at IS NULL;

-- Primary list query: active templates ordered by usage.
CREATE INDEX IF NOT EXISTS idx_svc_templates_lookup
  ON service_templates(company_id, is_active, usage_count)
  WHERE deleted_at IS NULL;

-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS service_template_components (
  id                  varchar       PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          varchar       NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  template_id         varchar       NOT NULL REFERENCES service_templates(id) ON DELETE CASCADE,
  -- References an atomic catalog item (service or product).
  -- ON DELETE RESTRICT: prevents deleting a catalog item that is still
  -- referenced by an active template. Dispatcher must remove the
  -- component first.
  item_id             varchar       NOT NULL REFERENCES items(id) ON DELETE RESTRICT,

  -- Quantity stored as NUMERIC for parity with pricebook_group_items.
  quantity            numeric(12,2) NOT NULL DEFAULT 1,
  -- Unit cost snapshot at time of template authoring (informational).
  unit_cost_snapshot  numeric(12,2),
  -- Display ordering within the template's component list.
  sort_order          integer       NOT NULL DEFAULT 0,
  notes               text,

  created_at          timestamptz   NOT NULL DEFAULT NOW(),
  updated_at          timestamptz,

  CONSTRAINT svc_template_components_qty_positive CHECK (quantity > 0)
);

-- Each (template, item) pair is unique — an item appears at most once
-- per template. Re-adding bumps quantity instead.
CREATE UNIQUE INDEX IF NOT EXISTS idx_svc_template_components_template_item_uq
  ON service_template_components(template_id, item_id);

-- Fast component expansion given a template_id.
CREATE INDEX IF NOT EXISTS idx_svc_template_components_lookup
  ON service_template_components(company_id, template_id, sort_order);
