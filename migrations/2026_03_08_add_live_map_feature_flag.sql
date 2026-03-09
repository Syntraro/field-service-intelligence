-- Migration: Add live_map_enabled feature flag to tenant_features
-- Date: 2026-03-08
-- Description: Adds liveMapEnabled column for independently gating Live Map access.
--              Live Map has separate infrastructure costs (map tiles, real-time GPS).
--
-- Run: psql $DATABASE_URL < migrations/2026_03_08_add_live_map_feature_flag.sql

ALTER TABLE tenant_features
  ADD COLUMN IF NOT EXISTS live_map_enabled BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN tenant_features.live_map_enabled IS 'Whether the Live Map feature is enabled for this tenant. Can be disabled to control map tile / GPS infrastructure costs.';
