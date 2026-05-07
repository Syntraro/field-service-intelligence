-- =====================================================================
-- Migration: 2026-05-07 — user_dashboard_widgets
-- =====================================================================
-- Adds per-user dashboard layout persistence: each row records one
-- widget's visibility + ordering on a specific dashboard for a single
-- user. Backs the new `useDashboardLayout` hook + the canonical
-- "Customize Dashboard" right-side drawer. Layout absence (zero rows
-- for a (user, dashboard) pair) means "use the registry defaults" —
-- no row is ever auto-seeded. Reset = delete the user's rows for the
-- target dashboard; subsequent GETs fall back to defaults.
--
-- Why
-- ---
-- The financial dashboard previously rendered six widgets in a fixed
-- hardcoded JSX order. Different operator personas want different
-- arrangements (technician-focused vs. owner-cashflow vs. dispatch-
-- focused). This table backs a registry-driven framework so the same
-- registry can drive both the rendered grid and the customize drawer.
--
-- Schema
-- ------
--   user_id         FK users(id) ON DELETE CASCADE
--   dashboard_key   text — namespaces layouts. Initial value "financial".
--                    The shape supports adding "operations" / "team_hub"
--                    later without a migration.
--   widget_key      text — matches the canonical registry key in
--                    `shared/dashboardWidgetRegistry.ts`. Server validates
--                    the key against the registry on PUT, rejecting
--                    unknown widgets at 400.
--   visible         boolean — per-user visibility override. Falls back
--                    to the registry default when no row exists.
--   order_index     integer — per-user ordering override. Smaller = top.
--   created_at      timestamptz — insert-time clock.
--   updated_at      timestamptz — bumped by the storage layer on UPDATE.
--
-- Constraints
-- -----------
--   UNIQUE (user_id, dashboard_key, widget_key) — one preference row per
--   widget per dashboard per user. The PUT route uses this for
--   idempotent upsert (delete + insert in a transaction).
--
-- Index
-- -----
--   idx_user_dashboard_widgets_lookup on (user_id, dashboard_key,
--   order_index) — the canonical read predicate the GET route runs.
--
-- Run with
-- --------
--   npm run db:migrate:one -- migrations/2026_05_07_user_dashboard_widgets.sql
-- =====================================================================

CREATE TABLE IF NOT EXISTS user_dashboard_widgets (
  id            varchar       PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       varchar       NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  dashboard_key text          NOT NULL,
  widget_key    text          NOT NULL,
  visible       boolean       NOT NULL DEFAULT true,
  order_index   integer       NOT NULL,
  created_at    timestamptz   NOT NULL DEFAULT NOW(),
  updated_at    timestamptz,
  CONSTRAINT user_dashboard_widgets_unique UNIQUE (user_id, dashboard_key, widget_key)
);

CREATE INDEX IF NOT EXISTS idx_user_dashboard_widgets_lookup
  ON user_dashboard_widgets (user_id, dashboard_key, order_index);
