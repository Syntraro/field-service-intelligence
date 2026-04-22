-- 2026-04-21 Phase 3 canonical policy architecture: drop tenant_features.
--
-- PRECONDITION
-- ------------
-- Phase 1 moved feature-entitlement truth to the `subscription_features` +
-- `subscription_plan_features` + `tenant_feature_overrides` catalog. Phase 2
-- migrated the last in-app client consumers (`useTenantFeatures`,
-- SubscriptionBanner, CommunicationSettingsPage, InvoiceDetailPage) off the
-- legacy endpoint. Phase 3 migrated the last server-side readers
-- (portal.ts, templateDataBuilder.ts, invoiceReminderService.ts) to the
-- canonical entitlement resolver and moved reminder cadence config onto
-- `company_settings`. All legacy admin/platform endpoints that read/wrote
-- this table have been deleted.
--
-- The `tenant_features` table now has no live reader or writer.
--
-- WHAT THIS MIGRATION DOES
-- ------------------------
-- A1. Adds `invoice_reminders_enabled`, `invoice_reminder_first_delay_days`,
--     `invoice_reminder_repeat_every_days` to `company_settings` — the new
--     canonical home for invoice reminder cadence. IF NOT EXISTS so it's
--     safe on a fresh DB where the Drizzle schema already emitted the cols.
-- A2. Backfills those three columns on any existing `company_settings` row
--     from the old `tenant_features` row for the same company, if both
--     tables + both rows are present. This is defensive — the project is
--     about to wipe the DB, but any pre-wipe environment running this
--     migration gets consistent state.
-- A3. Drops the `tenant_features` table (CASCADE — FK from any forgotten
--     consumer falls with the table).
--
-- POST-MIGRATION STATE
-- --------------------
-- - `tenant_features` table does not exist.
-- - `company_settings` carries reminder cadence as functional tenant config.
-- - The canonical entitlement catalog is the sole source of truth for
--   feature on/off state.
--
-- Run via: npm run db:migrate. Idempotent. Transactional.

BEGIN;

-- ============================================================================
-- A1 — Ensure reminder cadence columns exist on company_settings.
-- ============================================================================

ALTER TABLE company_settings
  ADD COLUMN IF NOT EXISTS invoice_reminders_enabled            boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS invoice_reminder_first_delay_days    integer NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS invoice_reminder_repeat_every_days   integer NOT NULL DEFAULT 7;

-- ============================================================================
-- A2 — Backfill cadence from tenant_features when both tables exist.
-- ============================================================================
-- Guarded: the backfill only runs if `tenant_features` is still present in
-- this database. On a freshly provisioned DB the table is gone and the
-- DO block silently no-ops.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'tenant_features'
  ) THEN
    UPDATE company_settings cs
    SET
      invoice_reminders_enabled          = tf.invoice_reminders_enabled,
      invoice_reminder_first_delay_days  = tf.invoice_reminder_first_delay_days,
      invoice_reminder_repeat_every_days = tf.invoice_reminder_repeat_every_days
    FROM tenant_features tf
    WHERE cs.company_id = tf.company_id;

    RAISE NOTICE '[phase3] Reminder cadence backfilled from tenant_features into company_settings.';
  ELSE
    RAISE NOTICE '[phase3] tenant_features table absent — skipping backfill.';
  END IF;
END $$;

-- ============================================================================
-- A3 — Drop the legacy table.
-- ============================================================================

DROP TABLE IF EXISTS tenant_features CASCADE;

COMMIT;
