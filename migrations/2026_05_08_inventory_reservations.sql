-- =====================================================================
-- Migration: 2026-05-08 — Inventory reservations (Phase 5)
-- =====================================================================
-- Phase 5 of the capability-gated Inventory module. Activates the
-- existing inventory_quantities.reserved_quantity column (which has
-- been ≥ 0 CHECK-guarded since Phase 1 but never mutated by any code
-- path) by introducing first-class reservation rows.
--
-- Architectural decisions
-- -----------------------
-- 1. Reservations are their OWN audit log. The inventory_reservations
--    row records who reserved what, when, against which job/line, and
--    every status transition. We do NOT write inventory_transactions
--    rows for reserve / release / cancel because no quantity moves
--    physically — only the (on_hand vs reserved) split shifts. The
--    inventory_transactions log historically records stock MOVEMENTS
--    (from_location → to_location with a positive quantity); a
--    reservation has neither a movement nor a destination, so it
--    doesn't fit that audit shape.
--
-- 2. Reservations contribute to inventory_quantities.reserved_quantity.
--    The single-tx invariant from Phase 1 is preserved: every change
--    to reserved_quantity is paired with an INSERT or UPDATE on
--    inventory_reservations inside the same Drizzle transaction
--    (mediated by inventoryService.reserveInventory /
--    releaseReservation / cancelReservation / consumeForJob).
--
-- 3. Two-counter model on the reservation row: `quantity` is the
--    original reserved amount (immutable) and `consumed_quantity` is
--    the running counter of how much was consumed against this
--    reservation. The remaining un-consumed balance is derived as
--    quantity − consumed_quantity. When consumed_quantity reaches
--    quantity the reservation transitions to status='consumed'.
--    Manual release of an active reservation transitions to
--    status='released' and frees (quantity − consumed_quantity) from
--    the location's reserved_quantity. We never mutate `quantity`
--    after creation.
--
-- 4. Soft state (status enum) instead of hard delete. Released and
--    canceled reservations stay in the table forever for audit. The
--    repository's "active reservations" reads filter on
--    status='active' so historic rows never affect availability.
--
-- 5. visit_id column is added now (nullable) for forward-compat with
--    the future visit-level reservation flow. NO existing visit table
--    is referenced because the system has multiple visit-shape
--    candidates (job_visits, lead_visits, etc.) — leaving the FK
--    unenforced now keeps the migration simple. A future pass picks
--    the canonical visit table + adds the FK.
--
-- Idempotent: every CREATE / ALTER uses IF NOT EXISTS.
-- =====================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS inventory_reservations (
  id                       varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id               varchar NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  item_id                  varchar NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
  location_id              varchar NOT NULL REFERENCES inventory_locations(id) ON DELETE RESTRICT,
  -- Optional linkage. job_id is the most-common case (reserve against
  -- a scheduled job); line_item_id mirrors the Phase 4 linkage on
  -- job_inventory_usage so the consume-from-line-item flow can
  -- reconcile via reservation when one exists. visit_id is forward-
  -- compat (no FK enforced — see file-level rationale).
  job_id                   varchar REFERENCES jobs(id) ON DELETE SET NULL,
  visit_id                 varchar,
  line_item_id             varchar REFERENCES job_parts(id) ON DELETE SET NULL,
  -- Two-counter model. quantity is immutable post-create;
  -- consumed_quantity grows up to quantity as consumption flows pull
  -- against this reservation.
  quantity                 numeric(14, 4) NOT NULL,
  consumed_quantity        numeric(14, 4) NOT NULL DEFAULT 0,
  status                   text NOT NULL DEFAULT 'active',
  reserved_by_user_id      varchar REFERENCES users(id) ON DELETE SET NULL,
  notes                    text,
  released_at              timestamp,
  created_at               timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at               timestamp,
  CONSTRAINT inventory_reservations_quantity_positive
    CHECK (quantity > 0),
  CONSTRAINT inventory_reservations_consumed_nonneg
    CHECK (consumed_quantity >= 0),
  CONSTRAINT inventory_reservations_consumed_le_quantity
    CHECK (consumed_quantity <= quantity),
  CONSTRAINT inventory_reservations_status_check
    CHECK (status IN ('active', 'consumed', 'released', 'canceled'))
);

-- Tenant-scoped active-only lookup index — every "what's currently
-- reserved" read goes through this. The partial filter keeps it tight
-- so historic released / canceled rows don't bloat the index.
CREATE INDEX IF NOT EXISTS inventory_reservations_active_company_idx
  ON inventory_reservations(company_id, item_id, location_id)
  WHERE status = 'active';

-- Per-item recent index for the item rail's "Reservations" sub-strip.
CREATE INDEX IF NOT EXISTS inventory_reservations_item_recent_idx
  ON inventory_reservations(company_id, item_id, created_at DESC);

-- Per-location recent index for the location rail.
CREATE INDEX IF NOT EXISTS inventory_reservations_location_recent_idx
  ON inventory_reservations(company_id, location_id, created_at DESC);

-- Per-job index for the JobReservationsSection. Active-only because
-- the section only renders active reservations; historical view goes
-- through the activity feed.
CREATE INDEX IF NOT EXISTS inventory_reservations_job_active_idx
  ON inventory_reservations(company_id, job_id, created_at DESC)
  WHERE job_id IS NOT NULL AND status = 'active';

-- Phase 5 reuses the existing inventory_core capability + the
-- inventory.manage permission for writes (reserve / release /
-- cancel) and inventory.view for reads. No new permission rows or
-- catalog entries are needed.

COMMIT;
