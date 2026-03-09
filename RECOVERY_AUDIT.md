# Recovery Audit: `main` vs `recover-phase4b`

**Date:** 2026-03-09
**Analyst:** Claude Code
**Branches compared:** `main` (f0fd366) ↔ `recover-phase4b` (31889e3)

---

## Executive Summary

The `recover-phase4b` branch contains **~4 weeks of product development** that is completely absent from `main`. The two branches share a merge base at `f0fd366` (the current HEAD of `main`), meaning `recover-phase4b` is 73 commits ahead with zero shared path — it is an **alternate lineage**, not a diverged ancestor.

**Main lost:**
- Entire PM Workspace (4 pages, backend queue, auto-generation engine)
- Entire Dispatch Board (22 components, day/week views, DnD)
- Live Map with technician tracking
- Customer Portal (magic-link auth, invoice viewing)
- QBO Console massive expansion (customer/catalog import, onboarding)
- Visit Intelligence & Auto-Gap Scheduling
- Equipment Catalog Items + Nameplate OCR
- Activity Feed system
- 20 database migrations
- Calendar → Scheduling rename

**Main kept:** 135 commits of canonical query refactors, performance hardening, and hook abstractions — no new product features.

**Recovery is viable** but requires staged porting due to architectural renames and deleted components on main.

---

## 1. Branch Divergence Summary

| Metric | Value |
|--------|-------|
| Merge base | `f0fd366` (current HEAD of `main`) |
| Commits unique to `main` | 0 |
| Commits unique to `recover-phase4b` | 73 |
| Relationship | `recover-phase4b` is a **side branch** — main is an ancestor, not a parallel line |
| Total diff | 544 files changed, +46,467 / -31,423 lines |

`main` contains 135 commits ahead of `origin/main`, but all 135 are ancestors of `recover-phase4b`'s merge base. The 73 new commits on `recover-phase4b` were created by the Replit agent deployment pipeline and never merged back.

---

## 2. High-Value Feature Recovery Inventory

### Feature 1: PM Workspace (Phase 4B) — PRIORITY 1
| Aspect | Detail |
|--------|--------|
| **Status on recover-phase4b** | ✅ Fully implemented — 4 pages, backend queue, auto-generation |
| **Status on main** | ❌ Completely absent — zero PM pages, no queue endpoint, no auto-gen |
| **Recovery difficulty** | **Medium** — clean additions, but App.tsx routes + server/index.ts registration needed |
| **Key files** | |
| | `client/src/pages/PMWorkspacePage.tsx` (856 lines) — Hub with grouping modes |
| | `client/src/pages/PMDetailPage.tsx` (581 lines) — Single PM setup view |
| | `client/src/pages/PMEditPage.tsx` (565 lines) — Edit PM template |
| | `client/src/pages/PMWizardPage.tsx` (1052 lines) — 5-step creation wizard |
| | `server/services/pmAutoGeneration.ts` (129 lines) — 6-hour auto-gen engine |
| | `server/storage/recurringJobs.ts` — +336 lines (getUpcomingQueue with location fields) |
| | `server/routes/recurringJobs.ts` — +76 lines (queue API endpoints) |

### Feature 2: Dispatch Board — PRIORITY 2
| Aspect | Detail |
|--------|--------|
| **Status on recover-phase4b** | ✅ Full dispatch board — day/week views, DnD, detail panel, 22 components |
| **Status on main** | ❌ Completely absent — main still has old Calendar.tsx (2288 lines) instead |
| **Recovery difficulty** | **High** — calendar→scheduling rename conflict, old Calendar.tsx must be replaced, DnD hooks rewritten |
| **Key files** | |
| | `client/src/pages/DispatchPreview.tsx` (1183 lines) |
| | `client/src/components/dispatch/` (22 files — timeline, lanes, DnD, detail panel) |
| | `client/src/hooks/useDispatchStream.ts`, `useTechnicianWorkingHours.ts` |
| | `server/routes/scheduling.ts` (renamed from `calendar.ts`) |
| | `server/storage/scheduling.ts` (renamed from `calendar.ts`) |

### Feature 3: Live Map — PRIORITY 2
| Aspect | Detail |
|--------|--------|
| **Status on recover-phase4b** | ✅ Technician route visualization, numbered stops, focus-to-fly |
| **Status on main** | ❌ Completely absent — no LiveMapPage, no map routes, no geocode utils |
| **Recovery difficulty** | **Medium** — mostly additive, needs map.ts route + geocode.ts + schema columns |
| **Key files** | |
| | `client/src/pages/LiveMapPage.tsx` (rewritten, 965 lines diff) |
| | `server/routes/map.ts` (370 lines) |
| | `server/utils/geocode.ts` (62 lines) |
| | `shared/types/map.ts` (77 lines) |
| | `client/src/hooks/useLiveTechnicians.ts` |
| | Migrations: `2026_03_04_google_places_geocoding_columns.sql`, `2026_03_05_technician_*`, `2026_03_05_live_map_backfills.sql`, `2026_03_08_add_live_map_feature_flag.sql` |

### Feature 4: QBO Console Expansion — PRIORITY 3
| Aspect | Detail |
|--------|--------|
| **Status on recover-phase4b** | ✅ Customer import, catalog import, onboarding flow, dry-run, conflict resolution |
| **Status on main** | ⚠️ Partial — QBO base exists but no import services, no onboarding, smaller console page |
| **Recovery difficulty** | **High** — QboConsolePage.tsx has 5127 lines of diff; qbo.ts routes +1176 lines; new services + schema columns |
| **Key files** | |
| | `client/src/pages/QboConsolePage.tsx` (massively expanded) |
| | `server/routes/qbo.ts` (+1176 lines) |
| | `server/services/qbo/QboCustomerImportService.ts` (837 lines — NEW) |
| | `server/services/qbo/QboCatalogImportService.ts` (555 lines — NEW) |
| | `shared/schema.ts` — `qboConnections` table, onboarding timestamp columns |
| | Migrations: `2026_02_20_qbo_connections.sql`, `2026_02_20_qbo_customer_unique_indexes.sql`, `2026_02_28_items_qbo_last_synced_at.sql`, `2026_03_01_qbo_onboarding_timestamps.sql` |

### Feature 5: Customer Portal — PRIORITY 3
| Aspect | Detail |
|--------|--------|
| **Status on recover-phase4b** | ✅ Magic-link auth, dashboard, invoice list/detail, separate session |
| **Status on main** | ❌ Completely absent |
| **Recovery difficulty** | **Medium** — self-contained module, minimal coupling |
| **Key files** | |
| | `client/src/pages/portal/` (6 files — login, verify, dashboard, invoices) |
| | `client/src/components/PortalLayout.tsx` |
| | `client/src/lib/portalAuth.tsx` |
| | `server/routes/portal.ts` (525 lines) |
| | Migration: `2026_02_15_customer_portal.sql` |

### Feature 6: Visit Intelligence & Auto-Gap Scheduling — PRIORITY 4
| Aspect | Detail |
|--------|--------|
| **Status on recover-phase4b** | ✅ Operational signals, delay detection, gap analysis, auto-scheduling suggestions |
| **Status on main** | ❌ Completely absent |
| **Recovery difficulty** | **Medium** — mostly additive server-side, needs events/attention schema |
| **Key files** | |
| | `server/lib/visitIntelligence.ts` — signal computation |
| | `server/lib/autoGapScheduling.ts` — slot suggestions |
| | `server/lib/attentionRules.ts` — dispatcher alerts |
| | `server/routes/intelligence.ts` (348 lines) |
| | `server/routes/attention.ts` |
| | `server/storage/attention.ts`, `server/storage/events.ts` |
| | Migration: `2026_03_04_events_and_attention_items.sql` |

### Feature 7: Equipment Catalog + Nameplate OCR — PRIORITY 4
| Aspect | Detail |
|--------|--------|
| **Status on recover-phase4b** | ✅ Catalog items per equipment, service timeline, photo OCR |
| **Status on main** | ❌ Completely absent |
| **Recovery difficulty** | **Low** — clean additive components + 1 route + 1 migration |
| **Key files** | |
| | `client/src/components/EquipmentCatalogItemsSection.tsx` (370 lines) |
| | `client/src/components/EquipmentServiceTimeline.tsx` |
| | `client/src/components/NameplateCaptureSection.tsx` (289 lines) |
| | `server/routes/equipmentCatalogItems.routes.ts` (345 lines) |
| | `server/services/nameplateOcr.ts` (112 lines) |
| | Migrations: `2026_03_06_equipment_catalog_items.sql`, `2026_03_06_equipment_nameplate_photo.sql` |

### Feature 8: Client/Job/Location Detail Rewrites — PRIORITY 2
| Aspect | Detail |
|--------|--------|
| **Status on recover-phase4b** | ✅ Major redesigns of all three detail pages |
| **Status on main** | ⚠️ Old versions with canonical query hook updates but older layouts |
| **Recovery difficulty** | **High** — 3190 lines diff on ClientDetailPage, 1839 on JobDetailPage; main's canonical hook changes conflict |
| **Key files** | |
| | `client/src/pages/ClientDetailPage.tsx` (3190 lines diff) |
| | `client/src/pages/JobDetailPage.tsx` (1839 lines diff) |
| | `client/src/pages/LocationDetailPage.tsx` (276 lines diff) |
| | `client/src/components/QuickAddJobDialog.tsx` (772 lines diff) |

### Feature 9: Activity Feed + Events System — PRIORITY 5
| Aspect | Detail |
|--------|--------|
| **Status on recover-phase4b** | ✅ Server events bus, activity feed drawer, dispatch stream |
| **Status on main** | ❌ Completely absent |
| **Recovery difficulty** | **Low** — additive |
| **Key files** | |
| | `client/src/components/activity/ActivityFeedDrawer.tsx` |
| | `client/src/lib/activityStore.tsx` |
| | `server/lib/events.ts`, `server/lib/dispatchBus.ts` |
| | `server/routes/activity.ts`, `server/routes/dispatch-stream.ts`, `server/routes/telemetry.ts` |

---

## 3. File-Level Diff Inventory (App-Critical Only)

### PM / Recurring Maintenance
| Status | File | Lines Δ |
|--------|------|---------|
| **ADD** | `client/src/pages/PMWorkspacePage.tsx` | +856 |
| **ADD** | `client/src/pages/PMWizardPage.tsx` | +1052 |
| **ADD** | `client/src/pages/PMDetailPage.tsx` | +581 |
| **ADD** | `client/src/pages/PMEditPage.tsx` | +565 |
| **ADD** | `server/services/pmAutoGeneration.ts` | +129 |
| **MOD** | `server/storage/recurringJobs.ts` | +336 |
| **MOD** | `server/routes/recurringJobs.ts` | +76 |
| **ADD** | `migrations/2026_03_09_pm_service_windows.sql` | new |

### Dispatch / Scheduling
| Status | File | Lines Δ |
|--------|------|---------|
| **ADD** | `client/src/pages/DispatchPreview.tsx` | +1183 |
| **ADD** | `client/src/components/dispatch/` (22 files) | ~4000+ |
| **ADD** | `client/src/hooks/useDispatchStream.ts` | new |
| **ADD** | `client/src/hooks/useTechnicianWorkingHours.ts` | +84 |
| **RENAME** | `server/routes/calendar.ts` → `scheduling.ts` | +709 |
| **RENAME** | `server/storage/calendar.ts` → `scheduling.ts` | +987 |
| **DEL** | `client/src/pages/Calendar.tsx` | -2288 |
| **DEL** | `client/src/components/calendar/` (15 files) | -6000+ |
| **DEL** | `client/src/hooks/useCalendarDnD.ts` | -1612 |
| **DEL** | `client/src/hooks/useCalendarState.ts` | -322 |

### Map / Geocoding / Routing
| Status | File | Lines Δ |
|--------|------|---------|
| **ADD** | `client/src/pages/LiveMapPage.tsx` | +965 |
| **ADD** | `server/routes/map.ts` | +370 |
| **ADD** | `server/utils/geocode.ts` | +62 |
| **ADD** | `shared/types/map.ts` | +77 |
| **ADD** | `shared/colors.ts` | +27 |
| **ADD** | `client/src/hooks/useLiveTechnicians.ts` | new |
| **ADD** | `client/src/lib/googleMapsLoader.ts` | new |
| **ADD** | Migrations: geocoding columns, technician positions, live map | 6 files |

### QBO / Invoices / Finance
| Status | File | Lines Δ |
|--------|------|---------|
| **MOD** | `client/src/pages/QboConsolePage.tsx` | 5127 |
| **MOD** | `server/routes/qbo.ts` | +1176 |
| **ADD** | `server/services/qbo/QboCustomerImportService.ts` | +837 |
| **ADD** | `server/services/qbo/QboCatalogImportService.ts` | +555 |
| **MOD** | `server/services/qbo/QboItemService.ts` | +308 |
| **MOD** | `server/services/qbo/QboItemMapper.ts` | +205 |
| **MOD** | `client/src/pages/InvoiceDetailPage.tsx` | +199 |
| **MOD** | `client/src/components/InvoiceHeaderCard.tsx` | +322 |
| **ADD** | Migrations: qbo_connections, onboarding timestamps, etc. | 4 files |

### Client / Job / Location Detail Surfaces
| Status | File | Lines Δ |
|--------|------|---------|
| **MOD** | `client/src/pages/ClientDetailPage.tsx` | 3190 |
| **MOD** | `client/src/pages/JobDetailPage.tsx` | 1839 |
| **MOD** | `client/src/pages/LocationDetailPage.tsx` | +276 |
| **MOD** | `client/src/components/JobDetailDialog.tsx` | 1411 |
| **MOD** | `client/src/components/QuickAddJobDialog.tsx` | +772 |
| **MOD** | `client/src/components/TaskDialog.tsx` | +675 |
| **ADD** | `client/src/components/visits/EditVisitModal.tsx` | +462 |
| **ADD** | `client/src/components/QuickCreateDrawer.tsx` | +483 |

### Portal
| Status | File | Lines Δ |
|--------|------|---------|
| **ADD** | `client/src/pages/portal/` (6 files) | ~800+ |
| **ADD** | `client/src/components/PortalLayout.tsx` | new |
| **ADD** | `client/src/lib/portalAuth.tsx` | new |
| **ADD** | `server/routes/portal.ts` | +525 |
| **ADD** | `migrations/2026_02_15_customer_portal.sql` | new |

### Schema / Migrations
| Status | Detail |
|--------|--------|
| **MOD** | `shared/schema.ts` — +635 lines (qboConnections table, geocoding columns, equipment catalog items, nameplate photo, postal code schema) |
| **ADD** | 20 new migration files on `recover-phase4b` not on `main` |

---

## 4. Exact Recovery Candidates

### PM Workspace Phase 4B
**Method: Copy files + patch existing files**
- Copy: `PMWorkspacePage.tsx`, `PMDetailPage.tsx`, `PMEditPage.tsx`, `PMWizardPage.tsx`, `pmAutoGeneration.ts`
- Patch: `server/storage/recurringJobs.ts` (add getUpcomingQueue location fields), `server/routes/recurringJobs.ts` (add queue endpoints), `client/src/App.tsx` (add routes), `server/index.ts` (register auto-gen)
- Run: `migrations/2026_03_09_pm_service_windows.sql`

### Live Map
**Method: Copy files + run migrations**
- Copy: `LiveMapPage.tsx`, `server/routes/map.ts`, `server/utils/geocode.ts`, `shared/types/map.ts`, `shared/colors.ts`, `useLiveTechnicians.ts`, `googleMapsLoader.ts`
- Patch: `client/src/App.tsx` (add route), `server/routes/index.ts` (register), `shared/schema.ts` (geocoding columns)
- Run: 6 map-related migrations

### Dispatch Board
**Method: Manual port (cannot cherry-pick cleanly)**
- Copy: `DispatchPreview.tsx`, entire `client/src/components/dispatch/` directory, `useDispatchStream.ts`, `useTechnicianWorkingHours.ts`
- **Conflict:** `server/routes/calendar.ts` → `scheduling.ts` rename. Main still has `calendar.ts`. Must rename on main first or adapt imports.
- **Conflict:** Old `Calendar.tsx` (2288 lines) on main must be replaced or kept alongside
- Patch: `server/storage/calendar.ts` → port scheduling changes, `App.tsx`, `server/index.ts`

### QBO Console Expansion
**Method: Copy new services + selective diff merge on QboConsolePage**
- Copy: `QboCustomerImportService.ts`, `QboCatalogImportService.ts`
- Selective merge: `QboConsolePage.tsx` (5127 line diff — too large for cherry-pick, needs section-by-section port)
- Patch: `server/routes/qbo.ts`, `shared/schema.ts` (qboConnections table)
- Run: 4 QBO migrations

### Customer Portal
**Method: Copy files (self-contained module)**
- Copy: entire `client/src/pages/portal/`, `PortalLayout.tsx`, `portalAuth.tsx`, `server/routes/portal.ts`
- Patch: `App.tsx` (add portal routes), `server/routes/index.ts`
- Run: `2026_02_15_customer_portal.sql`

### Detail Page Improvements (Client/Job/Location)
**Method: Selective diff-based merge (CANNOT copy directly)**
- `ClientDetailPage.tsx`: 3190 lines diff. Main has canonical hook changes. Must manually merge layout improvements into main's hook structure.
- `JobDetailPage.tsx`: 1839 lines diff. Same issue.
- `LocationDetailPage.tsx`: Smaller diff, more feasible for selective merge.

---

## 5. Conflict / Risk Analysis

### HIGH RISK — Architectural Renames
| Conflict | Detail |
|----------|--------|
| `calendar.ts` → `scheduling.ts` | Both route and storage files renamed on `recover-phase4b`. Main still uses `calendar.ts`. All imports referencing `calendar` must be updated. |
| Calendar component deletion | `recover-phase4b` deleted 15 calendar components + 2 hooks (~8000 lines). Main still has `Calendar.tsx` (2288 lines). Dispatch replaces Calendar. |

### HIGH RISK — Query Architecture Mismatch
| Conflict | Detail |
|----------|--------|
| Canonical query keys | Main's 135 commits standardized all query keys to family format `["jobs", ...]`, `["invoices", ...]`. `recover-phase4b` predates this and uses older query key patterns in some files. |
| Invalidation patterns | Main rewrote mutation invalidation across all pages. Copied pages from `recover-phase4b` will use old invalidation patterns. |
| `useVisitFeed.ts` | Deleted on `recover-phase4b`, exists on main. Different visit data patterns. |

### MEDIUM RISK — Schema Divergence
| Conflict | Detail |
|----------|--------|
| 20 missing migrations | `recover-phase4b` has 20 migrations not on main. Must be run in order. Some may conflict with main's equipment consolidation migration. |
| `shared/schema.ts` | +635 lines of new tables/columns. Must be merged carefully — main also modified this file for canonical type exports. |

### MEDIUM RISK — Deleted Components on `recover-phase4b`
| Component | Detail |
|-----------|--------|
| `PMSetupModal.tsx` | Deleted (replaced by PMWizardPage) |
| `PartsManagementDialog.tsx` | Deleted (-767 lines) — main may still reference it |
| `NotificationBell.tsx` | Deleted on `recover-phase4b`, exists on main |
| `SettingsLayout.tsx` | Deleted, replaced by `SettingsShell.tsx` |
| `TasksSidebar.tsx` | Deleted (-380 lines) |
| Various UI primitives | 14 shadcn/ui components deleted (accordion, carousel, chart, etc.) |

### LOW RISK — Type Mismatches
| Issue | Detail |
|-------|--------|
| Job/Invoice types | Main uses `JobFeedItem`, `InvoiceFeedItem` canonical types. `recover-phase4b` uses local interfaces. Copied pages will need type updates. |
| TeamMember.id | Changed from `number` to `string` on `recover-phase4b` |

---

## 6. Recommended Recovery Order

### Stage 1: Foundation (Low risk, unblocks everything)
1. **Run the 20 missing migrations** in chronological order against the database
2. **Merge `shared/schema.ts`** additions (new tables, columns) into main's version
3. **Copy `shared/types/map.ts`** and **`shared/colors.ts`**
4. **Rename** `server/routes/calendar.ts` → `scheduling.ts` and `server/storage/calendar.ts` → `scheduling.ts` on main, updating all imports

### Stage 2: PM Workspace (Medium risk, highest product value)
1. Copy all 4 PM pages (`PMWorkspacePage`, `PMDetailPage`, `PMEditPage`, `PMWizardPage`)
2. Copy `server/services/pmAutoGeneration.ts`
3. Patch `server/storage/recurringJobs.ts` with `getUpcomingQueue` location fields
4. Patch `server/routes/recurringJobs.ts` with queue endpoints
5. Register routes in `App.tsx` and `server/index.ts`
6. **Update query keys** in PM pages to match main's canonical format
7. Test PM workspace end-to-end

### Stage 3: Live Map (Medium risk, high product value)
1. Copy `LiveMapPage.tsx`, `server/routes/map.ts`, `server/utils/geocode.ts`
2. Copy `useLiveTechnicians.ts`, `googleMapsLoader.ts`
3. Register route in `App.tsx` and `server/routes/index.ts`
4. Update query patterns to canonical format

### Stage 4: Dispatch Board (High risk, high product value)
1. Copy entire `client/src/components/dispatch/` directory
2. Copy `DispatchPreview.tsx`
3. Port `scheduling.ts` route/storage changes (already renamed in Stage 1)
4. Copy dispatch hooks (`useDispatchStream.ts`, `useTechnicianWorkingHours.ts`)
5. **Decision point:** Remove old `Calendar.tsx` or keep as fallback
6. Update all query/mutation patterns to canonical format
7. Heavy integration testing required

### Stage 5: QBO Console + Import Services (High risk, medium product value)
1. Copy `QboCustomerImportService.ts` and `QboCatalogImportService.ts`
2. Selectively merge `server/routes/qbo.ts` additions
3. **Manually port** `QboConsolePage.tsx` section-by-section (too diverged to copy)
4. Test OAuth flow, import dry-run, conflict resolution

### Stage 6: Customer Portal (Low risk, self-contained)
1. Copy entire portal module (pages, layout, auth, routes)
2. Register in `App.tsx` and `server/routes/index.ts`
3. Minimal conflict expected — fully isolated auth system

### Stage 7: Detail Page Improvements (High risk, reconciliation)
1. **Do NOT copy** detail pages from `recover-phase4b` directly
2. Manually diff each page and port **layout/UX improvements** into main's canonical hook versions
3. This is the most labor-intensive stage — budget accordingly
4. Port: `QuickAddJobDialog.tsx`, `EditVisitModal.tsx`, `QuickCreateDrawer.tsx`

### Stage 8: Intelligence + Equipment + Activity (Low risk, additive)
1. Copy all `server/lib/` intelligence files
2. Copy equipment catalog components + routes
3. Copy activity feed components + server events
4. Register routes, update query patterns

---

## Recommended Next Action

**Do Stage 1 (Foundation) now.** It is entirely additive, zero-risk to existing functionality, and unblocks all subsequent stages. Then proceed to Stage 2 (PM Workspace) as the highest-value recovery target.

Do **not** attempt a full branch merge — the 544-file diff with architectural renames will create hundreds of conflicts. Surgical file-by-file recovery is the only safe path.
