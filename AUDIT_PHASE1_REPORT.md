# Phase 1 Static Analysis Report

**Generated:** 2026-03-05
**Branch:** `perf-tech-timesheets-bundle`
**Scope:** Read-only codebase audit — no files modified

---

## 1. Dead Code

**Estimated total removable dead code: ~11,000+ lines**

### 1a. Dead Directories & Legacy Files

| Item | Files | Lines | Evidence |
|------|-------|-------|----------|
| `server/_legacy/` directory | `clients.ts`, `routes_storage.ts` | 937 | Zero imports from any file. `clients.ts` references non-existent `subscriptionService.ts`. |
| `server/migrate-to-multi-tenant.ts` | 1 | 227 | One-time migration script, never imported by the application |
| `server/cleanup/removeImplicitCompany.ts` | 1 | 1 | Empty placeholder, never imported |
| `server/cleanup/removeLegacyAuth.ts` | 1 | 1 | Empty placeholder, never imported |
| `client/src/components/examples/` directory | 6 | 135 | Re-exports dead components; never imported by active code |
| `client/src/pages/examples/` directory | 1 | 5 | Example page never registered in router |

### 1b. Unused Server Services & Utilities

| File | Lines | Evidence |
|------|-------|----------|
| `server/services/invoiceSync.ts` | 38 | Never imported by any file |
| `server/services/invoiceDirty.ts` | 9 | `markInvoiceDirty()` never called |
| `server/qbo/syncService.ts` | 7 | Wrapper around `assertInvoiceSyncAllowed`, never imported |
| `server/storage/types.ts` | 11 | `PaginatedResult` type never imported |
| `server/storage/base.ts` | 212 | `BaseRepository` class never imported |
| `server/auth/attachUserContext.ts` | 10 | Middleware never imported or mounted |

### 1c. Orphaned Route Handler

| Route File | API Path | Lines | Evidence |
|------------|----------|-------|----------|
| `server/routes/parts.ts` | `/api/parts/*` | 115 | Full CRUD never mounted in `server/routes/index.ts`. Zero frontend callers. Superseded by `/api/items`. |
| `server/routes/telemetry.ts` | `/api/telemetry/*` | ~50 | Mounted but zero frontend callers. GPS ping endpoint with no active client. |

### 1d. Unused React Components (~5,500 lines)

| # | Component | File | Lines | Evidence |
|---|-----------|------|-------|----------|
| 1 | `SubscriptionOverview` | `client/src/components/SubscriptionOverview.tsx` | 155 | Never imported |
| 2 | `ActionRequiredKPIs` | `client/src/components/ActionRequiredKPIs.tsx` | 171 | Never imported |
| 3 | `JobAssignmentsCard` | `client/src/components/JobAssignmentsCard.tsx` | 67 | Comment says "replaced by unified top-section layout" |
| 4 | `UnscheduledJobsSidebar` | `client/src/components/UnscheduledJobsSidebar.tsx` | 241 | Never imported (superseded by CalendarSidebar) |
| 5 | `ClientNotesTab` | `client/src/components/ClientNotesTab.tsx` | 309 | Never imported |
| 6 | `ClientLocationsTab` | `client/src/components/ClientLocationsTab.tsx` | 270 | Never imported |
| 7 | `ClientJobsTab` | `client/src/components/ClientJobsTab.tsx` | 210 | Never imported |
| 8 | `Header` | `client/src/components/Header.tsx` | 196 | Superseded by inline header in `App.tsx` |
| 9 | `AppHeader` | `client/src/components/AppHeader.tsx` | 219 | Never imported (only in comments) |
| 10 | `StatsCard` | `client/src/components/StatsCard.tsx` | 67 | Only by dead `examples/` |
| 11 | `NotificationBell` | `client/src/components/NotificationBell.tsx` | 261 | Only by dead `Header.tsx` and `AppHeader.tsx` |
| 12 | `MaintenanceCard` | `client/src/components/MaintenanceCard.tsx` | 163 | Only by dead `MaintenanceSection.tsx` |
| 13 | `MaintenanceSection` | `client/src/components/MaintenanceSection.tsx` | 67 | Never imported |
| 14 | `ClientListTable` | `client/src/components/ClientListTable.tsx` | 215 | Only by dead `examples/` |
| 15 | `TechnicianLayout` | `client/src/components/TechnicianLayout.tsx` | 68 | Never imported |
| 16 | `SettingsLayout` | `client/src/components/SettingsLayout.tsx` | 292 | Superseded by `SettingsShell.tsx` |
| 17 | `TasksSidebar` | `client/src/components/TasksSidebar.tsx` | 380 | Never imported |
| 18 | `CsrfInitializer` | `client/src/components/CsrfInitializer.tsx` | 18 | Never imported |
| 19 | `ClientDetailDialog` | `client/src/components/ClientDetailDialog.tsx` | 426 | Orphaned dialog |
| 20 | `PartsManagementDialog` | `client/src/components/PartsManagementDialog.tsx` | 767 | Never imported |
| 21 | `JobMetaCard` | `client/src/components/JobMetaCard.tsx` | 243 | Never imported |

### 1e. Orphaned React Pages (~2,655 lines)

Pages that exist but are never registered in any `<Route>` or imported by active code:

| # | File | Lines | Evidence |
|---|------|-------|----------|
| 1 | `JobStatusesPage.tsx` | 250 | Comment: "job statuses are now a fixed system enum" |
| 2 | `TechnicianDashboard.tsx` | 450 | Imported in App.tsx but never used in any `<Route>`. Superseded by `Technician.tsx`. |
| 3 | `TechLoginPage.tsx` | 122 | Unfinished technician field app |
| 4 | `TechHomePage.tsx` | 144 | Unfinished technician field app |
| 5 | `TechSchedulePage.tsx` | 165 | Unfinished technician field app |
| 6 | `TechTimesheetPage.tsx` | 149 | Unfinished technician field app |
| 7 | `TechMorePage.tsx` | 71 | Unfinished technician field app |
| 8 | `TechVisitDetailPage.tsx` | 530 | Unfinished technician field app |
| 9 | `AdminTimesheetsPage.tsx` | 722 | Never imported; backend route mounted but no frontend caller |
| 10 | `Suppliers.tsx` | 52 | Superseded by `SuppliersListPage.tsx` |

### 1f. Unused shadcn UI Wrapper Components (1,862 lines)

| File | Lines | Radix/Library Dep |
|------|-------|-------------------|
| `ui/accordion.tsx` | 56 | `@radix-ui/react-accordion` |
| `ui/aspect-ratio.tsx` | 5 | `@radix-ui/react-aspect-ratio` |
| `ui/breadcrumb.tsx` | 115 | (none) |
| `ui/carousel.tsx` | 260 | `embla-carousel-react` |
| `ui/chart.tsx` | 365 | `recharts` |
| `ui/context-menu.tsx` | 198 | `@radix-ui/react-context-menu` |
| `ui/drawer.tsx` | 118 | `vaul` |
| `ui/input-otp.tsx` | 69 | `input-otp` |
| `ui/menubar.tsx` | 256 | `@radix-ui/react-menubar` |
| `ui/navigation-menu.tsx` | 128 | `@radix-ui/react-navigation-menu` |
| `ui/pagination.tsx` | 117 | (none) |
| `ui/resizable.tsx` | 45 | `react-resizable-panels` |
| `ui/slider.tsx` | 26 | `@radix-ui/react-slider` |
| `ui/toggle.tsx` | 43 | `@radix-ui/react-toggle` (only by toggle-group) |
| `ui/toggle-group.tsx` | 61 | `@radix-ui/react-toggle-group` |

### 1g. Stale Imports in Active Files

| File | Unused Symbols |
|------|---------------|
| `App.tsx` | `TechnicianDashboard` import (L34), `ClipboardList`/`Users`/`FileText`/`Receipt` icons, `DropdownMenu*` components |
| `JobDetailPage.tsx` | `CardDescription` from card |
| `Calendar.tsx` | `CollisionDetection` (could be type import) |

### 1h. Commented-Out Code / Dev Logging

| File | Lines | Description |
|------|-------|-------------|
| `server/routes/map.ts` | 200-225 | Dev-only diagnostic (guarded by `NODE_ENV`, acceptable) |
| `CalendarGridDayJobber.tsx` | 130-132, 174-176 | `console.log` in drop zones on every `isOver` during drag |
| `Jobs.tsx` | 53-60 | Commented-out lifecycle status documentation |

### 1i. Additional Dead Code Observations

- **Duplicate audit services:** `server/auditService.ts` (root) and `server/services/auditService.ts` — two separate implementations. Consider consolidating.
- **Transitively dead hook:** `client/src/hooks/useVisitFeed.ts` (144 lines) — only referenced by orphaned `TechVisitDetailPage.tsx`. If tech pages are deleted, this hook becomes fully dead.
- **Barrel file:** `client/src/components/jobs/index.ts` (2 lines) — never imported; consumers use direct paths.

---

## 2. Duplicate / Redundant Logic

### 2a. CRITICAL — Route Files Bypassing Storage Layer

11 route files execute raw DB queries instead of delegating to `server/storage/` repositories:

| Route File | Tables Queried Directly |
|------------|------------------------|
| `server/routes/map.ts` | `users`, `technician_live_positions`, `job_visits`, `jobs`, `client_locations`, `attention_items`, `company_settings` |
| `server/routes/calendar.ts` | `job_visits`, `jobs`, `client_locations`, `users`, `company_settings` |
| `server/routes/roles.ts` | `roles`, `role_permissions`, `user_permission_overrides` |
| `server/routes/qbo.ts` | `client_locations`, `customer_companies` |
| `server/routes/qboSync.ts` | `client_locations`, `invoices`, `payments` |
| `server/routes/techField.ts` | `job_visits`, `jobs`, `users`, `technician_live_positions`, `company_settings` |
| `server/routes/invoices.ts` | `invoice_line_items`, `invoices` |
| `server/routes/jobs.ts` | `jobs`, `job_visits`, `client_locations` |
| `server/routes/equipmentUnits.ts` | `equipment_units`, `equipment_models` |
| `server/routes/reports.ts` | `jobs`, `invoices`, `client_locations` |
| `server/routes/adminTimesheets.ts` | `timesheet_entries`, `jobs`, `users` |

**Impact:** Inconsistent query patterns, duplicated tenant scoping, harder to maintain.

### 2b. CRITICAL — Haversine Distance Copied 4 Times

| File | Function Name | Lines |
|------|--------------|-------|
| `server/services/visitIntelligence.ts` | `haversineDistance()` | ~15 |
| `server/services/autoGapScheduling.ts` | `haversineDistance()` | ~15 |
| `server/routes/calendar.ts` | `haversineDistance()` | ~15 |
| `server/services/intelligence.ts` | `haversineDistance()` | ~15 |

**Fix:** Extract to `server/utils/geo.ts`.

### 2c. CRITICAL — Timezone Helpers Copied

| File | Functions |
|------|-----------|
| `server/routes/map.ts` | `todayInTimezone()`, `dayBoundsInTz()`, `getTenantTimezone()` |
| `server/routes/techField.ts` | `todayInTimezone()`, `dayBoundsInTz()`, `getTenantTimezone()` |

Identical implementations. **Fix:** Extract to `server/utils/timezone.ts`.

### 2d. HIGH — Visit Response Shape Built 3 Different Ways

| File | Shape |
|------|-------|
| `server/routes/calendar.ts` | `scheduledStart`, `scheduledEnd`, `technicianId`, `clientName` |
| `server/routes/map.ts` | `scheduledStart`, `scheduledEnd`, `technicianId`, `locationName` |
| `server/routes/techField.ts` | `scheduled_start`, `scheduled_end`, `technician_id`, `location_name` |

Inconsistent field naming (camelCase vs snake_case) and different included fields.

### 2e. HIGH — Technician + Live Position Query Duplicated 3 Times

| File | Pattern |
|------|---------|
| `server/routes/map.ts` | `users LEFT JOIN technician_live_positions` |
| `server/routes/techField.ts` | `users LEFT JOIN technician_live_positions` |
| `server/routes/calendar.ts` | `users JOIN` (variant) |

### 2f. HIGH — Format Utilities Duplicated

| Utility | Locations |
|---------|-----------|
| `formatDateOnly()` | `client/src/lib/`, `client/src/components/`, `server/services/` |
| `formatDate()` | `server/services/pdfService.ts`, `server/services/invoicePdfService.ts` |
| `formatCurrency()` | `server/services/pdfService.ts`, `server/services/invoicePdfService.ts` |

---

## 3. Missing or Suspicious Database Indexes

### 3a. HIGH Priority — Tables with Zero Indexes

| Table | Row Estimate | Common Filters | Suggested Index |
|-------|-------------|----------------|-----------------|
| `payments` | Growing | `company_id`, `invoice_id`, `qbo_payment_id` | `(company_id, invoice_id)`, `(company_id, qbo_payment_id)` |
| `client_contacts` | Growing | `company_id`, `location_id` | `(company_id, location_id)` |
| `quote_lines` | Growing | `quote_id` | `(quote_id)` |

### 3b. HIGH Priority — Missing Compound Indexes on Frequently Queried Tables

| Table | Missing Index | Query Pattern |
|-------|--------------|---------------|
| `job_visits` | `(company_id, is_active, scheduled_start)` | Calendar + Map date-range queries — most critical hot path |
| `job_visits` | `(company_id, job_id, is_active)` | Job detail visit lookups |
| `client_notes` | `(company_id, location_id)` | Client detail page notes tab |
| `supplier_locations` | `(supplier_id)` | FK lookup when loading supplier details |
| `client_locations` | `(company_id) WHERE deleted_at IS NULL` | Partial index for soft-delete-aware list queries |
| `customer_companies` | `(company_id) WHERE deleted_at IS NULL` | Partial index for soft-delete-aware list queries |
| `jobs` | `(company_id, status) WHERE status NOT IN ('cancelled','voided')` | Active jobs dashboard queries |

### 3c. MEDIUM Priority — FK Columns Without Indexes

| Table | Column | Referencing |
|-------|--------|------------|
| `attention_items` | `entity_id` | Used in WHERE + JOIN for map risk lookups |
| `audit_logs` | `company_id`, `user_id` | Admin console queries |
| `invoice_line_items` | `invoice_id` | Invoice detail page |
| `equipment_units` | `location_id`, `model_id` | Equipment section queries |
| `job_equipment` | `job_id`, `equipment_unit_id` | Job detail equipment tab |
| `pm_schedules` | `location_id` | PM setup queries |
| `job_template_parts` | `template_id` | Template parts loading |
| `contract_locations` | `contract_id`, `location_id` | Contract detail queries |
| `recurring_job_series` | `company_id` | Recurring job management |
| `time_off_requests` | `company_id`, `user_id` | Calendar time-off display |

### 3d. LOW Priority — GPS/Specialized Columns

| Table | Column | Notes |
|-------|--------|-------|
| `client_locations` | `lat`, `lng` | Map queries filter by coords; spatial index could help at scale |
| `technician_live_positions` | `(company_id, technician_id)` | Already has PK but compound index aids JOIN queries |
| `invitations` | `company_id`, `token` | Security: token lookup should be indexed |
| `sessions` | `expire` | Session cleanup queries |

### Summary: **31+ missing indexes identified** across 90 tables (79 existing indexes catalogued)

---

## 4. Unused Dependencies

### 4a. Frontend — Completely Unused Packages (HIGH)

| Package | Est. Size (gzipped) | Evidence |
|---------|---------------------|----------|
| `framer-motion` | ~32 KB | Zero imports in `client/src/` |
| `@stripe/react-stripe-js` | ~15 KB | Zero imports (server-side Stripe used, not browser SDK) |
| `@stripe/stripe-js` | ~50 KB | Zero imports |
| `react-icons` | ~20 KB | Zero imports (project uses `lucide-react`) |
| `next-themes` | ~3 KB | Zero imports (Next.js-specific, app uses Vite) |
| `tw-animate-css` | ~2 KB | Zero imports (project uses `tailwindcss-animate`) |
| `@jridgewell/trace-mapping` | ~5 KB | Transitive dep incorrectly in direct deps |

### 4b. Frontend — Packages Only Used by Dead shadcn Wrappers (LOW)

| Package | Used Only By |
|---------|-------------|
| `embla-carousel-react` | `ui/carousel.tsx` (never imported) |
| `input-otp` | `ui/input-otp.tsx` (never imported) |
| `react-resizable-panels` | `ui/resizable.tsx` (never imported) |
| `vaul` | `ui/drawer.tsx` (never imported) |
| `recharts` | `ui/chart.tsx` (never imported) |
| `@radix-ui/react-accordion` | `ui/accordion.tsx` (never imported) |
| `@radix-ui/react-aspect-ratio` | `ui/aspect-ratio.tsx` (never imported) |
| `@radix-ui/react-context-menu` | `ui/context-menu.tsx` (never imported) |
| `@radix-ui/react-menubar` | `ui/menubar.tsx` (never imported) |
| `@radix-ui/react-navigation-menu` | `ui/navigation-menu.tsx` (never imported) |
| `@radix-ui/react-slider` | `ui/slider.tsx` (never imported) |
| `@radix-ui/react-toggle-group` | `ui/toggle-group.tsx` (never imported) |

### 4c. Backend — Unused Packages

| Package | Severity | Evidence |
|---------|----------|----------|
| `memorystore` | MEDIUM | Zero imports in `server/`. App uses `connect-pg-simple`. |
| `@jridgewell/trace-mapping` | HIGH | Not imported anywhere; transitive dep promoted to direct. |

### 4d. Misplaced `@types/*` in Production Dependencies

These should be in `devDependencies`: `@types/bcryptjs`, `@types/cors`, `@types/leaflet`, `@types/multer`, `@types/pdfkit`, `@types/react-window`

### Estimated Bundle Savings

| Action | Estimated Savings |
|--------|-------------------|
| Remove unused heavy packages (framer-motion, stripe-js, react-icons) | ~100 KB gzipped |
| Remove unused shadcn wrappers + their deps | ~80 KB gzipped |
| Remove unused light packages | ~15 KB gzipped |
| **Total potential** | **~195 KB gzipped** |

---

## 5. Component Over-Rendering Risks

### P0 — High Impact

| # | Finding | File(s) | Description |
|---|---------|---------|-------------|
| 1 | `getEventsForTech` not memoized | `CalendarGridDayJobber.tsx:548-554`, `CalendarGridDayRows.tsx:461-467` | Plain function called per technician, filters `dayEvents` array. For 10 techs = 40+ filter passes per render. **Fix:** Pre-compute `Map<techId, CalendarEvent[]>` with `useMemo`. |
| 2 | `ImpersonationBanner` polls every 5s | `ImpersonationBanner.tsx:33` | `refetchInterval: 5000, staleTime: 0` fires for ALL users even when not impersonating. Mounted in app layout. **Fix:** Add `enabled: !!isImpersonating`. |

### P1 — Medium Impact

| # | Finding | File(s) | Description |
|---|---------|---------|-------------|
| 3 | `ResizableJobCard` not memoized | `ResizableJobCard.tsx:40-228` | Per-event component re-renders on every parent change. Has `useCallback` on handlers but no `React.memo()` wrapper. |
| 4 | `DraggableEventBlock` not memoized | `CalendarGridDayRows.tsx:125-278` | Unlike `DraggableClient` (which uses memo + custom comparator), this is a plain function component. |
| 5 | Calendar unscheduled query `staleTime: 0` | `Calendar.tsx:1365` | Always considered stale, refetches on every mount/focus. High-traffic page. **Fix:** `staleTime: 10_000`. |
| 6 | `MemoizedTechColumn` receives unstable array props | `CalendarGridDayJobber.tsx:597-654` | `clients` and `technicians` arrays passed as props — new references from query data defeat `memo`. |
| 7 | `useEffect` missing `businessHours` dependency | `CalendarGridDayRows.tsx:470-476` | Auto-scroll effect uses `businessHours` but only depends on `[dateKey]`. Won't re-fire if hours load async. |

### P2 — Low Impact

| # | Finding | File(s) | Description |
|---|---------|---------|-------------|
| 8 | LiveMap markers not separated | `LiveMapPage.tsx:718-807` | Tech + visit markers inline in `MapContainer`. Any state change recalculates all markers. Leaflet DOM diffing mitigates. |
| 9 | `NotificationBell` 30s polling | `NotificationBell.tsx:67` | Mounted in app header. Consider WebSocket push or increase to 60s. |
| 10 | 3 separate `useEffect` for LiveMap toggles | `LiveMapPage.tsx:559-561` | Each toggle state change writes to localStorage independently → 3 sequential re-renders possible. |
| 11 | `onClick` closure in ResizableJobCard | `ResizableJobCard.tsx:190-192` | Creates new closure every render, defeats child memo. Wrap in `useCallback`. |
| 12 | Calendar.tsx has 8+ `useQuery` calls | `Calendar.tsx:255-1418` | TanStack Query deduplicates, but many active observers slow invalidation cycles. |

---

## 6. Multi-Tenant Isolation Gaps

### Overall Assessment: **STRONG**

The codebase has robust multi-tenant isolation via `ensureTenantContext` middleware and consistent `companyId` filtering. Only minor findings:

| # | Severity | Table/Area | Issue |
|---|----------|-----------|-------|
| 1 | LOW | `supplier_visit_details` | No direct `company_id` column. Isolation depends on parent `tasks` table having `company_id`. If a direct query is ever made on `supplier_visit_details` without joining `tasks`, it would leak. Currently mitigated by the storage layer always joining through tasks. |
| 2 | INFO | `attention_items`, `events` | Use `tenant_id` column name instead of `company_id`. Functionally equivalent but naming inconsistency could cause copy-paste errors in new queries. |

---

## 7. Summary Table

| # | Category | Finding | Severity | Files Affected | Est. Lines | Est. Fix Effort |
|---|----------|---------|----------|---------------|-----------|-----------------|
| 1 | Dead Code | `server/_legacy/` + dead server files (services, storage, auth) | HIGH | 13 | ~1,500 | 10 min |
| 2 | Dead Code | 21 unused React components | HIGH | 21 | ~5,500 | 15 min |
| 3 | Dead Code | 10 orphaned React pages | HIGH | 10 | ~2,655 | 10 min |
| 4 | Dead Code | 15 unused shadcn UI wrappers | MEDIUM | 15 | ~1,862 | 15 min |
| 5 | Dead Code | Orphaned route handler (`parts.ts`) | HIGH | 1 | 115 | 2 min |
| 6 | Dead Code | Stale imports in active files (App.tsx, etc.) | MEDIUM | 3 | ~15 | 5 min |
| 7 | Dead Code | `examples/` + `pages/examples/` directories | LOW | 7 | 140 | 2 min |
| 8 | Duplicate | 11 route files bypass storage layer | CRITICAL | 11 | N/A | 4-8 hrs |
| 9 | Duplicate | Haversine distance copied 4× | CRITICAL | 4 | ~60 | 30 min |
| 10 | Duplicate | Timezone helpers copied 2× | CRITICAL | 2 | ~40 | 20 min |
| 11 | Duplicate | Visit response shape inconsistent 3× | HIGH | 3 | N/A | 1 hr |
| 12 | Duplicate | Tech + live position query 3× | HIGH | 3 | N/A | 30 min |
| 13 | Duplicate | Format utilities duplicated | HIGH | 5 | ~30 | 30 min |
| 14 | Indexes | `job_visits` missing compound index (hot path) | CRITICAL | schema | N/A | 5 min |
| 15 | Indexes | `payments`, `client_contacts`, `quote_lines` — zero indexes | HIGH | schema | N/A | 10 min |
| 16 | Indexes | 15+ FK columns without indexes | MEDIUM | schema | N/A | 20 min |
| 17 | Indexes | Soft-delete partial indexes missing | HIGH | schema | N/A | 10 min |
| 18 | Dependencies | 7 completely unused frontend packages (~100KB) | HIGH | package.json | N/A | 5 min |
| 19 | Dependencies | 12 packages only used by dead shadcn wrappers (~80KB) | MEDIUM | package.json | N/A | 10 min |
| 20 | Dependencies | `memorystore` unused in backend | MEDIUM | package.json | N/A | 2 min |
| 21 | Dependencies | 6 `@types/*` in prod dependencies | LOW | package.json | N/A | 5 min |
| 22 | Rendering | `getEventsForTech` not memoized (calendar hot path) | CRITICAL | 2 | N/A | 30 min |
| 23 | Rendering | `ImpersonationBanner` polls every 5s for all users | HIGH | 1 | N/A | 5 min |
| 24 | Rendering | `ResizableJobCard` + `DraggableEventBlock` not memoized | MEDIUM | 2 | N/A | 30 min |
| 25 | Rendering | Calendar unscheduled query `staleTime: 0` | MEDIUM | 1 | N/A | 2 min |
| 26 | Tenant | `supplier_visit_details` no direct `company_id` | LOW | 1 | N/A | 15 min |
| 27 | Tenant | `tenant_id` vs `company_id` naming inconsistency | INFO | 2 | N/A | N/A |

---

## Recommended Fix Order

### Phase A — Quick Wins (< 1 hour, ~11,000 lines removed)

1. **Delete dead server files** — `server/_legacy/`, `invoiceSync.ts`, `invoiceDirty.ts`, `syncService.ts`, `storage/types.ts`, `storage/base.ts`, `attachUserContext.ts`, `migrate-to-multi-tenant.ts`, `cleanup/` (~1,500 lines)
2. **Delete 21 orphaned components** — SubscriptionOverview, ActionRequiredKPIs, UnscheduledJobsSidebar, ClientNotesTab, ClientLocationsTab, ClientJobsTab, Header, AppHeader, etc. (~5,500 lines)
3. **Delete 10 orphaned pages** — JobStatusesPage, TechnicianDashboard, Tech* pages, AdminTimesheetsPage, old Suppliers.tsx (~2,655 lines)
4. **Delete `server/routes/parts.ts`** — orphaned CRUD, never mounted (115 lines)
5. **Delete `examples/` directories** — dead wrappers (140 lines)
6. **Clean stale imports** in `App.tsx` (TechnicianDashboard, unused icons, DropdownMenu)
7. **Add `job_visits` compound index** — `(company_id, is_active, scheduled_start)` — biggest perf win for calendar + map
8. **Add missing indexes on `payments`, `client_contacts`, `quote_lines`** — tables with zero indexes
9. **Fix `ImpersonationBanner` polling** — add `enabled` guard, saves network for all users
10. **Fix `Calendar.tsx` unscheduled `staleTime`** — change from `0` to `10_000`
11. **Remove 7 unused npm packages** — `framer-motion`, `@stripe/react-stripe-js`, `@stripe/stripe-js`, `react-icons`, `next-themes`, `tw-animate-css`, `@jridgewell/trace-mapping`
12. **Remove `memorystore`** from backend deps

### Phase B — Medium Effort (2-4 hours total)

13. **Extract `haversineDistance` to `server/utils/geo.ts`** — deduplicate 4 copies
14. **Extract timezone helpers to `server/utils/timezone.ts`** — deduplicate 2 copies
15. **Memoize `getEventsForTech`** — pre-compute `Map<techId, events[]>` in both DayJobber + DayRows
16. **Wrap `ResizableJobCard` + `DraggableEventBlock` in `React.memo()`**
17. **Delete 15 unused shadcn wrappers + 12 associated npm packages** (~1,862 lines + ~80KB bundle)
18. **Add remaining FK indexes** (medium priority batch)
19. **Add soft-delete partial indexes** on `client_locations`, `customer_companies`
20. **Consolidate duplicate audit services** — `server/auditService.ts` + `server/services/auditService.ts`

### Phase C — Architectural (4-8 hours)

21. **Migrate route files to storage layer** — start with `map.ts`, `techField.ts`, `calendar.ts` (highest duplication)
22. **Standardize visit response shape** — create shared DTO, normalize field naming

---

**COMPLETE: Phase 1 static analysis finished. 27 findings logged, ~11,000+ lines of dead code identified, ~195KB bundle savings possible, 31+ missing indexes catalogued. Ready for human review.**
