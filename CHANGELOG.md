# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

### Fixed

#### Dispatch Board — False Version Conflicts + Slow Saving UX (2026-03-12)

- **Bug**: Normal dispatch moves/reschedules/resizes were frequently blocked by false version-conflict toasts ("This schedule changed while you were editing it") and intrusive "Saving..." text that made interactions feel blocked for 1-1.5 seconds.
- **Root causes**:
  1. **Stale version from refetch race**: After a successful mutation, `patchCachedVersion(v2)` patched the cache, then `backgroundInvalidate()` triggered a refetch. If a second mutation fired before the refetch completed, the refetch response (containing v2) arrived and overwrote the second mutation's `patchCachedVersion(v3)` — reverting cache to stale v2. Next move sent stale v2 → 409.
  2. **`isVersionConflict()` regex too broad**: `/version/i.test(msg)` and `/conflict/i.test(msg)` matched ANY error containing those words, not just real version conflicts. False-positived on unrelated errors.
  3. **"Saving..." text replaced card content**: `markSaving` → `clearSaving` spanned the full API round-trip, replacing the visit block's normal content with a spinner and "Saving..." text for 1-1.5s.
  4. **Drag disabled during saving**: `disabled: isSaving` prevented chaining moves without waiting for the API call to complete, despite `chainForVisit` already serializing mutations safely.
- **Fixes applied**:
  - **Cancel-before-patch**: Added `cancelAndPatchVersion()` — cancels any in-flight refetches before patching the cached version, preventing the refetch-overwrites-patch race. All mutations now use this instead of bare `patchCachedVersion()`.
  - **Tightened conflict detection**: `isVersionConflict()` now only matches HTTP 409 status (explicit backend version-mismatch response). Removed overly broad regex patterns.
  - **Removed "Saving..." text**: Visit and task blocks now keep their normal content visible during saving. A subtle small spinner appears in the top-left corner as the only saving indicator — no content replacement.
  - **Enabled drag during saving**: Removed `isSaving` from the `disabled` condition on draggable blocks. Users can now chain moves without waiting. Resize handles also remain available during saving.
  - **Increased invalidation delay**: `backgroundInvalidate` delay increased from 150ms to 800ms to further reduce refetch-overwrites-patch timing windows.
- Files changed: `client/src/components/dispatch/useDispatchPreviewMutations.ts`, `client/src/components/dispatch/DispatchVisitBlock.tsx`, `client/src/components/dispatch/DispatchTaskBlock.tsx`, `client/src/components/dispatch/DispatchUnscheduledCard.tsx`

#### Dispatch Board — Concurrency/UX Bug during Rapid Resize & Reschedule (2026-03-12)

- **Bug**: Two live errors during rapid resize/reschedule on the Dispatch Board:
  1. "Not found" runtime error overlay from `queryClient.ts`/`useDispatchPreviewMutations.ts`
  2. Version mismatch: "Expected version: 12, Actual version: 13" — backend optimistic lock rejection
- **Root causes**:
  1. `resizeVisit` did not use `chainForVisit()` — allowed overlapping mutations on the same visit to fire simultaneously
  2. `resizeVisit` did not call `freshVersion()` or `patchCachedVersion()` — subsequent mutations read stale version from cache
  3. `resizeVisit` did not use `markSaving()`/`clearSaving()` — item not marked as in-flight during resize
  4. All visit mutations used `throw err` in catch blocks — propagated to unhandled promise rejection causing runtime error overlay
- **Fixes applied**:
  - **Per-visit serialization**: `resizeVisit` now uses `chainForVisit()` so rapid resizes on the same visit queue sequentially, each reading the latest server-returned version
  - **Version tracking**: `resizeVisit` now calls `freshVersion()` before API call and `patchCachedVersion()` with server response, closing the version gap
  - **Saving state**: `resizeVisit` now uses `markSaving()`/`clearSaving()` to disable interactions during in-flight mutations
  - **Graceful error recovery**: All mutations (`scheduleVisit`, `rescheduleVisit`, `resizeVisit`, `unscheduleVisit`, `updateVisitCrew`, `updateVisitStatus`, `deleteVisit`, `rescheduleTask`) now use `handleMutationError()` — shows recovery toast instead of crashing with runtime overlay
  - **Error detection helpers**: Added `isVersionConflict()` and `isNotFoundError()` for structured error classification
  - **Force refresh**: Added `forceRefresh()` for immediate (non-debounced) cache invalidation after conflict/not-found recovery
- Files changed: `client/src/components/dispatch/useDispatchPreviewMutations.ts`

#### PM Generation → Dispatch Board Handoff — Cache invalidation + duration forwarding (2026-03-12)

- **Bug**: PM-generated jobs did not appear on the Dispatch Board's unscheduled panel after generation. The user would generate a PM due item, see the job in the Jobs area, but the Dispatch Board showed stale data.
- **Root cause**: The PM generation mutation's `onSuccess` handler invalidated `/api/jobs` and PM-related caches, but did NOT invalidate `/api/calendar/unscheduled` (the Dispatch Board's data source). TanStack Query's 60-second `staleTime` meant the dispatch board served cached data without the newly-created PM jobs.
- **Fix 1 — Cache invalidation**: Added `queryClient.invalidateQueries` for both `/api/calendar/unscheduled` and `/api/calendar` in the PM generation `onSuccess` handler. PM-generated jobs now appear immediately on the Dispatch Board after generation.
- **Fix 2 — Duration forwarding**: PM generation now passes `template.defaultDurationMinutes` to `createJob()`, so the visit gets the correct estimated duration instead of hardcoded 60 minutes. The unscheduled endpoint now includes `durationMinutes` in its response, and the frontend mapper uses it instead of hardcoding 60.
- Files changed: `client/src/pages/PMWorkspacePage.tsx`, `server/domain/recurrence.ts`, `server/routes/scheduling.ts`, `shared/types/scheduling.ts`, `client/src/components/dispatch/dispatchPreviewMappers.ts`

### Added

#### Dispatch Board — Click-to-Schedule Mode + Shared Placement Resolver (2026-03-12)

- **Feature**: First-class click-to-schedule mode alongside existing drag-and-drop scheduling on the Dispatch Board.
  - Toggle between Drag and Click modes via header buttons (day view only).
  - **Click mode**: Select an unscheduled visit card → hover over lane rows for live preview → click to schedule. Cancel via Escape, re-click same card, or mode switch.
  - **Drag mode**: Unchanged behavior — no regression.
- **Shared Placement Resolver** (`dispatchPlacementResolver.ts`): Canonical single-source-of-truth for ALL board placement calculations:
  - `pxToSnappedMinutes()` — pixel-to-time conversion (replaces 3 duplicated implementations)
  - `clientXToRelativePx()` — coordinate transform (scroll + grab offset)
  - `resolvePlacement()` — full placement pipeline: snap → overlap check → auto-resolve → ISO times → preview pixels
  - Used by: drag preview, drag commit, click preview, click commit (4 code paths, 1 resolver)
- **Drag mode unified**: Drag preview (`dragHasOverlap` + `DispatchDragPreview`) and drag commit (`handleDragEnd` day-view) now route through `resolvePlacement()`. Eliminated local `pxToSnappedMinutes()`, `computeDropTime()`, and direct `checkOverlap`/`findNearestValidSlot` calls from the orchestrator.
- **Job type filter**: Added type filter pills (All/PM/Repair/Service/Install/Inspection) in the Unscheduled Panel header.
- **Dead code removed**: `DispatchDragPreview` component no longer used (preview rendered inline from PlacementResult). Local `pxToSnappedMinutes`, `computeDropTime` functions removed from DispatchPreview.tsx. Unused imports cleaned up.
- Files changed: `client/src/pages/DispatchPreview.tsx`, `client/src/components/dispatch/DispatchBoardHeader.tsx`, `client/src/components/dispatch/DispatchLaneRow.tsx`, `client/src/components/dispatch/DispatchTimeline.tsx`, `client/src/components/dispatch/DispatchUnscheduledPanel.tsx`, `client/src/components/dispatch/DispatchUnscheduledCard.tsx`
- Files created: `client/src/components/dispatch/dispatchPlacementResolver.ts`

### Fixed

#### PM Dashboard — Split Due Now / Upcoming to prevent accidental generation (2026-03-12)

- **Problem**: The PM Dashboard mixed actionable due items (overdue, due soon, in window) with future upcoming PMs in the same generation surface. Users could accidentally bulk-generate jobs for PMs that weren't actually ready yet.
- **Fix**: Added a "Due Now" / "Upcoming" sub-view selector inside the Dashboard tab.
  - **Due Now** (default): Shows only actionable items (overdue, due soon, in window). Generation controls, checkboxes, and "Generate All Filtered" are available here.
  - **Upcoming**: Shows future PMs not yet in their service window. No checkboxes, no bulk generate, informational banner explains items will move to Due Now when their window opens.
- **Generation eligibility**: Removed "upcoming" from `GENERATION_ELIGIBLE_STATUSES` — only overdue, due_soon, and in_window items can be generated.
- **Summary badges**: Now reflect only the actionable Due Now count, not a mixed total.
- **Footer counts**: Scoped to the active sub-view.
- Files changed: `client/src/pages/PMWorkspacePage.tsx`

#### Technician Routes Map — Ghost warning count from deleted jobs (2026-03-12)

- **Bug**: The diagnostic banner "X visits have scheduled_date set but scheduled_start is missing" was counting 4 visits belonging to soft-deleted/cancelled jobs. These visits were excluded from the active map surface but still matched the diagnostic query.
- **Root cause**: The diagnostic gap-count query in `/api/map/day` only filtered `job_visits` by `is_active` and `archived_at`, but did not join the `jobs` table to exclude soft-deleted parents (`deleted_at IS NOT NULL`), cancelled/voided jobs, or non-active visit statuses.
- **Fix**: Added `JOIN jobs` with `deleted_at IS NULL` and `status NOT IN ('cancelled','voided')` filters, plus `jv.status IN (ACTIVE_VISIT_STATUSES)` to match the main visit query's criteria.
- Files changed: `server/routes/map.ts`

#### PM Contract Deletion — False "deleted" message, dashboard leakage, orphaned instances (2026-03-11)

Three bugs found and fixed via live database truth-trace:

- **Bug 1 — False "deleted" toast**: The old DELETE handler returned `204 No Content`. `apiRequest` returns `undefined` for 204 responses. Toast checked `data?.action === "archived"` which evaluates to `false` on `undefined`, always showing "PM contract deleted" even when the backend only deactivated. **Fix**: DELETE now returns `200` with `{ action, instancesCanceled }` body. Toast messages are branched explicitly on `data.action` value.
- **Bug 2 — Dashboard leakage**: `getUpcomingQueue()` used `INNER JOIN` on `recurringJobTemplates` but did NOT filter by `isActive`. Inactive/archived contracts' pending instances still appeared as actionable due items on Dashboard. **Fix**: Added `eq(recurringJobTemplates.isActive, true)` to the query conditions.
- **Bug 3 — Pending instances survive archive**: When a contract was deactivated, its pending instances remained in DB untouched, leaking to Dashboard. **Fix**: `deactivateTemplate()` now cancels all pending (not-yet-generated) instances as part of the archive operation. Return type changed to `{ deactivated: boolean; instancesCanceled: number }`.
- **Data cleanup**: Ran one-time scripts to cancel 4 leaking pending instances and hard-delete 3 contracts that had no downstream activity but were incorrectly deactivated by the old handler.
- **Decision rules after fix**:
  - Hard delete: no instances with `generatedJobId IS NOT NULL` → delete template (CASCADE removes all instances)
  - Archive: has generated job references → set `isActive=false` + cancel all pending instances + return `{ action: "archived", instancesCanceled: N }`
  - Pending-only instances do NOT prevent hard delete — they cascade-delete with the template
- Files changed: `server/routes/recurringJobs.ts`, `server/storage/recurringJobs.ts`, `client/src/pages/PMWorkspacePage.tsx`, `client/src/pages/PMDetailPage.tsx`

#### PM Templates — Delete verified correct (2026-03-11)

- `DELETE /api/pm/templates/:id` does a real hard delete from DB, returns `{ success: true }` (200, not 204). Frontend invalidates query and shows "Template deleted". No misleading-message bug.
- Files verified: `server/routes/pmTemplates.ts`

### Fixed

#### PM Subsystem Alignment — Create-month instance generation bug (2026-03-11)

- **Root cause**: `computePmOccurrences()` in `server/domain/recurrence.ts` excluded current-month occurrences when `generationMode: "period_start"` because the occurrence date (1st of month) was before the template `startDate` (creation date, e.g. 11th). The `occDate >= templateStart` check filtered out the current cycle.
- **Fix**: Added same-calendar-month exception — if the occurrence is in the same year/month as `templateStart`, it passes the filter regardless of day comparison.
- **Server-side generation on CREATE**: POST `/api/recurring-templates` now calls `generateForSingleTemplate()` after creating an active template with a location, ensuring current-cycle instances are created server-side rather than relying on the fragile client-side post-create call.
- **Client-side simplification**: Removed the redundant client-side `generate?scope=current_month` call from `PMWizardPage.tsx` since the server now handles this.
- **Edit behavior**: Added TODO comment on PATCH handler noting that edit-triggered current-cycle due-state should be handled via explicit user prompt, not silent auto-backfill.
- Files changed: `server/domain/recurrence.ts`, `server/routes/recurringJobs.ts`, `client/src/pages/PMWizardPage.tsx`

### Changed

#### PM Wizard — Remove scheduling/assignment fields, improve UX (2026-03-11)

- **Removed from wizard Step 3 (PM Details)**:
  - "Automatically assign a scheduled time" checkbox + time/duration inputs
  - "Default assigned technician" dropdown
  - These are dispatch concerns, not PM contract setup concerns.
- **Removed from Review screen (Step 5)**:
  - "Scheduling" row (was showing "Manual (unscheduled)")
  - Location now shows location name only, not "Company — Location" (customer shown separately)
- **Contract term UX**: Replaced raw end-date input with structured term picker:
  - Ongoing (no end date)
  - 1 year (auto-calculated from start date)
  - Custom duration (number + months/years)
  - Specific end date (date picker)
- **Searchable template picker**: Template selection in Step 2 now uses a searchable combobox (Command/Popover pattern) with search by name/summary, replacing the plain Select dropdown.
- **Template prefill**: `applyPmTemplate()` continues to prefill all applicable fields including `includeLocationPmParts`, months, generation mode, service window, and billing defaults.
- Files changed: `client/src/pages/PMWizardPage.tsx`

#### PM Template Editor — Product/service catalog search already functional (2026-03-11)

- **Verified**: `PMTemplateEditorPage.tsx` line items already search the real `/api/items` catalog, bind to canonical product IDs, allow quantity/price editing, and support freeform fallback. No changes needed.
- Files verified: `client/src/pages/PMTemplateEditorPage.tsx`

### Changed

#### PM Workspace — Tab label cleanup and History placeholder (2026-03-11)

- **Renamed tabs** to remove redundant "PM" prefix since the page header already identifies the module:
  - "PM Due Queue" → "Dashboard"
  - "PM Contracts" → "Contracts"
  - "PM Billing" → "Billing"
  - "Templates" → "Templates" (unchanged)
- **Added "History" tab** placeholder between Billing and Templates. Will eventually show generated/completed/skipped/canceled PM work. Currently renders an empty state with a "coming soon" message.
- **Tab order** is now: Dashboard | Contracts | Billing | History | Templates
- **No routing or functionality changes** — Dashboard still renders the PM Due Queue content, all other tabs unchanged.
- Files changed: `client/src/pages/PMWorkspacePage.tsx`

### Fixed

#### PM Due Queue — Enforce pre-generation boundary (2026-03-11)

- **Backend**: `getUpcomingQueue()` in `server/storage/recurringJobs.ts` now filters `generatedJobId IS NULL`, ensuring only pending (not-yet-generated) PM instances appear in the PM Due Queue. Generated jobs belong on the Dispatch Board.
- **Removed "unscheduled" filter/badge/logic**: The PM Due Queue no longer references "Generated — Unscheduled" as a filter, count badge, or group badge. That state belongs to generated jobs on Dispatch.
- **Removed post-generation filters**: "Scheduled" and "Completed" filters removed from the PM Due Queue dropdown — those states can't exist for pre-generation instances.
- **PM Contracts tab label**: Removed numeric count badge; tab now reads "PM Contracts" only.
- **Preserved**: Checkbox selection, select-all, "Generate Selected" bulk action, and confirmation dialog remain intact for valid pending instances.
- Files changed: `server/storage/recurringJobs.ts`, `client/src/pages/PMWorkspacePage.tsx`

#### PM Due Queue — Bulk generation UX + Detail page history (2026-03-11)

- **"Generate All Filtered" button**: One-click shortcut to select all eligible items and open confirmation dialog. Appears when no items are manually selected and eligible items exist.
- **"Clear Selection" button**: Explicit button to deselect all items, shown when items are selected.
- **Confirmation dialog wording**: Updated to clearly state PM items will be "converted into jobs and moved into the normal job workflow."
- **Post-generation success toast**: Now states "These jobs are now in the dispatch workflow. Schedule them from the Dispatch Board."
- **PMDetailPage categorized history**: PM History section reorganized into three clear groups:
  - "Due — Awaiting Generation" (pending instances with no generated job)
  - "Generated — In Progress" (instances with active jobs not yet completed)
  - "PM History" (completed, skipped, or canceled instances)
- **OperationalSummary cleanup**: Removed `generated_unscheduled` references to align with PM Due Queue boundary.
- Files changed: `client/src/pages/PMWorkspacePage.tsx`, `client/src/pages/PMDetailPage.tsx`

### Changed

#### PM Billing Phase 2 — Contract Billing Events + Invoice Generation (2026-03-11)

- **New `pm_billing_events` table**: Tracks contract-period billing events for `monthly_fixed` and `annual_prepaid` PM contracts. Fields: `id`, `company_id`, `pm_contract_id`, `billing_model_snapshot`, `period_start`, `period_end`, `billing_date`, `status`, `invoice_id`, `amount_snapshot`, `billing_label_snapshot`, `notes`, timestamps.
- **Idempotent event creation**: Unique index on `(pm_contract_id, period_start)` prevents duplicate billing events. Query-before-insert + constraint violation fallback ensure safe concurrent runs.
- **Billing event engine** (`server/services/pmBillingService.ts`):
  - `processContractBilling()` — creates missing billing events for current period
  - `createInvoiceForEvent()` — creates canonical invoices from pending billing events
  - `runBillingForAllTenants()` — scans all companies with contract-billed PM contracts
  - `runBillingForCompany()` — single-company billing (for API trigger)
  - Monthly: one event per calendar month (`YYYY-MM-01` to last day)
  - Annual: one event per anniversary period based on contract start date
- **Invoice creation from billing events**: New `createInvoiceFromBillingEvent()` in `server/storage/invoices.ts` — authorized via `PM_BILLING_SERVICE` source. Creates invoices with no `jobId` (contract billing, not job billing). Includes single line item with billing label + period description.
- **Scheduler integration**: Billing runs automatically after PM instance generation in `pmAutoGeneration.ts` (startup + every 6 hours)
- **API routes** (`server/routes/pmBilling.ts`):
  - `GET /api/pm/billing/events` — all events for company
  - `GET /api/pm/billing/events/:contractId` — events for specific contract
  - `POST /api/pm/billing/run` — manual billing trigger
  - `POST /api/pm/billing/events/:id/skip` — skip a pending event
  - `GET /api/pm/billing/summary` — billing oversight summary
- **PM Billing tab upgrade**: Now shows contract billing events (pending, invoiced, exceptions) alongside per-visit job billing. Added "Run Billing Now" button for manual trigger. Separate sections for contract billing exceptions vs per-visit exceptions.
- **PM detail billing visibility**: Contract-billed PM contracts now show a "Contract Billing Events" card with: last billed date, next expected date, event history table with period/amount/status/invoice link.
- **Per-visit flow preserved**: No changes to `per_visit` billing. Jobs still carry disposition snapshots, closeout guidance still works, per-visit exceptions still detected.
- Migration: `migrations/2026_03_11_pm_billing_events.sql`
- Files added:
  - `server/services/pmBillingService.ts` — PM billing event engine
  - `server/routes/pmBilling.ts` — PM billing API routes
  - `migrations/2026_03_11_pm_billing_events.sql` — pm_billing_events table
- Files changed:
  - `shared/schema.ts` — Added `pmBillingEvents` table, `PmBillingEventStatus` type, insert schema
  - `server/storage/invoices.ts` — Added `PM_BILLING_SERVICE` source, `createInvoiceFromBillingEvent()` method
  - `server/services/pmAutoGeneration.ts` — Integrated billing run after instance generation
  - `server/routes/index.ts` — Registered `/api/pm/billing` routes
  - `client/src/pages/PMWorkspacePage.tsx` — Enhanced PM Billing tab with billing events display
  - `client/src/pages/PMDetailPage.tsx` — Added `PMBillingEventsCard` component for contract detail

#### PM Phase 4B — Due Queue Grouping Views (2026-03-11)

- **Checkbox selection in grouped view**: `GroupSection` now renders checkboxes for generation-eligible items across all grouping modes (location, client, proximity). Selections persist across group collapse/expand.
- **Group-level select all**: Each group header has a checkbox that selects/deselects all eligible items in that group. Shows indeterminate state when partial selection exists.
- **Cross-group select all**: "Select all eligible" checkbox appears above grouped view to select/deselect all eligible items across all groups at once.
- **Bulk generate across groups**: "Generate Selected (N)" button works identically whether items are selected from flat view or across multiple groups — uses same `generateFromInstances()` path.
- **Indeterminate checkbox support**: Updated `Checkbox` component to render minus icon for `checked="indeterminate"` state with proper Radix UI styling.
- **QueueItemRow refactored**: Now accepts optional `showCheckbox`, `isSelected`, `isEligible`, `onToggle` props — reused in both flat and grouped views, eliminating column layout duplication.
- No schema changes, no migrations, no new API endpoints. All grouping is client-side using existing query results.
- Files changed:
  - `client/src/pages/PMWorkspacePage.tsx` — `GroupSection` + `QueueItemRow` updated with selection support, `UpcomingTab` passes selection state to groups
  - `client/src/components/ui/checkbox.tsx` — Added indeterminate state visual (minus icon)

#### PM Billing Disposition + PM Billing Oversight Foundation (2026-03-11)

- **PM contract billing fields**: Added `pm_billing_model`, `pm_billing_label`, `pm_contract_amount` to `recurring_job_templates` table for contract-level billing configuration
- **Job billing disposition snapshot**: Added `pm_billing_model`, `pm_billing_disposition`, `pm_billing_status`, `pm_billing_label` to `jobs` table. Billing behavior is stamped at job generation time from the PM contract
- **Billing disposition derivation**: `deriveBillingDisposition()` in `server/domain/recurrence.ts` maps contract billing model → job-level disposition + initial status:
  - `per_visit` → `invoice_on_completion` / `pending_invoice`
  - `monthly_fixed` / `annual_prepaid` → `covered_by_contract` / `no_invoice_expected`
  - `do_not_bill` → `archive_no_invoice` / `no_invoice_expected`
- **Lifecycle billing status updates**: `jobLifecycle.ts` now updates `pmBillingStatus` on transitions:
  - `invoice_now` → sets `pmBillingStatus: "invoiced"`
  - `archive` with `invoice_on_completion` disposition → sets `pmBillingStatus: "billing_exception"` (per-visit job archived without invoice)
  - `archive` with other PM dispositions → sets `pmBillingStatus: "no_invoice_expected"`
- **PM Billing closeout guidance**: Job detail page shows billing model, disposition badge, and actionable closeout guidance for PM jobs (e.g., "Create invoice for this visit" or "No invoice needed — covered by contract")
- **PM Billing oversight tab**: New "PM Billing" tab in PM Workspace with contract billing summary, billing exceptions, awaiting invoice queue, covered-by-contract list, and invoiced PM work
- **PM contract edit page**: Added Billing section with billing model selector, billing label, and contract amount fields
- **PM contract detail page**: Added Billing card showing configured billing model, label, and contract amount
- Migration: `migrations/2026_03_11_pm_billing_disposition.sql`
- Files changed:
  - `shared/schema.ts` — Added PM billing enums, contract billing fields, job billing fields
  - `migrations/2026_03_11_pm_billing_disposition.sql` — New migration for billing columns
  - `server/domain/recurrence.ts` — `deriveBillingDisposition()`, billing snapshot in `generateFromInstances()`
  - `server/domain/jobLifecycle.ts` — PM billing status updates on invoice/archive transitions
  - `server/storage/jobsFeed.ts` — PM billing fields in job header detail query
  - `client/src/hooks/useJobsFeed.ts` — PM billing fields in `JobHeaderDetail` type
  - `client/src/pages/JobDetailPage.tsx` — PM Billing guidance panel
  - `client/src/pages/PMWorkspacePage.tsx` — PM Billing oversight tab
  - `client/src/pages/PMEditPage.tsx` — Billing section in contract editor
  - `client/src/pages/PMDetailPage.tsx` — Billing card in contract detail

#### PM Pivot Phase 1 — Due Queue + Manual Job Generation (2026-03-11)

- **Core change: Background PM generation no longer auto-creates jobs.** `generateForTemplate()` now creates pending instances only. Instances remain in "pending" status until a dispatcher manually generates jobs from the PM Due Queue.
- **Manual job generation via `generateFromInstances()`**: This existing function is now the canonical path for creating jobs. Dispatchers select pending due instances and generate jobs through bulk selection.
- **PM Due Queue (renamed from "Upcoming")**: Default tab now shows pending PM work needing job generation. Default filter changed to "Needs Generation" — shows all pending instances awaiting job creation.
- **New "Needs Generation" filter**: Primary filter showing pending items not yet converted to jobs. "Awaiting Generation" scheduling badge replaces "No Job" for pending instances.
- **Language cleanup**: "PM Setup" → "PM Contract", "Maintenance Plans" → "PM Contracts", "Upcoming" tab → "PM Due Queue", "Jobs created on" → "Due on", "Generate This Month" → "Create Due Instances", "Generated Work" → "PM History"
- **Confirmation dialog updated**: Now reads "These PM items will be converted into jobs and will need to be scheduled on your dispatch board."
- **Success toast updated**: Now reads "Jobs created and ready for dispatch scheduling."
- **Templates tab de-emphasized**: Tab renamed to just "Templates", description updated to emphasize they are "reusable presets for PM contracts"
- **Auto-generation service updated**: Log messages reflect instances-only behavior, no longer mention job creation
- No schema changes or migrations required. No new tables introduced.
- Files changed:
  - `server/domain/recurrence.ts` — `generateForTemplate()` creates instances only (no claim/job creation)
  - `server/services/pmAutoGeneration.ts` — Updated docs and log messages for instances-only behavior
  - `server/routes/recurringJobs.ts` — Updated route documentation for PM pivot model
  - `client/src/pages/PMWorkspacePage.tsx` — Renamed tabs, updated filters, language cleanup, "Needs Generation" filter
  - `client/src/pages/PMDetailPage.tsx` — Updated labels, button text, section headers for PM pivot model

#### PM Template UX Rework — Full-Page Editor + Bug Fix (2026-03-10)

- **Full-page editor**: PM template create/edit moved from cramped modal dialog to full-page routes (`/pm/templates/new`, `/pm/templates/:id/edit`)
- **Simplified UI**: Removed unnecessary section headers ("Template Identity", "Default PM Content") and explanatory copy ("Define a reusable blueprint..."). Clean layout with labeled fields and optional section dividers.
- **Products & Services integration**: Template line items now search/select from existing Products & Services catalog via typeahead dropdown, with quantity + unit price support. Freeform entry still supported.
- **Single-line template names**: Template list table and wizard dropdown show only template name (no subtitle/summary subtext)
- **Fixed "Failed to create template" bug**: Old modal's `onError` handler swallowed the real error message. New full-page editor surfaces actual backend error in toast description for proper debugging.
- **Template table simplified**: Removed "Default Summary" column from template list table; rows are clickable to navigate to edit page
- **Top + bottom save actions**: Save Template and Cancel buttons appear both at top-right header and at page bottom, so users never need to scroll to save.
- **Modal removed**: `PmTemplateFormDialog`, `FormSection`, `LineItemRow`, old `MonthPicker` and related constants removed from PMWorkspacePage (~350 lines eliminated)
- **Wizard integration preserved**: Template dropdown/selection in PM wizard still works, template prefill unchanged
- Files changed:
  - `client/src/App.tsx` — Added routes for `/pm/templates/new` and `/pm/templates/:id/edit`
  - `client/src/pages/PMTemplateEditorPage.tsx` — Full-page template editor (already existed, now routed)
  - `client/src/pages/PMWorkspacePage.tsx` — Removed modal/dialog code, PMTemplatesTab navigates to full pages
- No schema or migration changes required

### Added

#### PM Template System — Phase 2 Refinement (2026-03-10)

- **Template identity distinction**: Template Name (internal blueprint label) is clearly separated from Default PM Summary (prefill for job title) and Default Description (job body).
- **Optional scheduling defaults**: Templates can now store default months, service window (days before/after), generation mode/day, and include-location-parts flag. All optional — null means "not set" and wizard uses its own defaults.
- **Optional billing defaults**: New fields for billing mode (per_visit/monthly/annually/none), billing label, and default price. Prefill-only; no invoicing logic changes.
- **Sectioned template form**: Form reorganized into 5 clear sections — Template Identity, Default PM Content, Scheduling Defaults (optional), Billing Defaults (optional), Line Items (optional).
- **Expanded wizard prefill**: `applyPmTemplate()` now prefills months, generation mode, service window, and location parts from template when values are present. Missing values left at wizard defaults.
- **Parts duplication warning**: Shown in template form (when location parts + line items both active) and in wizard review step.
- **Equipment linking placeholder**: TODO comment in wizard steps array for future "Link existing equipment" step.
- **Template table enriched**: Columns now show Schedule (months preview), Billing (mode + price), in addition to Name/Summary/Items.
- Schema changes: Added 9 nullable columns to `pm_templates` (scheduling + billing defaults)
- Files added:
  - `migrations/2026_03_10_pm_templates_phase2.sql` — Add optional default columns
- Files changed:
  - `shared/schema.ts` — Extended `pmTemplates` table with scheduling/billing columns, billing mode enum
  - `client/src/pages/PMWorkspacePage.tsx` — Rewrote template form dialog with sections, enriched table, month picker
  - `client/src/pages/PMWizardPage.tsx` — Expanded `applyPmTemplate()` prefill, review step warning, equipment TODO

#### PM Template System — Foundation (2026-03-10)

- **New `pm_templates` table**: Reusable job content templates for maintenance plans (id, company_id, name, summary, description, default_line_items_json)
- **CRUD API**: `GET/POST/PATCH/DELETE /api/pm/templates` — all scoped by company_id
- **PM Templates tab**: Third tab on PM Workspace page (Upcoming, Maintenance Plans, PM Templates) with table listing, create/edit dialog, duplicate, delete
- **Template form**: Fields for template name, default PM summary, job description, optional line items (JSONB). Includes warning about location parts duplication.
- **Wizard integration**: Step 2 "Setup Type" replaced "Copy from existing PM setup" with "Use PM template". Dropdown of available templates with prefill. Empty state links to template creation.
- **Template application**: Selected template prefills wizard fields (PM Name, Description). User can modify everything before saving.
- **Deep link support**: `?tab=templates` query param on /pm route opens directly to PM Templates tab
- Files added:
  - `migrations/2026_03_10_pm_templates.sql` — Create pm_templates table
  - `server/routes/pmTemplates.ts` — PM Templates CRUD API
- Files changed:
  - `shared/schema.ts` — Added `pmTemplates` table, insert/update schemas, types
  - `server/routes/index.ts` — Mount `/api/pm/templates` router
  - `client/src/pages/PMWorkspacePage.tsx` — Added PM Templates tab with management UI
  - `client/src/pages/PMWizardPage.tsx` — Replaced "Copy from existing" with "Use PM template" in Step 2

### Changed

#### Job Page — Apply Template Action Restored (2026-03-10)

- **Restored "Apply Template" as first-class action** in the Parts & Billing section, placed directly next to "Add Line Item" button
- **New template picker dialog** with: search input, default templates section (starred), full template list with descriptions, scrollable for large template libraries
- **Existing behavior preserved**: Replace/Merge mode confirmation dialog still appears when job already has line items; direct apply when job is empty
- Files changed:
  - `client/src/components/PartsBillingCard.tsx` — Replaced Select dropdown with Button + Template Picker Dialog, added `TemplatePickerList` component

#### PM Workspace List Cleanup — Phase 5B (2026-03-10)

- **Part 1 — Fix client/location display**: Backend `getTemplates()` and `getUpcomingQueue()` now return `locationLabel` (site name) separately instead of joining `companyName + location` which duplicated the customer company name.
- **Part 2 — Search in Maintenance Plans**: Added search input to filter plans by title, customer name, or location.
- **Part 3 — Sortable columns**: Maintenance Plans table headers are clickable to sort by Customer, Title, Recurrence, Status, or Generation. Toggle ascending/descending.
- **Parts 4-7 — Upcoming queue column cleanup**: Removed Target Date, Tech, and Actions columns. Added Customer/Location (split display), Window (start—end), and Job Status columns. Fixed visit date bug (was showing job creation timestamp for unscheduled visits — now only shows date when `schedulingState === "scheduled"`). Updated both flat view and grouped view (`QueueItemRow` + `GroupSection`) to match final layout: Compliance, Scheduling, PM Plan, Customer/Location, Window, Visit, Job, Status.
- Files changed:
  - `client/src/pages/PMWorkspacePage.tsx` — Search, sorting, column layout cleanup for flat + grouped views
  - `server/storage/recurringJobs.ts` — `getTemplates()` and `getUpcomingQueue()` location name fix

#### PM Workspace UX Improvements — Phase 5 (2026-03-10)

- **Part 1 — Remove Auto Schedule column**: Removed Auto Schedule column from Maintenance Plans list. Auto-scheduling is not part of the current dispatch architecture; all generated PM visits start unscheduled.
- **Part 2 — Rename tab**: "PM Setups" → "Maintenance Plans" to better reflect the page shows existing plans, not configuration.
- **Part 3 — Default landing tab**: PM workspace now opens to the "Upcoming" tab (operational queue) instead of Maintenance Plans.
- **Part 4 — Client/Location display**: Three-line hierarchy in both Maintenance Plans and Upcoming tables: Client name, Location name, Address. Backend already returns `clientName`, `locationName`, `locationAddress`.
- **Part 5 — Fix recurrence display**: Fixed "Every undefined months" bug. Root cause: frontend type used `intervalMonths` but backend returns `interval`. Now uses `interval` and derives smart labels from months: Monthly, Quarterly (Mar, Jun, Sep, Dec), Semi-annual (Apr, Oct), Selected months: Mar, Apr, May, Jun.
- **Part 6 — Rename generation label**: "Generation Mode" column renamed to "Jobs created on" with improved formatting (e.g., "1st of month", "15th of month").
- **Part 7 — Unscheduled status verification**: Confirmed backend scheduling state logic correctly classifies generated visits with `scheduledStart === null` as `generated_unscheduled`. These appear in Upcoming queue under "Needs Action" filter.
- **Part 8 — Generation workflow**: Generation controls remain in the Upcoming queue (row-level + bulk generate with confirmation modal), not on the Maintenance Plans page. Global "Generate Now" was already removed in Phase 4C.
- Files changed:
  - `client/src/pages/PMWorkspacePage.tsx` — Tab rename, reorder, default change, Auto Schedule column removal, recurrence display fix, client/location display improvement, generation label rename, `AutoScheduleBadge` component removed

### Added

#### Client CSV Import v1 (2026-03-10)

- **Five-step import wizard** at Settings > Import Clients with: Upload → Map Fields → Preview & Validate → Execute → Results
- **Shared types** in `shared/clientImportTypes.ts`: `ClientImportRow`, field definitions, header aliases, validation/result types
- **Backend import service** in `server/services/clientImport.ts`: CSV parsing, header auto-mapping via alias dictionary, row normalization (trim, boolean coercion, postal code normalization), row validation, row execution
- **API endpoints**:
  - `POST /api/client-import/preview` — Parse CSV, auto-map headers, normalize/validate rows, check company name dedup, return preview summary
  - `POST /api/client-import/execute` — Execute validated rows: create customer_company (deduped by exact name), create primary client_location, create optional primary client_contact
- **Import scope (v1)**: One CSV row = one client package (company + location + optional contact). Create-only, no update/merge. Exact company-name dedup. Max 500 rows.
- **Primary location logic**: First location for a new company gets `isPrimary=true`. Locations added to existing companies respect existing primary — only set `isPrimary=true` if no existing primary.
- **Contact rules**: Contact block created only if at least one contact field present. Requires (firstName OR lastName) AND (email OR phone). Auto-set `isPrimary=true`. Created as company-level contact (not legacy flat fields).
- **Field mapping UI**: Header similarity auto-suggestion, grouped by Company/Billing/Location/Contact, sample value preview, duplicate field prevention
- **Validation**: Blocked rows (blank company name, invalid email, invalid contact block, invalid postal code). Warning rows (existing company match, blank location name, no contact, no address).
- **Results**: Summary cards, failed row table with error export to CSV
- Files added:
  - `shared/clientImportTypes.ts` — Shared types and field definitions
  - `server/services/clientImport.ts` — Import service (parse, map, normalize, validate, execute)
  - `server/routes/clientImport.ts` — API routes (preview + execute)
  - `client/src/pages/ClientImportPage.tsx` — Five-step import wizard UI
- Files changed:
  - `server/routes/index.ts` — Mount `/api/client-import` router
  - `client/src/App.tsx` — Add `/settings/import-clients` route
  - `client/src/components/SettingsShell.tsx` — Add "Import Clients" nav item

### Changed

#### PM Phase 4C — Generation Flow + PM Setups Display Fix (2026-03-10)

- **Fix: Client / Location display in PM Setups list** — The `getTemplates()` storage method was returning raw template rows without joining `customer_companies` or `client_locations`, causing the Client/Location column to always show "—". Added LEFT JOINs to return `clientName`, `locationName`, and `locationAddress`. Frontend now renders "Client Name / Address" instead of dashes.
- **Removed global Generate Now button** — The dangerous "Generate Now" button in the PM Workspace header (which generated jobs for ALL active templates at once) has been removed. PM Setups is now a configuration-only surface (Edit, Duplicate, Pause/Resume).
- **Moved generation to Upcoming queue** — Generation controls are now in the Upcoming tab:
  - Row-level "Generate" button for individual eligible instances
  - Checkbox selection with "Generate Selected (N)" bulk action
  - Confirmation modal showing customer count, location count, date range before bulk generation
- **Generation eligibility rules** — Only instances with compliance status `upcoming`, `in_window`, `due_soon`, or `overdue` (and scheduling state `not_generated`) can be generated. Prevents accidental far-future PM generation.
- **New API endpoint** — `POST /api/recurring-templates/generate-selected` accepts `{ instanceIds: string[] }` for selective instance-level generation (max 100 per request).
- Files changed:
  - `server/storage/recurringJobs.ts` — `getTemplates()` now joins customer_companies + client_locations; new `TemplateWithNames` type
  - `server/domain/recurrence.ts` — New `generateFromInstances()` function for selective generation
  - `server/routes/recurringJobs.ts` — New `POST /generate-selected` endpoint
  - `client/src/pages/PMWorkspacePage.tsx` — Removed global Generate Now, added selection checkboxes + row-level Generate + bulk Generate Selected + confirmation modal to Upcoming tab, fixed Client/Location display

### Fixed

#### PM Wizard — Customer Company Not Displaying (2026-03-10)

- **Root cause 1 — Missing list endpoint**: `GET /api/customer-companies` (no `:id` param) did not exist. All routes in customer-companies.ts required `/:companyId`. The wizard's `useQuery({ queryKey: ["/api/customer-companies"] })` silently errored (404 → error state), so `companies` was always `[]`. The company dropdown rendered with zero options.
- **Root cause 2 — Field name mismatch**: `CustomerCompanyLite` interface used `companyName` but the `customer_companies` table column is `name`. Even if the endpoint existed, `company?.companyName` would always be `undefined`, preventing the selected company name from displaying.
- **Fix A — New list endpoint**: Added `GET /api/customer-companies` route returning `[{ id, name }]` for the tenant. Added `listCustomerCompanies()` repository method (lightweight: active companies only, ordered by name).
- **Fix B — Field name alignment**: Changed `CustomerCompanyLite.companyName` → `.name` in both `PMWizardPage.tsx` and `PMDetailPage.tsx`. Updated all references: `company?.companyName` → `company?.name`, `company.companyName` → `company.name`.
- **Fix C (prior) — Company-first enforcement**: Location picker disabled until company selected, no global location fallback, location selection cannot auto-derive company, template prefill race condition fixed.
- **Regression tests**: 23 pure-logic tests in `tests/pm-wizard-company-first.test.ts`.
- Files changed:
  - `server/routes/customer-companies.ts` — New `GET /` list endpoint
  - `server/storage/customerCompanies.ts` — New `listCustomerCompanies()` method
  - `client/src/pages/PMWizardPage.tsx` — `CustomerCompanyLite.name`, all `companyName` → `name` refs, company-first enforcement, template prefill deps
  - `client/src/pages/PMDetailPage.tsx` — `CustomerCompanyLite.name`, `companyName` → `name` ref
  - `tests/pm-wizard-company-first.test.ts` — 23 regression tests

### Changed

#### Command Palette Quick Actions Refinement (2026-03-10)

- **Refined default Quick Actions** to focus on true create commands: Create Job, Create Quote, Create Invoice, Create Task, Create PM Contract. Removed navigation shortcuts (Open Dispatch, Open PM, Open Clients, Open Invoices, Open Quotes) from the default list since they duplicate sidebar navigation.
- **Navigation still searchable**: All removed items moved to the navigation command set and still appear when users search for "dispatch", "pm", "clients", etc.
- Files changed:
  - `client/src/components/UniversalSearch.tsx` — Updated `buildCommands()`: added Create Task and Create PM Contract actions, moved 5 "Open ..." items from `action` to `navigation` section

### Added

#### Create Quote Flow — Template Chooser Modal (2026-03-10)

- **QuoteTemplateChooserModal**: New modal opened from command palette "Create Quote" action. Shows searchable list of active quote templates with quick-select for top 5 (default template first, then alphabetical). Includes "Create Blank Quote" option.
- **NewQuoteModal template support**: Added optional `templateId` prop. When provided, auto-applies the selected template via `POST /api/quote-templates/:id/apply` (replace mode) after quote creation. Non-blocking — if template apply fails, quote is still created.
- **Command palette wiring**: "Create Quote" now opens the template chooser instead of navigating to `/quotes`. Flow: Chooser → select template or blank → NewQuoteModal (location + details) → quote created with template applied.
- **Quick-select fallback**: Uses first 5 active templates sorted by default flag then alphabetical name (no usage tracking yet).
- Files changed:
  - `client/src/components/QuoteTemplateChooserModal.tsx` — New component
  - `client/src/components/NewQuoteModal.tsx` — Added `templateId` prop, auto-apply on creation
  - `client/src/App.tsx` — Import new components, add state for chooser/template, wire up callbacks

#### Command Palette — Quick Actions + Navigation + Search (2026-03-10)

- **Command Palette**: Upgraded header search bar into a Linear/Raycast-style command palette with three sections: Quick Actions, Navigation, and Search Results.
- **Cmd+K / Ctrl+K shortcut**: Global keyboard shortcut opens/closes the palette, with browser default prevented via `capture: true` listener.
- **Quick Actions** (8): Create Job, Create Quote, Create Invoice, Open Dispatch, Open PM, Open Clients, Open Invoices, Open Quotes.
- **Navigation shortcuts** (12): Dashboard, Dispatch, Live Map, Jobs, PM, Invoices, Quotes, Clients, Suppliers, Reports, Settings, Admin — all with keyword aliases for fuzzy matching.
- **Ranked matching**: Exact label match → starts-with → contains → keyword match → multi-word match. Commands ranked above search results.
- **Preserved search**: Existing `/api/search` integration unchanged — debounced, grouped by type (invoice > job > company > location > supplier).
- **Keyboard navigation**: ArrowUp/Down, Enter to select, Esc to close, Tab trapped while open, scroll-into-view for selected item.
- **Create callbacks**: Create Job opens QuickAddJobDialog, Create Quote navigates to /quotes, Create Invoice navigates to /invoices.
- Files changed:
  - `client/src/components/UniversalSearch.tsx` — Full rewrite: command palette architecture with static commands, scoring, unified palette items, floating panel UI, global keyboard shortcut
  - `client/src/App.tsx` — Pass `onCreateJob`, `onCreateQuote`, `onCreateInvoice` callbacks to UniversalSearch

### Changed

#### Sidebar Navigation Grouping — Workflow Sections (2026-03-10)

- **Sidebar items reorganized** into 5 logical workflow sections with visible dividers:
  1. Live Operations: Dashboard, Dispatch, Live Map
  2. Work Management: Jobs, PM, Invoices, Quotes
  3. Relationships: Clients, Suppliers
  4. System / Back Office: Reports
  5. Settings + Admin (conditional)
- **Divider styling improved**: Changed from `border-t border-white/10 my-2` to explicit `height: 1px, background: rgba(255,255,255,0.12), margin: 12px` for better visibility.
- **Item order unchanged**: All sidebar items keep original order; only grouping via divider placement changed.
- Files changed:
  - `client/src/components/AppSidebar.tsx` — Added `isDivider` to Clients and Reports items, updated divider element styling

#### Primary UI Color Update — Syntraro Green #82BA58 (2026-03-10)

- **Primary color updated**: Replaced old brand green (#2F7D32) with Syntraro green (#82BA58) across all CSS variables and hardcoded values.
  - `--primary`: HSL 94 45% 54% (was 122 45% 34%)
  - `--brand`: #82BA58 (was #2F7D32)
  - `--brand-hover`: #6FA846 (was #256329)
  - `--ring`: HSL 95 50% 68% (#A6D683) for focus rings
- **+ New button**: Updated inline styles to #82BA58 / hover #6FA846.
- **Focus rings**: Input, AddressAutocomplete, and UniversalSearch focus rings now use rgba(130,186,88,...) / #A6D683.
- **Status pill success**: Updated light-mode success variant to use new green rgba values.
- **Active badge**: LocationDetailPage active status badge updated to new green.
- Files changed:
  - `client/src/index.css` — All CSS variable definitions (light + dark mode)
  - `client/src/App.tsx` — + New button inline styles
  - `client/src/components/ui/input.tsx` — Focus border/shadow colors
  - `client/src/components/ui/AddressAutocomplete.tsx` — Focus border/shadow colors
  - `client/src/components/ui/status-pill.tsx` — Success variant colors
  - `client/src/components/UniversalSearch.tsx` — Search input focus ring
  - `client/src/pages/LocationDetailPage.tsx` — Active status badge

#### App Shell Cleanup — Header & Sidebar Layout Refinement (2026-03-10)

- **Sidebar toggle relocated**: Moved the collapse/expand toggle from the header into the sidebar header, so it belongs visually to the sidebar shell.
- **Header branding re-aligned**: Logo shifted further left (reduced header padding), removed extra wrapper div around company name, increased gap between logo and tenant name from `gap-2.5` to `gap-4`.
- **Search bar moved rightward**: Search no longer centered in header; now sits right-aligned before the action controls (+ New, More menu) for a more balanced layout.
- **Ctrl+K hint removed**: Search placeholder changed from "Search or run command… (Ctrl+K)" to "Search or run command…" until the keyboard shortcut is implemented.
- Files changed:
  - `client/src/App.tsx` — Removed SidebarTrigger from header, adjusted header padding/layout, search positioning
  - `client/src/components/AppSidebar.tsx` — Added SidebarTrigger import, placed toggle in SidebarHeader
  - `client/src/components/UniversalSearch.tsx` — Removed (Ctrl+K) from placeholder text

#### App Shell Cleanup — Header More Menu, Sidebar Streamlining (2026-03-10)

- **Header color matched to sidebar**: Header now uses `var(--sidebar-bg)` (#243241) — exact same CSS variable as the sidebar — instead of hardcoded `#1F2937`. Header and sidebar read as one continuous shell.
- **Sidebar Feedback/Logout removed**: Removed Feedback and Logout buttons from the sidebar footer, freeing vertical space for future nav items.
- **Header More menu**: Replaced standalone Settings gear icon with a `⋯` (MoreHorizontal) dropdown containing Settings, Feedback, and Logout (with separator above Logout). All actions preserved, just relocated.
- **Logout moved to header**: Logout handler moved from AppSidebar to App.tsx AppContent, triggered via More dropdown.
- **Feedback moved to header**: FeedbackDialog ownership moved from AppSidebar to App.tsx, opened via More dropdown.
- **Operations Queue Preview removed**: Removed sidebar "Preview" section with Operations Queue nav entry, and removed the `/preview/operations-queue` route + `PreviewOperationsQueue` import.
- **Search placeholder updated**: Changed from "Search jobs, invoices, clients..." to "Search or run command… (Ctrl+K)" to support future command palette pattern.
- Files changed:
  - `client/src/App.tsx` — Header More dropdown, logout/feedback handlers, FeedbackDialog, removed operations queue route/import, color fix
  - `client/src/components/AppSidebar.tsx` — Removed Feedback, Logout, Operations Queue Preview, cleaned up unused imports
  - `client/src/components/UniversalSearch.tsx` — Updated placeholder text

### Added

#### PM Phase 4B — Queue Grouping Views: Location, Client, Proximity (2026-03-09)

- **Grouping mode selector**: Segmented control (None / Location / Client / Proximity) at top of Upcoming tab lets dispatchers switch queue views instantly.
- **Group by Location**: Groups PMs by `locationId`, showing location name as group header with customer name as sublabel.
- **Group by Client**: Groups PMs by `clientId` (customer company), showing customer name with location count sublabel.
- **Group by Proximity**: Uses Haversine formula + single-linkage clustering (5 km threshold) to cluster PMs at nearby locations. Labels derived from city names. Locations without coordinates placed in "No coordinates" bucket.
- **Group-level summary badges**: Each collapsible group header shows overdue/due-soon/needs-action counts as colored badges.
- **Group sorting**: Groups sorted by urgency — overdue first, then due soon, then needs action, then alphabetical.
- **Item sorting within groups**: Items sorted by compliance urgency (overdue → due_soon → in_window → upcoming → completed → rest).
- **Filter + grouping interaction**: Filters apply BEFORE grouping, so grouped views respect the active filter.
- **Collapsible groups**: Each group section is collapsible via shadcn Collapsible component; all expanded by default.
- **Row-level actionability preserved**: Each PM row within a group remains individually clickable, linking to PM detail page.
- Files changed:
  - `server/storage/recurringJobs.ts` — Added `locationLat`, `locationLng`, `locationAddress`, `locationCity` to `UpcomingQueueItem` interface and SELECT query
  - `client/src/pages/PMWorkspacePage.tsx` — Full rewrite with grouping modes, proximity clustering, collapsible group sections, group-level badges

#### PM Phase 4A — Scheduling Visibility + Actionable Planning Queue (2026-03-09)

- **Dual-state planning queue**: Each row in the Upcoming tab now shows both compliance state (overdue/due_soon/in_window/upcoming/completed_on_time/completed_late/skipped/canceled) and scheduling state (not_generated/generated_unscheduled/scheduled/completed/canceled/skipped) as separate badge columns.
- **Visit scheduling info**: Backend now batch-fetches earliest `job_visit` per generated job. Upcoming queue displays visit scheduled date/time when available.
- **Completed on-time vs late**: Compliance status now distinguishes `completed_on_time` from `completed_late` by comparing visit/job completion timestamp against service window end date.
- **"Needs Action" filter**: Default filter shows PMs that are in-window/due-soon/overdue AND not yet scheduled. Also available: overdue, due soon, generated-but-unscheduled, scheduled, upcoming, completed, and all.
- **Summary badges**: Clickable count badges at top of queue: "X need action", "X overdue", "X due soon", "X unscheduled".
- **Location grouping hint**: When multiple PMs are due at the same location, a small badge shows "X PMs due at this site" with tooltip.
- **PMDetailPage operational summary**: New summary block at top of detail page showing: Status, Next due, In service window, Needs scheduling, Last completed (with late indicator).
- **PMDetailPage scheduling column**: Instance history table now includes a "Scheduling" column showing derived state (No Job / Job Open / Done / Skipped / Canceled).
- **Queue columns**: PM Setup, Customer/Location, Target Date, Service Window, Visit Date, Technician, Job — all visible in the upgraded table.
- Files changed:
  - `server/storage/recurringJobs.ts` — Two-pass query (instances+jobs, then batch visits), dual state computation, `UpcomingQueueItem` interface expanded with `schedulingState`, `visit`, `completed_on_time`/`completed_late`
  - `client/src/pages/PMWorkspacePage.tsx` — Full rewrite of UpcomingTab with dual badges, rich filters, location grouping hints, TooltipProvider
  - `client/src/pages/PMDetailPage.tsx` — OperationalSummary block, enhanced instance table with scheduling column, upcoming queue integration

### Fixed

#### PMWizardPage clientId mapping fix (2026-03-09)

- Fixed `clientId` in PM wizard payload — was incorrectly set to `locationId` instead of `customerCompanyId`. The `clientId` FK on `recurring_job_templates` references `customer_companies`, not `client_locations`.
- File: `client/src/pages/PMWizardPage.tsx`

#### QBO Integration — Switch from Sandbox to Production (2026-03-09)

- **Root cause:** Three layers were all pointing to sandbox: `QBO_ENVIRONMENT` env var, `companies.qbo_environment` DB column, and `isImportAllowedInEnvironment()` hard-blocking production imports.
- **`server/services/qbo/QboClient.ts`**: Updated `isImportAllowedInEnvironment()` to always return `true`. Import operations are read-only (QBO → App, enforced by `isImportReadOnlyEnforced()`) and safe in production.
- **DB**: Set `companies.qbo_environment` to `"production"` for the active tenant.
- **Secrets required**: `QBO_ENVIRONMENT` must be changed from `"sandbox"` to `"production"` in Replit Secrets. Production `QBO_CLIENT_ID` and `QBO_CLIENT_SECRET` from Intuit developer portal must replace sandbox credentials.
- Import logic, data mapping, sync orchestration, and webhook handling remain unchanged.

### Added

#### PM Phase 3 — Planning Queue + Service Windows + Compliance Status (2026-03-09)

- **Service window fields**: Added `service_window_days_before` (default 7) and `service_window_days_after` (default 14) to `recurring_job_templates` table.
  - Migration: `migrations/2026_03_09_pm_service_windows.sql`
  - Schema: `shared/schema.ts` (insert + update Zod schemas updated)
  - Storage: `server/storage/recurringJobs.ts` (createTemplate supports new fields)
- **Upcoming planning queue API**: `GET /api/recurring-templates/upcoming` returns instances across all templates with computed compliance status (`upcoming`, `in_window`, `due_soon`, `overdue`, `completed`, `skipped`, `canceled`), service window dates, customer/location names, and technician names. Supports date range, status, and pagination filters.
  - Route registered before `/:id` to prevent Express param matching conflict.
  - Files: `server/routes/recurringJobs.ts`, `server/storage/recurringJobs.ts`
- **Real Upcoming tab**: Replaced placeholder in PMWorkspacePage with a live planning queue showing compliance badges, customer/location, ideal dates, service windows, technician assignments, and linked jobs. Includes clickable summary badges (overdue/due soon/in window counts) and dropdown filter (Actionable/All/Overdue/Due Soon/In Window/Upcoming/Completed).
  - File: `client/src/pages/PMWorkspacePage.tsx`
- **PMDetailPage service window display**: Schedule card now shows "Service window: Xd before — Yd after". Technician name now resolved via `useTechniciansDirectory` instead of showing raw UUID.
  - File: `client/src/pages/PMDetailPage.tsx`
- **PMWizardPage service window fields**: Step 3 (PM Details) now includes "Days before" and "Days after" inputs for service window configuration. Values appear in Review step and are sent in create payload.
  - File: `client/src/pages/PMWizardPage.tsx`
- **PMEditPage service window fields**: Schedule card now includes service window inputs. Values saved in PATCH payload.
  - File: `client/src/pages/PMEditPage.tsx`

### Removed

#### PMSetupModal deletion (2026-03-09)

- **Deleted** `client/src/components/PMSetupModal.tsx` — fully retired dead code, no imports anywhere in the codebase since Phase 2C.

#### PM Phase 2C — PM Detail/Edit Experience + PMScheduleCard Modal Retirement (2026-03-09)

- **PM detail page** (`client/src/pages/PMDetailPage.tsx`): New `/pm/:id` route showing full PM setup with overview, schedule, parts, actions (edit/pause/generate/duplicate/open location/customer), and instance history table with job links and status badges.
- **PM edit page** (`client/src/pages/PMEditPage.tsx`): New `/pm/:id/edit` route with same field layout as the wizard. Loads existing template, allows full PM settings update via PATCH, returns to detail page on save.
- **App routing**: Added `/pm/:id/edit` and `/pm/:id` routes in `App.tsx`.
- **PM workspace clickable rows**: Table rows in PM workspace now navigate to `/pm/:id` on click. Action buttons use `stopPropagation` to prevent double navigation.
- **PMScheduleCard modal retirement**: Removed `PMSetupModal` import and rendering from `PMScheduleCard`. Edit button now navigates to `/pm/:id/edit`. "View PM details" link navigates to `/pm/:id`. Creation button already routes to `/pm/new?locationId=`.
- **PMSetupModal status**: No longer imported or rendered anywhere in the active product flow. File exists but is fully retired from navigation. All PM create/edit paths now use dedicated PM workspace routes.
- **No backend changes**: All pages use existing recurring template APIs.
- Files: `client/src/pages/PMDetailPage.tsx` (new), `client/src/pages/PMEditPage.tsx` (new), `client/src/App.tsx`, `client/src/pages/PMWorkspacePage.tsx`, `client/src/components/PMScheduleCard.tsx`

#### PM Phase 2B — Guided PM Creation Wizard + Legacy Flow Redirect (2026-03-09)

- **PM creation wizard** (`client/src/pages/PMWizardPage.tsx`): New 5-step guided wizard at `/pm/new` for creating PM setups via the modern recurring template system.
  - Step 1: Target selection (customer company + location, searchable combobox pickers)
  - Step 2: Setup type (from scratch or copy settings from existing PM template)
  - Step 3: PM details (name, months, generation mode, auto-schedule, start/end date, preferred technician)
  - Step 4: Parts options (include location PM parts toggle with part count preview)
  - Step 5: Review summary and create
- **Query-param prefill**: Supports `?locationId=`, `?fromTemplateId=`, `?duplicate=` for contextual launches.
- **App routing**: Registered `/pm/new` route in `App.tsx` (before `/pm` for correct matching).
- **PMScheduleCard creation redirect**: "Create PM Schedule" button on location pages now navigates to `/pm/new?locationId=` instead of opening the embedded modal. PMSetupModal is retained only for **editing** existing PM schedules.
- **Primary creation path**: All PM creation entry points (`/pm` workspace "New PM Setup" button, PMScheduleCard "Create" button, duplicate action) now route through the wizard.
- **No backend changes**: Wizard reuses existing `POST /api/recurring-templates` and `POST /api/recurring-templates/:id/generate` endpoints.
- Files: `client/src/pages/PMWizardPage.tsx` (new), `client/src/App.tsx`, `client/src/components/PMScheduleCard.tsx`

#### PM Phase 2 — Dedicated PM Workspace, Navigation, Auto-Generation, Duplicate Flow (2026-03-09)

- **PM Workspace page** (`client/src/pages/PMWorkspacePage.tsx`): New `/pm` route with two tabs — "PM Setups" (template list with status, recurrence, months, actions) and "Upcoming" (placeholder for generated job instances). Supports pause/resume, edit, duplicate, and "Generate Now" actions.
- **Sidebar navigation**: Added "PM" entry (Wrench icon) in the operations section of `AppSidebar.tsx`, between Jobs and Invoices.
- **App routing**: Registered `/pm` route in `App.tsx` with `ProtectedRoute requireAdmin` guard.
- **Duplicate/copy API**: `POST /api/recurring-templates/:id/duplicate` creates a paused copy of a template with " (Copy)" title suffix. Storage method in `recurringJobsRepository.duplicateTemplate()`.
- **Auto-generation wired to server startup**: `startPmAutoGeneration()` called in `server/index.ts` after server starts listening. Runs 30s after boot, then every 6h.
- **PMScheduleCard link-in**: Added "View all PM setups →" link to PM workspace from the location-level PM card.
- Files: `client/src/pages/PMWorkspacePage.tsx`, `client/src/App.tsx`, `client/src/components/AppSidebar.tsx`, `server/index.ts`, `server/services/pmAutoGeneration.ts`, `server/routes/recurringJobs.ts`, `server/storage/recurringJobs.ts`, `client/src/components/PMScheduleCard.tsx`

#### PM Auto-Generation Service (2026-03-09)

- Created `server/services/pmAutoGeneration.ts` — background scheduler that automatically generates recurring PM job instances for all tenants.
- Runs 30 seconds after server startup (catch-up), then every 6 hours.
- Queries all companies with active `recurring_job_templates`, calls `generateInstances()` per tenant with a 45-day lookahead window.
- Idempotent: the existing generation engine handles dedup via unique constraints.
- Fault-tolerant: each company is processed independently so one failure doesn't block others.
- Files: `server/services/pmAutoGeneration.ts`

#### Tenant Data Reset Script (2026-03-09)

- Created `scripts/resetTenantData.ts` — safely wipes all sandbox operational data for a tenant while preserving account, users, schema, feature flags, and settings.
- Deletes from 50+ operational tables in correct FK order inside a single transaction with automatic rollback on failure.
- Handles missing tables/columns gracefully via SAVEPOINTs (for schemas that haven't been fully migrated).
- Supports tables with `company_id`, `tenant_id`, or no tenant column (subquery-based deletion via parent FK).
- Outputs pre-reset counts, per-table deletion log, post-reset verification, and preserved-table checks.
- Usage: `npx tsx scripts/resetTenantData.ts [companyId]`
- Files: `scripts/resetTenantData.ts`

### Changed

#### Dispatch Board — Visual Color Mapping for Jobs / Tasks / Supplier Visits (2026-03-09)

Updated the dispatch board color system to match the intended semantic meaning:

- **Jobs render GREEN**: `visitStatusColor()` and `visitStatusDot()` updated — scheduled uses emerald, dispatched uses green, in_progress uses lime. Selection rings, resize handles, team badges, occupancy rails, drag previews, unscheduled cards, and detail panel all updated from blue/slate to emerald/green.
- **Tasks render BLUE**: All task blocks changed from violet/purple to blue color family — card background, borders, selection rings, resize handles, status badges, week view items, detail panel header/footer/badges.
- **Supplier visits distinguished by ICON**: `Truck` icon used for `SUPPLIER_VISIT` and `supplier_run` task types (replacing generic `ClipboardList`). Applied in `DispatchTaskBlock`, `WeekDispatchCell`, and `DispatchDetailPanel`. Added `SUPPLIER_VISIT` to type label maps.
- **Any Time chips unchanged**: Yellow/amber chips remain as-is.
- **Three-color system enforced**: Green = jobs, Blue = tasks (including supplier visits), Yellow = Any Time state.
- Files: `dispatchPreviewUtils.ts`, `DispatchVisitBlock.tsx`, `DispatchTaskBlock.tsx`, `DispatchDetailPanel.tsx`, `DispatchUnscheduledCard.tsx`, `DispatchDragPreview.tsx`, `DispatchLaneRow.tsx`, `WeekDispatchCell.tsx`

#### Job Detail Page — Visual Surface & Section Rhythm Pass (2026-03-09)

Visual-only refinements to improve section grouping, hierarchy, and readability. No layout or logic changes.

- **Billing surface zone**: Parts & Billing + Expenses + Recurring wrapped in unified `bg-muted/15` container with lighter internal dividers (`border-border/40`) for cohesion.
- **Stronger section boundaries**: Notes and Visits sections use `border-t-2 border-border/50` for clear visual separation from billing zone. Activity uses lighter `border-t border-border/30`.
- **Section heading consistency**: All section headings standardized to `text-[13px] font-semibold`, icons to `text-muted-foreground/70`, chevrons to `text-muted-foreground/50`.
- **Sidebar as utility rail**: Removed `bg-muted/10` background tint, replaced full-width `border-b` dividers with inset `mx-5 border-t border-border/40` dividers, added `[&>*]:bg-transparent` to strip child card backgrounds.
- **Collapse trigger polish**: Parts & Billing trigger conditionally shows `border-b border-border/40` only when expanded.
- **Header card typography**: Title `text-2xl font-bold tracking-tight`, summary `text-muted-foreground/90`, address `text-muted-foreground/70` with dot separator.
- Files: `client/src/pages/JobDetailPage.tsx`, `client/src/components/JobHeaderCard.tsx`

#### Dispatch Board — Improved Quick Create Menu (2026-03-09)

- **Replaced generic "New Task" with explicit task types**: Quick Create menu now shows three options: New Job Visit (CalendarPlus icon), General Task (ClipboardList icon), Supplier Visit (Truck icon).
- **Task type prefill**: `TaskPrefill` interface extended with `taskType` field. Quick-create passes `"GENERAL"` or `"SUPPLIER_VISIT"` so `TaskDialog` opens with the correct type pre-selected.
- **Left-aligned button content**: Menu buttons use `justify-start gap-2` for icon + label alignment.
- Files: `client/src/pages/DispatchPreview.tsx`, `client/src/components/TaskDialog.tsx`

#### Job Detail Page — Final Layout Refinement (2026-03-09)

Content redistribution for better page balance and readability.

- **Notes moved to main column**: Moved from right sidebar to main column below Parts & Billing / Expenses. Notes now have full horizontal width for easier scanning.
- **Visits moved to main column**: Moved below Notes in main column. Compact visit list with slightly larger touch targets (`px-3 py-2`, `text-xs`).
- **Parts & Billing collapsible**: Added `Collapsible` wrapper with a section header trigger (`DollarSign` icon + "Parts & Billing" + chevron). Users can collapse to reduce scrolling. Expanded by default.
- **Activity section moved to main column**: Activity timeline now lives at the bottom of the main column (below Visits), removed `Card` wrapper, uses `hover:bg-muted/30` for subtle interaction feedback.
- **Sidebar refined**: Now contains only Labour, Equipment, Status Timeline, Scheduling History. Added `bg-muted/10` background tint to visually distinguish from main column. Narrowed from `340px` to `300px`.
- **Removed unused `Card` import**: No longer needed after Activity section cleanup.
- Files: `client/src/pages/JobDetailPage.tsx`

### Added

#### Dispatch Board — Any Time Capacity Warning + Default Schedule Prefill (2026-03-09)

Three dispatch UX improvements:

- **Unscheduled schedule prefill**: When scheduling an unscheduled visit from the dispatch detail panel, the date field now prefills with the board's currently selected date (not today unless the board is on today). Time defaults to 09:00, duration to 1 hour (existing defaults preserved).
- **Any Time capacity warning (soft limit)**: When converting a timed visit to Any Time, if the technician already has 3+ Any Time visits on that day, a warning toast is shown: "This technician already has N Any Time visits today. Consider scheduling a specific time." Warning only — does not block the save.
- **Any Time overflow popover**: The Any Time column already showed max 3 chips with `+N` overflow indicator. The `+N` is now clickable, opening a popover that lists all overflow visits with the same chip styling. Clicking an overflow chip selects the visit in the detail panel.
- **Stable chip sort**: Any Time chips are sorted by visit ID (creation order) to prevent unpredictable reordering.
- Files: `client/src/pages/DispatchPreview.tsx`, `client/src/components/dispatch/DispatchDetailPanel.tsx`, `client/src/components/dispatch/DispatchTimeline.tsx`

### Fixed

#### Dispatch Board — Visit disappears after converting to Any Time (2026-03-09)

- **Root cause**: The API query range used `startOfDay(selectedDate)` which is local-timezone midnight. In timezones behind UTC (e.g., EST where local midnight = 5am UTC), an allDay visit stored at UTC midnight (`2026-03-09T00:00:00Z`) falls BEFORE the query range start (`2026-03-09T05:00:00Z`). The optimistic cache showed the visit correctly, but the background refetch excluded it from the server response, causing it to vanish.
- **Fix**: Widened the API query start to `min(localMidnight, utcMidnight)` so allDay visits at UTC midnight are always captured. Applied a unified post-filter using `getDispatchDayKey()` on ALL visits (not just allDay) to remove any wrong-day timed visits from the wider range. Same fix applied to week view.
- Files: `client/src/components/dispatch/useDispatchPreviewData.ts`, `client/src/components/dispatch/useDispatchWeekData.ts`

#### Job Detail Page — Visual Polish Pass (2026-03-09)

Visual-only refinements to the unified surface — no layout changes.

- **Inline attention indicator**: Replaced full-width OfficeActionsStrip banner with a compact inline status pill on the left side of the action row (e.g., "⚠ Overdue — since Mar 8"). Uses `getAttentionReason()` and `ATTENTION_CONFIG` for consistency.
- **Strengthened typography hierarchy**: Title is `font-bold tracking-tight`, summary is `text-sm text-muted-foreground/90`, address is `text-xs text-muted-foreground/70` with dot separator.
- **Sidebar metadata grid alignment**: Replaced `flex justify-between` rows with a `grid grid-cols-[auto_1fr]` layout for perfectly aligned label/value columns.
- **Parts & Billing emphasis**: Added `bg-muted/30` background tint and transparent child backgrounds to visually distinguish the primary working area.
- **Unified surface shadow**: Added `shadow-sm border-border/80` for a more premium card feel.
- **Sidebar section header contrast**: Section titles use explicit `text-foreground` for stronger visual weight against muted backgrounds.
- Files: `client/src/pages/JobDetailPage.tsx`, `client/src/components/JobHeaderCard.tsx`

### Changed

#### Job Detail Page — Unified Surface Redesign (2026-03-09)

Second-pass layout restructure to create one cohesive workspace instead of fragmented cards.

- **Removed Back button**: Eliminated from action bar entirely; users navigate via main app nav.
- **Removed context-actions bar**: Eliminated the duplicate state-based CTA bar (Schedule Visit, Assign Technician, View Invoice) that competed with the main action row.
- **Rationalized OfficeActionsStrip**: Banner no longer duplicates scheduling actions from the action bar. On Hold shows "Resume" only; Overdue shows "Unschedule" only; Requires Invoicing shows "Create Invoice" only.
- **Single canonical action row**: Right-aligned only — Schedule Visit + Edit Job + More Actions. No Back button, no left-aligned buttons, no second action row.
- **Unified bordered surface**: Header + body wrapped in one `rounded-lg border bg-card` container with internal dividers instead of separate Card components.
- **Header integrated**: Identity (left) and metadata (right) are sections within the unified surface, separated by a vertical divider. No separate Card wrapper.
- **Body 2-column layout**: Left column (billing/expenses/recurring) and right column (labour/notes/visits/equipment/timeline/history/activity) are within the same surface, separated by a vertical border.
- **PartsBillingCard flush integration**: Card border stripped via CSS selector `[&>*]:border-0` so it renders flush inside the unified surface as the main working area.
- **Sidebar sections use internal dividers**: Labour, Notes, Visits rendered with `border-b` dividers instead of separate Card wrappers. Equipment, Timeline, History, Activity cards have borders stripped to integrate.
- **JobNotesSection embedded mode**: Added `embedded?: boolean` prop to render without Card wrapper when integrated into a parent surface.
- **Removed duplicate Schedule Visit from visits section header**: Only the top action bar has the Schedule Visit button.
- **Cleaned up unused imports**: Removed icons no longer used after layout simplification.
- Files: `client/src/pages/JobDetailPage.tsx`, `client/src/components/JobNotesSection.tsx`

#### Dispatch Board — Fix Any Time Day Bucketing + Unify Row Alignment (2026-03-09)

Two structural fixes to the dispatch board:

- **Fixed wrong-day Any Time bucketing (root cause: local-timezone date range query)**:
  The API query used `startOfDay()`/`endOfDay()` from date-fns, which operates in browser-local timezone. For timezones behind UTC (e.g., EST), the local-midnight-to-midnight range in UTC includes midnight of the next UTC day — causing allDay visits stored at `2026-03-08T00:00:00.000Z` to appear on the Mar 7 board. Fix: post-filter allDay visits using canonical UTC day-key comparison against the selected date.
- **Added `getDispatchDayKey()` canonical helper**: Single source of truth for dispatch day bucketing — uses UTC date extraction for allDay visits, local timezone for timed visits. Used in both Day view (post-filter) and Week view (grouping).
- **Unified row alignment across all board columns**: Extracted `DIVIDER_HEIGHT_PX` to shared `dispatchPreviewUtils.ts` constant. All three board columns (technician sidebar, Any Time column, timeline grid) now use the same explicit height for the off-shift divider and consistent `border-slate-200/80` borders on tech rows. Removed padding-based implicit sizing.
- Files: `client/src/components/dispatch/dispatchPreviewUtils.ts`, `client/src/components/dispatch/useDispatchPreviewData.ts`, `client/src/components/dispatch/useDispatchWeekData.ts`, `client/src/components/dispatch/DispatchTechnicianSidebar.tsx`, `client/src/components/dispatch/DispatchTimeline.tsx`

#### Job Detail Page — UI/UX Layout Restructure (2026-03-09)

Surgical restructure of the Job Detail page layout for improved information hierarchy and action discoverability.

- **Top action bar**: Added a dedicated action bar above the header card with Back, Schedule Visit, Edit Job, and More Actions dropdown. Actions are now immediately accessible without scrolling into the header card.
- **2-column header card**: Replaced the old 3-column meta card (identity / visits / status) with a cleaner 2-column layout: identity info (left) and metadata sidebar (right). Description renders inline below the identity block.
- **Visits moved to sidebar**: Visits section relocated from the middle column of the header to the right sidebar as a flat sorted list. Shows all visits (active + completed) with status badges for non-scheduled statuses. Defaults to 5 visible with "Show all" toggle.
- **More Actions in action bar**: The More Actions dropdown (Create Similar, Create/View Invoice, Signature, PDF, Print, Delete) is now in the top action bar instead of nested inside JobHeaderCard.
- **JobHeaderCard simplified**: Removed Card wrapper; accepts `showActions` prop to hide internal action buttons when parent provides its own action bar. All dialog/mutation logic preserved internally.
- **JobNotesSection compact layout**: Notes now render without individual card borders; author and date on a single inline line (`Author · Date`); delete button only shows on hover. Reduced vertical spacing.
- **Wider right sidebar**: Right sidebar column widened from `1fr` to `340px` for better readability of sidebar cards.
- Files: `client/src/components/JobHeaderCard.tsx`, `client/src/pages/JobDetailPage.tsx`, `client/src/components/JobNotesSection.tsx`

#### Dispatch Board — Any Time Editing Stabilization Pass (2026-03-09)

Coherent stabilization pass for Any Time scheduling in dispatch.

- **Fixed Any Time date display bug (root cause: UTC/local timezone mismatch)**: Date display for all-day visits now extracts UTC date parts directly (`getUTCFullYear/Month/Date`) instead of using `new Date(isoString)` which shifts midnight UTC to the previous day in negative-offset timezones (e.g., EST). This fixes the snap-back / off-by-one where clicking March 9 appeared as March 8.
- **Any Time column alignment**: Off-shift divider in the Any Time column now uses explicit `DIVIDER_HEIGHT_PX` (26px) to match the sidebar and timeline dividers exactly. Extracted `DIVIDER_HEIGHT_PX` to module-level constant.
- **Any Time checkbox replaces mode badge**: Replaced the read-only "Timed"/"Any Time" badge with an interactive "Any Time" checkbox. No "Timed" label shown anywhere. Checking the box saves immediately with canonical UTC boundaries. Unchecking reveals time/duration controls with visible defaults — user must press "Schedule at HH:MM" to confirm. No silent save on uncheck.
- **Optimistic cache now patches `allDay` flag**: `optimisticReschedule()` in `useDispatchPreviewMutations.ts` now patches the `allDay` field in the TanStack Query cache, so visits immediately render in the correct surface (any-time column vs timeline grid) without waiting for server response.
- **Conversion flow (Any Time → timed)**: When unchecking "Any Time", a conversion form appears showing the current date, a time picker (default 09:00), and a duration selector. The user must explicitly click "Schedule" to commit. No hidden fallback values. Preserves the visit's current date.
- Files: `client/src/components/dispatch/DispatchDetailPanel.tsx`, `client/src/components/dispatch/DispatchTimeline.tsx`, `client/src/components/dispatch/useDispatchPreviewMutations.ts`

#### Dispatch Board — Fixed Any-Time Column + Disable Broken Toggle (2026-03-09)

Replaced the confusing per-lane any-time chip rail with a dedicated fixed column in the dispatch timeline layout.

- **Fixed Any Time column**: Added an 80px-wide sticky-left column in `DispatchTimeline` between the tech sidebar and the scrollable hour grid. Each tech lane gets a cell showing up to 3 any-time visit chips (with overflow "+N" indicator). The column header reads "ANY TIME" in amber. The column scrolls vertically with lanes but stays pinned horizontally when scrolling the timeline.
- **Removed chip rail from lanes**: Deleted the `anyTimeVisits` chip rail overlay from `DispatchLaneRow` (was pinned to lane top, caused visual clutter and confusion). Lane rows now only render timed visits and tasks.
- **Disabled Timed/Any Time toggle**: Replaced the interactive toggle buttons in `DispatchDetailPanel` with a read-only scheduling mode badge. The toggle caused day teleportation (9 AM UTC hardcoded, wrong for non-UTC users). Users should use the full visit editor (`EditVisitModal`) to change scheduling mode.
- **Any-time date editing preserved**: The date picker for any-time visits in the detail panel still works correctly (UTC midnight boundaries).
- Files: `client/src/components/dispatch/DispatchTimeline.tsx`, `client/src/components/dispatch/DispatchLaneRow.tsx`, `client/src/components/dispatch/DispatchDetailPanel.tsx`

#### Dispatch Board — Any-Time UI + Detail Panel Editing + Multi-Tech Drag Fix (2026-03-08)

Three follow-up fixes for all-day/any-time scheduling UX:

- **Any-time lane UI refined**: Replaced full-width yellow banner strip (`absolute top-0 left-0 right-0 bg-amber-50/90 border-b`) with compact inline chip rail. Chips are now `rounded-full` pills with `CalendarDays` icon, pinned to lane top-left with no full-width background. Hidden scrollbar for overflow (`scrollbarWidth: "none"`). Added `data-dispatch-block="anytime"` to prevent quick-create on chip clicks.
- **Visit detail panel Any Time editing**: Added `Timed / Any Time` toggle in the Schedule section. Toggling to Any Time calls `onReschedule` with UTC midnight/23:59:59 boundaries (canonical path). Toggling to Timed defaults to 9–10 AM. Any-time mode shows date picker only (no time/duration controls). Date change in any-time mode preserves `allDay: true` flag.
- **Multi-tech drag: time move allowed, crew reassignment blocked**: Previous guard blocked ALL cross-lane drags for multi-tech visits. Now looks up the visit's full `technicianIds` list and checks whether the target lane tech is already assigned. If yes → time reschedule (all mirrors move). If no → blocked with toast feedback. Applied consistently to both day and week view handlers.
- **`RescheduleParams` extended**: Added optional `allDay` field. `rescheduleVisit` mutation now passes `allDay` through to the API instead of hardcoding `false`. Detail panel's `onReschedule` prop signature extended with optional `allDay` parameter.
- Files: `client/src/components/dispatch/DispatchLaneRow.tsx`, `client/src/components/dispatch/DispatchDetailPanel.tsx`, `client/src/components/dispatch/useDispatchPreviewMutations.ts`, `client/src/pages/DispatchPreview.tsx`

#### All-Day Scheduling — UTC Timestamp Fix & Normalization Consolidation (2026-03-08)

Root-cause fix for `jobs_all_day_end_2359_check` constraint violation when changing all-day visit dates from the job detail page.

**Phase 1 — Fix constraint violations:**
- **`EditVisitModal.tsx`**: All-day payload was constructing `new Date("YYYY-MM-DDT00:00:00")` without `Z` suffix, causing browser-local timezone interpretation. `toISOString()` then shifted the hour into UTC (e.g., midnight EST → 05:00:00 UTC), violating the midnight/23:59:59 constraints. Fixed to send pre-formed UTC ISO strings: `"YYYY-MM-DDT00:00:00.000Z"` / `"YYYY-MM-DDT23:59:59.000Z"`.
- **`jobVisits.ts` `createJobVisit()`**: Fallback end-of-day computation used `setHours(23,59,59,0)` (local time). Changed to `setUTCHours(23,59,59,0)`.
- **`jobVisits.ts` `syncJobScheduleFromVisits()`**: Mirror write to `jobs` table passed raw Date objects without sanitization. Added `sanitizeAllDayTimestamps()` call before DB write to replace Date objects with UTC-safe SQL expressions (`::timestamp` cast), preventing node-pg timezone serialization from breaking the constraint.

**Phase 2 — Consolidate normalization:**
- **`jobVisits.routes.ts` PATCH handler**: When `isAllDay=true`, the route now passes the payload through `normalizeScheduleTimes()` (canonical function in `server/domain/scheduling.ts`) instead of raw `new Date()` conversion. This ensures the server produces correct UTC boundaries regardless of what the client sends. Timed/unscheduled payloads still use direct Date conversion (no change).

**Cosmetic:**
- **`DispatchLaneRow.tsx`**: Suppressed "24h" duration display on any-time visit chips (meaningless for all-day visits).

- Files: `client/src/components/visits/EditVisitModal.tsx`, `server/storage/jobVisits.ts`, `server/routes/jobVisits.routes.ts`, `client/src/components/dispatch/DispatchLaneRow.tsx`

#### Dispatch Board — Resize/Quick-Create Guardrails, Multi-Tech Drag, Task Modal (2026-03-08)

Four interaction fixes for dispatch board UX:

- **Resize → quick-create suppression**: Added `lastBlockInteractionRef` timestamp guard in `DispatchLaneRow`. `onPointerUp` on the lane tracks interactions with `[data-dispatch-block]` elements; `handleLaneClick` suppresses clicks within 300ms of a block interaction. Prevents resize release from triggering quick-create modal.
- **Multi-tech cross-lane drag feedback**: Multi-tech visits dragged to a different lane now show a toast ("Change crew assignments from the visit detail panel") and return early instead of silently executing the mutation with unchanged tech assignment.
- **Cursor change**: Replaced `cursor-crosshair` with `cursor-pointer` on empty lane slots for appropriate affordance.
- **Task quick-create modal**: Replaced inline `apiRequest` task creation with `TaskDialog` modal. Added `initialData` prop to `TaskDialog` for prefilling `assignedToUserId`, `startDate`, `startTime` from dispatch context. Removed `isCreatingTask` state and `apiRequest` import (no longer needed). Users now get the full task form (title, notes, type, supplier visit details) instead of a generic "New Task" auto-creation.
- Files: `client/src/pages/DispatchPreview.tsx`, `client/src/components/dispatch/DispatchLaneRow.tsx`, `client/src/components/TaskDialog.tsx`

#### Dispatch Board — Quick Create Bug Fix + Regression Pass (2026-03-08)

Fixed two broken quick-create actions, restyled modal, fixed regression, and added unassigned lane guardrail.

- **New Task fix**: Radix `AlertDialogAction` auto-closes the dialog on click via internal context — `e.preventDefault()` does not prevent this. Switched entire quick-create modal from `AlertDialog` to `Dialog` with plain `Button` components. Buttons now have `disabled={isCreatingTask}` for proper double-click protection. Dialog prevents close during task creation via `onOpenChange` guard. Toast on success and destructive toast on failure.
- **New Job Visit fix**: Was navigating to `/jobs/new` which matched `/jobs/:id` route, treating `"new"` as a job ID → "Job not found". Fixed by opening `QuickAddJobDialog` modal instead (the app's canonical job creation flow). Added `initialSchedule` prop to `QuickAddJobDialog` to accept prefilled date/time/tech from dispatch board, wired through to `createDefaultScheduleValue()`.
- **Modal styling**: Replaced `AlertDialog` + generic `bg-blue-600`/`bg-violet-600` colors with `Dialog` + app theme `Button` variants (default for primary, `outline` for secondary, `ghost` for cancel). Tightened spacing (`max-w-[280px] p-5`), improved typography hierarchy (tech name + time as `text-sm font-medium`, date as `text-xs text-muted-foreground`).
- **Stale state prevention**: `QuickAddJobDialog` resets `scheduleValue` to `unscheduled: true` when `open` becomes false (existing cleanup effect). `quickCreateJobSchedule` is cleared to `undefined` when dialog closes. No leak across opens.
- **Unassigned lane guardrail**: `handleEmptySlotClick` rejects clicks with `techId === UNASSIGNED_TECH_ID` — shows toast "Choose a technician lane" instead of opening quick-create. Prevents `__unassigned__` from reaching `POST /api/tasks` or `QuickAddJobDialog.initialSchedule.primaryTechnicianId`.
- Files: `client/src/pages/DispatchPreview.tsx`, `client/src/components/QuickAddJobDialog.tsx`

#### Client Detail — Duplication Removal & Density Polish (2026-03-08)

- **Part A: Single Active jobs list in Company Overview** — Removed separate Overdue/Active/Recent sections. Replaced with one list sorted by `getJobStatusDisplay().priority` (overdue 0 → in-progress 1 → scheduled 2 → open 3 → completed 4 → invoiced 5 → archived 6), secondary sort by updatedAt desc. No duplicate job rows.
- **Part B: Compact note metadata** — Changed note footer from `"Added by {name} · {date} at {time}"` with `border-t mt-2 pt-2` to `"{name} · {date}, {time}"` with `mt-1.5`, no border separator. Edit/delete buttons shrunk from `h-6 w-6` to `h-5 w-5`, icons from `h-3.5` to `h-3`.
- Files: `client/src/pages/ClientDetailPage.tsx`, `client/src/components/NotesPanel.tsx`

#### Dispatch Board — Final Stabilization & UX Completion Pass (2026-03-08)

Seven-item stabilization pass for dispatch board UX polish and missing features.

- **Item 1: Drag preview alignment** — Verified all 4 coordinate paths (preview, drop, overlap, drag ghost) use consistent `dragGrabBlockXRef` offset subtraction
- **Item 2: Multi-tech unscheduled** — `UnscheduledScheduleForm` now uses searchable multi-select crew picker instead of single-select dropdown. Schedules with primary tech, then updates crew roster for additional technicians
- **Item 3: Task date editing** — Task detail panel now has Calendar popover for date editing (mirrors visit date editing pattern). Previously date was read-only text
- **Item 4: 24h toggle functional** — `show24Hour` state now fully wired through timeline pipeline: `getTimelineConfig()` → `DispatchTimeline` → `DispatchLaneRow` → `DispatchVisitBlock` / `DispatchTaskBlock` / `DispatchDragPreview`. All position calculations, resize clamping, drop snapping, and overlap detection use dynamic `startHour`/`endHour` instead of hardcoded constants. Active button styling changed from `bg-slate-800` to `bg-primary` (green)
- **Item 5: Sidebar tooltips** — Added `tooltip` prop to all `SidebarMenuButton` items in `AppSidebar.tsx` (leverages shadcn's built-in tooltip support for collapsed icon-only state)
- **Item 6: Click-empty-slot quick create** — Clicking empty lane area computes snapped time + tech, opens quick-create dialog with two actions: **New Job Visit** (navigates to `/jobs/new` with prefilled tech/time) and **New Task** (creates 1-hour task via `POST /api/tasks` with prefilled tech/time, violet styling). Lane cursor changes to crosshair when handler is active
- **Item 7: Any Time visibility** — Already has prominent amber banner strip across lane top with CalendarDays icon, label, and clickable visit chips. No further changes needed
- Files: `client/src/pages/DispatchPreview.tsx`, `client/src/components/dispatch/DispatchTimeline.tsx`, `client/src/components/dispatch/DispatchLaneRow.tsx`, `client/src/components/dispatch/DispatchDragPreview.tsx`, `client/src/components/dispatch/DispatchTaskBlock.tsx`, `client/src/components/dispatch/DispatchVisitBlock.tsx`, `client/src/components/dispatch/DispatchDetailPanel.tsx`, `client/src/components/dispatch/DispatchBoardHeader.tsx`, `client/src/components/dispatch/dispatchPreviewUtils.ts`, `client/src/components/AppSidebar.tsx`

#### Client Detail / Location — Consistency & Surface Cleanup Pass (2026-03-08)

Six-part cleanup pass for consistency, terminology, and dead UI removal.

- **Part A: Contact fields removed from Edit Location modal** — Removed `contactPhone`/`contactEmail` state, prefill logic, payload fields, and UI inputs from `LocationFormModal`. Contacts managed only in dedicated Contacts surface
- **Part B: Scroll trap removed from Edit Location modal** — Removed `max-h-[85vh] overflow-y-auto` from DialogContent, tightened spacing (`space-y-3 py-2`, `p-3` toggles). Modal fits without inner scrollbar
- **Part C: Unified job rows** — Created shared `JobRow` component. Used consistently in `CompanyOverviewTab`, `LocOverviewTab`, `LocJobsTab`, `ClientAllJobsTab`. Eliminates 4 inline job-rendering patterns
- **Part D: Removed low-value sections from Location Overview** — Removed PM empty-state block ("No PM contract") and Access block below Active Work
- **Part E: Standardized terminology to "Site Code"** — Single canonical label replaces "Roof/Ladder Code", "Roof Ladder Code", "Site Code / Store Number", "Access" across all surfaces
- **Part F: Site Code in location header** — Site code now displays inline next to address in location header as small metadata
- Files: `client/src/pages/ClientDetailPage.tsx`, `client/src/components/LocationFormModal.tsx`, `client/src/components/NewAddClientDialog.tsx`, `client/src/components/EditClientDialog.tsx`, `client/src/components/QuickAddClientModal.tsx`

#### Client Detail Page — Scope Cleanup & Compaction (2026-03-08)

Focused the client detail page for dispatchers: removed noise, tightened layout, corrected scope.

- **Removed** Equipment, PM, Parts tabs from company scope (site-level assets, not company-level)
- **Company tabs** now: Overview, Jobs, Invoices, Quotes. Location adds Equipment, PM, Parts.
- **Removed** summary cards (Locations/Active/Total/Quotes) from company overview — already in header
- **Company overview** now shows Overdue → Active → Recent jobs directly (operationally useful)
- **Removed** billing section from right metadata panel (belongs in Invoices tab)
- **Right panel** compacted: `p-4 space-y-5` → `p-3 space-y-3`, tighter section headers
- **Location scope** no longer shows company-wide contacts — location contacts only
- **Contact card** layout improved: Name + Primary badge → Phone/Email inline → Role badges
- **Scope hint** label added to workspace header ("Company" or "Location")
- **Job list** location label made visually lighter (`text-[10px] text-muted-foreground/70`)
- **Removed** dead code: `BillingSummaryCompact`, `CompanyEquipmentTab`, `CompanyPMTab`,
  `CompanyPartsTab`, `LocationEquipmentSection`, `LocationPartsSection`
- Files: `client/src/pages/ClientDetailPage.tsx`

#### Client Detail Page — Three-Panel Scope Selector Architecture (2026-03-08)

Replaced the nested page-within-page layout (top client-level tab bar + left location rail + inner location tabs)
with a clean scope selector + workspace + metadata panel architecture:

- **Removed** the top client-level tab bar (Locations/Jobs/Invoices/Quotes/Billing/Contacts/Activity)
- **Left rail** is now a narrow (w-56) scope selector with Company Overview row + Locations section
- **Center workspace** shows unified tabs (Overview/Jobs/Invoices/Quotes/Equipment/PM/Parts) scoped
  to either the company or selected location
- **Right metadata panel** (w-72) shows contextual cards: Contacts, Notes, Billing/Activity (company)
  or Contacts, Notes, Access/Site Info (location)
- **Tags** render inline near entity name in workspace header instead of a separate tab
- **State model** uses `scopeType: "company" | "location"` for clean scope switching
- **Company Overview** is the default scope, showing aggregated data across all locations
- **Create Job** respects scope — preselects location when in location scope
- Eliminated `LocationDetailPane` component; queries lifted to parent for shared access
- Removed `LocTagsTab`, `CLIENT_TABS`, `LOC_TABS`, `ClientBillingTab` (replaced by compact variants)
- New components: `CompanyOverviewTab`, `CompanyEquipmentTab`, `CompanyPMTab`, `CompanyPartsTab`,
  `BillingSummaryCompact`, `CompanyContactsCompact`, `LocContactsCompact`, `ClientActivityCompact`
- Files: `client/src/pages/ClientDetailPage.tsx`

### Added

#### Dispatch Board Stabilization + Feature Completion Pass (2026-03-08)

**Item 1: Fix Drag Preview / Time-Slot Alignment**
- Unified coordinate calculations between drag overlay ghost, snap preview indicator, overlap
  detection, and final drop placement. The grab X offset within the block is now subtracted
  so preview/drop align to the block's left edge, not the cursor position.
- Files: `client/src/pages/DispatchPreview.tsx`

**Item 2: "Any Time" Visit State**
- All-day (any-time) visits are now separated from timed visits in lane rendering. They appear
  as compact amber pill chips at the top-right of each technician lane rather than stretching
  across the entire timeline. Clicking opens the detail panel.
- Files: `client/src/components/dispatch/DispatchLaneRow.tsx`

**Item 3: Extended Timeline Range (5 AM – 10 PM)**
- Timeline window extended from 6AM–8PM to 5AM–10PM (17 hours) for early/late scheduling.
- Auto-scroll on mount now targets whichever is earlier: 1 hour before current time, or
  business hours start (7 AM). Business hours constants exported for reuse.
- `getVisitPosition()` now clamps visits starting before the timeline to left=0 instead of
  hiding them entirely.
- Files: `client/src/components/dispatch/dispatchPreviewUtils.ts`,
  `client/src/components/dispatch/DispatchTimeline.tsx`

**Item 4: Date Editing for Unscheduled Visits**
- Unscheduled visits in the detail panel now show an inline scheduling form with date picker,
  time input, duration selector, and technician assignment. Clicking "Schedule Visit" fires
  the `scheduleVisit` mutation (same path as drag-and-drop scheduling).
- Files: `client/src/components/dispatch/DispatchDetailPanel.tsx`,
  `client/src/pages/DispatchPreview.tsx`

**Item 5: Technician Availability Sync**
- Background invalidation now also invalidates `/api/team/technicians/working-hours` so
  on-shift/off-shift grouping refreshes after schedule mutations.
- Reduced working hours stale time from 5 minutes to 2 minutes for faster sync.
- Files: `client/src/components/dispatch/useDispatchPreviewMutations.ts`,
  `client/src/hooks/useTechnicianWorkingHours.ts`

**Item 6: Collapsible Unscheduled Panel**
- The unscheduled panel can now be collapsed to a slim 36px vertical tab with a count badge
  and vertical "Unscheduled" label. The timeline expands to fill the freed horizontal space.
  Search and scroll state are preserved across collapse/expand cycles.
- Files: `client/src/components/dispatch/DispatchUnscheduledPanel.tsx`

#### Dispatch Board Stabilization Pass — Duration, All-Day, Task Panel, Visual Cleanup (2026-03-08)

**Item 1: Fix Multi-Tech Visit 24h Duration Regression**
- Reschedule mutations now explicitly send `allDay: false` to prevent the server from
  interpreting cross-day moves as all-day events (which produced 24-hour durations).
- Files: `client/src/components/dispatch/useDispatchPreviewMutations.ts`

**Item 2: Fix Technician Off-Shift Mismatch**
- Added `refetchOnWindowFocus: "always"` to the working hours query so edits from
  the settings page are immediately reflected when switching back to dispatch.
- Files: `client/src/hooks/useTechnicianWorkingHours.ts`

**Item 3: Company Name Clickable in Detail Panel**
- The customer name in the visit detail panel is now a link to `/clients/:customerCompanyId`.
- Files: `client/src/components/dispatch/DispatchDetailPanel.tsx`

**Item 5: Reduce Visual Noise — Occupancy Rail**
- Occupancy rail reduced from 3px to 1px and only visible on lane hover to eliminate
  the appearance of extra borders/shadows under visit cards.
- Files: `client/src/components/dispatch/DispatchLaneRow.tsx`

**Item 6: Prominent Any-Time Visit Display**
- Any-time (all-day) visits now render as a full-width amber banner strip at the top
  of each lane instead of tiny pills at the top-right corner.
- Files: `client/src/components/dispatch/DispatchLaneRow.tsx`

**Item 7: 24-Hour Timeline Toggle**
- Added a "24h" toggle button in the dispatch board header (day view only).
- New `getTimelineConfig()` utility for dynamic timeline start/end/hours.
- Files: `client/src/components/dispatch/DispatchBoardHeader.tsx`,
  `client/src/components/dispatch/dispatchPreviewUtils.ts`,
  `client/src/pages/DispatchPreview.tsx`

**Item 8: Task Sidebar Actions**
- Task detail panel now includes Complete/Reopen and Delete actions matching the visit panel.
- Added `completeTask` (POST /close), `reopenTask` (POST /reopen), and `deleteTask` (DELETE)
  mutations to the dispatch mutation hook.
- Task title shows strikethrough and checkmark when completed/closed.
- Files: `client/src/components/dispatch/DispatchDetailPanel.tsx`,
  `client/src/components/dispatch/useDispatchPreviewMutations.ts`,
  `client/src/pages/DispatchPreview.tsx`

### Fixed

#### Fix A: Jobs Not Appearing on Client/Location Detail Pages After Creation (2026-03-08)
- **Root cause**: `invalidateScheduleQueries()` in `jobScheduling.ts` invalidated `["jobs"]`
  but NOT the client/company overview query keys (`["/api/clients", *, "overview"]` and
  `["/api/customer-companies", *, "overview"]`). The ClientDetailPage reads jobs via these
  overview endpoints, so newly created jobs didn't appear until manual refresh.
- **Fix**: Added `["/api/clients"]` and `["/api/customer-companies"]` family-wide invalidation
  to both `invalidateScheduleQueries()` and `QuickAddJobDialog.onSuccess`.
- Files: `client/src/lib/jobScheduling.ts`, `client/src/components/QuickAddJobDialog.tsx`

#### Fix B: Contact Entered During Add Location Not Saved (2026-03-08)
- **Root cause**: `createLocationUnderCustomerCompany` stored contact info as legacy fields
  on the location record (`contactName`/`email`/`phone` columns on `client_locations`), but
  never created a proper `client_contacts` row. The Contacts tab reads from `client_contacts`,
  so the contact appeared to be silently dropped.
- **Fix (v2 — atomic)**: Location + contact creation now wrapped in `db.transaction()` so
  both succeed or both roll back. Added `createLocationUnderCustomerCompanyTx()` and
  `createContactTx()` transaction-aware methods to their respective repositories. If no
  inline contact fields are present, location is created without a transaction (no overhead).
- Files: `server/routes/customer-companies.ts`, `server/storage/customerCompanies.ts`,
  `server/storage/clientContacts.ts`

#### Fix D: Job Cache Invalidation Gap on Update Path (2026-03-08)
- **Root cause**: `QuickAddJobDialog`'s update mutation `onSuccess` invalidated `["jobs"]`
  but not `["/api/clients"]` or `["/api/customer-companies"]` family queries. The create
  path had full coverage, but edits didn't refresh the client detail overview.
- **Fix**: Added `["/api/clients"]` and `["/api/customer-companies"]` family-wide
  invalidation to the update mutation's `onSuccess` handler.
- File: `client/src/components/QuickAddJobDialog.tsx`

#### Fix E: Redundant "Create Job" Button in Location Detail Panel (2026-03-08)
- **Root cause**: Two "Create Job" buttons existed on ClientDetailPage — one in the main
  header action bar (correct) and one inside the LocationDetailPane header (redundant).
- **Fix**: Removed the duplicate button, its `jobDialogOpen` state, and the second
  `<QuickAddJobDialog>` instance from LocationDetailPane. The top-level dialog remains
  and uses `selectedLocationId` for preselection.
- File: `client/src/pages/ClientDetailPage.tsx`

#### Fix C: Job Autocomplete Shows Duplicate Company Names for Multi-Location Customers (2026-03-08)
- **Root cause**: The autocomplete CommandItem primary label rendered only `location.companyName`.
  For customers with multiple locations, all results showed the same company name with location
  name hidden in a secondary line, making them visually indistinguishable.
- **Fix**: Primary label now shows `Company Name — Location Name` when location name exists
  and differs from company name. Secondary line shows address and city. Applied symmetrically
  to both QuickAddJobDialog and QuickCreateDrawer autocompletes.
- Files: `client/src/components/QuickAddJobDialog.tsx`, `client/src/components/QuickCreateDrawer.tsx`

#### BUG 1: Version Conflict During Rapid Chained Moves (2026-03-08)
- **Root cause**: When the same visit was moved rapidly between technicians, multiple
  mutations fired concurrently. Each called `freshVersion()` before the prior mutation's
  API response had updated the cache via `patchCachedVersion()`. Both mutations sent the
  same version N, but the server incremented to N+1 on the first, rejecting the second.
- **Fix**: Added per-visit mutation serialization (`chainForVisit`) — when multiple
  mutations target the same visitId, each waits for the prior to complete before resolving
  the version. Optimistic cache patching still runs immediately (outside the chain) for
  instant visual feedback. Only the API call + version resolution is serialized.
- **Also fixed**: Background invalidation starvation — added 5-second max delay to ensure
  cache reconciliation cannot be starved indefinitely during rapid chained moves.
- File: `client/src/components/dispatch/useDispatchPreviewMutations.ts`

#### BUG 2: Unscheduled Panel Drag Preview/Ghost Misalignment (2026-03-08)
- **Root cause**: dnd-kit positions the DragOverlay ghost at `elementOriginalPosition + delta`,
  preserving the grab-point-to-element-corner offset. For unscheduled cards (wide, in a sidebar
  far from the timeline), the offset between cursor and ghost was large, causing visible
  misalignment with the snap preview indicator in the lane.
- **Fix**: Capture the pointer-to-element-corner offset during `handleDragStart` and apply
  a compensating transform to the DragOverlay content. The ghost's top-left is now always at
  `(cursor - 10px, cursor - 10px)` regardless of where the card was grabbed.
- Files: `client/src/pages/DispatchPreview.tsx`

#### Dispatch Board Performance — Optimistic UX for Drag/Drop/Resize/Unschedule (2026-03-08)
- **Root cause**: All mutations awaited `invalidateDispatch()` (3 parallel refetches)
  before releasing the UI. This blocked the interaction for ~2.8–3.0s while refetches
  completed, causing the board to feel sluggish after the stale-version fix.
- **Fix**: Replaced blocking invalidation with optimistic cache patching:
  - On interaction commit, immediately patch the canonical visit in TanStack Query cache
    so the UI snaps to the new position/duration/lane without waiting for refetch
  - Snapshot dispatch cache before mutation for rollback on error
  - On API success: patch server-returned version into cache, fire background invalidation
    (non-blocking, debounced 150ms to batch rapid mutations)
  - On API error: restore cache snapshot, show error toast
- **Optimistic operations**: reschedule (position + lane), schedule (unscheduled → scheduled),
  unschedule (scheduled → backlog), resize (endAt + duration), task reschedule, delete
- **Preserved invariants**: fresh version resolution from cache, server-returned version
  patching, multi-tech mirrored rendering, overlap enforcement, off-shift confirmation
- File: `client/src/components/dispatch/useDispatchPreviewMutations.ts`

#### Subscription Entitlement Bug — Enterprise Plan Capped at 10 Locations (2026-03-08)
- **Root cause**: `subscription_plans` table was created but never seeded with plan data.
  When admin set `subscriptionPlan = "enterprise"`, no matching row was found, causing
  fallback to "trial" plan (limit=10). Enterprise tenants were incorrectly blocked.
- **Fix 1**: Added seed migration (`2026_03_08_seed_subscription_plans.sql`) with trial (10),
  starter (25), pro (100), enterprise (unlimited/999999) plan definitions using upsert.
- **Fix 2**: Added "unlimited" plan handling in `canAddLocation()` — plans with
  `locationLimit >= 999999` bypass the limit check entirely.
- **Fix 3**: Added cache invalidation in admin billing update route (`server/routes/admin.ts`).
  Previously, changing subscriptionPlan/status in admin did NOT invalidate the subscription
  cache (60s TTL), so stale plan data persisted after admin changes.
- Files: `server/storage/subscriptions.ts`, `server/routes/admin.ts`,
  `migrations/2026_03_08_seed_subscription_plans.sql`

#### Subscription Package Enforcement Audit — Feature Gates & UI Fix (2026-03-08)
- **Issue**: Premium features (invoices, route optimization, multi-tech, customer portal)
  had feature flags defined in schema but no middleware enforcement on API routes.
  Enterprise plan showed "999999" instead of "Unlimited" in UI limit displays.
- **Fix 1 — Invoices gate**: Added `requireFeature("invoicesEnabled")` to `server/routes/invoices.ts`
  (17 endpoints now gated)
- **Fix 2 — Route Optimization gate**: Added `requireFeature("routeOptimizationEnabled")` to
  `server/routes/routes.ts`
- **Fix 3 — Multi-tech gate**: Added `requireFeature("multiTechEnabled")` to the
  `/visit/:visitId/assign-crew` endpoint in `server/routes/scheduling.ts`
- **Fix 4 — Customer Portal gate**: Added `customerPortalEnabled` feature check in
  magic link request handler (`server/routes/portal.ts`)
- **Fix 5 — Unlimited display**: Fixed UI to show "Unlimited" instead of raw sentinel value
  (999999) in QuickCreateDrawer, NewAddClientDialog, and UserSubscriptionDialog
- Files: `server/routes/invoices.ts`, `server/routes/routes.ts`, `server/routes/scheduling.ts`,
  `server/routes/portal.ts`, `client/src/components/QuickCreateDrawer.tsx`,
  `client/src/components/NewAddClientDialog.tsx`, `client/src/components/UserSubscriptionDialog.tsx`

### Added

#### Live Map Feature Flag (2026-03-08)
- Added `liveMapEnabled` boolean to `tenant_features` table (default: true)
- Added `requireFeature("liveMapEnabled")` middleware to map router (`server/routes/map.ts`)
- Live Map can now be independently disabled per tenant to control map tile / GPS costs
- Route Optimization and Live Map are independent flags — can be toggled separately
- Migration: `migrations/2026_03_08_add_live_map_feature_flag.sql`
- Files: `shared/schema.ts`, `server/storage/tenantFeatures.ts`,
  `server/auth/requireFeature.ts`, `server/routes/map.ts`



#### Frontend Architectural Dependency Audit (2026-03-08)
- Full dependency audit of all frontend pages, components, hooks, and providers
- Report written to `AUDIT_DEPENDENCY_REPORT.md` covering 60+ files across 8 app sections
- Identified 4 critical cross-section dependencies, 3 warnings, 6 clean sections
- Key findings: global `/api/calendar/unscheduled` query on every page, cross-section
  invalidations in AddClientPage.tsx, triple-fetched company settings, uncontrolled polling
- Includes dependency matrix, recommended removals, and architecture principles

#### Backend Tenant Admin Dependency Audit (2026-03-08)
- Full backend audit of tenant admin, settings, and client-limit enforcement paths
- Report written to `AUDIT_BACKEND_TENANT_ADMIN.md`
- Traced complete request chains from route to SQL for all admin endpoints
- Confirmed client-limit enforcement is cleanly isolated (zero scheduling deps)
- Identified and catalogued all legacy `calendar_assignments` references

#### Frontend Architectural Cleanup — Cross-Domain Decoupling (2026-03-08)
- Removed global `/api/calendar/unscheduled` query from app shell (`App.tsx`) — was fetching
  dispatch data on every page load including settings, admin, and client pages
- Removed overdue alert UI block from app header (referenced removed calendar query)
- Removed cross-domain cache invalidations from `AddClientPage.tsx` — client CRUD no longer
  invalidates `/api/calendar`, `/api/reports/parts`, `/api/reports/schedule`,
  `/api/maintenance/recently-completed`, `/api/maintenance/statuses`
- Removed `/api/calendar` invalidation from `TimezoneSetupDialog.tsx` — timezone save
  only invalidates company-settings domain now
- Removed dead `/api/clients` query from `CompanySettingsPage.tsx` (fetched but never used)
- Added `staleTime: 30min` to `SubscriptionBanner.tsx` subscription usage query
- Added architecture boundary comments to high-risk files
- **Files:** `client/src/App.tsx`, `client/src/pages/AddClientPage.tsx`,
  `client/src/components/TimezoneSetupDialog.tsx`, `client/src/pages/CompanySettingsPage.tsx`,
  `client/src/components/SubscriptionBanner.tsx`

### Refactored

#### Tenant Admin decoupled from operational schema (2026-03-08)
- **Architecture change:** Tenant admin (`GET /api/admin/tenants`, `GET /api/admin/tenants/:id`)
  no longer depends on any operational tables (jobs, job_visits, tasks, calendar_assignments).
  This prevents operational schema refactors from breaking tenant administration.
- **Removed from tenant admin response:**
  - `jobs.openCount`, `jobs.onHoldCount`, `jobs.overdueCount` (operational)
  - `calendar.scheduledThisWeek` (operational — was the source of the `calendar_assignments` crash)
  - `users.activeTechnicians` (operational detail, not needed for account admin)
- **Kept in tenant admin response:**
  - `company` identity + subscription status (account)
  - `owner` contact info (support)
  - `users.total` + `users.lastLoginAt` (account management)
  - `qbo` integration health (admin/support concern)
- **Backend:** Rewrote `server/storage/admin.ts` — removed `jobs` import, removed all
  job/calendar queries from both `getTenantHealthList()` and `getTenantDetail()`.
  New types: `TenantAccountSummary`, `TenantAccountDetail` (replacing `TenantHealthSummary`).
  Batch query count reduced from 8 to 5.
- **Frontend:** Updated `AdminTenants.tsx` — removed Jobs column, "This Week" column,
  "Open Jobs" summary card. Replaced "With Issues" card with "QBO Issues" (account-scoped).
  Updated `AdminTenantDetail.tsx` — removed "Open Jobs" and "Scheduled This Week" metric
  cards. Replaced with "Subscription" status and "QBO Environment" cards.
- **Dead code cleanup:** Removed `calendarAssignmentId` from unused `jobCreateSchema`
  (`server/schemas.ts`), removed stale test assertions (`tests/job-lifecycle.test.ts`),
  deleted orphaned `server/storage/clients.ts.backup`.
- **Files:** `server/storage/admin.ts`, `server/routes/admin.ts`, `server/schemas.ts`,
  `client/src/pages/AdminTenants.tsx`, `client/src/pages/AdminTenantDetail.tsx`,
  `tests/job-lifecycle.test.ts`

### Fixed


#### Dispatch Board — Stale version / identity causing reschedule and crew update failures (2026-03-08)
- **Bug 1:** Repeated reschedule fails with "Scheduling was modified by another user.
  Expected version X, Actual version Y" — optimistic concurrency version mismatch.
- **Bug 2:** Create visit → assign multi techs → unschedule → reschedule → edit crew
  fails with "Not found" — stale visitId/version after refetch gap.
- **Root cause:** All mutation call sites passed `version` from component state/props
  (e.g., `visit.version`, `dragData.version`). After a successful mutation,
  `invalidateDispatch()` was fire-and-forget (not awaited), so the query cache refetch
  hadn't completed by the time the user initiated the next action. The version from
  the previous render was stale by +1 (or more).
- **Fix (3 parts):**
  1. **Version resolved from cache** (`resolveVisitFromCache`): Before every
     version-sensitive API call, the mutation reads the freshest version from the
     TanStack Query cache (checking both scheduled and unscheduled data).
  2. **Cache patched from response** (`patchCachedVersion`): After a successful
     mutation, the server-returned version is immediately written into the cached
     event/job objects — so subsequent mutations (before refetch completes) use the
     correct version.
  3. **Invalidation awaited**: `invalidateDispatch()` now `await`s all three
     invalidation promises so the cache is fully refreshed before the mutation returns.
- **Caller changes:** Removed `version` from all mutation param interfaces.
  `DispatchPreview.tsx` no longer passes `visit.version` or `dragData.version` to
  any mutation. The scheduling model, multi-tech mirroring, off-shift confirmation,
  and overlap enforcement are all unchanged.
- **Debug logging:** Added `[DISPATCH]` console logs for version resolution
  (cached vs caller vs resolved) on reschedule and crew update attempts.
- **Files:**
  - `client/src/components/dispatch/useDispatchPreviewMutations.ts` — core fix
  - `client/src/pages/DispatchPreview.tsx` — removed stale version passing

#### Technician Routes — Map markers missing due to ungeooded client locations (2026-03-08)
- **Bug:** Visit markers and route lines not rendering on the Technician Routes map.
  Panel rows showed "No coords" badges for all visits, even those with street addresses.
- **Root cause:** All 36 `client_locations` records had `lat=NULL, lng=NULL`. The
  address fields (street, city, province) were populated, but geocoding was never
  called on the create/update write paths. The SQL joins and frontend parsing were
  correct — the coordinates were genuinely absent in the database.
- **Fix (3 parts):**
  1. **Geocoding utility** (`server/utils/geocode.ts`): New `geocodeToLatLng()` and
     `maybeGeocode()` helpers using OpenRouteService forward geocoding.
  2. **Auto-geocode on save**: Wired into `clientRepository.createClient()`,
     `clientRepository.updateClient()`, `customerCompanyRepository.createLocationUnderCustomerCompany()`,
     and `bulkCreateClients()` allowlist (was missing `lat`/`lng`).
  3. **Backfill**: Geocoded all 34 existing locations with addresses. All resolved
     successfully. 2 locations with no address remain without coords (expected).
  4. **Backfill endpoint** (`POST /api/map/geocode-backfill`): Admin-triggered endpoint
     for future use if new locations are imported without coords.
- **Files:**
  - `server/utils/geocode.ts` (new)
  - `server/storage/clients.ts` — added `maybeGeocode` to create/update paths, `lat`/`lng` to bulk allowlist
  - `server/storage/customerCompanies.ts` — added geocoding to `createLocationUnderCustomerCompany()`
  - `server/routes/map.ts` — added `POST /geocode-backfill` endpoint
- **Data:** 34/36 locations now have coordinates. 10/10 active visits have map-renderable coords.

#### Technician Routes — Map data wiring regression (500 error from /api/map/day) (2026-03-08)
- **Bug:** Technician Routes screen showed "0 techs · 0 online · 0 visits" with no
  markers or panel data. The header, filter dropdown, and panel were all empty.
- **Root cause:** Two SQL bugs in `server/routes/map.ts`:
  1. **`ANY()` array parameter:** `jv.status = ANY(${ACTIVE_VISIT_STATUSES})` — Drizzle's
     `sql` template tag passes JavaScript arrays as scalar parameters, not PostgreSQL arrays.
     PostgreSQL rejects this with "op ANY/ALL (array) requires array on right side".
  2. **Non-existent column:** `j.assigned_technician_user_id` doesn't exist in the `jobs`
     table. The actual columns are `primary_technician_id` and `assigned_technician_ids`.
- **Fix:**
  1. Replaced `ANY(${array})` with `IN (${sql.join(...)})` using Drizzle's `sql.join` helper.
  2. Changed `j.assigned_technician_user_id` to `COALESCE(j.primary_technician_id, j.assigned_technician_ids[1])`.
- **Impact:** The endpoint returned 500, which TanStack Query caught silently (data stayed
  undefined). Added error badge and console logging to `LiveMapPage.tsx` for future visibility.
- **Files:** `server/routes/map.ts`, `client/src/pages/LiveMapPage.tsx`

#### Create Job Modal — Broken time dropdown replaced with native time input (2026-03-08)
- **Bug:** Time dropdown in QuickAddJobDialog showed duplicate/misordered entries.
  On DST transition days (e.g., spring-forward March 8), `setHours(new Date(), 2)`
  produces 3:00 AM because 2:00 AM doesn't exist in the client's local timezone.
  Radix Select also has rendering quirks with 96-item lists (scroll jumps, focus issues).
- **Root cause:** `generateTimeOptions()` used `date-fns` `setHours`/`setMinutes` on
  `new Date()` to format labels. This is timezone-sensitive — on DST days, certain
  hours map to the same wall-clock time, producing duplicate display labels.
  Additionally, Radix Select struggles with 96+ items.
- **Fix:** Replaced the 96-item Select dropdown with a native `<input type="time">`
  (step=900 for 15-min increments). Added a separate "All day" Checkbox inline.
  Removed `generateTimeOptions()` and `TIME_OPTIONS` from QuickAddJobDialog entirely.
- **Duration:** Kept as a Select dropdown (only 9 items, no rendering issues).
- **Known:** `JobScheduleFields.tsx` (shared component used by ScheduleJobModal)
  still has the same `generateTimeOptions()` — noted for future fix but out of scope.
- **File:** `QuickAddJobDialog.tsx`

#### Dispatch Panel — Crew picker / date picker clicks closing the visit panel (2026-03-08)
- **Bug:** Clicking inside the crew picker popover (search input, technician rows,
  checkboxes) or any Radix portal (date picker, duration select, time select)
  closed the entire visit detail panel immediately.
- **Root cause:** The outside-click handler (`handleOutsideClick` in DispatchPreview.tsx)
  checked `panelRef.current.contains(target)`, but Radix popovers and selects render
  in portals outside the panel DOM tree, so clicks inside them appeared "outside."
- **Fix:** Added three portal-aware guards to the outside-click handler:
  - `[data-radix-popper-content-wrapper]` — covers Popover, Calendar, and other
    popper-based portals
  - `[data-radix-select-viewport]` — covers Select dropdown portals
  - `[role='listbox']` — fallback for any listbox-style dropdown
- **File:** `DispatchPreview.tsx` (3 lines added to `handleOutsideClick`)

### Improved

#### Dispatch Detail Panel — Hierarchy Restructure & Functional Editing (2026-03-08)
Rebuilt the visit detail panel for cleaner hierarchy, compact layout, and
functional inline editing of crew, date, time, and duration.

**Goal 1 — Client-first header hierarchy:**
- Primary title is now the customer/site name (was "Visit #N")
- Visit summary/description appears directly below the title
- Job number shown as a clickable blue link near the header (navigates to job)
- Visit number shown as small metadata beside job link
- Team badge (multi-tech indicator) inline with job/visit metadata
- Removed bottom "Open Job" button (replaced by header job link)
  - File: `DispatchDetailPanel.tsx`

**Goal 2 — Compact status section:**
- Status badge row is now a simple flex row with bottom border (no Section wrapper)
- Job type shown inline as small muted text beside status badge
- Priority badge still shown when non-normal
- Completed styling preserved (CheckCircle2 icon in badge)
  - File: `DispatchDetailPanel.tsx`

**Goal 3 — Searchable multi-select crew picker:**
- Added search input at top of crew popover
- Changed to checkbox-based multi-select (Checkbox component for visual clarity)
- Popover stays open during multi-select (no auto-close on selection)
- Closes only on outside click (standard Popover behavior)
- Min-1-tech rule still enforced (last tech disabled + cursor-not-allowed)
- Off-shift styling preserved (muted text, "off" label)
- Assigned techs highlighted with blue background + checked checkbox
- Scales to large rosters via search filtering + 240px max scroll
- Collapsed state still shows "Name, Name" or "Name +N" summary
  - File: `DispatchDetailPanel.tsx`

**Goal 4 — Inline date editing:**
- Date is now a clickable text that opens a Calendar popover
- Date change calls the same `onReschedule` mutation path as time/tech changes
- Preserves original time-of-day, duration, and technician assignment
- Multi-tech visits still behave as one shared visit (no separate mutation)
  - File: `DispatchDetailPanel.tsx`

**Goal 5 — Panel section order:**
1. Client name (title) → 2. Summary → 3. Job link + visit # + team badge
4. Status + priority + job type (compact row)
5. Crew (searchable picker) → 6. Schedule (date, time, duration)
7. Location → 8. Contact → 9. Notes → 10. Actions (footer)

**Goal 6 — Compactness:**
- Reduced Section padding (pb-2.5 → pb-2, mb-2.5 → mb-2)
- Reduced InfoRow vertical padding (py-1 → py-0.5)
- Reduced content area padding (py-3 → py-2)
- Duration row uses invisible icon spacer for alignment (no duplicate Clock icon)
- Removed jobType from Location section (moved to status row)
- Unused imports cleaned up (User, Briefcase, Button, Check, UserCheck, parseISO)

**Preserved:**
- All visit-level actions (complete/reopen, delete with confirmation, unschedule)
- Completed visit header styling (line-through, CheckCircle2, muted bg)
- Off-shift confirmation flow (handled by parent DispatchPreview.tsx — unchanged)
- TaskDetail component (unchanged structure, matching compactness tweaks)
- All existing props interface (no breaking changes to parent consumers)

**Files changed:** `DispatchDetailPanel.tsx`

#### Create New Job Modal — Compact Redesign (2026-03-08)
Rebuilt the quick-create job modal for speed, compactness, and scale.
Modal no longer requires body scrollbar on standard desktop viewports.

**Layout flattened:**
- Removed bordered "Scheduling" panel container (`border rounded-lg p-4 bg-muted/20`)
- Reduced modal width from `max-w-2xl` to `max-w-xl`
- Removed `max-h-[90vh] overflow-y-auto` from modal body (no longer needed)
- Reduced vertical spacing from `space-y-4` to `space-y-3`
- All labels use `text-xs font-medium` for density
- Description textarea reduced from 3 rows to 2, with `resize-none`
- Footer buttons use `size="sm"` for compactness

**Scheduling controls inlined:**
- Replaced stacked `JobScheduleFields` component with compact inline row
- Date, Time, Duration, and Technicians all in one flex-wrap row
- "Unscheduled (backlog)" checkbox inline with "Schedule" label
- When unscheduled is checked, scheduling row grays out with `pointer-events-none`
- Duration select hidden for all-day events (saves space)
- Duration labels shortened ("1 hour" → "1h", "30 min" → "30m")

**Technician picker — searchable multi-select popover:**
- Replaced inline chips + "Add" button with a single popover trigger
- Closed state: compact button showing "Unassigned" / "Name" / "Name +N"
- Open state: search input at top + scrollable checkbox list (max 240px)
- Checkbox-based multi-select (toggle on/off, no add/remove buttons)
- "Clear all" footer when selections exist
- Scales cleanly to 200+ technicians via search + scroll
- Never expands modal height regardless of team size
  - File: `QuickAddJobDialog.tsx` (new `TechnicianMultiSelect` component)

**Location dropdown improved:**
- Popover width matches trigger width (`w-[--radix-popover-trigger-width]`)
- Location items show secondary context (address/location subtext)
- Search value includes address for better filtering
- Trigger height reduced to `h-9`

**Preserved:**
- All validation logic (location required, summary required, date required when scheduled)
- Create vs Edit mode behavior
- Quick-create client flow within location popover
- `createJobWithSchedule` / `applyJobSchedule` integration
- Activity logging and query invalidation
- All `data-testid` attributes for testing

**Files changed:** `QuickAddJobDialog.tsx`
**No changes to:** `JobScheduleFields.tsx` (still used by other consumers)

#### Technician Routes Screen (2026-03-08)
Transformed the Live Map into a Technician Routes visualization surface with
route lines, numbered markers, and structured panel layout.

**Right panel restructured — "Technician Routes":**
- Panel title changed from "Dispatch" to "Technician Routes"
- Unscheduled Visits section at top (amber styling, collapsible, max 200px scroll)
- Scheduled Routes by technician below, sorted by schedule time
- Focused technician sorts to top of tech list
- Completed visits shown with muted styling + "Done" badge + line-through
- Duration display added to visit stop rows
  - Files: `LiveMapPage.tsx`

**Route line rendering (focused technician):**
- Dashed Polyline connects focused tech's visit stops in schedule order
- Route starts from tech's live GPS position when available
- Uses tech's assigned color with 60% opacity
- Only rendered when a technician is focused (click tech header or map marker)
  - Files: `LiveMapPage.tsx`

**Enhanced map markers for focused technician:**
- Focused tech's marker enlarged (radius 12 vs 10, weight 3 vs 2)
- Focused tech's visit markers enlarged (radius 10 vs 7, thicker stroke)
- Permanent tooltips shown for focused tech's visits (numbered stop labels always visible)
- Completed visit markers shown with gray fill + reduced opacity
- Click tech marker on map to focus/unfocus (same as panel header click)
- Click visit marker to fly-to at zoom 17
  - Files: `LiveMapPage.tsx`

**Unscheduled visits data:**
- Separate fetch from `/api/calendar/unscheduled` (not mixed into map endpoint)
- Mapped to lightweight `MapUnscheduledJob` type for map context
- Shows job number, type, location, customer company name
- 60s stale time (less frequent than scheduled data)
  - Files: `LiveMapPage.tsx`, `shared/types/map.ts`

**Shared types:**
- Added `MapUnscheduledJob` interface to `shared/types/map.ts`

### Improved

#### Dispatch Board — Visit Status Clarity & Visit-Centric Panel (2026-03-08)
Completed visits now look completed, crew picker is compact, and the detail panel
is visit-centric with visit-level actions.

**Goal 1 — Completed visit visual treatment:**
- Day view: completed blocks get reduced opacity (55%), line-through on customer name, CheckCircle2 icon, muted status colors
- Week view: completed items get reduced opacity (55%), line-through text, check icon replaces status dot
- Both narrow and wide day-view block variants show completed treatment
- Multi-tech completed visits retain completed styling on all mirrored copies
  - Files: `DispatchVisitBlock.tsx`, `WeekDispatchCell.tsx`, `dispatchPreviewUtils.ts`

**Goal 2 — Compact crew picker:**
- Replaced always-expanded technician list with popover-based multi-select (CrewPicker component)
- Collapsed state: compact button showing assigned tech names/count + chevron
- Open state: scrollable checklist in popover with off-shift styling, min-1-tech rule
- Panel height no longer explodes with many technicians
  - File: `DispatchDetailPanel.tsx`

**Goal 3 — Visit-centric detail panel:**
- Panel header changed from "#{jobNumber}" to "Visit #{visitNumber} — Job #{jobNumber}"
- Completed visits show CheckCircle2 + line-through in header
- Visit-level actions added to footer:
  - "Complete Visit" button (transitions active → completed)
  - "Reopen Visit" button (transitions completed → scheduled, guarded by backend)
  - "Delete Visit" button with confirmation (soft-delete, hidden for visit #1)
  - "Unschedule Visit" renamed from "Unschedule" (hidden when completed)
- "Open Job" demoted to secondary navigation (muted styling, bottom of footer)
  - Files: `DispatchDetailPanel.tsx`, `DispatchPreview.tsx`

**Goal 4 — Honest status actions:**
- Complete: calls `POST /api/jobs/:jobId/visits/:visitId/status` with `status: "completed"`
- Reopen: calls same endpoint with `status: "scheduled"` — backend rejects if parent job is in terminal status (409)
- Delete: calls `DELETE /api/jobs/:jobId/visits/:visitId` — backend guards against deleting placeholder visit #1
- All mutations use existing `apiRequest` + refetch-on-success pattern (no optimistic updates)
  - File: `useDispatchPreviewMutations.ts`

**Goal 5 — Consistency verification:**
- Completed styling consistent across day view, week view, and detail panel
- Available actions change appropriately: complete shown when active, reopen when completed
- Delete hidden for visit #1 (placeholder), unschedule hidden when completed
- Multi-tech team badge + selection logic unaffected

**Files changed:**
- `client/src/components/dispatch/dispatchPreviewUtils.ts` — added `isCompletedStatus()` helper
- `client/src/components/dispatch/DispatchVisitBlock.tsx` — completed visit visual treatment in day view
- `client/src/components/dispatch/WeekDispatchCell.tsx` — completed visit visual treatment in week view
- `client/src/components/dispatch/DispatchDetailPanel.tsx` — compact crew picker, visit-centric actions, completed header styling
- `client/src/components/dispatch/useDispatchPreviewMutations.ts` — added `updateVisitStatus()` and `deleteVisit()` mutations
- `client/src/pages/DispatchPreview.tsx` — wired new handlers to panel props

#### Phase 2 Map Convergence — Narrow Map to Visualization Surface (2026-03-08)
Refactored the Live Map endpoint so it no longer acts as a parallel scheduling/eligibility engine.
The map is now purely a route-visualization surface; dispatch remains the assignment authority.

**Technician eligibility filter removed from map (Part 3):**
- Removed `is_schedulable = true` filter from map technician query
- Map now returns all active, non-deleted company users as a display roster
- Technicians with assigned visits are always visible on the map regardless of schedulability flag
- `disabled = false` and `deleted_at IS NULL` kept as basic data-integrity guards
- Dispatch board retains `filterSchedulableTechnicians()` as the assignment authority
  - File: `server/routes/map.ts`

**Shared map types updated (Part 5):**
- `MapTechnician` documented as a DISPLAY roster model, not a scheduling-authority model
- `isSchedulable` field intentionally excluded from MapTechnician type
  - File: `shared/types/map.ts`

**Diagnostic messaging updated:**
- Map empty-state message changed from "No schedulable technicians" to "No active technicians"
  - File: `client/src/pages/LiveMapPage.tsx`

**Responsibilities narrowed:**
- Map endpoint response: explicit `technicianId/name/lat/lng/online/lastSeenAt` shape (stripped internal fields)
- Map endpoint doc comment clarifies: "display model, not scheduling authority"
- No changes to visit query, job fallback, risk flags, or GPS overlay logic

**Files changed:**
- `server/routes/map.ts` — removed is_schedulable filter, added display roster documentation
- `shared/types/map.ts` — documented MapTechnician as display roster model
- `client/src/pages/LiveMapPage.tsx` — updated empty-state diagnostic text

#### Phase 1 Live Map / Dispatch Convergence Refactor (2026-03-08)
Refactored the Live Map foundation to share canonical scheduling logic with the dispatch board,
eliminating parallel business logic for colors, timezone, and types.

**Shared color palette (Part 4):**
- Created `shared/colors.ts` with unified `TECHNICIAN_COLORS` (10 colors) and `getTechnicianColor()` helper
- Dispatch mappers (`dispatchPreviewMappers.ts`) now import from shared palette instead of local `DEFAULT_COLORS` (was 8 colors)
- LiveMapPage now imports from shared palette instead of local `TECH_COLORS` (was 10 different colors)
- Both views now render identical colors for the same technician roster index

**Shared map types (Part 3):**
- Extracted `MapTechnician`, `MapVisit`, `MapDayMeta`, `MapDayData` to `shared/types/map.ts`
- LiveMapPage imports from shared types (removed ~30 lines of inline type definitions)

**Map endpoint convergence (Part 2):**
- `server/routes/map.ts` now uses `companyRepository.getCompanyTimezone()` (shared with scheduling routes)
- Removed parallel `getTenantTimezone()` function and `companySettings` import
- Removed unused `eq` import from drizzle-orm

**Real-time symmetry (Part 6):**
- `useDispatchStream.ts` now invalidates `/api/map/day` queries on dispatch signals
- Live map receives real-time schedule updates via the same SSE stream as the dispatch board
- Map no longer relies solely on 15-second polling for schedule freshness

**Files changed:**
- `shared/colors.ts` (new) — unified technician color palette
- `shared/types/map.ts` (new) — shared map API types
- `server/routes/map.ts` — timezone convergence, removed parallel logic
- `client/src/pages/LiveMapPage.tsx` — shared types + colors, removed inline definitions
- `client/src/components/dispatch/dispatchPreviewMappers.ts` — shared color palette
- `client/src/hooks/useDispatchStream.ts` — map query invalidation on SSE signals

#### Dispatch Board — Final Week/Crew UX Polish (2026-03-08)
Targeted polish pass for week-view drag/drop, off-shift confirmation, crew editing, and layout consistency.

**Week view DnD polish:**
- Added `data-dispatch-block` attribute to week visit/task items — fixes outside-click handler race condition where mousedown would close panel before click could select item
- Increased empty cell drop target height (`min-h-[24px]` → `min-h-[36px]`) for easier drop targeting
- Added `transition-colors` to cell hover state for smoother drop feedback
- Normalized team badge sizing to match day view (`px-0.5` → `px-1 py-px gap-0.5`)
  - File: `WeekDispatchCell.tsx`

**Off-shift confirmation wording:**
- Pluralized title/description when multiple off-shift techs are involved ("technicians" / "are")
- Changed "assign this visit" → "proceed" to correctly cover both visits and tasks
- Added bold styling to technician names for readability
- Passed `count` in confirmation state for plural grammar
  - File: `DispatchPreview.tsx`

**Crew editing ergonomics:**
- Off-shift technicians now visually distinguished in crew picker: grayed text, faded avatar, "OFF" label
- Increased row padding (`py-1` → `py-1.5`) for better touch targets
- Increased scroll area height (`max-h-40` → `max-h-44`) for longer tech lists
  - File: `DispatchDetailPanel.tsx`

### Improved

#### Dispatch Board — Multi-Tech Visit UX Integrity & Shared-Visit Clarity (2026-03-08)
Surgical pass on mirrored selection state, team-visit clarity, and selection persistence for multi-tech visits.

**Mirrored selection state (Goal 1):**
- Verified: clicking any mirrored copy of a multi-tech visit highlights ALL copies in day and week views
- Selection uses canonical `visit.id`, not per-lane composite DnD IDs — already correct across all components
- Detail panel opens once for the shared visit regardless of which copy is clicked
  - Verified in: `DispatchLaneRow.tsx`, `WeekDispatchCell.tsx`, `DispatchUnscheduledPanel.tsx`

**Team-visit move/resize clarity (Goal 2):**
- Added Users icon + count badge to detail panel header for multi-tech visits
- Added helper text below crew list: "Schedule changes apply to all N assigned technicians."
- Added Users icon to Crew section title for visual consistency
  - File: `DispatchDetailPanel.tsx`

**Selection persistence after mutation (Goal 3):**
- Debounced selection-clear effect (1.5s grace period) to survive transient refetch gaps
- Prevents premature panel dismissal during crew change / reschedule mutations
- Selection re-resolves automatically when fresh data arrives within the grace window
  - File: `DispatchPreview.tsx`

**Mirrored copy behavior audit (Goal 4):**
- Verified: drag/resize/unschedule any copy affects shared visit (all copies update on refetch)
- Verified: crew removal removes mirrored rendering from that tech's lane only
- Verified: crew addition adds mirrored rendering in the new tech's lane/cell
- Verified: composite DnD IDs prevent collisions, canonical visit.id drives mutations

**Week/day parity (Goal 5):**
- Same team badge (Users icon + count) in both views
- Same selection logic (visit.id match) in both views
- Same detail panel behavior regardless of entry view
- Same off-shift handling in both views

### Added

#### Dispatch Board — Multi-Tech Visits, Week View DnD, Crew Assignment (2026-03-08)
Six-goal dispatch board enhancement: multi-tech visit rendering, crew assignment UI, week view drag/drop, off-shift confirmation everywhere, team badges, and data integrity.

**GOAL 1 — Multi-tech visit model (mirrored lane rendering):**
- Visits with multiple assigned technicians now render as mirrored copies in each tech's lane (day and week views)
- One canonical visit, multiple render placements — no duplicate records
- Dragging/resizing/unscheduling any copy edits the shared visit
- Dragging a multi-tech visit does NOT change the tech roster (moves schedule only)
- Composite DnD IDs (`scheduled-${visitId}--${laneTechId}`) prevent dnd-kit collisions
  - Files: `DispatchVisitBlock.tsx`, `DispatchLaneRow.tsx`, `useDispatchWeekData.ts`, `DispatchPreview.tsx`

**GOAL 2 — Detail panel multi-tech crew assignment:**
- Replaced single-tech dropdown with multi-select crew assignment UI
- Shows all schedulable technicians with checkboxes, avatars, and check marks
- Add/remove techs from crew with real-time `PATCH /api/calendar/visit/:visitId/assign-crew`
- Tasks remain single-tech assignment
  - Files: `DispatchDetailPanel.tsx`, `useDispatchPreviewMutations.ts`

**GOAL 3 — Week view drag and drop:**
- Full drag/drop support in week view: visits and tasks between days, between techs, to unscheduled
- Cell-based drop targets with `dayKey` (yyyy-MM-dd) in drop data
- Preserves original time-of-day when moving between days (`originalStart` in drag data)
- Multi-tech visit drag moves all mirrored copies together
  - Files: `WeekDispatchCell.tsx`, `WeekDispatchGrid.tsx`, `dispatchDndTypes.ts`, `DispatchPreview.tsx`

**GOAL 4 — Off-shift confirmation across all entry points:**
- Off-shift confirmation now applies to: day-view DnD, week-view DnD, unscheduled→lane, unscheduled→week cell, detail panel crew changes, multi-tech crew additions
- Uses `isTechWorkingOnDate()` for week view (per-day check) and `isTechWorkingInRange()` for day view
  - File: `DispatchPreview.tsx`

**GOAL 5 — Visual team badge:**
- Multi-tech visits show subtle team badge (Users icon + count) in both day and week views
- Blue pill badge: `bg-blue-100 text-blue-700`
  - Files: `DispatchVisitBlock.tsx`, `WeekDispatchCell.tsx`

**GOAL 6 — Data integrity:**
- `technicianIds: string[]` added to `DispatchVisit` type for canonical multi-tech tracking
- Mappers populate from `assignedTechnicianIds` API field with single-tech fallback
- Selection follows shared visit ID across all mirrored copies
  - Files: `dispatchPreviewTypes.ts`, `dispatchPreviewMappers.ts`, `dispatchPreviewMockData.ts`

**New backend endpoint:**
- `PATCH /api/calendar/visit/:visitId/assign-crew` — Updates visit crew roster with full `technicianUserIds[]` array. Version-checked, logged, SSE-emitted.
  - Files: `server/routes/scheduling.ts`, `server/storage/scheduling.ts`

### Removed

#### Preview Client Workspace Cleanup (2026-03-08)
Removed preview/prototype client workspace now that real Client Workspace is live at `/clients/:clientId`.

**Deleted files:**
- `client/src/pages/PreviewClientWorkspaceSplit.tsx` — Preview split-view client workspace page
- `client/src/pages/PreviewClientWorkspace.tsx` — Earlier preview client workspace (already dead code, no route)
- `client/src/components/CommandPalette.tsx` — Preview-only command palette (all routes pointed to deleted preview page)

**Cleaned up:**
- Removed `/preview/client-workspace-split` route from `client/src/App.tsx`
- Removed CommandPalette state, Ctrl+K keyboard handler, and rendering from `client/src/App.tsx`
- Removed CommandPalette search trigger button (preview-route conditional) from header
- Removed "Client Workspace (Split)" sidebar nav item from `client/src/components/AppSidebar.tsx`
- Removed unused imports: `PreviewClientWorkspaceSplit`, `CommandPalette`, `useEffect`, `Search` icon, `Columns` icon

**Kept:** `client/src/pages/previewClientWorkspaceMockData.ts` — still used by `PreviewOperationsQueue` and its mock data.

### Added

#### Dispatch Board — Technician Working-Hours Grouping & Week View Cleanup (2026-03-08)
Surgical dispatch board refinement: on-shift/off-shift technician grouping with confirmation prompt, and week-view clutter removal.

**New API endpoint:**
- `GET /api/team/technicians/working-hours` — Bulk working hours for all schedulable technicians. Returns per-technician schedule (custom or company-default fallback). Used by dispatch board for on-shift/off-shift grouping.
  - File: `server/routes/team.ts`

**New hook:**
- `useTechnicianWorkingHours()` — Fetches bulk working hours, returns `TechScheduleMap` lookup. Includes helpers `isTechWorkingOnDate()` and `isTechWorkingInRange()`.
  - File: `client/src/hooks/useTechnicianWorkingHours.ts`

**Technician presentation cleanup (Day + Week views):**
- Removed green "Available" status text under technician names in both day and week views
- Removed per-lane operational summary (hours, visit/task counts) from day view sidebar
- Technician names now centered cleanly in row/header area
- Technicians split into Working (on-shift) and Off-shift groups with subtle divider
- Off-shift technicians appear below divider with grayed-out name styling and faded avatars
- Off-shift technicians remain visible and droppable
  - Files: `client/src/components/dispatch/DispatchTechnicianSidebar.tsx`, `client/src/components/dispatch/WeekDispatchGrid.tsx`, `client/src/components/dispatch/DispatchTimeline.tsx`

**Off-shift assignment confirmation:**
- Dragging or reassigning a visit/task to an off-shift technician shows confirmation dialog before committing mutation
- Applies to: drag-drop scheduling, drag-drop rescheduling, detail panel technician reassignment
- Cancel aborts mutation; confirm proceeds with normal mutation path
  - File: `client/src/pages/DispatchPreview.tsx`

**Week view cleanup:**
- Removed daily summary cue bar ("2h 2v" style labels) from week cells
- Kept actual scheduled items visible for density/readability
  - File: `client/src/components/dispatch/WeekDispatchCell.tsx`

**Type change:**
- Added `isWorking?: boolean` to `Technician` type for on-shift/off-shift determination
  - File: `client/src/components/dispatch/dispatchPreviewTypes.ts`

### Changed

#### Calendar-Named Infrastructure Renamed to Scheduling (2026-03-07)
Second-pass ownership cleanup: all preserved calendar-named modules renamed to reflect their actual role as canonical scheduling infrastructure. No behavior changes — pure rename pass.

**Frontend renames:**
- `useCalendarApi.ts` → `useSchedulingApi.ts` — canonical scheduling API hooks (4 consumer imports updated)
- `calendarDiagnostics.ts` → `schedulingDiagnostics.ts` — mutation diagnostics store (queryClient.ts import updated)
- `shared/types/calendar.ts` → `shared/types/scheduling.ts` — canonical scheduling DTOs (3 dispatch imports + 1 server import updated)

**Backend renames (file only — `/api/calendar` URL intentionally kept stable):**
- `server/routes/calendar.ts` → `server/routes/scheduling.ts` (routes/index.ts import updated)
- `server/storage/calendar.ts` → `server/storage/scheduling.ts` (storage/index.ts import updated)
- `CalendarRepository` class → `SchedulingRepository`
- `calendarRepository` export → `schedulingRepository` (all route + test consumers updated)
- `CalendarJobWithDetails` type → `ScheduledJobWithDetails`

**Intentionally kept:**
- `/api/calendar` URL — ~50+ client-side references; URL is the scheduling API contract, not legacy UI
- `DEFAULT_CALENDAR_START_HOUR` / `DEFAULT_CALENDAR_END_HOUR` — match `calendarStartHour` schema column
- `CalendarEventDto`, `CalendarRangeResponseDto`, `UnscheduledJobDto` type names — canonical DTO contracts used across full stack

### Removed

#### Legacy Calendar UI Decommissioned (2026-03-07)
- **Deleted legacy calendar page**: `client/src/pages/Calendar.tsx` — the old scheduling surface is fully removed.
- **Deleted all legacy calendar components** (22 files): `client/src/components/calendar/` directory removed entirely. Includes CalendarGridDay, CalendarGridWeek, CalendarGridMonth, CalendarSidebar, CalendarHeader, CalendarEventChip, JobCard, ResizableJobCard, DraggableClient, ScheduleJobModal, QuickCreateSlotDialog, SuggestSlotDialog, DiagnosticsPanel, DispatchDetailPanel, TechLaneHeader, TechnicianFilterPopover, calendarUtils, calendarErrorHandler, calendarClientLookup, CalendarGridDayRows, CalendarGridDayJobber, index.
- **Deleted legacy calendar hooks** (4 files): `useCalendarState.ts`, `useCalendarDnD.ts`, `useCalendarTasks.ts`, `useCalendarDaySummary.ts`.
- **Removed `/calendar-legacy` route** from `App.tsx` and Calendar import.
- **Removed "Calendar (Legacy)" nav entry** from `AppSidebar.tsx`. Renamed sidebar section from "Preview / Legacy" to "Preview".
- **Preserved**: `useCalendarApi.ts` (used by dispatch board), `calendarDiagnostics.ts` (used by `queryClient.ts` mutation logging), `shared/types/calendar.ts` (canonical DTOs), `server/routes/calendar.ts`, `server/storage/calendar.ts` — all still in active use.
- **Canonical scheduling UI**: `/dispatch` (DispatchPreview) is now the only scheduling surface. `/calendar` continues to alias to `/dispatch`.

### Added

#### Dispatch Board — Readability, Lane Awareness & Scan Speed (2026-03-07)

**Goal 1 — Lane Header Operational Summary**
- Technician sidebar now shows per-lane stats: total scheduled hours, visit count, task count, and outside-window indicator count. Reuses existing `countItemsBefore`/`countItemsAfter` helpers — no duplicate computation. (`DispatchTechnicianSidebar.tsx`, `DispatchPreview.tsx`)

**Goal 2 — Stronger Selected / Active / Current-Time Readability**
- Selected visit blocks: upgraded from `ring-2 z-10` to `ring-2 ring-offset-1 shadow-md z-20` for immediate visibility on busy boards. (`DispatchVisitBlock.tsx`)
- Selected task blocks: same ring-offset + shadow treatment with violet theme. (`DispatchTaskBlock.tsx`)
- NowLine (current-time indicator): widened from 1px to 2px stroke, enlarged dot with shadow, added subtle red glow band for scanability. (`DispatchTimeline.tsx`)
- Lane boundaries: border upgraded from `border-slate-100` dashed to `border-slate-200/80` solid for cleaner separation. Alternating hour columns get subtle `bg-slate-50/40` fill for half-day rhythm. (`DispatchLaneRow.tsx`)

**Goal 3 — Free-Gap / Occupancy Clarity**
- Added 3px occupancy rail at the bottom of each lane row showing occupied (blue for visits, violet for tasks) vs free periods. Computed via lightweight `useMemo` over existing position helpers — no new data fetching. (`DispatchLaneRow.tsx`)

**Goal 4 — Week View Operational Scan**
- Each week cell now shows a compact daily summary cue: total hours + visit/task counts. Color-coded by density: green (light < 4h), amber (moderate 4-7h), red (heavy 7h+). Memoized per-cell. (`WeekDispatchCell.tsx`)

**Goal 5 — Performance**
- All new computations use targeted `useMemo` with minimal dependency arrays. Occupancy rail reuses existing `getVisitPosition`/`getTaskPosition` — no new iteration. Lane summary reuses `countItemsBefore`/`countItemsAfter`. No impact on drag/resize path.

#### Phase 3 — Legacy Contact Surface Cleanup + Server Guardrails + Workspace Audit (2026-03-07)

**Part A — Legacy Contact Surface Cleanup**
- **AddClientDialog** — "Contact Details" relabeled to "Primary Site Contact (Summary)" with helper text directing to Contacts tab. (`AddClientDialog.tsx`)
- **EditClientDialog** — Contact fields now prefixed with summary disclaimer and helper text. (`EditClientDialog.tsx`)
- **NewAddClientDialog** — "Contact Information" relabeled to "Primary Site Contact (Summary)" with helper text. (`NewAddClientDialog.tsx`)
- **QuickAddClientModal** — Contact phone/email labels changed to "Site Contact Phone/Email" with summary disclaimer. (`QuickAddClientModal.tsx`)
- **QuickCreateDrawer** — "Primary Contact (optional)" relabeled to "Primary Site Contact (summary)". (`QuickCreateDrawer.tsx`)

**Part B — Server-Side Contact Scope Guardrails**
- **Scope immutability enforcement** — PATCH contact update now rejects scope changes (company→location or location→company) with 400 error. Scope derived from existing DB record, not trusted from client payload. (`server/routes/customer-companies.ts`)
- **LocationId stripped from simple updates** — The fallback single-row update path now strips `locationId`, `association`, and `existingContactIds` from the update payload, preventing crafted requests from silently re-scoping contacts. (`server/routes/customer-companies.ts`)
- **Location ownership validation** — POST and PATCH contact routes now validate that all submitted locationIds actually belong to the target customerCompany. Prevents cross-company contact association via crafted requests. Uses `validateLocationOwnership()` helper. (`server/routes/customer-companies.ts`)

**Part C — Client Workspace Data Integrity Audit**
- **Audit completed** — Systematic audit of header metrics, location signals, tab ownership, query keys, selected location transitions, and normalization boundaries. No issues found: all query keys are correctly scoped (clientId for client-level, locationId for location-level, companyId for company-level). `LocationDetailPane` uses `key={selectedLoc.id}` for clean re-mount on location switch. All location list signals derive from per-location maps (`jobsByLocation`, `invoicesByLocation`, `quotesByLocation`).

#### Panel Overlap Enforcement + Task Schedule Editing (2026-03-07)
- **Panel edits enforce overlap rules** — Duration changes via detail panel now route through `clampResizeEnd()` (same as resize drag). Start time changes route through `findNearestValidSlot()` (same as drag-drop). Panel edits produce identical outcomes to direct manipulation. (`DispatchDetailPanel.tsx`)
- **Task schedule editing in detail panel** — Task detail panel now shows inline technician selector, start time input, and duration selector (same controls as visit panel). Wired to existing `rescheduleTask` mutation via new `onRescheduleTask` callback. (`DispatchDetailPanel.tsx`, `DispatchPreview.tsx`)
- **Lane data passed to detail panel** — `DispatchPreview` computes `selectedLaneData` (visits + tasks for the selected item's technician lane) and passes to panel for overlap validation. (`DispatchPreview.tsx`)

#### Dispatcher Usability Improvements (2026-03-07)
- **Inline technician reassignment** — Detail panel shows a technician dropdown when a scheduled visit is selected. Selecting a new tech calls the existing reschedule mutation, moves the block to the new lane. Reuses same endpoint as drag. (`DispatchDetailPanel.tsx`, `DispatchPreview.tsx`)
- **Inline duration editing** — Detail panel shows a duration dropdown (15m–8h) for scheduled visits. Changing duration calls the existing resize mutation. Overlap clamping from the resize pass applies. (`DispatchDetailPanel.tsx`, `DispatchPreview.tsx`)
- **Inline start time editing** — Detail panel shows a time input for the visit start. Editing recalculates end from current duration. Uses existing reschedule mutation. (`DispatchDetailPanel.tsx`)
- **Auto-scroll during drag** — Timeline scroll container auto-scrolls when the pointer approaches any edge during drag (60px threshold, gradual speed). Horizontal and vertical. No interference with existing drag math. (`DispatchPreview.tsx`)
- **Unscheduled card info hierarchy** — Cards now show client name (bold, line 1), summary (line 2), location/duration/#job (line 3). Summary gets its own line. Duration slightly more prominent. Job number further de-emphasized (9px, slate-400). (`DispatchUnscheduledCard.tsx`)

### Fixed

#### Resize Overlap Enforcement (2026-03-07)
- **Resize now obeys same overlap rules as drag** — Visit and task resize is clamped in real time against all other blocks in the same lane (visit-visit, visit-task, task-task). Uses shared `clampResizeEnd()` from `dispatchOverlapUtils.ts`. Edge-touching allowed (consistent with drag). (`DispatchVisitBlock.tsx`, `DispatchTaskBlock.tsx`, `DispatchLaneRow.tsx`, `dispatchOverlapUtils.ts`)
- **Cross-midnight defensive guard** — `blockToTimeRange()` now clamps end time to 24:00 if it wraps past midnight, preventing negative-width ranges that would break overlap math. The board only supports same-day scheduling. (`dispatchOverlapUtils.ts`)

### Changed

#### Contact Architecture Hardening — Phase 2 (2026-03-07)
- **Company contacts locked to client-level editing** — Company-wide contacts are read-only in the location Contacts tab with clear labeling ("Read-only — manage from the client-level Contacts tab"). Edit/delete affordances only appear for location-scoped contacts in location tab. (`ClientDetailPage.tsx`)
- **Scope-safe contact edit flows** — `ContactFormDialog` now derives effective scope from the contact's actual association (via `locationId`) during edit, not from the active tab context. Scope is immutable during edit unless a dedicated "move contact" flow is added. (`ClientDetailPage.tsx`)
- **Structured contact role selection** — Replaced free-text comma-separated role input with a clickable tag-style multi-select for 9 standard roles (billing, scheduling, operations, site, manager, owner, primary, after-hours, maintenance). Legacy/unknown roles preserved via "Other roles" text field. Primary contact flag exposed as a checkbox. (`ClientDetailPage.tsx`)
- **Contact data normalization** — Added `normalizeContact()` helper that produces a consistent `{id, displayName, email, phone, roles, scope, locationId, isPrimary}` shape. `ContactCard` now consumes normalized data, reducing branching and making scope rules explicit. (`ClientDetailPage.tsx`)
- **ContactScope type** — Added `ContactScope = "company" | "location"` type alias used by `ContactFormDialog` and `normalizeContact`, preventing ambiguous string comparisons. (`ClientDetailPage.tsx`)
- **Legacy single-contact fields demoted** — `contactName`/`contactPhone`/`contactEmail` fields in location creation forms now labeled as "Primary site contact summary" with helper text pointing to the Contacts tab for full management. Fields are preserved for backward compatibility/bootstrap. (`ClientDetailPage.tsx`, `LocationFormModal.tsx`, `AddClientWithCompanyDialog.tsx`)
- **QBO sync extension seam** — Added TODO comment in `PATCH /api/customer-companies/:companyId` marking where non-blocking QBO customer sync should be invoked after successful updates. No sync behavior activated. (`server/routes/customer-companies.ts`)

### Fixed

#### Dispatcher-Polish and Live-Verification Pass (2026-03-07)
- **Task durationMinutes dragData fallback** — `DispatchTaskBlock` dragData now uses `durationMinutes || 60` matching the render fallback, preventing 0-duration tasks from breaking overlap detection and snap placement. (`DispatchTaskBlock.tsx`)
- **Panel outside-click resilience** — Replaced fragile `.group\/visit` / `.group\/task` CSS class selectors with `data-dispatch-block` attribute on all block types (visit, task, unscheduled card). Outside-click handler now uses `[data-dispatch-block]` selector which is immune to Tailwind class renaming. (`DispatchPreview.tsx`, `DispatchVisitBlock.tsx`, `DispatchTaskBlock.tsx`, `DispatchUnscheduledCard.tsx`)
- **Outside-window indicator viewport clipping** — Replaced hard-coded `800px` viewport limit with dynamic `containerHeight` tracked from scroll container's `clientHeight`. Indicators now correctly clip on any screen size. (`DispatchTimeline.tsx`)
- **Detail panel flex layout** — Added `h-full` to panel ref wrapper `<div>` so the detail panel fills the parent flex container correctly instead of potentially collapsing. (`DispatchPreview.tsx`)

#### Client Workspace Live-Data Bug Batch (2026-03-07)
- **Fix 1: Activity tab crash** — `activity.map is not a function` error fixed. The `/api/activity/:entityType/:entityId` endpoint returns `{ items: [], hasMore, nextCursor }` (paginated object), not a raw array. Added `normalizeActivityPayload()` that safely handles array, paginated object, null, and undefined payloads. (`ClientDetailPage.tsx`)
- **Fix 2: Edit Client action** — "Edit Client" dropdown item now opens a working edit dialog instead of navigating to self. New `PATCH /api/customer-companies/:companyId` endpoint added for updating company name, phone, email, billing address. (`ClientDetailPage.tsx`, `customer-companies.ts`, `customerCompanies.ts`)
- **Fix 3: 0-locations client** — Investigated: this is a legitimate data state where a customer company exists but has no linked locations. The overview endpoint correctly queries `client_locations WHERE parentCompanyId = :id`. Enhanced empty state to show "Add First Location" button instead of just text. (`ClientDetailPage.tsx`)
- **Fix 4: Remove "Open Full Page"** — Removed visible "Open full page" menu item from location detail dropdown. Old location routes preserved for backward compatibility but no longer surfaced in the new workspace UI. (`ClientDetailPage.tsx`)
- **Fix 5: Multi-contact support** — Full CRUD restored for both client-level and location-level contacts:
  - Client-level "Contacts" tab added to client-wide tabs with add/edit/delete for company contacts (Accounts Payable, Operations Manager, etc.)
  - Location-level Contacts tab upgraded from view-only to full CRUD with add/edit/delete
  - Reusable `ContactCard` and `ContactFormDialog` components created
  - Uses existing `POST/PATCH/DELETE /api/customer-companies/:companyId/contacts` endpoints
  - (`ClientDetailPage.tsx`)

### Changed

#### Client Detail Page → Split-Pane Client Workspace (2026-03-07)
- **Split-pane layout replaces two-column grid** — Client detail page (`/clients/:clientId`) now uses the enterprise master/detail pattern: left pane = location list, right pane = selected location detail with tabs. Replaces the old monolithic ClientDetailPage (1609 lines → ~750 lines, modular).
- **Client header** — compact header showing company name, status badge, and 4 key metrics: location count, active jobs, overdue invoices, pending quotes. Company tags shown subtly below. Primary actions: Create Job, Add Location, More (...).
- **Client-wide tabs** — Locations | Jobs | Invoices | Quotes | Billing | Activity. Non-Locations tabs show client-wide aggregated data across all locations.
- **Left pane (locations list)** — searchable location list with compact rows showing name, address, primary star, and right-aligned status indicators (active jobs, overdue invoices, pending quotes, PM indicator). Selected row highlighted with blue left border.
- **Right pane (location detail)** — 10 location tabs: Overview, Jobs, Invoices, Quotes, Equipment, PM, Parts, Notes, Contacts, Tags. All wired to real live data via existing API endpoints.
- **URL state for deep-linking** — `?location=<id>&tab=<tabName>` params preserved in URL for stable location selection, page refresh, and future deep-linking.
- **Billing tab (client-level)** — shows outstanding balance, overdue balance, open invoice count, pending quote count, computed from real invoice/quote data. Lists unpaid invoices.
- **Activity tab (client-level)** — wired to `/api/activity/customer_company/:id` endpoint. Shows real events with timestamps. Clean empty state if no data.
- **Location tab content** — Overview shows active work, PM status, access info, equipment summary. Jobs/Invoices/Quotes use real data from overview endpoint. Equipment supports add/delete. PM uses PMScheduleCard. Parts uses PartsSelectorModal. Notes uses NotesPanel. Contacts shows both location-specific and company-wide. Tags uses EditTagsModal.
- **Old LocationDetailPage preserved** — routes `/clients/:id/locations/:locationId` and `/locations/:locationId` still work for backwards compatibility and deep links.
- **Files modified:** `ClientDetailPage.tsx` (complete rewrite)

### Fixed

#### Dispatch Drag Corrections + Task Rules (2026-03-07)
- **Fix 1: Lane jumping** — visits no longer jump to the technician row above on drag start. Origin lane is captured at drag start via `originLaneRef` and used as fallback until the pointer crosses into another lane. (`DispatchPreview.tsx`)
- **Fix 2: Task/visit overlap enforcement** — tasks can no longer overlap visits and vice versa. `checkOverlap()`, `findNearestValidSlot()`, and `getOverlappingVisitIds()` now accept both visits and tasks, combining them into a single block list for overlap detection. (`dispatchOverlapUtils.ts`, `DispatchPreview.tsx`)
- **Fix 3: Ghost drag offset** — DragOverlay ghost card now uses `translate(-10px, -10px)` positioning to stay near the cursor instead of jumping above it. Drop position calculated from pointer coordinates relative to timeline container. (`DispatchPreview.tsx`)
- **Fix 4: Default task duration = 60 minutes** — tasks without a duration now default to 60 minutes on the backend (`tasks.routes.ts`) and frontend (`DispatchTaskBlock.tsx`), ensuring visibility on the timeline.
- **Fix 5: Close panel on outside click** — clicking empty grid area closes the detail panel. Clicking another visit/task switches the panel. Dragging and resizing do not trigger panel close. (`DispatchPreview.tsx`)

#### Dispatch UX Correction Pass (2026-03-07)
- **Drag ghost offset** — DragOverlay ghost card now renders above the cursor (`-translate-y-full`) with reduced opacity (70%), so the target slot time label stays readable during drag.
- **Drag preview readability** — time chip repositioned ABOVE the preview block (not centered inside it). White-on-blue or white-on-red pill is always visible even when the ghost card is nearby.
- **Overlap warning prominence** — overlap state shows a large centered red "OVERLAP" banner with bold white text; preview block border changes to solid red-500. Unmissable.
- **Nearest-valid-slot snapping** — when a drop would overlap, the system searches outward (before/after in 15-min increments) for the nearest non-overlapping slot. Only snaps back if no valid slot exists in the timeline window. Replaces hard block-on-overlap. New `findNearestValidSlot()` in `dispatchOverlapUtils.ts`.
- **Task resize** — tasks now have right-edge resize handles (same UX as visit blocks). Uses PATCH `/api/tasks/:id` with updated `scheduledEndAt`. Violet color scheme matches task styling.
- **Quick reschedule layout** — date and time inputs now stack vertically with labels, larger touch targets (h-8), proper padding (p-3), and outline-variant Cancel button.
- **Right panel visual separation** — detail panel border changed from `border-l` to `border-l-2 border-l-slate-300` (visit) / `border-l-violet-300` (task) with `shadow-lg`. Header bg darkened to `bg-slate-100` / `bg-violet-50`. Task panel now has "Open Related Job" footer action.
- **Outside-window indicators** — moved from lane-row absolute positioning (broken: `right-0` was at end of 1680px lane, off-screen) to a non-scrolling overlay in DispatchTimeline. Indicators now stick to viewport edges regardless of horizontal scroll position.
- **Files modified:** `dispatchOverlapUtils.ts`, `DispatchDragPreview.tsx`, `DispatchPreview.tsx`, `DispatchOutsideWindowIndicators.tsx`, `DispatchLaneRow.tsx`, `DispatchTimeline.tsx`, `DispatchTaskBlock.tsx`, `DispatchDetailPanel.tsx`

### Changed

#### Preview Cleanup + Command Palette Routing Fix (2026-03-07)
- **Removed old preview client workspace** — `/preview/client-workspace` route removed from `App.tsx`, nav entry removed from `AppSidebar.tsx`, import of `PreviewClientWorkspace` removed. The split-pane version (`/preview/client-workspace-split`) is the only client workspace preview now.
- **Deterministic command palette navigation** — every `CommandPalette` search result now carries an explicit `client` slug param (e.g., `?client=northstar-foods&location=3&tab=jobs`). No fuzzy routing, no default-client fallback. Client slugs: `freeman-service-group`, `northstar-foods`, `apex-property-management`, `city-of-toronto`.
- **Client-scoped split-pane** — `PreviewClientWorkspaceSplit` now reads `?client=` param, shows the correct client name in the header, and filters locations to only those belonging to that client. Selecting NorthStar Foods shows only Hillcrest Mall and Lakeside Heights.
- **URL params re-read on navigation** — split-pane workspace now re-applies `client`, `location`, and `tab` params on every URL change (not just mount). Navigating between CommandPalette results without remounting the page correctly updates the view.
- **Preview identity registry** — `previewClientWorkspaceMockData.ts` now exports `PREVIEW_CLIENTS` array with stable slugs and location ID mappings, plus lookup helpers `findPreviewClient()`, `findClientForLocation()`, `getDefaultLocationForClient()`.
- **Files modified:** `CommandPalette.tsx` (client slug in all routes), `PreviewClientWorkspaceSplit.tsx` (client param, re-read on nav, client-scoped locations), `previewClientWorkspaceMockData.ts` (preview identity registry), `App.tsx` (removed old route + import), `AppSidebar.tsx` (removed old nav entry + dead import)

### Added

#### Dispatch Board: Next-Phase Architecture Pass (2026-03-07)
- **Week View** — real Week view on the NEW dispatch architecture. Technician rows x day columns grid with compact visit/task cells. Supports click-to-select for detail panel, today highlighting, weekend shading. Files: `WeekDispatchGrid.tsx`, `WeekDispatchCell.tsx`, `useDispatchWeekData.ts`.
- **Day/Week View Switching** — `DispatchBoardHeader` now supports Day and Week toggles. Navigation arrows advance by day or week depending on active view. Date label shows week range in Week view.
- **Drag Preview with Target Time** — `DispatchDragPreview` renders a snap-aligned ghost block in the active drop lane showing exact proposed start/end times. Turns red with "Overlap!" warning on conflict.
- **Overlap Prevention** — `dispatchOverlapUtils` detects overlapping visits for same technician. Drops are blocked when overlap detected; lane highlights red; drag preview shows warning.
- **Compact Unscheduled Cards** — redesigned to 2-line layout for dense backlog display. Line 1: customer name + summary. Line 2: location, duration, job number. Supports 20+ items without excessive scrolling.
- **Task Parity** — tasks are now clickable (opens detail panel) and draggable (PATCH /api/tasks/:id with scheduledStartAt/EndAt). Task drag overlay shows violet styling. Resize not yet supported (documented). Task detail panel shows type, status, schedule, notes.
- **Outside-Window Indicators** — amber chevron buttons appear in lane rows when technician has items before 6 AM or after 8 PM. Shows item count per direction.
- **Hide Weekends Toggle** — Week view filter bar includes "Hide Weekends" checkbox that removes Sat/Sun columns.
- **Shared Filter Model** — technician multi-select and visit status filter work identically in Day and Week views. No separate filter systems.
- **Detail Panel Improvements** — stronger visual separation with grouped sections (Status, Schedule, Location, People, Notes). Quick Reschedule inline form for date/time changes. Supports both visit and task detail via entityType discriminator. Visit and task headers have distinct styling.
- **Task Reschedule Mutation** — `useDispatchPreviewMutations` now includes `rescheduleTask()` via PATCH /api/tasks/:id. Also invalidates /api/tasks queries on all mutations.
- **Files created:** `WeekDispatchGrid.tsx`, `WeekDispatchCell.tsx`, `useDispatchWeekData.ts`, `DispatchDragPreview.tsx`, `dispatchOverlapUtils.ts`, `DispatchOutsideWindowIndicators.tsx`
- **Files modified:** `DispatchPreview.tsx` (Day/Week orchestration, drag preview, overlap, task selection), `DispatchBoardHeader.tsx` (view toggle, week date label), `DispatchFiltersBar.tsx` (hide weekends toggle), `DispatchTimeline.tsx` (drag preview + task selection passthrough), `DispatchLaneRow.tsx` (drag preview, overlap, task selection, outside-window indicators), `DispatchTaskBlock.tsx` (clickable + draggable), `DispatchUnscheduledCard.tsx` (compact 2-line layout), `DispatchDetailPanel.tsx` (sections, quick reschedule, task support), `useDispatchPreviewMutations.ts` (rescheduleTask, task invalidation), `dispatchDndTypes.ts` (scheduled-task drag type)

#### Dispatch Board: Day View Improvement Components (2026-03-07)
- **DispatchDragPreview** — visual drag preview indicator that renders inside each lane row during drag operations. Shows a semi-transparent block at the snap-aligned position with proposed start/end times. Turns red with "Overlap!" warning when the drop would conflict with an existing visit.
- **dispatchOverlapUtils** — pure utility functions for overlap detection. `checkOverlap()` returns boolean for conflict detection; `getOverlappingVisitIds()` returns conflicting visit IDs for highlighting. Both exclude the dragged visit and handle missing schedule data gracefully.
- **DispatchOutsideWindowIndicators** — edge indicators rendered in each lane row when a technician has visits/tasks before 6 AM or after 8 PM (outside the visible 6 AM–8 PM timeline window). Shows amber chevron buttons with item count; supports optional scroll-to callbacks.
- **Files created:** `client/src/components/dispatch/DispatchDragPreview.tsx`, `client/src/components/dispatch/dispatchOverlapUtils.ts`, `client/src/components/dispatch/DispatchOutsideWindowIndicators.tsx`

### Fixed

#### Dispatch Board: Mutation + Task + UX Fix Pass (2026-03-07)
- **ROOT CAUSE: Visit ID mismatch** — `mapEventToDispatchVisit()` used `event.id` for the visit's `id` field, but the API returns `event.id === jobId`. All visit-level mutations (`reschedule`, `unschedule`, `resize`) sent the job UUID to `/visit/:visitId/...` routes, causing 404 "Not found" errors.
- **FIX: Use visitId for mutations** — mapper now uses `event.visitId ?? event.id`, ensuring visit-level routes receive the correct visit UUID.
- **FIX: Mutation fallback strategy** — `useDispatchPreviewMutations.ts` rewritten with try-new-route → catch-404 → fallback-to-old-route pattern. Supports both old job-level routes (stale server) and new visit-level routes (restarted server).
- **FIX: Resize sends visitId** — resize handler passes `visit.id` (now correct visitId), `visit.scheduledStart`, and `visit.scheduledEnd` to the resize mutation.
- **FIX: Version field consistency** — after server restart, API returns `visit_version` (from `jv.version`) and new routes check `visit.version`. Old routes removed from code; version fields are now consistent end-to-end.
- **FIX: Mutation response version desync** — `rescheduleVisit`, `unscheduleVisit`, `resizeVisit` storage methods returned job version in response (from `getJobById`), but calendar query returned visit version. This caused consecutive mutations to fail with VERSION_MISMATCH. Fixed by re-fetching visit after mutation and returning `visitVersion` in storage responses. Routes now return `result.visitVersion ?? result.version`.
- **FIX: Task date filter** — task query used `scheduledToDate=YYYY-MM-DD` which parsed as midnight, excluding same-day tasks. Changed to use full ISO range (`dayStart`/`dayEnd`) matching the calendar event query pattern.
- **ADDED: Task rendering on timeline** — new `DispatchTaskBlock.tsx` renders tasks on technician lanes with violet/dashed styling. Tasks fetched from `GET /api/tasks?scheduledFromDate=&scheduledToDate=&limit=200`. Read-only (no drag/resize) pending backend task mutation contract.
- **ADDED: Task data pipeline** — `useDispatchPreviewData.ts` fetches tasks for selected day, `mapRawTask()` normalizes API response, `tasksByTech` useMemo groups tasks by `assignedToUserId`.
- **UX: Card information hierarchy** — scheduled visit blocks now show customerName as primary (bold), summary as secondary. Unscheduled cards made more compact (reduced padding), customerName primary, job number moved to metadata line.
- **Files modified:** `dispatchPreviewMappers.ts` (visitId fix, mapRawTask), `dispatchPreviewTypes.ts` (DispatchTask type), `useDispatchPreviewMutations.ts` (rewritten with fallback), `useDispatchPreviewData.ts` (task fetching, ISO date range), `DispatchPreview.tsx` (tasksByTech wiring, mutation params), `DispatchVisitBlock.tsx` (card hierarchy), `DispatchUnscheduledCard.tsx` (compact cards), `DispatchTimeline.tsx` (tasksByTech prop), `DispatchLaneRow.tsx` (task rendering), `server/storage/calendar.ts` (visitVersion in mutation responses), `server/routes/calendar.ts` (return visitVersion in route responses)
- **Files created:** `DispatchTaskBlock.tsx`

#### Dispatch Board: Empty Board Bug Fix (2026-03-07)
- **ROOT CAUSE: Technician roster derived only from visit payload** — `extractAllTechnicians()` built the tech list solely from `event.technicians` arrays in scheduled events and unscheduled jobs. On empty days (or days with unassigned visits), the tech list was empty, causing empty sidebar, empty filter dropdown, empty timeline, and no visit lanes.
- **FIX: Independent technician roster fetch** — dispatch board now uses `useTechniciansDirectory()` (existing hook for `GET /api/team/technicians`) to fetch all schedulable technicians independently. `buildTechnicianRoster()` maps team members to display format, enriched with colors from event payload when available. Empty days now show all technician lanes.
- **FIX: View toggle honesty** — Day/Week/Month toggle buttons replaced with Day (always active) + Week/Month (disabled with "coming soon" tooltip). Previously all three appeared clickable, with Month visually selectable despite no implementation.
- **FIX: Empty day state** — timeline now shows a clear "No schedulable technicians found" message when the roster is genuinely empty, distinguishing it from a data pipeline failure.
- **FIX: Unassigned visits invisible** — scheduled visits with no `technicianId` (2 of 3 on the verified test day) were silently dropped by `visitsByTech`. Added an "Unassigned" virtual lane row (slate-colored, `??` avatar) that collects these visits. The unassigned lane is not a drop target — you cannot drag visits onto it, only off of it.
- **Removed dead state** — `activeView`/`onViewChange` state removed from `DispatchPreview.tsx` since only Day view is implemented.
- **Files modified:** `useDispatchPreviewData.ts` (technician roster from team API), `dispatchPreviewMappers.ts` (replaced `extractAllTechnicians` with `buildTechnicianRoster`), `DispatchBoardHeader.tsx` (disabled Week/Month toggles), `DispatchTimeline.tsx` (empty tech state), `DispatchPreview.tsx` (removed view toggle state, added unassigned lane logic), `DispatchLaneRow.tsx` (disable droppable for unassigned lane), `dispatchPreviewTypes.ts` (UNASSIGNED_TECH_ID sentinel)

### Changed

#### Preview: Client Workspace & Search Refinement (2026-03-07)
- **1A/1B: Compact location indicators** — replaced text-heavy status pills in left pane with icon+count indicators (wrench for active jobs, receipt for overdue invoices, file for pending quotes, calendar for PM). Saves ~40% vertical space per row.
- **1C: Tags moved to subtle line** — location tags (HVAC, Refrigeration, etc.) moved below address as muted 10px text instead of colored badges.
- **1D: New client-level tab set** — replaced `activeWork/jobs/invoices/quotes/history` tabs with `Locations/Jobs/Invoices/Quotes/Billing/Activity`. Added `ClientBillingContent` (account summary, payment methods, billing contact). Renamed `ClientHistoryContent` → `ClientActivityContent`.
- **Part 2: Command palette deterministic routing** — `CommandPalette.tsx` now uses `csRoute()` helper with exact mock location IDs (e.g., `?location=20&tab=jobs`). All ~50 mock results updated with correct numeric IDs matching `previewClientWorkspaceMockData.ts`.
- **Part 3: Unified search UX** — on preview routes, the top nav search bar is now a styled trigger that opens the CommandPalette modal (same as Cmd+K). Production routes retain the full `UniversalSearch` component with real API. One search system per context, not two competing inputs.
- **Part 3: Deep-link support** — `PreviewClientWorkspaceSplit.tsx` reads `?location=` and `?tab=` URL query params on mount, preselecting the correct location and detail tab when navigated from the command palette.
- **Files modified:** `App.tsx` (preview-aware search bar trigger), `CommandPalette.tsx` (deterministic routing), `PreviewClientWorkspaceSplit.tsx` (compact indicators, new tabs, billing content, URL param reading)

### Added

#### Preview: Operations Queue (2026-03-07)
- **New preview page** at `/preview/operations-queue` — split-pane triage queue for actionable items across all client locations.
- **Left pane:** filterable queue list (All, Invoices, Jobs, Quotes, PM tabs), search bar, urgency-sorted items with colored left borders (red=overdue invoices, blue=active jobs, amber=pending quotes, green=PM due).
- **Right pane:** location detail with 10 tabs (Overview, Jobs, Invoices, Quotes, Equipment, PM, Parts, Notes, Contacts, Tags) populated from existing mock data.
- **Mock data derivation:** queue items generated from `previewClientWorkspaceMockData.ts` locations — overdue invoices (urgency 1), active jobs (2), pending quotes (3), PM due (4). Multiple client names for variety.
- **Sidebar entry** added under "Preview / Legacy" section with `ListChecks` icon.
- **Files created:** `PreviewOperationsQueue.tsx`, `previewOperationsQueueMockData.ts`
- **Files modified:** `App.tsx` (route), `AppSidebar.tsx` (nav entry)

#### Preview: Universal Command Search (Cmd+K) (2026-03-07)
- **Command palette** triggered by `Cmd+K` / `Ctrl+K` — modal overlay with search input, grouped results, keyboard navigation.
- **7 entity groups:** Clients, Locations, Jobs, Invoices, Quotes, Equipment, Contacts — ~60 mock search results.
- **Keyboard navigation:** ArrowUp/Down to move, Enter to select, Esc to close. Active item highlighted with "Enter" hint badge.
- **Navigation:** selecting a result navigates to the corresponding preview route via wouter.
- **Trigger button** added next to existing search bar in the app header (magnifying glass icon with "Cmd+K" badge).
- **Preview-only:** all routes point to `/preview/` paths. No backend calls. No production route changes.
- **Files created:** `CommandPalette.tsx`
- **Files modified:** `App.tsx` (Cmd+K handler, trigger button, CommandPalette render)

### Fixed

#### Dispatch Board: Post-Cutover Validation Fixes (2026-03-07)
- **BLOCKER: Layout overflow** — dispatch board used `h-screen` (100vh) but is rendered inside the app shell which already has a 56px header. Board extended beyond viewport, requiring scroll. Fixed to `h-full` so it fills the remaining space correctly. Also fixed error state container.
- **HIGH: "Open Job" full page reload** — detail panel used `<a href>` for the job link, causing full page reload. Replaced with wouter `<Link>` for SPA navigation. Removed unused `Hash` import.
- **MEDIUM: Click after drag** — clicking a visit block could fire `onSelect` after a drag-and-drop completed, opening the detail panel unintentionally. Added `wasDraggingRef` guard to suppress click immediately after drag.
- **Files modified:** `DispatchPreview.tsx`, `DispatchDetailPanel.tsx`, `DispatchVisitBlock.tsx`

### Changed

#### Route Cutover: Dispatch Board Promoted to Primary Scheduling Surface (2026-03-07)
- **`/dispatch`** is now the primary scheduling route, serving the new dispatch board.
- **`/calendar`** now renders the new dispatch board (same as `/dispatch`), preserving existing bookmarks/links.
- **`/calendar-legacy`** serves the old `Calendar.tsx` as a temporary fallback.
- **`/dispatch-preview`** kept as alias (renders the same dispatch board).
- **Sidebar nav:** "Calendar" renamed to "Dispatch" with `LayoutGrid` icon, pointing to `/dispatch`.
- **Preview UI section** renamed to "Preview / Legacy". "Dispatch Board" entry removed (now primary). "Calendar (Legacy)" entry added.
- **Preview banner removed** from dispatch board page — no longer labeled as preview.
- **No backend changes.** No legacy calendar files deleted.
- **Files modified:** `App.tsx` (routes), `AppSidebar.tsx` (nav), `DispatchPreview.tsx` (banner removed, doc comment updated)

### Added

#### Dispatch Board: Read-Only Visit Detail Panel (2026-03-07)
- **Click-to-select** — click any scheduled visit block or unscheduled card to open a read-only detail slide-over panel on the right, replacing the unscheduled panel while active.
- **Detail fields shown:** job number, visit number, summary, status badge, priority, job type, customer name, location name, scheduled date/time, duration, technician name(s), site contact name/phone, access instructions, job description, visit notes, location notes.
- **Quick actions:** "Open Job" link navigates to `/jobs/:jobId`, "Unschedule" button for scheduled visits, "Close" button.
- **Selection ring** — selected visit block or card shows a blue ring highlight.
- **Auto-clear** — selection clears when the selected visit disappears due to date/filter changes.
- **Toggle behavior** — clicking the same visit again deselects it, returning to the unscheduled panel.
- **Extended DispatchVisit type** — added optional fields (`jobType`, `locationId`, `customerCompanyId`, `description`, `accessInstructions`, `contactName`, `contactPhone`, `locationNotes`, `visitNotes`, `technicianNames`) mapped from existing `CalendarEventDto` and `UnscheduledJobDto` payloads. No new backend calls.
- **Files created:** `DispatchDetailPanel.tsx`
- **Files modified:** `dispatchPreviewTypes.ts`, `dispatchPreviewMappers.ts`, `DispatchVisitBlock.tsx`, `DispatchUnscheduledCard.tsx`, `DispatchUnscheduledPanel.tsx`, `DispatchLaneRow.tsx`, `DispatchTimeline.tsx`, `DispatchPreview.tsx`

#### Dispatch Board: Visit Block Resize (2026-03-07)
- **Right-edge resize handle** on scheduled visit blocks in `/dispatch-preview`. Drag to change duration with 15-minute snap increments, minimum 15 minutes.
- **Live preview** — block width and duration label update in real-time during resize drag.
- **Persist via backend** — calls `POST /api/calendar/visit/:visitId/resize` with `{ newEndTime }` on pointer release. Refetch-on-success strategy.
- **Clamped to timeline** — resize cannot extend past `TIMELINE_END_HOUR` (8 PM).
- **Fixed unschedule hover bug** — X button now only appears when hovering the specific visit block (Tailwind named group `group/visit`), not the entire lane row.
- **New constants** in `dispatchPreviewUtils.ts`: `SNAP_MINUTES`, `MIN_DURATION_MINUTES`, `PX_PER_MINUTE`.
- **New mutation** `resizeVisit` in `useDispatchPreviewMutations.ts`.
- **Files:** `DispatchVisitBlock.tsx` (resize handle + hover fix), `DispatchLaneRow.tsx` (onResize prop), `DispatchTimeline.tsx` (onResize prop), `DispatchPreview.tsx` (handleResize wiring), `useDispatchPreviewMutations.ts` (resizeVisit), `dispatchPreviewUtils.ts` (constants)

### Changed

#### Preview: Client Workspace V3 Refinement (2026-03-07)
- **Calmer, flatter list-based layout** — removed row background tinting for urgency (badges only), removed card-within-card nesting, flatter rows with border separators instead of chunky cards.
- **Simplified header** — de-emphasized equipment count, prioritized Active Jobs / Overdue Invoices / Quotes Pending as inline metrics. Client tags moved to subtle grey chips below metrics.
- **Client-wide tabs with mock content** — Active Work, Jobs, Invoices, Quotes, History tabs now render real mock data across all locations (not decorative).
- **Full location tab set** — added Invoices and Quotes tabs. Full set: Overview, Jobs, Invoices, Quotes, Equipment, PM, Parts, Notes, Contacts, Tags.
- **Collapsible right rail** — sidebar sections use accordion pattern. Client Contacts and Billing Snapshot open by default; Client Notes, Payment Methods, Recent Activity collapsed by default.
- **Shared mock data** — extracted mock data to `previewClientWorkspaceMockData.ts` with new `MockInvoice` and `MockQuote` types per location.
- **Files:** `PreviewClientWorkspace.tsx` (rewritten), `previewClientWorkspaceMockData.ts` (new)

### Added

#### Preview: Client Workspace Split-Pane (2026-03-07)
- **New split-pane preview** at `/preview/client-workspace-split` — enterprise master/detail pattern for comparison.
- **Left pane:** stable location list with Locations/Needs Attention toggle, search, filter, sort. Selected row highlighted. No inline expansion.
- **Right pane:** selected location detail with full tab set (Overview, Jobs, Invoices, Quotes, Equipment, PM, Parts, Notes, Contacts, Tags).
- **Client-wide tabs** — Active Work shows split-pane, Jobs/Invoices/Quotes/History show client-wide aggregated content.
- **Needs Attention mode** — filters to actionable locations sorted by urgency, shows reason summary.
- **No right sidebar** — omitted to let the split-pane breathe.
- **Files:** `PreviewClientWorkspaceSplit.tsx` (new), `App.tsx` (route), `AppSidebar.tsx` (nav entry with Columns icon)

#### Calendar: Symmetric DnD Identity Normalization (2026-03-07)
- **Removed asymmetric drag ID model.** Previously visits used bare UUIDs and tasks used `"task-{uuid}"` prefixed IDs. Now both use typed drag IDs: `"visit-{uuid}"` and `"task-{uuid}"`. This eliminates fragile string-prefix routing and makes the system extensible to future entity types.
- **New centralized helpers:** `buildCalendarDragId(entityType, entityId)` and `parseCalendarDragId(dragId)` in `calendarUtils.ts`. All drag ID construction and parsing now goes through these — no more ad-hoc `startsWith("task-")` or `.replace("task-", "")` scattered across components.
- **CalendarEvent type extended:** Added optional `entityId` (raw UUID for API calls) and `entityType` fields. `assignmentId` is now always a typed drag ID.
- **Routing by parsed entity type:** `handleDragEnd` and `handleResize` in Calendar.tsx use `parseCalendarDragId()` to determine entity type and extract raw IDs, instead of string prefix checks.
- **savingJobIds updated:** Visit mutations now use `buildCalendarDragId("visit", visitId)` for saving state, matching the typed `event.assignmentId` that grid components check.
- **No behavior changes.** All drag/drop, resize, optimistic update, and rollback flows work identically.
- **Files:** `calendarUtils.ts`, `useCalendarDnD.ts`, `Calendar.tsx`, `ResizableJobCard.tsx`, `CalendarGridWeek.tsx`, `CalendarGridDayJobber.tsx`, `CalendarGridDay.tsx`, `CalendarSidebar.tsx`

### Added

#### Preview: Dispatch Board (2026-03-07)
- **New isolated Dispatch Board preview** at `/dispatch-preview` — visual prototype for the calendar replacement architecture.
- **3-column layout:** technician sidebar (left), scrollable day timeline with hour grid + visit blocks (center), unscheduled visits panel with search (right).
- **Header:** "Dispatch Board" title, Today/prev/next day navigation, Day/Week/Month view toggle (Day active, others placeholder).
- **Filters:** Multi-select technician dropdown with checkboxes (Select All / Clear All), multi-select visit status dropdown (Open, Scheduled, Dispatched, En Route, On Site, In Progress, Completed). No departments filter.
- **Visit blocks:** Color-coded by visit status, priority border accent (urgent=red, high=amber), job number + summary + location + duration. Positioned on timeline by scheduledStart/duration.
- **Technician lanes:** Avatar with initials + color, name, status dot (available/on_job/off). Rows align with timeline lanes.
- **Unscheduled panel:** Search bar, visit cards with grip handle (future drag source), priority badges, location + duration metadata.
- **Now line:** Red vertical indicator at current time, auto-scrolls timeline to current hour on mount.
- **Component structure:** 8 new files in `client/src/components/dispatch/` — fully isolated from calendar codebase.
- **No backend changes.** No calendar modifications. No drag/drop mutations wired.
- **Files:** `DispatchPreview.tsx` (page), `DispatchBoardHeader.tsx`, `DispatchFiltersBar.tsx`, `DispatchTechnicianSidebar.tsx`, `DispatchTimeline.tsx`, `DispatchLaneRow.tsx`, `DispatchVisitBlock.tsx`, `DispatchUnscheduledPanel.tsx`, `DispatchUnscheduledCard.tsx`, `dispatchPreviewTypes.ts`, `dispatchPreviewUtils.ts`, `dispatchPreviewMockData.ts`, `App.tsx` (route), `AppSidebar.tsx` (nav entry)

#### Preview: Dispatch Board — DnD Scheduling Interactions (2026-03-07)
- **Drag/drop scheduling** added to `/dispatch-preview` — unscheduled visits can be dragged onto technician lanes to schedule them, scheduled visits can be moved to different times/technicians.
- **Unschedule action** — hover X button on scheduled visit blocks returns them to the unscheduled backlog.
- **Mutation hook:** `useDispatchPreviewMutations.ts` — handles `scheduleVisit` (POST `/api/calendar/schedule`), `rescheduleVisit` (PATCH `/api/calendar/visit/:visitId/reschedule`), and `unscheduleVisit` (POST `/api/calendar/visit/:visitId/unschedule`) with CSRF, saving state tracking, error toasts, and query invalidation.
- **DnD types:** `dispatchDndTypes.ts` — structured `DispatchDragData` and `DispatchDropData` interfaces (no brittle string parsing).
- **dnd-kit integration:** `DndContext` wraps the dispatch board, `useDraggable` on visit blocks and unscheduled cards, `useDroppable` on lane rows with visual drop target highlighting.
- **Drop position computation:** 15-minute snap grid, clamped to timeline bounds (6 AM–8 PM), computed from pointer position relative to scrollable timeline.
- **Drag overlay:** lightweight ghost preview follows cursor during drag.
- **Saving state feedback:** spinner on cards/blocks during mutations, disabled dragging while saving.
- **Refetch-on-success strategy** — no optimistic updates; mutations invalidate queries and refetch for correctness.
- **Version field** added to `DispatchVisit` type for optimistic locking.
- **Files created:** `dispatchDndTypes.ts`, `useDispatchPreviewMutations.ts`
- **Files modified:** `DispatchPreview.tsx`, `DispatchTimeline.tsx`, `DispatchLaneRow.tsx`, `DispatchVisitBlock.tsx`, `DispatchUnscheduledCard.tsx`, `DispatchUnscheduledPanel.tsx`, `dispatchPreviewTypes.ts`, `dispatchPreviewMappers.ts`, `dispatchPreviewMockData.ts`

#### Preview: Dispatch Board — Real Data Wiring (2026-03-07)
- **Replaced mock data with live backend data** in `/dispatch-preview`. Now fetches from `GET /api/calendar?start=&end=` (scheduled visits) and `GET /api/calendar/unscheduled` (backlog).
- **Mapper layer:** `dispatchPreviewMappers.ts` — maps `CalendarEventDto` → `DispatchVisit`, `UnscheduledJobDto` → `DispatchVisit`, extracts unique `Technician` objects from visit payloads with color fallbacks.
- **Data hook:** `useDispatchPreviewData.ts` — `useDispatchPreviewData(selectedDate)` computes day start/end boundaries, fetches both endpoints via TanStack Query, returns `{ scheduledVisits, unscheduledVisits, technicians, isLoading, error }`.
- **Date navigation functional:** changing date refetches scheduled visits for the new day range.
- **Loading/error states:** spinner overlay during fetch, centered error message on failure.
- **Tech filter auto-init:** auto-selects all technicians on first data load, preserves manual selections on subsequent fetches.
- **Read-only:** no mutations, no DnD, no scheduling writes.
- **Files:** `dispatchPreviewMappers.ts` (new), `useDispatchPreviewData.ts` (new), `DispatchPreview.tsx` (rewritten)

#### Preview: Client Command Center V2 (2026-03-07)
- **V2 UX refinement** of the Client Workspace preview at `/preview/client-workspace`.
- **Compact expanded panels** — Overview tab now uses dense summary strips (Active Work, PM, Access, Last Service) instead of a 3-column slab. All tab content tightened with smaller padding and text.
- **De-emphasized Create Job** — removed per-row "Create Job" button; replaced with a subtle icon-only action visible on hover. Primary Create Job action moved inside the expanded panel actions row.
- **Account Intelligence Rail** — right sidebar upgraded from simple contacts/notes to a full account rail: Client Contacts, Client Notes, Billing Snapshot (outstanding/overdue/open invoices/unapproved quotes with quick actions), Payment Methods (Visa/ACH mock), and Recent Activity feed (10 mixed activity items with timestamps).
- **Dual-view toggle** — segmented "Locations / Needs Attention" toggle above the locations workspace. Needs Attention view shows only locations with actionable signals, sorted by urgency (overdue > active jobs > quotes > PM).
- **Urgency emphasis** — rows with overdue invoices get a subtle red border tint. Needs Attention items share the same visual treatment.
- **Sort options expanded** — Active Work, Name A-Z, Overdue Balance, PM Status.
- **Optional secondary line** — collapsed rows show Next PM or Last Service date as a subtle subtitle when available.
- **Richer mock data** — equipment types, PM cadence, location-level emails, "Needs Review" job status, 3 client contacts, 10 activity feed items.
- **Sidebar "Preview UI" section** in `AppSidebar.tsx` — temporary navigation with flask icon for easy access.
- **No backend changes.** Mock data only. Does not modify existing client pages.
- **Files:** `PreviewClientWorkspace.tsx` (rewritten), `App.tsx` (route unchanged), `AppSidebar.tsx` (unchanged)

#### Calendar: Task Drag/Drop Scheduling with Optimistic Updates (2026-03-06)
- **Tasks are now fully interactive calendar items** — drag to reschedule, drag between technicians, resize duration, drag from sidebar to schedule. Previously tasks were read-only on the calendar.
- **Mutations:** Added `updateTask` and `resizeTask` mutations to `useCalendarDnD.ts` with full optimistic cache updates, savingJobIds tracking, and snapshot rollback on error. Tasks route to `PATCH /api/tasks/:id` (not visit endpoints).
- **Drag routing:** Calendar.tsx `handleDragEnd` now uses `updateTaskMutation.mutate()` instead of inline `apiRequest()` — gains optimistic UI, saving indicators, and rollback.
- **Resize routing:** Calendar.tsx `handleResize` detects task IDs (`task-` prefix) and routes to `resizeTaskMutation` instead of visit resize endpoint.
- **Sidebar drag:** Unscheduled tasks in `CalendarSidebar.tsx` are now wrapped in `useDraggable` via `DraggableTaskItem` component — can be dragged onto any calendar slot to schedule them.
- **Capability gates removed:** `getEventCapabilities()` now returns `draggable/resizable: true` for non-completed tasks (was previously `false` for all tasks). `JobCard` `draggable` prop no longer hardcoded to `!isTask`. `DraggableAllDayCard` no longer disables drag for tasks.
- **Click-vs-drag guard:** `DraggableTaskItem` uses `isDragging` + 250ms `lastDragEndedAtRef` cooldown to prevent `onClick` from firing after a drag (same pattern as `DraggableClient`). Completed tasks show `cursor-default` + reduced opacity.
- **Optimistic insert for first-schedule:** When an unscheduled task is dragged from the sidebar onto the calendar, `updateTask.onMutate` detects the task isn't in the calendar cache (no `.map()` match), builds a synthetic `CalendarEvent`, and appends it. Also optimistically removes the task from the unscheduled sidebar cache. Both caches roll back on error.
- **Files:** `client/src/hooks/useCalendarDnD.ts`, `client/src/pages/Calendar.tsx`, `client/src/components/calendar/CalendarSidebar.tsx`, `client/src/components/calendar/calendarUtils.ts`, `client/src/components/calendar/JobCard.tsx`, `client/src/components/calendar/CalendarGridDayJobber.tsx`

### Fixed

#### Calendar: DnD Identity/Routing Regression Fix (2026-03-07)
- **Root cause (task drag snap-back):** `ResizableJobCard` used `assignment.id` (raw entity UUID) as the drag ID. For tasks, `event.raw.id` is the bare task UUID (e.g., `"abc-123"`), but `handleDragEnd` routes via `activeIdValue.startsWith("task-")` — which requires the prefixed format `"task-abc-123"`. Without the prefix, task drags fell through to the visit branch, sending the task UUID to `PATCH /api/calendar/visit/{taskUUID}/reschedule` → 404 "Not found" + rollback.
- **Root cause (task resize "no start time"):** Same identity mismatch caused task resizes to skip the task branch in `handleResize` and fall through to `updateDuration`, which reads `assignment.scheduledStart || assignment.startAt` — but task objects use `scheduledStartAt`. Field not found → threw "Cannot resize: assignment has no start time".
- **Root cause (visit 404):** Visits were not directly broken — the "Not found" errors users saw were from task drags misrouted to visit endpoints. Visit-only drag/resize was unaffected.
- **Fix:** Added `assignmentId` prop to `ResizableJobCard` carrying the canonical CalendarEvent identity (`event.assignmentId`, which is `"task-{uuid}"` for tasks, visitId for visits). All 3 callers now pass it. `ResizableJobCard` uses `canonicalId` (prop ?? `assignment.id`) for drag ID and resize callback. Also added `scheduledStartAt` to the `handleResize` start-time fallback chain, and patched `normalizeTask()` to include `startAt`/`endAt` in `raw` for field name consistency.
- **Files:** `ResizableJobCard.tsx`, `CalendarGridWeek.tsx`, `CalendarGridDayJobber.tsx`, `CalendarGridDay.tsx`, `Calendar.tsx`, `calendarUtils.ts`, `useCalendarDnD.ts`

#### Calendar: Resize Snap-Back Lag Eliminated (2026-03-06)
- **Root cause:** `updateDuration` mutation had no `onMutate` (no optimistic update) and `onSuccess` called `await refetchCalendar()` — a full server round-trip before UI showed the new duration. Combined with `setTempDuration(null)` in ResizableJobCard clearing the visual height immediately, this caused a visible snap-back: card reverted to old height for 600-1200ms before settling at new height.
- **Fix:** Added `onMutate` with optimistic cache update (patches `durationMinutes` + `endAt` in query cache before server responds), added `savingJobIds` tracking, added snapshot for rollback on error. Replaced `await refetchCalendar()` in `onSuccess` with `mergeServerResponseIntoCache()` — no full refetch needed.
- **Files:** `client/src/hooks/useCalendarDnD.ts`

#### Calendar: Task Cards No Longer Appear Draggable (2026-03-06)
- **Root cause:** `ResizableJobCard` (used for timed events in Week and Day Columns views) did not check `getEventCapabilities().draggable` — it allowed drag for all non-completed, non-saving items regardless of event kind. Tasks rendered via ResizableJobCard appeared draggable (drag cursor, could be picked up) but on drop would fail silently or snap back because the drop handler expects visit IDs, not task IDs.
- **Fix:** Added `draggable` prop to `ResizableJobCard` (default `true`), wired to `useDraggable({ disabled: ... || !draggable })`. All three grid components that render ResizableJobCard now pass `caps.draggable` (which is `false` for tasks). Also fixed `CalendarGridDayJobber` to gate `onResize` through `caps.resizable` (was unconditionally passing `handleResize` to tasks).
- **Files:** `client/src/components/calendar/ResizableJobCard.tsx`, `client/src/components/calendar/CalendarGridWeek.tsx`, `client/src/components/calendar/CalendarGridDayJobber.tsx`

### Changed

#### Calendar: Final Dead Code Cleanup & Schema Rename (2026-03-06)
- **Removed dead `toggleComplete` mutation** from `useCalendarDnD.ts` (~29 lines). Never `.mutate()`'d and had a schema bug (sent `{completed}` without required `version`). Removed destructuring from `Calendar.tsx`.
- **Removed dead storage methods** from `server/storage/calendar.ts`: `rescheduleJob()` (~245 lines), `unscheduleJob()` (~80 lines), `rescheduleJobBypassWorkingHours()` (~120 lines). All were legacy job-centric methods with no remaining callers after visit-centric migration.
- **Renamed Zod schemas** in `server/routes/calendar.ts`: `rescheduleJobSchema` → `rescheduleVisitSchema`, `unscheduleJobSchema` → `unscheduleVisitSchema`. Localized rename — these schemas are only used within this file for visit-centric route handlers.
- **No behavior changes, no endpoint changes, no UI changes.**
- **Files:** `client/src/hooks/useCalendarDnD.ts`, `client/src/pages/Calendar.tsx`, `server/storage/calendar.ts`, `server/routes/calendar.ts`

#### Calendar: Full Legacy Mutation Retirement — Visit-Centric Model Complete (2026-03-06)
- **Removed 3 deprecated server routes:** `PATCH /api/calendar/schedule/:jobId`, `POST /api/calendar/unschedule/:jobId`, `POST /api/calendar/resize`. All client callers migrated to visit-centric endpoints. `resizeJobSchema` removed (unique to deprecated resize route). `rescheduleJobSchema` and `unscheduleJobSchema` retained (shared with active visit-centric routes).
- **Migrated `useCalendarApi.ts`:** Removed dead `rescheduleJob()`, `useRescheduleJob()`, `RescheduleJobPayload`. Replaced `unscheduleJob()` / `useUnscheduleJob()` with `unscheduleVisit()` / `useUnscheduleVisit()` calling `POST /api/calendar/visit/:visitId/unschedule`.
- **Migrated `jobScheduling.ts`:** `applyJobSchedule()` update path now calls `PATCH /api/calendar/visit/:visitId/reschedule` instead of legacy `PATCH /api/calendar/schedule/:jobId`. `unscheduleJob()` now fetches current visit via `/api/jobs/:jobId/visits` then calls `POST /api/calendar/visit/:visitId/unschedule`. Added `getCurrentVisitForJob()` helper for visit ID derivation.
- **Migrated `JobVisitsSection.tsx`:** Switched from `useUnscheduleJob` to `useUnscheduleVisit`, passing `{ visitId: currentEligibleVisit.id, version: currentEligibleVisit.version }`.
- **Migrated `JobDetailPage.tsx`:** Switched from `useUnscheduleJob` to `useUnscheduleVisit`, passing `{ visitId: activeVisit.id, version: activeVisit.version }`.
- **Migrated `ScheduleJobModal.tsx`:** Changed `existingAssignmentId` to `visitId` parameter for `applyJobSchedule`.
- **Migrated `QuickAddJobDialog.tsx`:** Changed to `isUpdate` flag (triggers auto-fetch of current visit ID).
- **Fixed `useCalendarDnD.ts`:** Updated diagnostic log strings to reference actual visit-centric endpoints.
- **Cleaned `storage/index.ts`:** Removed dead `rescheduleCalendarJob` and `unscheduleCalendarJob` bindings.
- **Cleaned `server/routes/calendar.ts`:** Removed `jobVisitsRepository` import (only used by deprecated resize route).
- **Files:** `client/src/hooks/useCalendarApi.ts`, `client/src/lib/jobScheduling.ts`, `client/src/components/JobVisitsSection.tsx`, `client/src/pages/JobDetailPage.tsx`, `client/src/components/calendar/ScheduleJobModal.tsx`, `client/src/components/QuickAddJobDialog.tsx`, `client/src/hooks/useCalendarDnD.ts`, `server/routes/calendar.ts`, `server/storage/index.ts`

### Fixed

#### Calendar: Unschedule Payload Field Name Mismatch — `expectedVersion` vs `version` (2026-03-06)
- **Root cause:** Five unschedule call sites sent `{ expectedVersion }` but the server schema (`unscheduleJobSchema`) expects `{ version }`. Zod strips unknown keys, so `expectedVersion` was silently dropped and the required `version` field was missing — causing 400 validation errors on DnD unschedule, bulk clear, and dispatch panel unschedule.
- **Fix:** Changed all 5 call sites from `expectedVersion` to `version`: `useCalendarDnD.ts` (deleteAssignment, clearSchedule, clearDay), `DispatchDetailPanel.tsx` (unscheduleMutation), `JobDetailDialog.tsx` (unscheduleJob).
- **Files:** `client/src/hooks/useCalendarDnD.ts`, `client/src/components/calendar/DispatchDetailPanel.tsx`, `client/src/components/JobDetailDialog.tsx`

#### Calendar: Missing Version in jobScheduling.ts Reschedule Path (2026-03-06)
- **Root cause:** `applyJobSchedule()` update path called `PATCH /api/calendar/visit/:visitId/reschedule` without sending `version`, but the server schema requires `version: z.number().int()` — causing 400 validation errors when rescheduling via ScheduleJobModal or QuickAddJobDialog edit flows.
- **Fix:** Added `visitVersion` option to `applyJobSchedule()`. When provided (ScheduleJobModal), uses it directly. When not available (QuickAddJobDialog `isUpdate` flow), fetches fresh version via `getCurrentVisitForJob()`. Version is now always included in the reschedule payload.
- **Files:** `client/src/lib/jobScheduling.ts`

#### Calendar: JobDetailDialog Version Mismatch on Technician Assignment (2026-03-06)
- **Root cause:** `assignTechnicianMutation` called legacy `PATCH /api/calendar/schedule/${jobId}` sending `localVersion` (visit version after the scheduled events query fix) but the server validated against `existingJob.version` (job version). Independent version counters meant false 409 conflicts on technician changes from the dialog.
- **Fix:** Switched to visit-centric `PATCH /api/calendar/visit/${visitId}/reschedule` endpoint which validates against visit version, matching what `localVersion` now carries.
- **Files:** `client/src/components/JobDetailDialog.tsx`

#### Calendar: jobScheduling.ts Unschedule Fails with Hard-Coded version: 0 (2026-03-06)
- **Root cause:** `unscheduleJob()` sent `version: 0` to the legacy unschedule endpoint. Since `0` is defined (not undefined), the server runs the version check: `existingJob.version !== 0`. Any job modified at least once (version > 0) would fail with a false VersionMismatchError.
- **Fix:** Omit the version field entirely from the unschedule payload so the server skips the optimistic lock check. This is safe for job-management flows that don't need concurrent-edit protection.
- **Files:** `client/src/lib/jobScheduling.ts`

#### Calendar: False "Scheduling Conflict" on Weekly Drag/Move (2026-03-06)
- **Root cause:** The scheduled events query (`getScheduledJobsInRange`) selected `j.version` (job version) but the visit-centric reschedule endpoint (`rescheduleVisit`) validates against `jv.version` (visit version). These are independent counters that diverge immediately — job version increments on job-level changes while visit version increments on visit-level changes, causing false conflict detection on every drag after any version drift.
- **Fix:** Added `jv.version as visit_version` to the scheduled events SQL query. Mapped `visit_version` (not `j.version`) into the `CalendarJobWithDetails.version` field for scheduled events. Client already sends `item.version` in mutation payload — it now carries the correct visit version that matches what `rescheduleVisit` checks. Backlog/unscheduled items still use `j.version` (correct for `scheduleJob`).
- **Files:** `server/storage/calendar.ts`

#### Calendar: Resize End Triggering Slot Click / Quick-Create (2026-03-06)
- **Root cause:** The resize handle's `handleResizeEnd` callback lacked `stopPropagation()`/`preventDefault()`, allowing the `pointerup` event to bubble to the parent grid cell's `onClick` handler. The grid's click guard only checked for `data-testid^="assigned-client-"` elements, missing `data-testid^="resize-handle-"` elements entirely. This caused `onEmptySlotClick()` to fire, opening the quick-create dialog after every resize operation.
- **Fix:** (1) Added `e.stopPropagation()` and `e.preventDefault()` to `handleResizeEnd` in `ResizableJobCard.tsx`. (2) Extended the `closest()` guard in all three grid click handlers to also check for `[data-testid^="resize-handle-"]`.
- **Files:** `client/src/components/calendar/ResizableJobCard.tsx`, `client/src/components/calendar/CalendarGridWeek.tsx`, `client/src/components/calendar/CalendarGridDayJobber.tsx`, `client/src/components/calendar/CalendarGridDayRows.tsx`

### Added

#### Equipment Service Timeline (2026-03-06)
- **New feature:** Equipment records now show a chronological service timeline in the detail expansion. Displays visit-level history with date, type (PM/Service/Inspection/Install), summary, technician name, visit status, and outcome badges.
- **Data source:** Aggregates from existing `job_equipment → jobs → job_visits → users` join path. No new tables or event system — reuses existing relationships.
- **API:** New `GET /api/equipment/:equipmentId/timeline` endpoint. Returns up to 50 newest-first timeline entries with display-ready shape. Tenant-scoped, auth-required.
- **UI component:** New `EquipmentServiceTimeline` — reusable, read-only component with loading skeleton, empty state ("No service history"), and vertical timeline with color-coded type icons.
- **Replaces:** Old basic service history section in equipment detail (which showed job-level rows from a non-existent API endpoint) with the new visit-granularity timeline.
- **Cleanup:** Removed unused `EquipmentWithHistory` interface, `equipmentDetails` query, `Calendar`/`Settings` icon imports, and `Job` type import from `LocationEquipmentSection`.
- **New files:** `client/src/components/EquipmentServiceTimeline.tsx`
- **Modified files:** `server/routes/equipmentCatalogItems.routes.ts`, `client/src/components/LocationEquipmentSection.tsx`

#### Equipment Nameplate Photo Capture with OCR (2026-03-06)
- **New feature:** Techs and admins can take or upload a nameplate photo when creating/editing equipment. The app attempts OCR extraction (manufacturer, model number, serial number) from the image using Claude Vision API, but always saves the photo regardless of OCR success.
- **OCR integration:** Isolated `nameplateOcr` service using Anthropic SDK (`claude-haiku-4-5-20251001`). Gracefully handles missing API key, unsupported image types, and extraction failures. Partial results are accepted and surfaced.
- **Database:** Added `nameplate_photo_id` column (FK to `files`) on `location_equipment` table. ON DELETE SET NULL.
- **API endpoints:** `POST /api/clients/:locationId/equipment/:equipmentId/nameplate` — upload photo + OCR (TECH_ROLES). `DELETE /api/clients/:locationId/equipment/:equipmentId/nameplate` — remove photo link (TECH_ROLES).
- **UI:** New `NameplateCaptureSection` component in equipment create/edit dialog with "Take Photo" (camera capture) and "Upload" buttons. Shows image preview, OCR status feedback ("Reading nameplate…", success/partial/failed messages), and remove button. OCR results prefill empty manufacturer/model/serial fields.
- **Equipment detail:** Expanded equipment rows show "Nameplate Photo" section with clickable image when present.
- **Deferred upload:** When creating new equipment (no ID yet), the photo is held locally and uploaded after equipment creation succeeds.
- **Migration:** `migrations/2026_03_06_equipment_nameplate_photo.sql`
- **New files:** `migrations/2026_03_06_equipment_nameplate_photo.sql`, `server/services/nameplateOcr.ts`, `client/src/components/NameplateCaptureSection.tsx`
- **Modified files:** `shared/schema.ts`, `server/routes/clients.ts`, `client/src/components/LocationEquipmentSection.tsx`
- **New dependency:** `@anthropic-ai/sdk`

### Changed

#### Calendar Toolbar: Move Secondary Controls into "More" Menu (2026-03-06)
- **Added "More" dropdown menu** (three-dot icon) in calendar toolbar for week/day views. Contains secondary controls moved off the main toolbar surface.
- **Moved "Hide Weekends" toggle** into More menu (week view only). Label still reflects current state ("Hide Weekends" / "Show Weekends"). Behavior unchanged.
- **Moved "Start Hour" selector** into More menu (week + day views). Select dropdown works interactively inside the menu. Behavior and persistence unchanged.
- **Removed standalone controls** from main toolbar: the `Start:` label + select and the Hide Weekends button no longer occupy top-level toolbar space.
- **Cleaned up imports:** Removed unused `CalendarOff` standalone usage; added `MoreHorizontal`, `Clock` icons and `DropdownMenu` primitives.
- **Files modified:** `client/src/components/calendar/CalendarHeader.tsx`

#### Equipment Catalog Item Associations (2026-03-06)
- **New feature:** Equipment records can now reference items from the parts/services catalog (QBO synced). These are purely informational — they help technicians and office staff see items commonly used when servicing a unit.
- **Database:** New `equipment_catalog_items` table with unique constraint on (company_id, equipment_id, catalog_item_id), indexed for fast lookup by equipment and reverse lookup by catalog item.
- **API routes:** 5 new endpoints under `/api/equipment/:equipmentId/catalog-items` — GET (list), POST (add), PATCH (update qty/notes), DELETE (remove), POST /reorder (bulk sort). MANAGER_ROLES can modify; all authenticated users can read. Tenant isolation enforced on all operations.
- **Equipment detail UI:** Expanded equipment rows in `LocationEquipmentSection` now show an "Associated Catalog Items" section with add/edit/remove controls for admin/office users.
- **Job equipment UI (visit/PM context):** `JobEquipmentSection` shows a read-only "Typical Parts / Materials" display below each linked equipment, showing associated catalog items. No editing from job/visit context.
- **Migration:** `migrations/2026_03_06_equipment_catalog_items.sql`
- **New files:** `migrations/2026_03_06_equipment_catalog_items.sql`, `server/routes/equipmentCatalogItems.routes.ts`, `client/src/components/EquipmentCatalogItemsSection.tsx`
- **Modified files:** `shared/schema.ts`, `server/routes/index.ts`, `client/src/components/LocationEquipmentSection.tsx`, `client/src/components/JobEquipmentSection.tsx`

#### Calendar UI: Remove Parts Button + Add Hide Weekends Toggle (2026-03-06)
- **Removed Parts button** from calendar header toolbar. The parts feature was disabled (no backend endpoint). Removed: button JSX, `onPartsClick` prop, `handlePartsClick` handler, `calculatePartsWithDates` helper, 4 state variables, `PartsDialog` render, `bulkParts`/`isLoadingParts` stubs, and `PartsDialog` import from Calendar.tsx. `Package` icon removed from CalendarHeader imports.
- **Added "Hide Weekends" toggle** in week view toolbar. When active, Saturday and Sunday columns are excluded from the week grid. Remaining 5 weekday columns expand to fill available width. All-day row, timed grid, day headers, drop zones, business hours shading, and "Now" line stay aligned via dynamic `gridTemplateColumns` inline style.
- **Persisted via localStorage** using existing `useCalendarState` preference system (same pattern as `showFullDay`, `dayLayout`, `riskFirstSort`).
- **Files modified:** `client/src/pages/Calendar.tsx`, `client/src/components/calendar/CalendarHeader.tsx`, `client/src/components/calendar/CalendarGridWeek.tsx`, `client/src/hooks/useCalendarState.ts`

#### Technician-Originated Live Dispatch Signals (2026-03-06)
- **Visit mutation freshness:** All 9 write endpoints in `jobVisits.routes.ts` now emit dispatch signals via `emitDispatch()`. When technicians change visit status, check in/out, arrive/depart, or when visits are created/updated/deleted/archived, dispatcher boards refresh in near real time.
- **Board-visible signals:** Status changes (scheduled → in_progress → on_site → completed) update status dots and checkmarks on calendar cards. Create/delete/archive add or remove cards.
- **Activity-only signals:** `tech.arrived` and `tech.departed` refresh the dispatch panel's activity timeline without changing calendar card rendering.
- **No client changes needed:** Existing `invalidateForSignal()` already handles `entityType: "visit"` signals with broad prefix matching on `/api/calendar`, `/api/calendar/unscheduled`, `/api/calendar/needs-follow-up`, `/api/calendar/day-summary`, and `/api/activity/dispatch/*`.
- **Files modified:** `server/routes/jobVisits.routes.ts`

#### Real-Time Dispatch Freshness — Hardening (2026-03-06)
- **Expanded mutation coverage:** Added emitDispatch to 5 previously uncovered mutation paths: legacy job resize (`calendar.ts`), job close/archive (`jobs.ts`), job reopen (`jobs.ts`), task assign (`tasks.routes.ts`), task reopen (`tasks.routes.ts`).
- **Day-summary invalidation:** Added `/api/calendar/day-summary` to client-side `invalidateForSignal()` so day view counts refresh on SSE signals.
- **Idempotent SSE cleanup:** Added guard to `dispatch-stream.ts` cleanup function to prevent double-cleanup when both `close` and `error` events fire.
- **Files modified:** `server/routes/calendar.ts`, `server/routes/jobs.ts`, `server/routes/tasks.routes.ts`, `client/src/hooks/useDispatchStream.ts`, `server/routes/dispatch-stream.ts`

#### Real-Time Dispatch Freshness — Phase 1 (2026-03-06)
- **SSE-based multi-user live updates:** Dispatch board now receives real-time invalidation signals via Server-Sent Events. When any dispatcher reschedules, assigns, unschedules, or completes a visit, all other connected dispatchers see the updated board within ~1 second.
- **In-process dispatch bus:** New `server/lib/dispatchBus.ts` provides tenant-scoped pub/sub via Node.js EventEmitter. Signals are emitted from successful mutation handlers (not from event logging), ensuring they fire only after DB success.
- **SSE endpoint:** `GET /api/dispatch/stream` sends `dispatch` events with tiny invalidation payloads (`{scope, entityType, entityId, ts}`). Includes 30s heartbeat to prevent proxy timeouts. Auto-reconnect with exponential backoff on client side.
- **Cross-tab freshness:** `BroadcastChannel` syncs invalidation across same-user tabs with zero server involvement.
- **Mutation coverage:** Calendar schedule, reschedule (job + visit), unschedule (job + visit), resize, and task create/update/close/delete all emit dispatch signals.
- **Signal-only architecture:** SSE carries invalidation hints, not DTOs. Clients refetch via existing REST endpoints, preserving the visit-centric read model.
- **New files:** `server/lib/dispatchBus.ts`, `server/routes/dispatch-stream.ts`, `client/src/hooks/useDispatchStream.ts`
- **Modified files:** `server/routes/calendar.ts`, `server/routes/tasks.routes.ts`, `server/routes/index.ts`, `client/src/pages/Calendar.tsx`

#### Dispatch Detail Panel (2026-03-06)
- **Right-side panel for visit events:** Clicking a calendar visit event now opens a compact right-side Sheet panel instead of the full-screen JobDetailDialog. Panel is non-modal — calendar remains interactive while panel is open.
- **Panel header:** Shows company name, Job # badge, Visit # badge, summary, and status badges (completed, visit status, outcome with amber styling for needs_parts/needs_followup).
- **Visit schedule section:** Read-only display of date, time range, duration. Inline "Edit" mode with date picker, time input, and duration dropdown that calls `PATCH /api/calendar/visit/:visitId/reschedule`.
- **Technician section:** Read-only display with "Change" button. Inline edit mode with technician select dropdown using existing `onAssignTechnicians` callback.
- **Outcome note display:** Shows structured visit outcome note when present.
- **Job context section:** Displays job status, type, and priority metadata.
- **Quick actions in footer:** Unschedule button (visit-centric), Add Visit button (launches existing AddVisitDialog), Full Details escape hatch (transfers to JobDetailDialog), Visit History link (navigates to `/jobs/:id?section=visits`).
- **Click routing logic:** Visit events → dispatch panel. Task events → TaskDialog (unchanged). Unscheduled sidebar items → JobDetailDialog (unchanged). Reschedule context menu → JobDetailDialog with focusSchedule (unchanged).
- **Panel state:** Only one panel open at a time. Clicking different event updates content. Closing clears selection. `modal={false}` prevents overlay from blocking calendar.
- **New component:** `DispatchDetailPanel.tsx` in `client/src/components/calendar/`
- **Files modified:** `DispatchDetailPanel.tsx` (new), `Calendar.tsx`

#### Recent Activity Timeline — Auth & Invalidation Fix (2026-03-06)
- **Fixed auth bug:** Activity query used raw `fetch()` without `credentials: 'include'`, causing silent 401 failures behind session-cookie auth. Replaced with the app's default `getQueryFn` via full-URL `queryKey` pattern.
- **Added query invalidation:** Reschedule, unschedule, and notes-save mutations now invalidate the dispatch activity query so the timeline refreshes after local changes.
- **Files modified:** `DispatchDetailPanel.tsx`

#### Recent Activity Timeline in Panel (2026-03-06)
- **Compact dispatch timeline:** DispatchDetailPanel now shows the 6 most recent activity events for the current job + visit, with relative timestamps and severity-colored dots.
- **Combined job + visit events:** New `GET /api/activity/dispatch/:jobId/:visitId` endpoint fetches events from both `entityType=job` and `entityType=visit` in a single query, covering scheduling, assignment, and visit lifecycle actions.
- **Event type labels:** Dispatch-relevant labels map raw event types to compact human text (e.g., `job.rescheduled` → "Rescheduled", `tech.arrived` → "Tech arrived").
- **Severity indicators:** Red dot for important, amber for warning, muted for info events.
- **Read-only, no pagination:** Intentionally minimal — shows last 6 items with no filters, editing, or infinite scroll. Dispatchers needing full history use the "Full Details" escape hatch.
- **Files modified:** `DispatchDetailPanel.tsx`, `server/routes/activity.ts`, `server/storage/events.ts`

#### Access / Site Context in Panel (2026-03-06)
- **Access instructions surfaced:** Job-level `accessInstructions` (gate codes, roof access, key info) now displayed in the DispatchDetailPanel under a dedicated "Access / Site" section with key icon.
- **Location notes surfaced:** Site-specific `notes` from `client_locations` shown alongside access instructions for arrival context.
- **Contact info section:** Location `contactName` and `phone` shown in a compact "Contact" section with clickable `tel:` link for quick dialing.
- **Panel section order:** Outcome Note → Visit Notes → Access / Site → Contact → Job Description → Job Context. Most actionable dispatch info appears first.
- **Calendar DTO expanded:** API now returns `accessInstructions`, `contactName`, `contactPhone`, `locationNotes` on each calendar event.
- **Files modified:** `DispatchDetailPanel.tsx`, `server/storage/calendar.ts`, `server/routes/calendar.ts`, `shared/types/calendar.ts`

#### Panel Dispatch Notes (2026-03-06)
- **Visit notes in panel:** DispatchDetailPanel now shows `visitNotes` with inline editing. Dispatchers can add/edit operational notes directly in the panel without navigating to the full job detail.
- **Outcome note preserved:** Technician-authored `outcomeNote` remains read-only and visually distinct from editable visit notes.
- **Job description context:** If the parent job has a `description`, it's shown as read-only context in the panel.
- **Visit-centric save:** Notes save via `PATCH /api/calendar/visit/:visitId/reschedule` with `{ notes, version }`, updating only the specific visit's `visitNotes`.
- **Calendar DTO expanded:** Calendar API now returns `visitNotes`, `outcomeNote`, and `description` fields on each event.
- **Files modified:** `DispatchDetailPanel.tsx`, `server/storage/calendar.ts`, `server/routes/calendar.ts`, `shared/types/calendar.ts`

#### Off-Hours Availability Overlays (2026-03-06)
- **Off-hours shading on all timed views:** Calendar day columns, day rows, and week views now show subtle gray background tint (`bg-slate-200/70`) for hours outside configured business hours. Helps dispatchers quickly identify schedulable vs non-working time.
- **Per-day-of-week shading in week view:** Each day column in the weekly grid independently checks business hours for its day of week. Saturday/Sunday columns shade fully if business is closed those days.
- **Time rail/header shading:** Hour labels in the time rail (day columns) and time header (day rows) are dimmed for off-hours, providing consistent visual cues across the full grid.
- **No drag/drop interference:** All shading is applied via background CSS classes. Drop zones and pointer events are unaffected.
- **Data source:** Company-wide business hours from `company_business_hours` table. Falls back to 6AM-5PM Mon-Fri when not configured. Per-technician schedules not yet available (deferred).
- **Files modified:** `CalendarGridDayJobber.tsx`, `CalendarGridDayRows.tsx`, `CalendarGridWeek.tsx`, `Calendar.tsx`

#### Visit Status Visual System (2026-03-06)
- **Status dots on calendar cards:** Visit lifecycle status (dispatched, en_route, on_site, in_progress, on_hold) now shows as a small colored dot before the company name on calendar visit cards. Scheduled (default) shows no dot to reduce noise. Completed retains existing checkmark + muted styling.
- **Shared status config:** New `VISIT_STATUS_STYLES` and `VISIT_OUTCOME_STYLES` in `calendarUtils.ts` provide canonical color mappings shared between board cards and DispatchDetailPanel.
- **Panel badge alignment:** DispatchDetailPanel status badges now use the shared config with colored dots and consistent badge styling, replacing inline hardcoded styles.
- **Tasks preserved:** Task cards are unaffected — no visitStatus field exists on task events. Violet border and ClipboardList icon badge unchanged.
- **Memo comparison updated:** DraggableClient memo now includes `visitStatus` and `visitOutcome` for proper rerender on status changes.
- **Files modified:** `calendarUtils.ts`, `DraggableClient.tsx`, `DispatchDetailPanel.tsx`

#### Tech Reassignment Audit (2026-03-06)
- **Audit confirmed visit-centric:** Full trace from DispatchDetailPanel → Calendar.tsx → useCalendarDnD.ts → `PATCH /api/calendar/visit/:visitId/reschedule` → `calendarRepository.rescheduleVisit()` → `jobVisitsRepository.updateJobVisit()`. All steps are visit-scoped.
- **Multi-visit safe:** Tech change on one visit does not affect other visits on the same job. Job-level `primaryTechnicianId` is a mirror of the "next upcoming" visit only.
- **No code changes needed:** Initial concern that tech reassignment used the legacy job-based endpoint was incorrect — the client-side mutation already calls the visit-centric endpoint.
- **Documentation updated:** `docs/REFACTORING_LOG.md` — added tech reassignment audit table.

#### Empty-Slot Quick-Create (2026-03-06)
- **Click empty time slot to create:** Clicking any empty time slot in Week, Day Columns, or Day Rows view opens a compact Quick Create dialog.
- **Job or Task toggle:** Dialog has Job/Task tabs. Job mode: client search + summary + technician → creates job via `createJobWithSchedule()`. Task mode: title → creates task via `POST /api/tasks` with scheduled start/end.
- **Prefilled from slot:** Date, time, and technician are prefilled from the clicked slot. Technician comes from the column/row that was clicked (Day view) or defaults to unassigned (Week view).
- **Duration chips:** Quick-pick 30m/60m/90m/2h duration with 60m default.
- **RBAC gated:** View-only users see "view only" toast instead of the dialog.
- **New component:** `QuickCreateSlotDialog.tsx` in `client/src/components/calendar/`
- **Grid click handlers:** Added `onEmptySlotClick` callback to `CalendarGridWeek`, `CalendarGridDayJobber`, `CalendarGridDayRows`. Click computes 15-minute-snapped time from cursor position.
- **Files modified:** `QuickCreateSlotDialog.tsx` (new), `CalendarGridWeek.tsx`, `CalendarGridDayJobber.tsx`, `CalendarGridDayRows.tsx`, `Calendar.tsx`, `calendar/index.ts`

#### Dispatch Board UI Refactor Pass 1 (2026-03-06)
- **Dispatch tray improvements:** Sidebar "Needs First Visit" and "Needs Follow-Up" sections both fully support drag-to-schedule. Follow-up items show amber-styled outcome context badges with outcome note and "Suggest slot" button.
- **Job number on cards:** Unscheduled tray cards now show `#jobNumber` badge for quick dispatch identification. Calendar event cards show `#jobNumber` alongside `V{visitNumber}`.
- **Visit outcome indicators on calendar:** Completed visits with `needs_parts` show Package icon; `needs_followup` shows RotateCcw icon in amber on calendar event cards.
- **"Add Visit" in calendar detail:** `JobDetailDialog` footer now has "Add Visit" button that opens `AddVisitDialog` for creating follow-up visits without navigating away from the calendar.
- **Visit context in dialog header:** `JobDetailDialog` header now shows "Visit #N" badge alongside "Job #N" link.
- **Dialog uses visit-centric endpoints:** `JobDetailDialog` schedule/unschedule mutations now use `PATCH /api/calendar/visit/:visitId/reschedule` and `POST /api/calendar/visit/:visitId/unschedule` (was legacy job-based endpoints).
- **Files modified:** `DraggableClient.tsx`, `CalendarSidebar.tsx`, `JobDetailDialog.tsx`, `Calendar.tsx`

#### Phase A: Structured Visit Outcomes (2026-03-06)
- **Tech completion writes structured fields:** `POST /api/tech/visits/:visitId/complete` now writes `outcome`, `outcomeNote`, `completedByUserId`, `completedAt`, and `isFollowUpNeeded` as structured columns (was text tags only in `visitNotes`). Legacy text tags preserved for backward compat.
- **Office completion writes outcome:** `updateJobVisitStatus()` now sets `completedAt` and `outcome = "completed"` when transitioning a visit to "completed" via office flow (if not already set by tech endpoint).
- **isFollowUpNeeded computed:** Set to `true` when outcome is `needs_parts` or `needs_followup`.
- **Files modified:** `server/routes/techField.ts`, `server/storage/jobVisits.ts`

#### Phase B: Unscheduled Work Split (2026-03-06)
- **Needs First Visit vs Needs Follow-Up:** Unscheduled sidebar now shows two sections:
  1. **Needs First Visit** — open jobs with no visits yet (existing behavior, refined)
  2. **Needs Follow-Up** — open jobs where the last completed visit has `isFollowUpNeeded=true` and no pending visit exists
- **New server query:** `getJobsNeedingFollowUp()` in `server/storage/calendar.ts` queries visit outcomes to find follow-up work. Uses `DISTINCT ON` for efficient per-job latest visit.
- **New API endpoint:** `GET /api/calendar/needs-follow-up` returns follow-up items with context fields (`lastOutcome`, `lastOutcomeNote`, `lastVisitCompletedAt`, `lastVisitNumber`).
- **Existing unscheduled filtered:** `getUnscheduledJobs()` now excludes jobs that belong in the follow-up section (prevents duplicates).
- **Follow-up drag behavior:** Dragging a follow-up item to the calendar creates a new visit via the existing first-schedule flow (`POST /api/calendar/schedule`). Previous completed visit stays closed. The item disappears from follow-up once a pending visit exists.
- **Sidebar UI:** `CalendarSidebar` renders section headers ("Needs First Visit" / "Needs Follow-Up") with counts and follow-up context badges showing visit outcome.
- **Cache invalidation:** `invalidateNarrow()` now also invalidates `/api/calendar/needs-follow-up` when unscheduled data changes.
- **Files modified:** `server/storage/calendar.ts`, `server/routes/calendar.ts`, `client/src/components/calendar/CalendarSidebar.tsx`, `client/src/pages/Calendar.tsx`, `client/src/hooks/useCalendarDnD.ts`

#### Dispatch-Calendar Phase 2: Visit-Centric Calendar Read Path (2026-03-06)
- **Visit-centric events:** Calendar API now returns one event per eligible visit instead of one per job. Multiple visits for the same job appear as separate calendar events.
- **Removed ROW_NUMBER dedup:** `getScheduledJobsInRange()` no longer uses `ROW_NUMBER() PARTITION BY job_id` to pick a single visit. All non-cancelled visits with `scheduled_start` in range are returned.
- **Event identity = visitId:** `CalendarJobWithDetails.id` is now `visit_id` (was `job_id`). The DTO `id` field reflects this. `jobId` remains as a separate field for linking to job detail.
- **Completed visits included:** Previously excluded `completed` visits from calendar. Now shows all non-cancelled scheduled visits so dispatchers can see visit outcomes.
- **New DTO fields:** Added `visitStatus` (visit-level status) and `visitOutcome` (structured outcome from Phase 1) to `CalendarEventDto` and `CalendarJobWithDetails`.
- **Files modified:** `server/storage/calendar.ts`, `server/routes/calendar.ts`, `shared/types/calendar.ts`
- **Breaking:** Client code reading `event.id` as jobId must now use `event.jobId` instead. Phase 3 (client normalization) will handle this.

#### Dispatch-Calendar Phase 3: Client Normalization Pivot (2026-03-06)
- **Visit-centric assignmentId:** `normalizeAssignments()` now sets `assignmentId = visitId` (was `jobId`). Visit events are identified by visitId throughout the client.
- **Explicit jobId on CalendarEvent:** Added `jobId: string` field to `CalendarEvent` type. Always populated from `a.jobId` in normalization. Tasks have empty `jobId`.
- **Transitional write adapters:** All DnD mutations extract `jobId` from the raw event for API calls since server endpoints still use `:jobId` URL params (Phase 4 will fix).
  - `activeJobId` extracted at top of drag handler for existing calendar events
  - `handleRemove` extracts `assignment.jobId` for delete mutations
  - `handleUnschedule` accepts optional `jobId` parameter
- **Defensive cache matching:** `useCalendarDnD.ts` optimistic update matchers now check `(a.id === params.id || a.jobId === params.id)` for Phase 3 compatibility.
- **Completed visit detection:** `normalizeAssignments()` now checks `visitStatus === 'completed'` in addition to job-level status for the `completed` flag.
- **Visit-enriched click handler:** `handleClientClick` now adds `visitId` to the enriched assignment for future Phase 6 use.
- **Files modified:** `client/src/components/calendar/calendarUtils.ts`, `client/src/pages/Calendar.tsx`, `client/src/hooks/useCalendarDnD.ts`
- **Known risk:** `savingJobIds` set contains jobId but grid checks `event.assignmentId` (visitId) — saving indicator falls back to `event.raw._saving` flag. **RESOLVED in Phase 4.**

#### Dispatch-Calendar Phase 4: Visit-Centric Write Path (2026-03-06)
- **Visit-centric server endpoints:** Added three new route handlers in `server/routes/calendar.ts`:
  - `PATCH /api/calendar/visit/:visitId/reschedule` — reschedule or reassign an existing visit
  - `POST /api/calendar/visit/:visitId/unschedule` — unschedule a visit (convert to placeholder)
  - `POST /api/calendar/visit/:visitId/resize` — resize a visit's end time
- **Visit-centric storage methods:** Added `rescheduleVisit()`, `unscheduleVisit()`, `resizeVisit()` to `server/storage/calendar.ts`. These fetch the visit directly (not via job), use `visit.version` for optimistic locking, and support spawn-on-action mode.
- **Client mutations updated:** `useCalendarDnD.ts` now calls visit-centric endpoints for all existing-visit mutations:
  - `updateAssignment` → `PATCH /api/calendar/visit/:visitId/reschedule`
  - `deleteAssignment` → `POST /api/calendar/visit/:visitId/unschedule`
  - `updateDuration` → `POST /api/calendar/visit/:visitId/resize`
  - `assignTechnicians` → `PATCH /api/calendar/visit/:visitId/reschedule`
  - `clearSchedule` / `clearDay` → `POST /api/calendar/visit/:visitId/unschedule`
  - `toggleComplete` → `PATCH /api/calendar/visit/:visitId/reschedule`
- **First-schedule unchanged:** `createAssignment` still uses `POST /api/calendar/schedule` with jobId (Flow A).
- **Removed Phase 3 transitional adapters:**
  - Removed `activeJobId` / `activeRawEvent` extraction from Calendar.tsx drag handler — existing events now pass `activeIdValue` (visitId) directly
  - Removed `jobId || assignmentId` fallback in `handleRemove` — visitId passed directly
  - Removed `jobId` param from `handleUnschedule` — visitId sufficient
  - Removed dual-match `(a.id === params.id || a.jobId === params.id)` from `useCalendarDnD.ts` optimistic updates — single `a.id === params.id` match
- **Saving indicator aligned:** `savingJobIds` now tracks visitId for existing visit events (matches `event.assignmentId` checked by grid components).
- **Files modified:** `server/storage/calendar.ts`, `server/routes/calendar.ts`, `client/src/hooks/useCalendarDnD.ts`, `client/src/pages/Calendar.tsx`

### Fixed

#### All-Day to Timed Drop Duration Bug (2026-03-06)
- **Root cause:** When an all-day event (durationMinutes=1440) was dragged to a timed slot, `ResizableJobCard` read `event.raw.durationMinutes` (1440) directly instead of the normalized `CalendarEvent.durationMinutes` (60). This made the event visually span "rest of day" from the drop time.
- **Fix 1 — Patch raw.durationMinutes in normalizeAssignments:** `patchedRaw` now also writes the computed `durationMinutes` so `ResizableJobCard` and other components reading from `event.raw` get the correct value.
- **Fix 2 — Optimistic update patches durationMinutes:** The `updateAssignment` optimistic update in `useCalendarDnD.ts` now writes the effective (clamped) `durationMinutes` on the raw event, preventing the stale 1440 from showing during optimistic render.
- **Fix 3 — Task timed drops send scheduledEndAt:** The task drag path in `Calendar.tsx` now computes `scheduledEndAt = scheduledStartAt + DEFAULT_TIMED_DURATION_MINUTES` for timed drops, ensuring the server stores a proper end time.
- **Fix 4 — Centralized default duration:** Added `DEFAULT_TIMED_DURATION_MINUTES = 60` constant in `calendarUtils.ts`, imported by `useCalendarDnD.ts` and `Calendar.tsx`. Single source of truth for future per-company settings integration.
- **Files modified:** `calendarUtils.ts`, `useCalendarDnD.ts`, `Calendar.tsx`

### Changed

#### Canonical Calendar Architecture — Unified Normalization, Titles, and All-Day Rendering (2026-03-06)
- **Unified normalization pipeline:** Moved task normalization from `calendarItems.ts` into `calendarUtils.ts` as `normalizeTask()`, returning `CalendarEvent` (same type as visits). Deleted vestigial `CalendarItem` type (dead `title`/`subtitle` fields unused by any view) and `visitToCalendarItem()` (never imported). Deleted `calendarItems.ts` entirely. `Calendar.tsx` now imports `normalizeTask` from `calendarUtils` instead of `taskToCalendarItem` from `calendarItems`.
- **Unified title resolution:** `getEventTitle()` is now the single canonical title resolver. `getEventClient()` delegates to `getEventTitle()` for the `companyName` field, so Week/Day views (which render via `client.companyName`) resolve titles through the same path as Month view. Removed all inline title logic from `DraggableAllDayChip` in Day Rows.
- **Unified all-day rendering:** Day Rows `DraggableAllDayChip` replaced with `CalendarEventChip` — the same compact chip used by Month view. All-day items across Month, Week, Day Columns, and Day Rows now use the same shared helpers: `getEventTitle()`, `getEventColor()`, `getEventOverdue()`, `getEventCapabilities()`. No remaining inline violet/primary hardcoded classes.
- **CalendarEventChip gains `draggable` prop:** Tasks are non-draggable via `getEventCapabilities().draggable`, now passed through to `CalendarEventChip` in Month visible/overflow and Day Rows all-day.
- **Shared canonical helpers in `calendarUtils.ts`:** `getEventTitle()`, `getEventOverdue()`, `getEventColor()`, `getEventCapabilities()`, `getEventClient()`, `TASK_COLOR` constant, and `normalizeTask()`.
- **Files modified:** `calendarUtils.ts`, `CalendarEventChip.tsx`, `CalendarGridMonth.tsx`, `CalendarGridWeek.tsx`, `CalendarGridDayJobber.tsx`, `CalendarGridDayRows.tsx`, `Calendar.tsx`, `JobCard.tsx`, `index.ts`
- **Files deleted:** `calendarItems.ts`, `CalendarGridWeekTechnicians.tsx`, `EventPreviewPopover.tsx`

#### Weekly View — Time-Based Schedule Grid (2026-03-06)
- **Replaced technician-row matrix with time-based week schedule.** Weekly view now shows day columns × hour rows with an all-day lane at top, matching the mental model of a scheduling board. Technicians are controlled via the existing visibility filter (hide/show techs), not as the layout axis. The old tech-row weekly view (`CalendarGridWeekTechnicians`) is no longer rendered.
- **Reused existing `CalendarGridWeek` component** that was already in the codebase but unused (replaced in Phase 8a). Adapted its filtering from `selectedTechnicianId` to `hiddenTechnicianIds` to match the current filter system. Added `itemKind` passthrough for task visual distinction.
- **Features preserved:** all-day lane with expand/collapse, 15-minute drop zones for drag scheduling, current time "Now" line, business hours toggle (6-20h / 24h), technician color coding, lane-based overlap layout for concurrent events.
- **Click routing preserved:** `handleClientClick` (with shared `isTaskEvent()` routing) is used for all click paths — tasks open Edit Task modal, visits open visit/job modal.
- **Removed dead code:** `handleTechWeekJobClick`, `handleTechWeekSlotClick`, `handleScheduleNew` handlers and `CalendarGridWeekTechnicians` import removed from Calendar.tsx. `toClientsArray`/`resolveClientForCalendarEvent` imports removed (no longer needed).
- **`ResizableJobCard` updated:** Added `itemKind` prop passthrough to `JobCard` for task styling in timed weekly slots.
- **Files:** `Calendar.tsx`, `CalendarGridWeek.tsx`, `ResizableJobCard.tsx`

#### Calendar Entity Typing + Click Routing + Hover Removal (2026-03-06)
- **Explicit `kind` discriminator on `CalendarEvent`:** Added `kind: "visit" | "task"` to the `CalendarEvent` type in `calendarUtils.ts`. `normalizeAssignments()` sets `kind: "visit"` on all job events. `taskToCalendarItem()` already set `kind: "task"`. All view components now use `event.kind` directly instead of `(event as any).kind` casts.
- **Shared click routing helpers:** Added `isTaskEvent()` and `getTaskIdFromEvent()` in `calendarUtils.ts`. Both `handleClientClick` and `handleTechWeekJobClick` in `Calendar.tsx` now use these shared helpers for task detection — previously `handleTechWeekJobClick` had NO task check and always opened the job modal for task clicks.
- **Removed hover preview (EventPreviewPopover):** Removed `EventPreviewPopover` wrapper from `CalendarGridMonth.tsx` (2 usages) and `JobCard.tsx` (1 usage, affects all week/day views). Removed hover logging (`logHover`) from `DraggableClient.tsx`. Simplified `CalendarEventChip` by removing `forwardRef` (was only needed for `HoverCardTrigger`). `EventPreviewPopover.tsx` is now dead code with zero imports.
- **Files:** `calendarUtils.ts`, `Calendar.tsx`, `CalendarGridMonth.tsx`, `JobCard.tsx`, `CalendarEventChip.tsx`, `DraggableClient.tsx`, `CalendarGridDayJobber.tsx`, `CalendarGridDayRows.tsx`, `CalendarGridWeekTechnicians.tsx`, `calendarItems.ts`

### Fixed

#### Monthly Calendar — Tasks Not Appearing + Wrong Modal on Click (2026-03-06)
- **Bug 1 — Tasks missing from month view:** `eventsByDayNumber` memo (used exclusively by month grid) iterated over `normalizedEvents` (jobs only) instead of `mergedEvents` (jobs + tasks). Tasks were correctly fetched, normalized via `taskToCalendarItem`, and merged into `mergedEvents` — but the month-specific index skipped them. Week and day views used `mergedEvents` via `eventIndexes`, which is why tasks appeared there.
- **Bug 2 — Task click opens "Job #Unknown" modal:** This was a consequence of Bug 1. Since tasks never appeared in month view, the click path was untested. However, the existing `handleClientClick` already checks `kind === "task"` and routes to the TaskDialog. With Bug 1 fixed, task clicks in month view now correctly open the Edit Task modal.
- **Fix:** Changed `eventsByDayNumber` to iterate `mergedEvents` instead of `normalizedEvents`. One-line data source change; no click handler changes needed.
- **File:** `client/src/pages/Calendar.tsx`

### Changed

#### Monthly Calendar — Fixed-Height Dashboard Layout (2026-03-06)
- **Root cause:** `Calendar.tsx` used `h-screen` (100vh) on its outermost wrapper, but it renders inside the app shell's `<main className="flex-1 overflow-auto">` which is already bounded by the shell's own `h-screen`. This made the calendar taller than its parent, forcing the browser/main to scroll the entire page instead of the calendar scrolling internally.
- **Fix:** Changed all 3 occurrences of `h-screen` to `h-full` in `Calendar.tsx` (error state, loading state, main content). Added `overflow-hidden` to the main content wrapper so it stays within its bounded flex parent. In `CalendarGridMonth.tsx`, added `min-h-0` to the root, `shrink-0` to the day-name headers, and `min-h-0 overflow-y-auto` to the days grid so the month grid scrolls internally when content exceeds available height.
- **Files:** `client/src/pages/Calendar.tsx`, `client/src/components/calendar/CalendarGridMonth.tsx`

### Investigation

#### Day View Layout Root-Cause Phase 2 (2026-03-05)
- **Investigation report:** `docs/DAY_VIEW_LAYOUT_ROOT_CAUSE_2.md` — 4 root causes identified, 6 suspects cleared
- **RC1 (HIGH):** Per-column header height variance — all-day events + TechLaneHeader make sticky headers different heights per tech column, misaligning droppable rects across columns
- **RC2 (HIGH):** Only one column's header measured via `headerRef` — now-line and auto-scroll use potentially wrong offset
- **RC3 (MEDIUM):** `closestCenter` fallback in collision detection picks off-screen droppables when `pointerWithin` misses
- **Debug instrumentation extended:** Full ancestor chain walk, per-column header audit, droppable spot-checks, DnD collision logging — all gated behind `?debugLayout=1`
- **Files (debug-only changes):** `CalendarGridDayJobber.tsx`, `CalendarGridDayRows.tsx`, `CalendarGridWeek.tsx`, `Calendar.tsx`

### Fixed

#### Job Detail — Completed State Polish (2026-03-05)
- **Fix A — Completed date:** Canonical field is `closedAt` (timestamp). Both `POST /api/jobs/:id/status` (completed transition) and `POST /api/jobs/:id/close` (lifecycle) set `closedAt = NOW`. Server returns it via `getJobHeader`. Client renders at `JobDetailPage.tsx:1462`. No code change needed — path was already correct.
- **Fix B — Hide Active Visit on completed jobs:** When `job.status` is `completed`, `invoiced`, or `archived`, the "Active Visit" block is hidden. Instead, a "Last Completed Visit" preview (most recent completed visit) is shown above the history list. Open jobs still show Active Visit normally. (`JobDetailPage.tsx`)
- **Fix C — Server guard for visit uncomplete:** `POST /api/jobs/:jobId/visits/:visitId/status` now rejects transitions away from "completed" when the parent job is in a terminal status (`completed`/`invoiced`/`archived`) with 409: "Reopen job to uncomplete a visit." (`jobVisits.routes.ts`)
- **Files:** `client/src/pages/JobDetailPage.tsx`, `server/routes/jobVisits.routes.ts`

#### Day View Fix 1 — Uniform Header Height (2026-03-05)
- **Root cause:** Each tech column's sticky header had variable height (all-day events, TechLaneHeader badges). The timed grid started at different Y offsets per column, causing droppable rects to misalign. Drops at the same visual row could land in different time slots depending on column.
- **Fix:** Replaced single-column `headerRef`/`headerPx` measurement with multi-column `uniformHeaderPx` system. A shared `ResizeObserver` measures every column header via `makeHeaderRef(techKey)` callback refs. The MAX height across all columns is applied as `minHeight` to every header, guaranteeing the timed grid starts at the same Y coordinate in all columns.
- **Also fixed:** Now-line position, auto-scroll offset, and TimeRail header all use `uniformHeaderPx` instead of single-column measurement.
- **Debug:** `?debugLayout=1` now shows `uniformHeaderPx`, per-column header heights, and `hour8TopSpread` (max spread of hour-8 droppable `rect.top` across columns — should be 0-2px).
- **File:** `CalendarGridDayJobber.tsx`

#### Tasks Feature End-to-End Fix (2026-03-05)
- **3A — Remove "Link to Client":** Removed client linking UI from TaskDialog (was deprecated). Removed `clientId` state, client fetch query, and client dropdown. "Link to Job" remains as full-width field. (`TaskDialog.tsx`)
- **3B — Supplier location dropdown (RC1 FIX):** Default `getQueryFn` uses `queryKey[0]` as URL. QueryKey `["/api/suppliers", supplierId, "locations"]` fetched `/api/suppliers` (supplier LIST) instead of `/api/suppliers/${supplierId}/locations`. Fixed with explicit `queryFn` that constructs correct URL and normalizes response (handles array, `{items}`, `{data}`, `{locations}` shapes). Added `[TASKS_DIAG]` logging. (`TaskDialog.tsx:180-201`)
- **3D — Calendar task click (RC2 FIX):** Old code read `rawAssignment.assignmentId` but `.raw` is the API task object (no `assignmentId` property). CalendarItem wrapper has `assignmentId: "task-${id}"` and `kind: "task"`. Fixed to check `kind === "task"` discriminator first, read `assignmentId` from CalendarItem (not `.raw`). Added `[TASKS_DIAG]` logging. (`Calendar.tsx:1683-1700`)
- **3E — Task drag/drop rescheduling:** Added task drag handling in `handleDragEnd`. When a task is dragged to any calendar drop zone (month day, week timed/all-day, day timed/all-day, tech week), it PATCHes `/api/tasks/:id` with updated `scheduledStartAt`, `allDay`, and optionally `assignedToUserId`. (`Calendar.tsx`)
- **Diagnostic instrumentation:** `[TASKS_DIAG]` logging gated behind `IS_DEV`/`NODE_ENV !== production` — silent in production. (`tasks.routes.ts`, `TaskDialog.tsx`, `Calendar.tsx`)
- **Files:** `client/src/components/TaskDialog.tsx`, `client/src/pages/Calendar.tsx`, `server/routes/tasks.routes.ts`

#### Supplier Visit Creation — 500 Error Elimination + Location Dropdown Fix (2026-03-06)
- **Root cause (500):** Unhandled DB constraint violations (FK on `supplier_id`, `supplier_location_id`) bubble up as raw Postgres errors without `statusCode`. Global error handler (`server/index.ts:166`) maps any error without `statusCode` to `500 "Internal server error"` in production, hiding the real cause.
- **Root cause (location dropdown):** Location dropdown showed only `location.name` (e.g., "Markham") with no address context. QueryKey `["supplier-locations", supplierId]` with explicit `queryFn` now fetches `GET /api/suppliers/:supplierId/locations`. Server returns `{ items: SupplierLocation[] }` filtered by `supplier_id + company_id + is_active + deletedAt IS NULL`. Labels now show `Name — Address` format (e.g., "Markham — 35 Riviera Drive").
- **Server fix — Pre-write validation:** Added `validateSupplierRefs()` to `TaskRepository`: (1) supplier exists and belongs to company, (2) location belongs to both supplier AND company. Returns 400 with descriptive message. (`server/storage/tasks.ts`)
- **Server fix — Soft-delete filter:** `listSupplierLocations` now excludes `deletedAt IS NOT NULL` rows in addition to `isActive = false`. (`server/storage/suppliers.ts`)
- **Server fix — Route-level error catch:** `PATCH /api/tasks/:id/supplier-visit` converts FK violations (23503) → 400, unique violations (23505) → 409. `POST /api/tasks` also catches FK violations. (`server/routes/tasks.routes.ts`)
- **Client fix — Location dropdown:** Explicit `queryFn` fetches `/api/suppliers/${supplierId}/locations`. Response normalized from `{ items }`. Label: `formatLocationLabel()` → `"Name — Address"`, fallbacks for missing fields. Primary locations marked with ★. Dropdown always visible when supplier selected (shows "No locations" / "Select supplier first" when appropriate). (`TaskDialog.tsx`)
- **Client fix — Product rule (no supplier required):** `canSubmit` only requires `title`. Techs can create supplier visit tasks without selecting supplier — admin fills details later. But if `supplierLocationId` is present, server validates it belongs to `supplierId`. (`TaskDialog.tsx`)
- **Client fix — Error surfacing:** All errors (save + delete) display inline in dialog (red banner). No `alert()` calls. Dialog stays open on failure. Saving shows "Saving..." text. (`TaskDialog.tsx`)
- **Client fix — Dialog sizing:** Width increased from `sm:max-w-[700px]` to `sm:max-w-3xl`. Removed `overflow-y-auto` and `max-h-[90vh]` from content. 4-column responsive grid for date/time fields. Supplier + Location side-by-side on desktop. (`TaskDialog.tsx`)
- **Tested scenarios:** both null ✓, supplier only ✓, valid match ✓, location without supplier → 400 ✓, mismatch → 400 ✓, cross-tenant → 404 ✓
- **Files:** `server/storage/tasks.ts`, `server/storage/suppliers.ts`, `server/routes/tasks.routes.ts`, `client/src/components/TaskDialog.tsx`

### Changed

#### Canonical EditVisitModal — Component Unification (2026-03-05)
- **FIX A — Shared EditVisitModal component:** Extracted visit editing into `client/src/components/visits/EditVisitModal.tsx`. Uses `JobScheduleFields` (same component as Calendar's ScheduleJobModal) for consistent scheduling UI: date picker, time dropdown, duration select, multi-technician chips with display names.
- **FIX B — Job Detail rewired:** Both active and completed visit clicks now open `EditVisitModal` directly in edit mode. Old `VisitDetailDialog` (inline in `JobDetailPage.tsx`) removed entirely (~460 lines deleted).
- **FIX C — Completed visit editing:** Completed visits can be rescheduled via the same modal. Complete/Uncomplete actions hidden when job is completed/closed.
- **FIX D — Technician display names:** `EditVisitModal` uses `JobScheduleFields` which already uses `getMemberDisplayName()` for technician chips.
- **Files:** `client/src/components/visits/EditVisitModal.tsx` (new), `client/src/pages/JobDetailPage.tsx` (modified — removed VisitDetailDialog, added EditVisitModal import)

### Fixed

#### Day View Layout Fix — RC-1 + RC-2 (2026-03-05)
- **RC-1:** Added `max-h-full` to Day Columns and Day Rows scroll containers, matching Week view behavior. Fixes height negotiation so Day views fill available viewport height without clipping. (`CalendarGridDayJobber.tsx`, `CalendarGridDayRows.tsx`)
- **RC-2:** Now-line and auto-scroll in Day Columns use dynamically measured header height via `ResizeObserver` instead of fixed `HEADER_HEIGHT` constant. TimeRail header also syncs to measured height. Fixes visual drift when all-day items make the sticky header taller than 44px. (`CalendarGridDayJobber.tsx`)

#### Unified Visit Click + Edit Modal (2026-03-05)
- **FIX A — Single modal for all visit clicks:** Active Visit click opens VisitDetailDialog directly in edit mode (`initialEdit` prop). Completed visit click opens same dialog in read-only mode. No more preview/details modal — one modal, one source of truth. (`JobDetailPage.tsx`)
- **FIX B — Visit history layout:** Collapsed preview shows last 2 completed visits (was 3). "View all completed visits (N)" toggle for expand/collapse. Prevents page push-down. (`JobDetailPage.tsx`)
- **FIX C — Technician name everywhere:** All inline `firstName && lastName ? name : email` patterns replaced with canonical `getMemberDisplayName()` from `lib/displayName.ts`. Fixes email-as-name bug. (`JobDetailPage.tsx`, `JobVisitsSection.tsx`)
- **FIX D — Duration display:** Edit mode label changed from "Duration (minutes)" to "Estimated Duration" with live hours/min preview. Read mode shows "1h 30m" instead of "90 min". Step changed to 15-min increments. (`JobDetailPage.tsx`)
- **FIX E — Prevent uncomplete while job closed:** Complete button hidden when visit is already completed/cancelled OR when job status is completed/closed. No uncomplete affordance added. (`JobDetailPage.tsx`)
- **Phase 3 — Click loop prevention:** `visitEditMode` + `selectedVisitId` are set atomically in click handler. `didAutoEdit` flag prevents `enterEditMode` from re-triggering on visit data changes. Dialog cleanup resets both states on close.

### Changed

#### Job Visit Lifecycle — Jobber-style Rules (2026-03-05)
- **Rule B — Visit History shows completed only:** Job Detail "Visits" section now has "Active Visit" card + "Visit History" list (completed visits only, grouped newest-first with completion date/tech)
- **Rule C — Close Job auto-completes visits:** When job status transitions to "completed" (via dropdown or close-job route), all uncompleted visits are automatically bulk-completed. Confirmation dialog added: "All uncompleted visits will be marked as completed."
- **Rule D — Scheduling reopens completed job:** `scheduleJob()` now also clears `closedAt`/`closedBy` when reopening a completed job (previously only set status='open')
- Server: `POST /api/jobs/:id/status` now auto-completes visits + sets `closedAt`/`closedBy` when transitioning to "completed" (`server/routes/jobs.ts`)
- Server: `POST /api/jobs/:id/close` response now includes `autoCompletedVisitCount` field
- Server: `scheduleJob()` clears `closedAt`/`closedBy` on reopen (`server/storage/calendar.ts`)
- Client: `useJobVisits` hook adds `activeVisit` + `completedVisits` derived selectors (`client/src/hooks/useJobVisits.ts`)
- Client: Job Detail visits section rewritten with Active Visit card + Visit History (completed only) (`client/src/pages/JobDetailPage.tsx`)
- Client: "Complete Job" confirmation dialog added with warning about auto-completing visits

#### Day View Layout Root-Cause Investigation (2026-03-05)
- **Diagnostic report:** `docs/DAY_VIEW_LAYOUT_ROOT_CAUSE.md` — 3 confirmed root causes, 3 cleared suspects
- **RC-1 (Medium):** Day views use `overflow-auto` (bidirectional) vs Week's `overflow-y-auto` + `max-h-full` — may cause height negotiation issues
- **RC-2 (Low-Medium):** DayJobber sticky header now has dynamic height (all-day strip) but nowLine uses fixed HEADER_HEIGHT constant
- **RC-3 (Low):** DayRows 2400px fixed-width timeline forces bidirectional scroll (by design for Gantt style)
- **Cleared:** `min-h-0` chain, `overflow-hidden` ancestors, and scrollTop-based time mapping — all correct
- **Debug instrumentation added** (gated behind `?debugLayout=1`): useLayoutEffect logs + colored outlines on scroll containers
- Files: `CalendarGridDayJobber.tsx`, `CalendarGridDayRows.tsx`, `CalendarGridWeek.tsx`

### Investigation

#### Day View Live Diagnostic Report (2026-03-05)
- `docs/DAY_VIEW_LIVE_DIAGNOSTIC.md` — Full investigation report with 6 ranked root causes
- RC-1: Sticky rect cache staleness defeats all-day/timed disambiguation when scrolled (Calendar.tsx:1806)
- RC-2: Row view uses Y-axis disambiguation for horizontal overlap (Calendar.tsx:1810, DayRows.tsx:399)
- RC-3: `calculateLanes()` defeats MemoizedTechColumn memo via inline `.map()` (DayJobber.tsx:691,725)
- RC-4: Resize "snap-back" visual lag from clearing tempDuration before API response (ResizableJobCard.tsx:187)
- RC-5: Click-after-drag useEffect timing gap (DayRows.tsx:213-220)
- RC-6: Visual sparsity (24h grid with few techs) misinterpreted as layout bug
- No code changes — investigation only

### Fixed

#### Day View All-Day Strip Relocation + DnD Simplification (2026-03-05)
- **Problem:** Sticky all-day lane above timed grid caused overlapping droppable rects, making timed<->all-day DnD unreliable (RC-1, RC-2 from diagnostic)
- **Fix:** Moved all-day items into an assignment strip inside each technician's column header; removed the separate sticky all-day lane entirely
- Removed sticky overlap collision disambiguation in `Calendar.tsx` (no longer needed — zones don't overlap)
- Removed TimeRail "Anytime" row (all-day strip is now per-column)
- Updated nowLineTop and auto-scroll calculations to remove old `ALLDAY_LANE_HEIGHT` offset
- Day Rows view unchanged (already uses side-strip layout)
- All DnD paths preserved: timed<->timed, timed<->all-day strip, all-day strip<->different tech, sidebar drops
- Files changed: `CalendarGridDayJobber.tsx`, `Calendar.tsx`

#### Placeholder Visits Cleanup (2026-03-05)
- **Problem:** Placeholder visits (scheduledStart NULL) from unschedule/reschedule cycles appeared as "No date" rows on Job Detail page
- **Fix 1 — Proactive archive:** `server/storage/calendar.ts` `scheduleJob()` now archives all other visits with `scheduledStart IS NULL` for the same job after a real visit is created/updated
- **Fix 2 — Defensive filter:** `server/storage/jobVisits.ts` `listAllJobVisitsForJob()` excludes empty placeholders — only shows visits with a scheduled date, check-in activity, or completed status
- **Safety:** Archive-only approach (sets `archivedAt`), no hard deletes
- Files changed: `server/storage/calendar.ts`, `server/storage/jobVisits.ts`

#### Day View DnD Bug Fixes (2026-03-05)

**Fix #1 (P0): Modal no longer opens after dragging all-day items**
- Added click-after-drag suppression (`wasDraggingRef` + `lastDragEndedAtRef` + 300ms guard) to:
  - `DraggableAllDayCard` in `CalendarGridDayJobber.tsx` (Columns view) — uses `onClickCapture` to intercept child `JobCard` clicks
  - `DraggableAllDayChip` in `CalendarGridDayRows.tsx` (Rows view) — guards existing `onClick` handler
- Pattern matches working implementations in `DraggableEventBlock` and `ResizableJobCard`

**Fix #2 (P0/P1): Timed ↔ all-day drops now reliable despite sticky overlap**
- Modified `customCollisionDetection` in `Calendar.tsx` to disambiguate when `pointerWithin` returns both `allday|` and `daily|` candidates simultaneously
- Uses the all-day droppable's bounding rect bottom edge as boundary: pointer above = allday zone, below = timed zone
- No regressions to weekly/monthly DnD (disambiguation only triggers when both zone types present)

**Fix #3 (P1): MemoizedTechColumn memo now effective**
- `CalendarGridDayJobber.tsx`: Pre-split events into `allDay`/`timed` arrays inside the `eventsByTech` useMemo
- Previous inline `.filter()` calls created 3 new array refs per tech per render, defeating React.memo
- Now passes stable pre-computed arrays as props — memo correctly prevents re-renders

**Fix #5 (P2): Rows view no longer looks cut off with few technicians**
- Added subtle `bg-muted/5` background to scroll container so empty space doesn't look like a broken/missing area

### Added

#### Live Map Backfill Migration + Guardrails (2026-03-05)

**Migration — Backfill Live Map prerequisites**
- `migrations/2026_03_05_live_map_backfills.sql` — Idempotent SQL migration that:
  - Sets `users.is_schedulable = TRUE` for active non-disabled users (was false/null)
  - Copies `job_visits.scheduled_date` → `scheduled_start` where missing
  - Defaults `estimated_duration_minutes` to 60 where null/0
  - Computes `scheduled_end` where start exists but end is NULL
- BEFORE: 8 schedulable techs, 2 visits missing scheduled_start, 1 today visit
- AFTER: 9 schedulable techs, 0 visits missing scheduled_start, 2 today visits

**Server-side invariant (write-path hardening)**
- `server/storage/jobVisits.ts` (`updateJobVisit`): DEV-only warning log when scheduledDate is set without scheduledStart (normalization already auto-fixes, log aids debugging)

**Live Map endpoint diagnostics**
- `server/routes/map.ts` (GET /api/map/day): Added `_meta` diagnostic fields:
  - `reasonTechsEmpty`: explains when 0 schedulable techs found
  - `reasonVisitsEmpty` + `visitsWithScheduledDateButNoStart`: explains scheduled_date vs scheduled_start gap

**UI empty-state messaging**
- `client/src/pages/LiveMapPage.tsx`: DispatchPanel shows actionable messages when server returns diagnostic meta (no schedulable techs, missing scheduled_start, etc.)

**Sanity check script**
- `server/scripts/mapSanityCheck.ts` — Validates Live Map prerequisites, exits non-zero on failure
- Package.json: `npm run db:map-sanity`
- Documented in `docs/MIGRATIONS.md` under "Sanity Checks"

### Investigation

#### Day View DnD/Layout Diagnostic (2026-03-05)

- **Diagnostic report**: `docs/DAY_VIEW_DND_DIAGNOSTIC.md` — structured root-cause analysis of Day view (Rows + Columns) DnD and layout issues
- **6 issues identified**, prioritized by severity:
  1. HIGH: Modal opens after dragging all-day items — missing click-after-drag suppression in `DraggableAllDayCard` (Columns) and `DraggableAllDayChip` (Rows)
  2. HIGH: Timed<->all-day drops unreliable — sticky all-day lane overlaps timed grid bounding rects during scroll
  3. MEDIUM: `MemoizedTechColumn` memo defeated by inline `.filter()` calls (CalendarGridDayJobber.tsx:696-698)
  4. LOW: Resize visual snap-back (no optimistic height update)
  5. LOW: Empty space below rows with few technicians (cosmetic)
  6. LOW: 92px sticky header stack reduces visible timed area
- Files analyzed: `Calendar.tsx`, `CalendarGridDayJobber.tsx`, `CalendarGridDayRows.tsx`, `ResizableJobCard.tsx`
- No code changes made (investigation only)

### Fixed

#### Replace Visit: Update-in-Place + Visit Archive (2026-03-05)

**Bug Fix — "Replace Visit" no longer creates duplicate visits**
- **Root cause**: `scheduleJob()` and `rescheduleJob()` in `server/storage/calendar.ts` used soft-delete (`isActive=false`) + `createJobVisit()` for the "replace" path, creating a second row. The Job Detail page's `listAllJobVisitsForJob` returns all visits including inactive, so both showed up.
- **Fix**: Changed Case 2 in `scheduleJob()` (line ~719) and the `replace` mode in `rescheduleJob()` to UPDATE the existing visit row IN-PLACE instead of soft-delete + create. Same visit ID is preserved; no new row created.
- Files: `server/storage/calendar.ts`

**Feature — Soft-delete archive for job visits (archivedAt)**
- Added `archived_at`, `archived_by_user_id`, `archived_reason` columns to `job_visits` table.
- All default visit queries now include `archived_at IS NULL` filter — archived visits excluded from: job detail visits list, calendar views, dispatch/live map, visit feeds, admin timesheets, auto-gap scheduling, visit intelligence.
- New endpoint: `POST /api/jobs/:jobId/visits/:visitId/archive` — sets archive fields in a transaction, requires manager role.
- Migration: `migrations/2026_03_05_job_visits_archived_columns.sql`
- Schema: `shared/schema.ts` — added archivedAt, archivedByUserId, archivedReason to jobVisits table
- Files changed:
  - `shared/schema.ts` (schema)
  - `server/storage/jobVisits.ts` (all queries + updateJobVisit)
  - `server/storage/visits.ts` (all 5 query functions)
  - `server/storage/calendar.ts` (scheduleJob, openVisit query, eligible visits CTE)
  - `server/routes/jobVisits.routes.ts` (archive endpoint)
  - `server/routes/map.ts` (3 raw SQL queries)
  - `server/routes/calendar.ts` (day summary raw SQL)
  - `server/routes/adminTimesheets.ts` (visit search query)
  - `server/lib/autoGapScheduling.ts` (scheduled visits query)
  - `server/lib/visitIntelligence.ts` (2 raw SQL queries)

#### Phase C: Pre-deploy P0 Performance + Scale Fixes (2026-03-05)

**Task 1 — DB Index for job_visits schedule queries**
- Added compound index `idx_job_visits_company_active_start` on `job_visits(company_id, is_active, scheduled_start)`.
- Covers hot query pattern in `/api/map/day`, calendar range queries, and eligible-visit lookups. Replaces bitmap AND across 3 separate single-column indexes with one range scan.
- Migration: `migrations/2026_03_05_job_visits_schedule_index.sql`

**Task 2 — ImpersonationBanner polling guard**
- `refetchInterval` changed from unconditional `5000` to a function: polls only when `isImpersonating === true`. Non-impersonating sessions make exactly one request then stop, eliminating ~12 requests/minute for every logged-in user.
- `staleTime` increased from `0` to `30_000` to further reduce refetches on component remount.
- File: `client/src/components/ImpersonationBanner.tsx`

**Task 3 — getEventsForTech memoization (calendar day views)**
- Replaced plain `getEventsForTech()` function (re-created every render, 4N+ filter passes) with a pre-computed `Map<techId, CalendarEvent[]>` via `useMemo([dayEvents])`.
- Eliminates redundant filtering: DayJobber previously called `getEventsForTech(null)` 4 times per render for the unassigned column alone.
- Stable array references now let `MemoizedTechColumn` / `MemoizedTechRow` `React.memo()` wrappers actually skip re-renders during drag/resize.
- Files: `client/src/components/calendar/CalendarGridDayJobber.tsx`, `client/src/components/calendar/CalendarGridDayRows.tsx`

#### Job Visit Schedule Normalization — scheduledDate→scheduledStart mirroring (2026-03-05)
- **Root cause**: Some scheduling flows wrote `scheduledDate` but not `scheduledStart` to `job_visits`. All downstream queries (Live Map `/api/map/day`, eligible-visit lookup, list filters) depend on `scheduledStart IS NOT NULL`, causing visits to silently disappear from the map and dispatch views.
- **Fix**: Added canonical normalization in `JobVisitsRepository.updateJobVisit()` — the single write path for all visit updates:
  1. If `scheduledDate` provided without `scheduledStart` → mirrors `scheduledDate` to `scheduledStart`
  2. Defaults `estimatedDurationMinutes` to 60 when null/0
  3. Auto-computes `scheduledEnd` from start + duration (or end-of-day for all-day events) when not explicitly provided
  4. When `scheduledStart` is explicitly cleared (unschedule), also clears `scheduledEnd`
- **Files**: `server/storage/jobVisits.ts` (`updateJobVisit` method)

#### Calendar Day View — Drag/Drop + All-Day Lane DnD + Layout Fix (2026-03-05)
- **Fixed Day ROW view drop zones**: RowDropZone and hour grid divs used `h-full` through nested absolute positioning which could resolve to zero-height bounding rects. Changed to explicit `height: ROW_HEIGHT` px values so dnd-kit collision detection always finds valid targets.
  - Files: `client/src/components/calendar/CalendarGridDayRows.tsx`
- **Made all-day items draggable in Day ROW view**: All-day chips were plain `<div>` elements with no `useDraggable`. Created `DraggableAllDayChip` component wrapping them for DnD between all-day and timed lanes.
  - Files: `client/src/components/calendar/CalendarGridDayRows.tsx`
- **Made all-day items draggable in Day Columns view**: All-day `JobCard` items had no drag support. Created `DraggableAllDayCard` wrapper component using `useDraggable`.
  - Files: `client/src/components/calendar/CalendarGridDayJobber.tsx`
- **Made timed items draggable in Day Columns view**: `ResizableJobCard` only supported resize via pointer events. Added `useDraggable` hook so timed items can be dragged to other time slots, all-day lanes, or between technician columns. Includes drag-end click suppression.
  - Files: `client/src/components/calendar/ResizableJobCard.tsx`

#### Live Map Dispatch — Visits Independent of Technician Online Status (2026-03-05)
- **Server meta enhanced**: Added `visitsAssigned` and `visitsUnassigned` counts to `/api/map/day` response `meta` object for client diagnostics.
  - Files: `server/routes/map.ts`
- **Dev logs improved**: Sample increased from 3 to 5 visits; now includes `technicianId` and `status` per sample for easier debugging.
  - Files: `server/routes/map.ts`
- **Fixed misleading "No visits for today" in dispatch panel**: When visits exist but are hidden by technician filter (e.g., "Online only" persisted when all techs are offline), panel now shows "N visits hidden by current filter" instead of "No visits for today". Only shows "No visits" when the server truly returns zero visits.
  - Root cause: `DispatchPanel` received pre-filtered `panelVisits` and had no way to distinguish "0 visits from server" from "all visits filtered out by client-side tech filter".
  - Files: `client/src/pages/LiveMapPage.tsx`
- **Client meta type updated**: `MapDayData.meta` interface now includes `visitsAssigned` and `visitsUnassigned` fields.
  - Files: `client/src/pages/LiveMapPage.tsx`

### Removed

#### Phase B Dead Code Cleanup (2026-03-05)
- **Deleted 2 dead server service files** (30 lines): `services/qboGuards.ts` (unused `assertInvoiceSyncAllowed`), `services/calendarService.ts` (unused `resizeJobTime`).
- **Deleted `server/stripe/` directory** (275 lines, 3 files): `stripeClient.ts`, `stripeService.ts`, `webhookHandlers.ts` — only referenced each other, no route mount, no external imports.
- **Removed 8 unused exports from `shared/schema.ts`**: `identityProviderEnum`, `IdentityProvider`, `invitationStatusEnum`, `InvitationStatus`, `insertPasswordResetTokenSchema`, `InsertPasswordResetToken`, `PasswordResetToken`, `ScheduleJobInput`, `UpdateJobScheduleInput`, `UnscheduleJobInput`.
- **Deleted superseded migration**: `migrations/006-fix-money-types.sql` — kept `006-fix-money-types-FIXED.sql` (adds required `::text` casts).
- **Archived 178 unreferenced attached_assets/** (8.4 MB) to `_archive/` subdirectory — no source file uses `@assets` alias.
- **Removed 14 unused npm dependencies**: `react-icons`, `react-resizable-panels`, `recharts`, `framer-motion`, `vaul`, `embla-carousel-react`, `tw-animate-css`, `next-themes`, `input-otp`, `memorystore`, `stripe`, `stripe-replit-sync`, `@stripe/react-stripe-js`, `@stripe/stripe-js`.
- **Total: ~305 server lines deleted, 14 packages removed, 8.4 MB assets archived.** Build verified (tsc + vite).

#### Phase A Dead Code Cleanup (2026-03-05)
- **Deleted `server/_legacy/` directory** (937 lines): `clients.ts` and `routes_storage.ts` — zero imports, referenced non-existent `subscriptionService.ts`.
- **Deleted 6 dead server files** (~290 lines): `services/invoiceSync.ts`, `services/invoiceDirty.ts`, `qbo/syncService.ts`, `auth/attachUserContext.ts`, `migrate-to-multi-tenant.ts`, `cleanup/` dir — all never imported.
- **Deleted 21 orphaned React components** (~5,500 lines): SubscriptionOverview, ActionRequiredKPIs, JobAssignmentsCard, UnscheduledJobsSidebar, ClientNotesTab, ClientLocationsTab, ClientJobsTab, Header, AppHeader, StatsCard, NotificationBell, MaintenanceCard, MaintenanceSection, ClientListTable, TechnicianLayout, SettingsLayout, TasksSidebar, CsrfInitializer, ClientDetailDialog, PartsManagementDialog, JobMetaCard.
- **Deleted 10 orphaned React pages** (~2,655 lines): JobStatusesPage, TechnicianDashboard, TechLoginPage, TechHomePage, TechSchedulePage, TechTimesheetPage, TechMorePage, TechVisitDetailPage, AdminTimesheetsPage, old Suppliers.tsx.
- **Deleted orphaned route** (115 lines): `server/routes/parts.ts` — full CRUD never mounted in router, superseded by `/api/items`.
- **Deleted `examples/` directories** (140 lines): `client/src/components/examples/`, `client/src/pages/examples/` — dead re-export wrappers.
- **Deleted 15 unused shadcn UI wrappers** (1,862 lines): accordion, aspect-ratio, breadcrumb, carousel, chart, context-menu, drawer, input-otp, menubar, navigation-menu, pagination, resizable, slider, toggle, toggle-group.
- **Deleted dead hook**: `useVisitFeed.ts` (144 lines) — only referenced by orphaned TechVisitDetailPage.
- **Deleted dead barrel**: `client/src/components/jobs/index.ts` — never imported.
- **Cleaned stale imports in `App.tsx`**: Removed `TechnicianDashboard` import, `ClipboardList`/`Users`/`FileText`/`Receipt` icons, `DropdownMenu*` components.
- **Total removed: ~11,600 lines across 55 files**. CSS bundle: 137.41 KB → 122.67 KB (−14.74 KB). Build verified (tsc + vite).

### Added

#### Live Map Fix — All Technicians + Reliable Visits + Meta Diagnostics (2026-03-05)
- **Technicians from users table**: Changed `/api/map/day` technicians query from `technician_live_positions` (only shows techs with GPS pings) to `users` table with `LEFT JOIN technician_live_positions`. Now returns ALL schedulable technicians (`disabled=false`, `is_schedulable=true`, `deleted_at IS NULL`) with `online`/`offline` status and optional lat/lng from live positions. Technician filter popover lists all techs immediately.
  - Files: `server/routes/map.ts`, `client/src/pages/LiveMapPage.tsx`
- **Updated MapTechnician type**: `lat`, `lng`, `lastSeenAt` are now `string | null` since techs without live positions have no coordinates. Map markers only render for techs with coords; panel lists all techs.
  - Files: `client/src/pages/LiveMapPage.tsx`
- **Enhanced meta diagnostics**: Response `meta` now includes `techniciansTotal`, `techniciansOnline`, `visitsMissingScheduledStart`. Dev-only diagnostic logs total active `job_visits` count when 0 visits found for a date.
  - Files: `server/routes/map.ts`
- **Filter button label**: Shows "Technicians (All)" when no filter active, "Technicians (N)" when N selected. Header badge shows total techs count.
  - Files: `client/src/pages/LiveMapPage.tsx`

#### Calendar Day View: Full-Height, All-Day Lane, Resize Polish, Card Cleanup (2026-03-05)
- **Day view full-height layout**: Changed CardContent to `flex flex-col`, view wrappers and grid roots to `flex-1 min-h-0` instead of `h-full`. Creates a clean flex chain from route → Card → grid → scroll container so day grids fill available viewport height.
  - Files: `client/src/pages/Calendar.tsx`, `client/src/components/calendar/CalendarGridDayJobber.tsx`, `client/src/components/calendar/CalendarGridDayRows.tsx`
- **Dedicated All-Day lane in Day Rows**: Moved all-day/anytime items from under the technician name into a separate 80px sticky column between the tech label and the timed grid. Added `RowAllDayDropZone` with `allday|{techId}|{date}` droppable ID (same format as Day Columns) so existing DnD handler supports drag between all-day and timed slots.
  - Files: `client/src/components/calendar/CalendarGridDayRows.tsx`
- **Suppress modal after resize end**: Added `lastResizeEndedAtRef` to both `ResizableJobCard` (columns) and `DraggableEventBlock` (rows). Click handlers now suppress for 250ms after resize end, matching existing drag-end suppression pattern.
  - Root cause: `setIsResizing(false)` fires before the browser dispatches the click event from pointer-up.
  - Files: `client/src/components/calendar/ResizableJobCard.tsx`, `client/src/components/calendar/CalendarGridDayRows.tsx`
- **Faster resize in Day Rows**: Added `requestAnimationFrame` throttle to `DraggableEventBlock`'s horizontal resize (same pattern already used in `ResizableJobCard`). Added `transition-none` during resize. Flush pending rAF on resize end and cleanup on unmount.
  - Files: `client/src/components/calendar/CalendarGridDayRows.tsx`
- **Removed Unschedule/Reschedule shortcuts from all cards**: Removed quick-action hover buttons (CalendarIcon + RotateCcw) from `JobCard`. Removed `isHovered` state, handlers, `showQuickActions` prop, and unused `Calendar`/`RotateCcw` icon imports. Users click the card to open details instead.
  - Files: `client/src/components/calendar/JobCard.tsx`, `client/src/components/calendar/ResizableJobCard.tsx`, `client/src/components/calendar/CalendarGridDayRows.tsx`, `client/src/components/calendar/CalendarGridWeekTechnicians.tsx`

#### Live Map Bugfix — Missing Visits, Default Duration, Z-Index (2026-03-05)
- **Visits with missing coordinates shown in panel**: Visits without lat/lng are still rendered in the dispatch panel under their tech/unassigned group, with an amber "No coords" badge. Pan-to-map click is disabled with tooltip "Add address/lat-lng to map this visit". Map markers are still filtered to coords-only.
  - Files: `client/src/pages/LiveMapPage.tsx`
- **Default duration 60 minutes**: Server now returns `durationMinutes` (COALESCE to 60) for both visit and job-fallback queries. Computes `scheduledEnd` from `scheduledStart + durationMinutes` when missing.
  - Files: `server/routes/map.ts`
- **Enhanced meta counts**: Response `meta` now includes `visitsTotal`, `visitsWithCoords`, `visitsMissingCoords` for client diagnostics.
  - Files: `server/routes/map.ts`
- **Technician filter popover z-index fix**: Changed `PopoverContent` to `z-[9999]` so it renders above Leaflet map's stacking context.
  - Root cause: Leaflet creates high z-index stacking contexts; Radix Portal's default z-index was insufficient.
  - Files: `client/src/pages/LiveMapPage.tsx`

#### Calendar Day View Fixes: Full-Height Layout, Click-After-Drag, Rows Parity, Smoother Resize (2026-03-05)
- **Day view fills available space**: Added `min-h-0` to root and scroll containers in both `CalendarGridDayJobber` and `CalendarGridDayRows`. Without `min-h-0`, flex children default to `min-height: auto`, preventing them from shrinking below content size.
  - Files: `client/src/components/calendar/CalendarGridDayJobber.tsx`, `client/src/components/calendar/CalendarGridDayRows.tsx`
- **Suppress click-after-drag**: Added `lastDragEndedAtRef` with 250ms suppression window in `DraggableClient` and `DraggableEventBlock`. When drag transitions from active to inactive, `Date.now()` is captured; subsequent click events within 250ms are ignored.
  - Root cause: `isDragging` flips false on pointer-up, then the click event fires synchronously after — the `isDragging` guard alone is insufficient.
  - Files: `client/src/components/calendar/DraggableClient.tsx`, `client/src/components/calendar/CalendarGridDayRows.tsx`
- **Day Rows cards use shared JobCard**: Refactored `DraggableEventBlock` to render `<JobCard>` inside the positioning wrapper instead of custom inline markup. Cards now look identical across Week, Day Columns, and Day Rows views (same hover popover, quick actions, tech color stripe).
  - Files: `client/src/components/calendar/CalendarGridDayRows.tsx`
- **Smoother resize in Day Columns**: Added `requestAnimationFrame` throttling to `ResizableJobCard` resize handler — stores latest duration in a ref and flushes to state at most once per frame. Applied `transition-none` to wrapper during resize to eliminate CSS transition lag.
  - Root cause: `setTempDuration` fired on every pointer-move event (potentially 60+ fps), and CSS transitions added perceived delay to height changes.
  - Files: `client/src/components/calendar/ResizableJobCard.tsx`

#### Live Map Fix — Technician Filter + No-Visits Bug (2026-03-05)
- **Technician multi-select filter**: Replaced boolean Techs toggle with a Popover containing search input, checkbox list (name + color dot + online/offline indicator), and quick actions (All / None / Online only / Offline only). Filter applies to both map markers and dispatch panel. Persisted to localStorage.
  - Files: `client/src/pages/LiveMapPage.tsx`
- **Fixed /api/map/day "no visits" bug**: Date boundaries now computed in company timezone (America/Toronto default) instead of UTC. Uses `todayInTimezone()` + `dayBoundsInTz()` with `timestamptz` comparison instead of `::date` cast. Status filter changed from exclusion list (`NOT IN cancelled`) to explicit allowlist of active statuses (scheduled, dispatched, en_route, on_site, in_progress, on_hold).
  - Root cause: `new Date().toISOString().slice(0,10)` returns UTC date — at 8pm EST this is already the next day. The `::date` cast also compared in DB timezone (UTC).
  - Files: `server/routes/map.ts`
- **Job fallback for orphan jobs**: When a job is scheduled today but has no corresponding active visit in the time window, it's returned as a "pseudo visit" with `source: "job_fallback"`. Marked with asterisk in panel and tooltip. Server returns `meta.jobFallbackCount` for client hint.
  - Files: `server/routes/map.ts`, `client/src/pages/LiveMapPage.tsx`
- **Improved empty state**: When no visits exist but job fallbacks are present, shows amber warning: "N scheduled jobs exist but have no visit records yet."
  - Files: `client/src/pages/LiveMapPage.tsx`
- **Preferences persistence**: Map preferences (selected technicians, show visits, show unassigned, panel open/closed) persisted to localStorage across sessions.
  - Files: `client/src/pages/LiveMapPage.tsx`

#### Live Map Upgrade — Dispatch-Grade Layout (2026-03-05)
- **Server aggregator endpoint**: `GET /api/map/day?date=YYYY-MM-DD` — batch-fetches technician positions (from `technician_live_positions`), scheduled visits (from `job_visits` + `client_locations`), and open risk flags (from `attention_items`) in parallel. Returns `{ date, technicians, visits }` with per-visit risk flags (late, overdue, runningLong).
  - Files: `server/routes/map.ts` (NEW), `server/routes/index.ts`
- **LiveMapPage dispatch layout**: Split layout with Leaflet map (left) and collapsible 320px dispatch panel (right). Header with date display and toggle switches (Show Techs, Show Visits, Show Unassigned). 15-second auto-refresh via `useMapDay()` hook.
  - Files: `client/src/pages/LiveMapPage.tsx` (REWRITTEN)
- **Technician markers**: Color-coded `CircleMarker` per technician from `TECH_COLORS` palette, with tooltip showing name + last-seen time. Online/offline distinction via opacity.
- **Visit markers**: Numbered sequence markers ("1", "2", etc.) colored by assigned technician, red for unassigned. Risk badges (Late/Overdue/Long) shown on panel items.
- **Dispatch panel**: Visits grouped by technician (online first), with time + location. Unassigned section at bottom. Click any visit/tech to pan map to location.
- **Focus mode**: Click a technician header to filter map to only that tech's markers. Click again to clear filter.

#### Calendar Day View Fixes — Layout, All-Day, Resize, Drag Parity (2026-03-05)
- **Day view fills available space**: Changed CardContent from `overflow-auto` to `overflow-hidden` so day grids control their own scrolling. Both Columns and Rows layouts now fill the full content area.
  - Files: `client/src/pages/Calendar.tsx`
- **All-day/Anytime items in Day view**: Created shared `isAllDayEvent()` helper in calendarUtils for consistent classification of all-day vs timed events. Day Columns now uses this helper. Day Rows now renders all-day items as compact chips in the tech label area.
  - Root cause: DayJobber used raw `e.isAllDay` which could miss edge cases with null `startMinutes`. DayRows had no all-day rendering at all.
  - Files: `client/src/components/calendar/calendarUtils.ts`, `client/src/components/calendar/CalendarGridDayJobber.tsx`, `client/src/components/calendar/CalendarGridDayRows.tsx`
- **Resize version error fixed**: Resize now uses `POST /api/calendar/resize` (correct endpoint) instead of `PATCH /api/calendar/schedule/:id` (reschedule endpoint that requires version and doesn't support durationMinutes). ResizableJobCard passes the raw assignment data through onResize so the mutation can compute newEndTime.
  - Root cause: `updateDuration` mutation was calling the reschedule endpoint which validates against `rescheduleJobSchema` requiring `version: z.number().int()` — a field never passed by the resize handler.
  - Files: `client/src/components/calendar/ResizableJobCard.tsx`, `client/src/hooks/useCalendarDnD.ts`, `client/src/pages/Calendar.tsx`
- **Day Rows drag/drop + resize parity**: EventBlock replaced with DraggableEventBlock using `useDraggable` from dnd-kit. Added horizontal resize handle (right edge, cursor-col-resize) with 15-minute snap. Drop zones use same `daily|` ID format as Day Columns for DnD handler compatibility.
  - Files: `client/src/components/calendar/CalendarGridDayRows.tsx`, `client/src/pages/Calendar.tsx`

#### Phase 6: Auto-Gap Scheduling — Suggest Optimal Slots (2026-03-05)
- **Gap suggestion engine**: `server/lib/autoGapScheduling.ts` — `suggestVisitSlots()` finds the best available time slots across technicians for an unscheduled visit. Batch-fetches visits, live positions, alerts, and schedulable techs in parallel. For each tech × date, computes workday gaps, evaluates travel time (haversine 30km/h), added drive vs direct, downstream late risk, and tech risk penalties (offline +50, running long +40, alerts +10). Returns top 12 scored candidates.
  - Files: `server/lib/autoGapScheduling.ts` (NEW)
- **Suggest-slots endpoint**: `POST /api/intelligence/suggest-slots` — accepts visitId (resolves duration + location from DB) or manual durationMinutes + location + dateFrom/dateTo. Returns `{ suggestions: SuggestedSlot[] }` ranked by score.
  - Files: `server/routes/intelligence.ts`
- **SuggestSlotDialog component**: Dialog with date range selector (Today/3 days/Week), results list showing technician name, time range, travel badges, risk badges, downstream late risk, score. Preview highlights a slot, Apply schedules the visit via `POST /api/calendar/schedule`.
  - Files: `client/src/components/calendar/SuggestSlotDialog.tsx` (NEW)
- **Calendar sidebar integration**: Per-visit "Suggest slot" button (Zap icon) in the Visits tab of CalendarSidebar. Opens SuggestSlotDialog with the visit's job/location data.
  - Files: `client/src/components/calendar/CalendarSidebar.tsx`, `client/src/pages/Calendar.tsx`

#### Dashboard & Calendar UX Fixes (2026-03-05)
- **Dashboard: Activity moved to notification feed panel** — Removed always-visible "Recent Activity" card from Dashboard. Added Activity feed icon (pulse icon) in AppHeader that opens a right-side Sheet drawer with scrollable activity list. Reuses same `/api/activity` endpoint.
  - Files: `client/src/components/activity/ActivityFeedDrawer.tsx` (NEW), `client/src/components/AppHeader.tsx`, `client/src/pages/Dashboard.tsx`
- **Calendar: Technician filter shows names** — Fixed TechnicianFilterPopover to show full technician names as primary text (was showing `undefined undefined` when `firstName`/`lastName` were missing). Uses robust fallback chain: `fullName` → `displayName` → `name` → `firstName lastName` → `email`. Color dot moved to secondary position. Popover widened to 256px.
  - Files: `client/src/components/calendar/TechnicianFilterPopover.tsx`
  - Root cause: Popover used `{tech.firstName} {tech.lastName}` but these fields are optional in the API response. The `fullName` field (always populated by Calendar.tsx normalization) was not used.
- **Calendar: Day view fills screen** — Removed `max-h-full` constraint from daily and weekly view wrappers that was clipping content. Added `flex-shrink-0` to TechColumn in DayJobber to prevent column compression (forces horizontal scroll instead).
  - Files: `client/src/pages/Calendar.tsx`, `client/src/components/calendar/CalendarGridDayJobber.tsx`

#### Calendar Improvement: Technician Lane Header — Capacity, Drive, Risk, Presence (2026-03-05)
- **Day summary endpoint**: `GET /api/calendar/day-summary?date=YYYY-MM-DD` — aggregates per-technician stats: scheduledMinutes, driveMinutesEstimated (haversine 30km/h), visitCount, risk level, riskCounts, online/offline presence. Joins visits, live positions, and attention items.
  - Files: `server/routes/calendar.ts`
- **TechLaneHeader component**: Renders capacity stats, risk badges (Late/Overdue/Running long/Offline/Idle), and presence dot with tooltip above each technician lane in all three calendar grid views.
  - Files: `client/src/components/calendar/TechLaneHeader.tsx` (NEW), `client/src/hooks/useCalendarDaySummary.ts` (NEW)
- **Calendar grids enhanced**: `CalendarGridWeekTechnicians`, `CalendarGridDayJobber`, `CalendarGridDayRows` all show enhanced tech headers with day summary data.
  - Files: `client/src/components/calendar/CalendarGridWeekTechnicians.tsx`, `client/src/components/calendar/CalendarGridDayJobber.tsx`, `client/src/components/calendar/CalendarGridDayRows.tsx`
- **Risk-first sort + alerts-only filter**: Two toggle buttons in CalendarHeader: "Risk first" (sorts lanes by risk level descending) and "Alerts only" (hides lanes with no active alerts). Persisted in localStorage.
  - Files: `client/src/hooks/useCalendarState.ts`, `client/src/components/calendar/CalendarHeader.tsx`, `client/src/pages/Calendar.tsx`

#### Phase 5B: Running Long + Downstream Impact + One-click Fixes (2026-03-05)
- **visit.running_long signal**: Detects active visits past their planned end. Severity tiers: +15m = medium, +45m = high. Computes downstream impact preview (ETA drift, late-by-minutes for each subsequent visit on the same tech/day).
  - Files: `server/lib/visitIntelligence.ts`, `shared/schema.ts` (added `visit.running_long` to `attentionRuleTypeEnum`)
- **Shift remainder endpoint**: `POST /api/intelligence/visits/:id/shift-remainder` — shifts all remaining visits forward by driftMinutes (auto-computed or provided). Logs `schedule.shift_remainder` event.
- **Optimize remainder endpoint**: `POST /api/intelligence/visits/:id/optimize-remainder` — re-optimizes remaining stops via ORS route optimization, applies new order + recomputed start times. Logs `schedule.optimize_remainder` event.
  - Files: `server/routes/intelligence.ts`
- **Dashboard actions**: OperationalAlertsWidget shows "Shift" and "Optimize" buttons for running_long alerts, with inline downstream impact summary and confirm dialog before applying.
  - Files: `client/src/pages/Dashboard.tsx`

#### Phase 5: Visit Intelligence Signals + Operational Alerts (2026-03-05)
- **Intelligence service**: `server/lib/visitIntelligence.ts` — `computeVisitStatusSignals()` evaluates scheduled visits, technician live positions, and assignments to generate operational signals.
  - `visit.late` — visit not started 15+ min past scheduled start (severity: high)
  - `visit.overdue` — scheduled end passed, visit not completed (severity: high)
  - `tech.offline` — last_seen_at older than 5 min, has assigned visits (severity: medium)
  - `tech.idle` — speed=0 and unchanged >10 min (severity: low)
  - `tech.arrived` — distance < 50m from visit location, emits event (not attention item)
- **Evaluate endpoint**: `POST /api/intelligence/evaluate` — manager+ role, runs signal computation and returns detected signals. Generates attention items with deduplication.
  - Files: `server/routes/intelligence.ts`, registered in `server/routes/index.ts`
- **Attention rule types**: Added `visit.late`, `visit.overdue`, `tech.offline`, `tech.idle` to `attentionRuleTypeEnum` in `shared/schema.ts`
- **Dashboard integration**: "Operational Alerts" widget on Dashboard shows latest visit intelligence attention items with severity badges (Late, Overdue, Offline, Idle).
  - Files: `client/src/pages/Dashboard.tsx`

#### Migration Rule: SQL-only Migrations (2026-03-05)
- **Migration runner**: `server/scripts/runMigrations.ts` — non-interactive Node script that connects via DATABASE_URL, ensures `schema_migrations` tracking table, scans `/migrations/*.sql` lexically, applies pending migrations, records filename + applied_at. Auto-detects `CONCURRENTLY` to skip transaction wrapper.
- **Tracking table**: `schema_migrations` with `filename` (UNIQUE) + `applied_at`. All existing migrations seeded as already applied.
  - Migration: `migrations/2026_03_05_schema_migrations.sql`
- **Package.json scripts**: `db:migrate` (apply all), `db:migrate:one` (single file), `db:sanity` (connectivity check). Removed `db:push` and `db:verify` (drizzle-kit push is banned).
- **Documentation**: `docs/MIGRATIONS.md` — rules, procedures, guardrails. Updated `CLAUDE.md` Database section.

#### Phase 4B.1: Ephemeral Live Positions + Milestone Events (2026-03-05)
- **Live positions table**: `technician_live_positions` — one row per technician, UPSERT target. UNIQUE(company_id, technician_id). Replaces DISTINCT ON query over history for O(1) live lookups.
  - Files: `shared/schema.ts`, migration: `migrations/2026_03_05_technician_live_positions.sql`
- **Telemetry UPSERT**: `POST /api/telemetry/ping` now UPSERTs into live table instead of appending to history. History table preserved but not written to by default.
  - Files: `server/routes/telemetry.ts`
- **Live query rewrite**: `GET /api/technicians/live` reads from `technician_live_positions`. Includes `online` flag (last_seen_at within 5 minutes). No more DISTINCT ON scan.
  - Files: `server/routes/technicians.ts`
- **History purge**: `POST /api/telemetry/purge` — admin-only endpoint to delete old history rows by age (olderThanDays). Returns deletedCount.
  - Files: `server/routes/telemetry.ts`
- **Milestone events**: Emits events via canonical logEvent system for key actions:
  - `visit.started` — on visit status → in_progress/on_site, and on check-in
  - `visit.completed` — on visit status → completed, and on check-out
  - `tech.arrived` / `tech.departed` — new endpoints: `POST /api/jobs/:jobId/visits/:visitId/arrived|departed`
  - `task.completed` — on task close
  - `note.created` — on location note creation
  - Added "visit", "task", "technician" to `eventEntityTypeEnum`
  - Files: `server/routes/jobVisits.routes.ts`, `server/routes/tasks.routes.ts`, `server/routes/location-notes.ts`, `shared/schema.ts`
- **Live Map online/offline**: Markers now show blue (online) or grey (offline) based on 5-minute threshold. Tooltips display "Online"/"Offline" status.
  - Files: `client/src/hooks/useLiveTechnicians.ts`, `client/src/components/RouteMap.tsx`, `client/src/pages/LiveMapPage.tsx`
- **Migration workflow**: All migrations are plain SQL files, run via `psql "$DATABASE_URL" -f migrations/<file>.sql`. No drizzle-kit push required.

#### Phase 4B: Technician Telemetry + Live Map Markers (2026-03-05)
- **Database**: `technician_positions` table for GPS pings (lat, lng, accuracy, speed, heading, recordedAt). Indexes on (company_id, technician_id) and (technician_id, recorded_at DESC).
  - Files (schema): `shared/schema.ts`, migration: `migrations/2026_03_05_technician_positions.sql`
- **Telemetry ingestion**: `POST /api/telemetry/ping` — validates technician belongs to caller's company, inserts GPS position record
  - Files (new): `server/routes/telemetry.ts`, registered in `server/routes/index.ts`
- **Live positions API**: `GET /api/technicians/live` — returns latest position per technician using `DISTINCT ON` pattern, joined with user names
  - Files: `server/routes/technicians.ts`
- **Live Map page**: Standalone `/live-map` page with full-screen Leaflet map, blue circle markers for each technician with tooltip (name + time ago + speed), auto-refresh every 15s
  - Files (new): `client/src/pages/LiveMapPage.tsx`, `client/src/hooks/useLiveTechnicians.ts`
  - Files: `client/src/App.tsx` (route), `client/src/components/AppSidebar.tsx` (nav link)
- **Route map integration**: Live technician markers also appear in the Route Optimization dialog map
  - Files: `client/src/components/RouteMap.tsx`

#### Calendar UI Polish Pass (2026-03-04)
- **Tasks always shown**: Removed "Show tasks" toggle — tasks are now always visible on calendar in all views. `showTasks` preference deprecated.
  - Files: `client/src/hooks/useCalendarState.ts`, `client/src/components/calendar/CalendarHeader.tsx`, `client/src/pages/Calendar.tsx`
- **Technician names prominent in filter**: Upgraded TechnicianFilterPopover to show `text-sm` names (was `text-xs`), smaller color dots, italic "Unassigned" label
  - Files: `client/src/components/calendar/TechnicianFilterPopover.tsx`
- **Month view fills screen**: Changed month grid from `auto-rows-[minmax(52px,max-content)]` to `gridAutoRows: 1fr` so rows stretch to fill available height
  - Files: `client/src/components/calendar/CalendarGridMonth.tsx`
- **Day layout toggle**: New "Columns" / "Rows" toggle in Day view header. Persisted as `dayLayout` preference.
  - Columns: existing vertical tech columns (CalendarGridDayJobber)
  - Rows: new horizontal Gantt-style layout with time on X-axis and techs as rows
  - Files (new): `client/src/components/calendar/CalendarGridDayRows.tsx`
  - Files: `client/src/hooks/useCalendarState.ts`, `client/src/components/calendar/CalendarHeader.tsx`, `client/src/pages/Calendar.tsx`, `client/src/components/calendar/index.ts`

#### Phase 4A: Route Optimization Endpoint + Dispatcher Route Preview (2026-03-04)
- **Route optimization API**: `POST /api/routes/optimize` — accepts stops with lat/lng or address fields, returns optimized visiting order via OpenRouteService. Supports both `clientIds` (server-side lookup) and inline `stops` modes. Geocoding fallback when lat/lng not available. Tenant-scoped, authenticated.
  - Files (new): `server/routes/routes.ts`
  - Files (modified): `server/routes/index.ts` (registered `/api/routes`)
- **Route preview UI**: Wired existing `RouteOptimizationDialog` + `RouteMap` (Leaflet) into Jobs page. "Optimize Route" button in toolbar opens dialog with currently filtered scheduled jobs. Shows optimized order, total distance/duration, and route map with numbered markers + polyline.
  - Files (modified): `client/src/pages/Jobs.tsx` (added RouteOptimizationDialog integration)
- **Observability**: Endpoint logs route optimization events with stop count, geocode calls skipped/made, distance, and duration
- **No new DB tables**: Uses existing `client_locations` lat/lng columns and `routeOptimizationService` singleton

#### List Pages Refactor — Consistent Layout System (2026-03-04)
- **Shared layout components**: Created `PageHeader`, `ListToolbar`, and `FiltersButton` for consistent list page structure
  - Files (new): `client/src/components/layout/PageHeader.tsx`, `client/src/components/layout/ListToolbar.tsx`, `client/src/components/filters/FiltersButton.tsx`
- **Stronger page headers**: Upgraded `TablePageShell` title from `text-lg` to `text-2xl font-semibold` across all list pages
  - Files: `client/src/components/ui/table-page-shell.tsx`
- **Jobs page**: Replaced scattered filter chips/dropdowns with single Filters popover containing Status, Schedule, Assignment, Workflow sections
  - Files: `client/src/pages/Jobs.tsx`
- **Invoices page**: Replaced status pill filter row with Filters popover containing Status and QBO Sync sections. KPI cards preserved
  - Files: `client/src/pages/InvoicesListPage.tsx`
- **Quotes page**: Replaced status pill filter row with Filters popover containing Status section
  - Files: `client/src/pages/Quotes.tsx`
- **Clients page**: Replaced Active/Inactive tabs and tag filter chips with Filters popover containing Status and Tags sections. Bulk actions moved into toolbar
  - Files: `client/src/pages/Clients.tsx`
- **Locations page**: Replaced tag filter chips with Filters popover containing Tags section. Bulk actions moved into toolbar
  - Files: `client/src/pages/Locations.tsx`
- **Suppliers page**: Replaced inline search with shared `ListToolbar` component
  - Files: `client/src/pages/SuppliersListPage.tsx`

#### Calendar Page UI Rewrite (2026-03-04)
- **Calendar header refactor**: Smaller date title (`text-lg font-semibold`), consolidated controls row
  - Files: `client/src/components/calendar/CalendarHeader.tsx` (rewritten)
- **Technician filter popover**: Replaces color-dot chips row with dropdown popover + checkboxes, All/None quick actions
  - Files: `client/src/components/calendar/TechnicianFilterPopover.tsx` (new)
- **Weekly view defaults to technician-first**: Hourly/By Technician toggle removed; weekly view always renders `CalendarGridWeekTechnicians`
  - Files: `client/src/pages/Calendar.tsx`, `client/src/hooks/useCalendarState.ts`
- **Unscheduled sidebar redesign**: New `CalendarSidebar` with Visits + Tasks tabs, Dashboard-style card styling
  - Files: `client/src/components/calendar/CalendarSidebar.tsx` (new)
- **Tasks on calendar**: Toggleable via "Show tasks" switch in header. Fetches tasks with `scheduledFromDate`/`scheduledToDate` filters
  - Files: `client/src/lib/calendarItems.ts` (new), `client/src/hooks/useCalendarTasks.ts` (new)
- **Task visual distinction**: Task items render with violet tint, ClipboardList icon, non-draggable
  - Files: `client/src/components/calendar/JobCard.tsx`, `client/src/components/calendar/DraggableClient.tsx`, `client/src/components/calendar/CalendarGridWeekTechnicians.tsx`, `client/src/components/calendar/CalendarGridDayJobber.tsx`, `client/src/components/calendar/CalendarGridMonth.tsx`
- **Backend**: `scheduledFromDate`/`scheduledToDate` filter on tasks API for calendar date-range queries
  - Files: `server/storage/tasks.ts`, `server/routes/tasks.routes.ts`
- **CalendarItem normalization layer**: Unified `CalendarItem` type extends `CalendarEvent` with `kind: "visit" | "task"` discriminator
  - Files: `client/src/lib/calendarItems.ts` (new)

#### Phase 3: Address Normalization + Postal Code Validation (2026-03-04)
- **Address normalization helper** (`server/lib/addressNormalize.ts`): Resolves province naming inconsistencies at the API boundary. `normalizeServiceAddress()` maps any of `province`/`provinceState`/`stateOrProvince` → `province` (for client/supplier locations). `normalizeCompanyAddress()` maps variants → `provinceState` (for company settings). `normalizePostalCode()` normalizes Canadian postal codes to uppercase with space (A1A 1A1).
- **Postal code Zod validation** (`postalCodeSchema` in `shared/schema.ts`): Optional Zod schema accepting Canadian (A1A 1A1) and US (12345 / 12345-6789) formats. Normalizes Canadian codes during parse. Rejects invalid non-empty values. Applied to: `quickCreateSchema` (clients), `updateCompanySettingsSchema`, `updateSupplierLocationSchema`.
- **Route integration**: `normalizePostalCode` applied to all client create/update paths (quick-create, full-create, PUT, PATCH, create-under-company). `normalizeServiceAddress` applied to supplier location create/update. Province fallback chain added to full-create billing/service address extraction (`stateOrProvince` ∥ `province`).
- **No migrations**: No DB column renames or schema changes. Normalization happens at the API boundary before persistence.
- **Files (new)**: `server/lib/addressNormalize.ts`
- **Files (modified)**: `shared/schema.ts` (postalCodeSchema), `server/routes/clients.ts`, `server/routes/companySettings.ts`, `server/routes/suppliers.ts`

#### Phase 1: Google Places Address Autocomplete + Persisted Lat/Lng (2026-03-04)
- **Database columns**: Added `country`, `lat` (numeric 10,7), `lng` (numeric 10,7), `place_id` to `client_locations`. Added `lat`, `lng`, `place_id` to `supplier_locations`. All nullable — no backfill required.
- **Google Maps loader** (`client/src/lib/googleMapsLoader.ts`): Singleton script loader for Google Maps Places API. Loads once, resolves to `false` if key missing or script fails (graceful fallback).
- **AddressAutocomplete component** (`client/src/components/ui/AddressAutocomplete.tsx`): Reusable address input with Google Places autocomplete. Matches shadcn Input styling. Returns structured `PlaceSelectPayload` (street, city, province, postalCode, country, lat, lng, placeId). Falls back to plain text input when API unavailable.
- **LocationFormModal integration**: Street address input replaced with `AddressAutocomplete`. Selecting a suggestion auto-fills street, city, province, postal code, country. Lat/lng/placeId persisted to DB on save.
- **Server route updates**: `POST /api/clients/quick-create` now uses Zod validation (was previously unvalidated). All client create/update routes and supplier location routes accept and persist `lat`, `lng`, `placeId`, `country` fields.
- **Route optimization improvement**: `routeOptimizationService.geocodeClients()` now uses persisted lat/lng when available, skipping OpenRouteService geocoding calls.
- **Migration**: `migrations/2026_03_04_google_places_geocoding_columns.sql`
- **Docs**: `docs/ADDRESS_AUTOCOMPLETE.md`
- **Dev dependency**: `@types/google.maps` added; `tsconfig.json` updated with `"google.maps"` type reference.
- **Files (new)**: `client/src/lib/googleMapsLoader.ts`, `client/src/components/ui/AddressAutocomplete.tsx`, `migrations/2026_03_04_google_places_geocoding_columns.sql`, `docs/ADDRESS_AUTOCOMPLETE.md`
- **Files (modified)**: `shared/schema.ts`, `server/routes/clients.ts`, `server/routeOptimizationService.ts`, `client/src/components/LocationFormModal.tsx`, `tsconfig.json`, `package.json`

#### Phase 2B: AddressAutocomplete — NewClientPage + CompanySettingsPage (2026-03-04)
- **NewClientPage full-create integration**: Replaced street address `<Input>` with `<AddressAutocomplete>` on all three address blocks: billing address, primary service address, and additional location service addresses. Service addresses persist `lat`/`lng`/`placeId`/`country` via the existing `POST /api/clients/full-create` payload. Billing autocomplete fills street/city/province/postalCode/country but does not persist geo fields (no billing geo columns).
- **CompanySettingsPage RHF integration**: Created `AddressAutocompleteField` (`client/src/components/ui/AddressAutocompleteField.tsx`) — a React Hook Form adapter wrapping `AddressAutocomplete` with `Controller` and `useFormContext()`. On place selection, uses `form.setValue()` to populate city, provinceState, and postalCode. No geo persistence (company settings has no lat/lng columns).
- **AddressAutocomplete data-testid support**: Added optional `data-testid` prop passthrough to the underlying `<input>` element.
- **Guardrails**: Same as Phase 2A — manual edits do not wipe geo fields; clearing the street field entirely clears lat/lng/placeId for service addresses.
- **Files (new)**: `client/src/components/ui/AddressAutocompleteField.tsx`
- **Files (modified)**: `client/src/pages/NewClientPage.tsx`, `client/src/pages/CompanySettingsPage.tsx`, `client/src/components/ui/AddressAutocomplete.tsx`

#### Phase 2A: Roll AddressAutocomplete into top address entry points (2026-03-04)
- **AddressAutocomplete integration**: Replaced street address `<Input>` with `<AddressAutocomplete>` on 6 additional forms. On place selection, auto-fills street, city, province, postal code, country; persists lat/lng/placeId. Falls back to plain text input when API key is missing.
- **Guardrails**: Manual edits to address after place selection do NOT wipe lat/lng. Clearing the address field entirely clears lat/lng/placeId. Place selection only overwrites city/province/postalCode if the Places API returns non-empty values.
- **ClientFormData interface updated**: `AddClientDialog.tsx` exports `ClientFormData` with optional `country`, `lat`, `lng`, `placeId` fields.
- **Files (modified)**: `client/src/components/QuickCreateDrawer.tsx`, `client/src/components/NewAddClientDialog.tsx`, `client/src/components/AddClientDialog.tsx`, `client/src/components/EditClientDialog.tsx`, `client/src/components/suppliers/AddLocationDialog.tsx`, `client/src/components/suppliers/EditLocationDialog.tsx`

#### Phase 1 Architecture: Event Log + Attention Queue (2026-03-04)
- **Events table (`events`)**: Canonical tenant-scoped append-only event log for activity feeds, entity timelines, and analytics. Fields: tenantId, actorUserId, actorType, entityType, entityId, eventType, severity, summary, meta (JSONB), createdAt. Three indexes for feed, entity, and event type queries.
- **Event writer (`server/lib/events.ts`)**: `logEvent(ctx, params)` and `logEventAsync(ctx, params)` helpers. Failures are swallowed (never break operations). Uses existing `QueryCtx` pattern for tenant/actor context.
- **Event instrumentation**: 12 event types instrumented across 5 route files: job (created, completed, status_changed, reopened, archived, scheduled, rescheduled, assigned, unassigned, unscheduled), invoice (created, sent), client (created), quote (created).
- **Activity read APIs**: `GET /api/activity?limit=50&cursor=<ISO>` (tenant feed), `GET /api/activity/:entityType/:entityId` (entity timeline). Cursor-based pagination via `createdAt`.
- **Attention items table (`attention_items`)**: Materialized "needs attention" queue with rule-based detection. Fields: tenantId, entityType, entityId, ruleType, severity, status (open/resolved), firstDetectedAt, lastDetectedAt, resolvedAt, meta (JSONB), dedupeKey (unique per tenant). Upsert-on-conflict pattern prevents duplicates.
- **Attention rules engine (`server/lib/attentionRules.ts`)**: Four rules implemented: `job.requires_invoicing` (high), `job.overdue` (high), `job.unassigned` (medium), `job.unscheduled` (medium). Each rule has full-scan `detect()` and single-entity `detectForEntity()` methods.
- **Incremental attention recompute**: `recomputeAttentionForEntity()` called after every job mutation (create, status change, close, reopen, schedule, reschedule, unschedule). Fire-and-forget (`.catch(() => {})`).
- **Admin recompute endpoint**: `POST /api/attention/recompute` (owner/admin only) — full tenant-wide recompute safety valve.
- **Attention read APIs**: `GET /api/attention?entityType=job&status=open` (filtered items), `GET /api/attention/summary` (counts by ruleType for dashboard), `GET /api/attention/:entityType/:entityId` (entity items).
- **Dashboard server-backed activity**: `RecentActivityWidget` now fetches from `GET /api/activity?limit=20` instead of in-memory `ActivityStore`. Loading state added.
- **Dashboard attention counts**: WorkflowStrip "Requires Invoicing", "Unassigned", "Unscheduled" counts now sourced from `/api/attention/summary` with fallback to existing workflow counts.
- **Migration**: `migrations/2026_03_04_events_and_attention_items.sql` — creates both tables with indexes and constraints.
- **Architecture docs**: `docs/EVENT_LOG_ATTENTION_QUEUE.md` — discovery report, schema reference, extension guide.
- **Files (new)**: `server/lib/events.ts`, `server/lib/attentionRules.ts`, `server/storage/events.ts`, `server/storage/attention.ts`, `server/routes/activity.ts`, `server/routes/attention.ts`, `migrations/2026_03_04_events_and_attention_items.sql`, `docs/EVENT_LOG_ATTENTION_QUEUE.md`
- **Files (modified)**: `shared/schema.ts` (2 new tables), `server/routes/index.ts` (register routes), `server/routes/jobs.ts` (logEvent + recompute), `server/routes/calendar.ts` (logEvent + recompute), `server/routes/invoices.ts` (logEvent), `server/routes/clients.ts` (logEvent), `server/routes/quotes.ts` (logEvent), `client/src/pages/Dashboard.tsx` (server-backed activity + attention counts)

#### Quick Create Drawer Fixes — Client fields, plan limit UX, searchable pickers (2026-03-04)
- **Quick Create Client — field reorder + address**: Form now shows Company Name → Street Address → City + Province/State (2-col) → Postal/ZIP (half-width) → Contact Name (optional). Address fields passed to server via updated `POST /api/clients/quick-create` endpoint. `needsDetails` flag set to `false` when address is provided.
- **Plan limit graceful handling**: Client form checks `GET /api/subscriptions/can-add-location` on mount. When at limit: Create button disabled, inline amber warning with location count and "Manage Locations" link displayed. No surprise toast errors.
- **Searchable client/location picker (Invoice + Quote)**: Replaced Select dropdown with Command+Popover combobox for client/location selection in Invoice and Quote quick create forms. Search matches on companyName, location, city, and address. Shows location + city as secondary line.
- **New Job picker verified**: QuickAddJobDialog already uses Command+Popover searchable picker — no changes needed.
- **Files (modified)**: `client/src/components/QuickCreateDrawer.tsx` (rewritten), `server/routes/clients.ts` (quick-create accepts address fields)

### Changed

#### Actionable Dashboard + Activity Feed + Smart Actions + Quick Create + List Polish (2026-03-04)
- **Dashboard "Needs Attention" focus**: Removed "Active" count from WorkflowStrip. Added "Unassigned" and "Unscheduled" navigation items that link to `/jobs?lifecycle=open&show=unassigned` and `/jobs?lifecycle=open&show=backlog` respectively. Null-count items display a `ChevronRight` arrow instead of a number.
- **Universal Activity Feed (UI-only)**: New `client/src/lib/activityStore.tsx` — React Context-based in-memory session store. Tracks last 20 actions (`logActivity()` / `useActivityStore()` hook). Wired into: QuickAddJobDialog (create job, create client), JobDetailPage (status update, create invoice), NewQuoteModal, AddJobNoteDialog, AddTimeEntryModal.
- **Dashboard Recent Activity widget**: New `RecentActivityWidget` component shows session activity with entity icons, relative timestamps, and click-to-navigate links.
- **Smart Context Actions on Job Detail**: Added `ContextActionsBar` to JobDetailPage. State-based CTAs: unscheduled→"Schedule Visit", scheduled+unassigned→"Assign Technician", completed→"Create Invoice", invoiced→"View Invoice".
- **Quick Create Drawer**: New `client/src/components/QuickCreateDrawer.tsx` — right-side Sheet drawer from global "+New" button. Menu of entity types (Job/Client/Invoice/Quote). "New Job" delegates to existing QuickAddJobDialog. Client/Invoice/Quote have inline minimal forms with activity logging, toast, and navigation on success. Replaced dropdown menu in App.tsx header.
- **Jobs list keyboard navigation**: Added Up/Down/Enter keyboard nav with `selectedRowIndex` state and `tableContainerRef`. Selected row styled with `ring-1 ring-inset ring-[var(--brand)] bg-[#F3F4F6]`. Input/textarea/select fields excluded from handler.
- **Jobs list URL param handling**: `show=unassigned` and `show=backlog` URL params now parsed and applied as initial derived filter state, enabling Dashboard→Jobs navigation.
- **Files (new)**: `client/src/lib/activityStore.tsx`, `client/src/components/QuickCreateDrawer.tsx`
- **Files (modified)**: `client/src/App.tsx`, `client/src/pages/Dashboard.tsx`, `client/src/pages/Jobs.tsx`, `client/src/pages/JobDetailPage.tsx`, `client/src/components/QuickAddJobDialog.tsx`, `client/src/components/NewQuoteModal.tsx`, `client/src/components/AddJobNoteDialog.tsx`, `client/src/components/time/AddTimeEntryModal.tsx`

#### List Screens Cleanup — status rules, filter consolidation, table consistency (2026-03-04)
- **Global header "+New" button**: Reduced from default to `size="sm"` with `h-8 px-3 text-sm` for a more compact header CTA.
- **Jobs list — duplicate button removed**: Removed the "New Job" button from `TablePageShell` actions; the global header "+New" dropdown already provides this.
- **Jobs list — single-status pill**: Added `getDisplayStatus()` helper that returns one pill per row with priority: Overdue > Requires Invoicing > Archived > Invoiced > Sub-status > Lifecycle. Replaced multi-pill rendering (lifecycle + sub-status + overdue + all-day) with a single `StatusPill`. SLA aging row and quick actions preserved.
- **Jobs list — filter row consolidation**: Merged two filter rows (lifecycle pills + search, and derived filters) into a single "Show:" row. Lifecycle status is now a compact dropdown. Sort dropdown removed (table header `SortableHeader` already handles column sorting). Default sort changed from "priority" to "schedule". Search input moved right-aligned in the same row.
- **Job detail — Create Invoice banner**: `requires_invoicing` attention banner now shows a single "Create Invoice" button (opens invoice dialog) instead of "Schedule another visit" + "Mark Invoiced". Added `onCreateInvoice` prop to `OfficeActionsStrip`.
- **Clients list — green active ring**: Tag filter chips now use `ring-[var(--brand)]` (green) for active state instead of per-tag-color boxShadow, matching the global green theme.
- **Clients list — header styling**: Grid header updated to `bg-[#FAFAFA] font-semibold text-[#6B7280]` matching the shared Table component header from `table.tsx`.
- **Table row hover**: `tableRowClass` in `list-surface.tsx` updated from `hover:bg-gray-100/60` to `hover:bg-[#F3F4F6]` matching the shared Table component hover color.
- **Invoices list — view toggle removed**: Removed density toggle (LayoutGrid/List buttons), `userDensityPreference` state, and `effectiveDensity` computation. Always shows comfortable (cards) layout. Removed `isCompact` conditionals from row rendering. Removed `LayoutGrid`/`List` lucide imports.
- **Files**: `client/src/App.tsx`, `client/src/pages/Jobs.tsx`, `client/src/pages/JobDetailPage.tsx`, `client/src/pages/Clients.tsx`, `client/src/components/ui/list-surface.tsx`, `client/src/pages/InvoicesListPage.tsx`

#### UI polish pass — EmptyState component, filter chip consistency, micro-cleanup (2026-03-04)
- **EmptyState component**: New `client/src/components/ui/empty-state.tsx` — shared component with optional icon (h-10 w-10, 50% opacity), message, description, and action slot. Standardizes the 28+ inline empty state patterns across the app into one reusable component with consistent py-12 spacing, text sizing, and color treatment.
- **AsyncBlock upgraded**: Now accepts `emptyIcon` and `emptyDescription` props and delegates to EmptyState internally instead of rendering bare text.
- **Filter chip consistency**: Invoices and Quotes filter buttons changed from `variant="outline"` rectangular to `rounded-full h-8 px-3 text-xs` pill style with green active state (`--brand`/`--brand-hover`), matching Jobs page. Dashboard TasksPanel Active/Completed toggle updated to same pill style.
- **Empty states standardized**: Replaced inline empty state divs with EmptyState component on: InvoicesListPage, Quotes, Clients, Suppliers, Reports (parts + schedule tabs), JobTemplatesPage, TechnicianManagementPage. Consistent icon + message + description pattern.
- **Micro consistency**: Loading text states changed from `opacity-70` to `text-muted-foreground` for consistent color treatment (Suppliers, TechnicianManagement).
- **Files**: `client/src/components/ui/empty-state.tsx` (new), `client/src/components/AsyncBlock.tsx`, `client/src/pages/InvoicesListPage.tsx`, `client/src/pages/Quotes.tsx`, `client/src/pages/Dashboard.tsx`, `client/src/pages/Clients.tsx`, `client/src/pages/Suppliers.tsx`, `client/src/pages/Reports.tsx`, `client/src/pages/JobTemplatesPage.tsx`, `client/src/pages/TechnicianManagementPage.tsx`

#### UI consistency pass — green primary theme, lighter sidebar, reduced width, header separation (2026-03-04)
- **Green primary theme**: Changed `--primary` from blue (`220 96% 58%` / `#2D6CFB`) to green (`122 45% 34%` / `#2F7D32`) in both `:root` and `.dark`. All default buttons, focus rings (`--ring`), and active states are now green globally via CSS variables. Added `--brand`, `--brand-hover`, `--brand-ring` design tokens.
- **Sidebar lightened + narrowed**: Background changed from `#1F2933` to `#243241` (lighter). Width reduced from `16rem` (256px) to `12.5rem` (200px). Sidebar HSL vars updated. Icon colors now use `--sidebar-muted` token. Active border uses `--brand` var.
- **Header separation**: Added micro-shadow `shadow-[0_1px_0_rgba(0,0,0,0.03)]` to global header for clear visual separation from content.
- **App background**: Updated `--app-bg` from `#F5F7F9` to `#F7F9FB` and `--background` HSL to match.
- **Blue accent cleanup**: Updated Dashboard Quotes section from blue to teal, LocationDetailPage active badge from blue to green, JobCard reschedule hover from blue to green. Jobs page filter chips now reference `--brand` vars instead of hardcoded hex.
- **Dark mode**: `--primary` and `--ring` updated to brighter green (`142 50% 45%`) for dark mode visibility.
- **Files**: `client/src/index.css`, `client/src/components/ui/sidebar.tsx`, `client/src/App.tsx`, `client/src/components/AppSidebar.tsx`, `client/src/pages/Jobs.tsx`, `client/src/pages/Dashboard.tsx`, `client/src/pages/LocationDetailPage.tsx`, `client/src/components/calendar/JobCard.tsx`

#### UI upgrade pass #2 — StatusPill, modern tables, dashboard metrics, filter chips, input focus (2026-03-04)
- **StatusPill component**: New `client/src/components/ui/status-pill.tsx` with 5 variants (neutral, success, warning, danger, info). Includes `statusToVariant()` mapping for consistent status→color across all pages. Height 24px, rounded-full, subtle border + background.
- **Modern table styling**: Updated `table.tsx` — header row gets `#FAFAFA` background, font-semibold `#6B7280` text; data rows 44px height (`h-11`); cells use `px-4 py-2.5` padding; hover state `#F3F4F6`.
- **Dashboard metrics card**: WorkflowStrip converted from `rounded-xl shadow-sm` to `rounded-md border` with full-height vertical dividers. NeedsAttention/Invoices widgets get matching card treatment. Status labels in dashboard use inline pill styling. Dashboard background changed to `bg-background`.
- **Jobs page StatusPill**: Replaced all Badge usage in status column with StatusPill (lifecycle, sub-status, overdue, all-day, SLA, escalated). Lifecycle filter tabs now use rounded-full pill chips with green active state. Derived filters (Scheduled/Backlog, Assigned/Unassigned, Overdue) use outline pill chips with green active fill.
- **Input focus ring**: Changed from blue ring to green focus glow (`box-shadow: 0 0 0 3px rgba(47,125,50,0.18)`, `border-color: rgba(47,125,50,0.55)`).
- **Job detail page**: Office action banner reduced from `rounded-lg border-2 p-4` to `rounded-md border px-4 py-3` with softer amber background. Badge classes updated to pill-style soft fills. Top meta card updated to `rounded-md` with micro-shadow.
- **Files**: `client/src/components/ui/status-pill.tsx` (new), `client/src/components/ui/table.tsx`, `client/src/components/ui/input.tsx`, `client/src/pages/Dashboard.tsx`, `client/src/pages/Jobs.tsx`, `client/src/pages/JobDetailPage.tsx`

#### RALPH UI modernization — design tokens, dark sidebar, global header, tighter radii (2026-03-04)
- **Design tokens**: Added CSS custom properties (`--app-bg`, `--sidebar-bg`, `--sidebar-text`, `--sidebar-hover`, `--primary-green`, `--radius-sm`, `--spacing-page/card/gap`, `--header-height`) in `:root` for consistent theming.
- **Dark sidebar**: Sidebar is always dark (#1F2933) regardless of light/dark mode. Updated `:root` and `.dark` sidebar CSS vars to match. Component classes use `bg-sidebar text-sidebar-foreground` with `hover:bg-white/[0.08]` and green active border.
- **Global header**: Restructured layout so header spans full width above the sidebar. Sidebar repositioned below header via `[data-slot="sidebar-container"]` CSS override.
- **Border radius reduction**: Changed `--radius` from `0.75rem` (12px) to `0.375rem` (6px). Updated `card.tsx`, `dialog.tsx`, `alert-dialog.tsx`, `alert.tsx`, `list-surface.tsx` from `rounded-xl`/`rounded-lg` to `rounded-md`.
- **Shadow → border**: Replaced `shadow-sm` on cards and list surfaces with `shadow-[0_1px_2px_rgba(0,0,0,0.05)]` micro-shadow + explicit border.
- **Files**: `client/src/index.css`, `client/src/App.tsx`, `client/src/components/AppSidebar.tsx`, `client/src/components/ui/card.tsx`, `client/src/components/ui/dialog.tsx`, `client/src/components/ui/alert-dialog.tsx`, `client/src/components/ui/alert.tsx`, `client/src/components/ui/list-surface.tsx`

#### Sidebar navigation reordered with section dividers (2026-03-04)
- Reordered: Dashboard, Calendar | Jobs, Invoices, Quotes, Clients, Suppliers, Reports | Settings, Admin.
- Added two visual dividers: after Calendar (before Operations group) and after Reports (before System group).
- **File**: `client/src/components/AppSidebar.tsx`

#### Create Job modal: multi-technician assignment support (2026-03-04)
- **Multi-tech picker**: Replaced single-technician dropdown in `JobScheduleFields` with chips + "+ Add" popover pattern (matching calendar job view modal). Supports 0, 1, or many technicians.
- **Backward compat**: `primaryTechnicianId` auto-syncs to first element of `assignedTechnicianIds`.
- **`parseJobToScheduleValue` fix**: Falls back to `primaryTechnicianId` singleton when `assignedTechnicianIds` is empty/missing, so edit mode correctly shows existing assignments.
- **Files**: `client/src/components/jobs/JobScheduleFields.tsx`

#### Calendar modal simplified — removed notes/attachments/reset, added autosave + typed time input (2026-03-04)
- **Removed from modal**: Notes section, "Add note" input, image upload button, attachments section, and Reset button. Modal is now focused on quick scheduling.
- **Autosave on close**: If scheduling fields (date, time, duration, all-day) are dirty when modal closes (X / overlay / escape), changes save automatically. On failure, modal stays open with error toast.
- **Typed time input**: Replaced hour/minute dropdown pair with single text input accepting shorthand (9, 9a, 930, 9:30, 21:15, 2:05pm). Validates on blur and blocks save/close if invalid.
- **Dirty tracking**: `ScheduleSnapshot` comparison tracks date/allDay/hour/minute/duration. "Unsaved changes" hint shown next to Save button.
- **Layout**: Narrowed dialog from `max-w-3xl` (2-column) to `max-w-lg` (single column) since right column (notes/attachments) was removed.
- **File**: `client/src/components/JobDetailDialog.tsx` (1329 → ~580 lines)

### Fixed

#### Template apply: job parts now retain item reference so Product/Service displays correctly (2026-03-04)
- **Server fix**: `applyJobTemplateToJob` now batch-fetches referenced products from `items` table. Description fallback chain: `descriptionOverride → items.name → items.description → ""`. Price fallback: `unitPriceOverride → items.unitPrice → "0"`. The `productId` field was already correctly written from `line.productId`.
- **UI fix**: Added `resolveProductDisplay()` helper used by both `LineItemRow` and `SortableLineItemRow`. Rendering fallback: resolved item name (via `productId` catalog lookup) → stored `description` → "No product". Prevents stale "No product" when mapping useEffect hasn't re-run or catalog is paginated.
- **Files**: `server/storage/templates.ts`, `client/src/components/PartsBillingCard.tsx`

#### Calendar modal: allow closing after Unschedule; fix stale version errors (2026-03-04)
- **Autosave-after-unschedule fix**: Unschedule success handler now resets dirty-tracking snapshot to empty-date baseline and clears validation errors, so `isDirty` is false and close is not blocked.
- **Autosave gate for unscheduled state**: `handleOpenChange` skips autosave when `selectedDate` is empty (unscheduled), allowing immediate close.
- **Stale version fix**: Added `localVersion` state initialized from `assignment.version`. All mutations (`updateSchedule`, `unscheduleJob`, `assignTechnicianMutation`) use `localVersion` instead of prop value, and update it from API responses. Prevents "Expected version X, Actual version Y" errors after sequential mutations.
- **Version conflict handling**: Technician mutation surfaces 409 errors with clear message ("Job was updated elsewhere. Please close and reopen to refresh.").
- **File**: `client/src/components/JobDetailDialog.tsx`

#### Calendar, overdue badge, and dashboard consistency fixes (2026-03-04)
- **Calendar: archived jobs hidden** — Added `j.status != 'archived'` filter to `getScheduledJobsInRange()` SQL query so archived jobs no longer appear on the calendar.
- **Calendar: terminal jobs styled as terminal** — Expanded `completed` flag in `calendarUtils.ts` normalizer to cover all terminal statuses (completed, invoiced, archived). Terminal jobs now render with muted opacity, strike-through, and disabled drag/drop in both `DraggableClient` and `CalendarEventChip`.
- **Overdue badge: suppressed for terminal jobs** — Replaced simplified overdue check in `JobMetaCard.tsx` with canonical `isJobOverdue()` predicate from `shared/schema.ts`. Terminal jobs (completed/invoiced/archived) can no longer show an "Overdue" badge.
- **Dashboard Needs Attention: reason badges** — Added "Needs invoicing" (amber) and "On hold" (orange) badges alongside existing "Overdue" (red) badge so every Needs Attention row shows its reason.
- **Files**: `server/storage/calendar.ts`, `client/src/components/calendar/calendarUtils.ts`, `client/src/components/calendar/DraggableClient.tsx`, `client/src/components/calendar/CalendarEventChip.tsx`, `client/src/components/JobMetaCard.tsx`, `client/src/pages/Dashboard.tsx`

### Changed

#### Jobs page default priority sort with context-aware navigation (2026-03-03)
- **Priority sort**: New default sort when landing on `/jobs` from sidebar. Jobs ordered by dispatch priority buckets: Overdue → Requires Invoicing → In Progress → Scheduled → Backlog → Completed → Archived. Secondary sort: scheduled date ASC, then created date DESC.
- **Priority sort fix**: Overdue bucket now uses canonical effective end time (`scheduledEnd → scheduledStart+duration → scheduledStart` fallback) instead of raw `scheduledStart`, matching `isJobOverdue()` and existing overdue SQL in `maintenance.ts`/`admin.ts`.
- **Backend**: Added `sortBy=priority` option to `GET /api/jobs` using SQL CASE expression in `server/storage/jobsFeed.ts`. Also passes `sortBy`/`sortOrder` query params through `server/routes/jobs.ts`.
- **Context-aware navigation**: Dashboard links (`/jobs?lifecycle=completed`, `/jobs?lifecycle=open&subStatus=on_hold`) now parsed by Jobs page and applied as initial filter state. When context params are present, default priority sort is NOT applied.
- **Archived exclusion**: "All" status tab now excludes archived jobs by default. Archived only visible when explicitly selecting the "Archived" tab.
- **Sort dropdown**: Added Sort control to filter row 2 with options: Priority, Schedule, Status, Job #, Location.
- **Files**: `server/storage/jobsFeed.ts`, `server/routes/jobs.ts`, `client/src/hooks/useJobsFeed.ts`, `client/src/pages/Jobs.tsx`

#### Visit Reschedule Architecture — single active visit per job (2026-03-02)
- **Architecture**: Simplified visit scheduling to enforce a single active visit per job. Empty/unactioned visits are silently replaced; actioned visits prompt a 2-button dialog ("Replace Visit" / "Complete & Schedule New"). Removed the "follow-up visit" concept entirely.
- **`isVisitEmpty()` helper**: Added inverse of `isVisitActioned()` to `server/storage/jobVisits.ts` — returns true when a visit has no meaningful activity. Client-side mirror in `client/src/lib/visitUtils.ts` (new file).
- **`getNextVisitNumber()` bug fix**: Removed `isActive` filter so soft-deleted visits are counted for the unique constraint `job_visits_job_visit_number_uq`. Prevents constraint violations when creating new visits after soft-deleting old ones.
- **`scheduleJob()` refactored**: Replaced placeholder-only detection with 2-case model: (1) empty visit or explicit `conflictMode='replace'` → soft-delete + create new, (2) actioned visit + `conflictMode='complete_and_new'` → complete old + create new, (3) actioned visit + no mode → 409 conflict for frontend dialog.
- **`rescheduleJob()` updated**: Added `mode` parameter. `mode='complete_and_new'` completes the old visit instead of soft-deleting. No mode = existing auto-detect behavior preserved (calendar drag-and-drop unchanged).
- **Conflict dialog**: Replaced 3-option AlertDialog (Cancel/Reschedule/Add Follow-up) with 2-button dialog (Replace Visit / Complete & Schedule New) in `JobDetailPage.tsx`.
- **Tech completion modal**: Simplified from 3 options to 2 — removed "Needs Follow-up" outcome from `TechVisitDetailPage.tsx`. Server still accepts `needs_followup` for backward compatibility.
- **Label renames**: "Schedule follow-up visit" → "Schedule Visit" across UI.
- **Files**: `server/storage/jobVisits.ts`, `server/storage/calendar.ts`, `server/routes/calendar.ts`, `client/src/lib/visitUtils.ts` (new), `client/src/pages/JobDetailPage.tsx`, `client/src/components/AddVisitDialog.tsx`, `client/src/components/JobVisitsSection.tsx`, `client/src/pages/TechVisitDetailPage.tsx`

#### Empty-visit confirmation before replace (2026-03-02)
- **Fix**: Scheduling a new visit when an empty (no-activity) visit exists now shows a confirmation dialog ("This visit has no activity. It will be removed and replaced…") instead of silently replacing. Actioned-visit dialog updated to single primary button ("Yes, Complete & Schedule New"). Backend enforcement unchanged.
- **Files**: `client/src/pages/JobDetailPage.tsx`

### Fixed

#### Calendar: all-day → timed drag creates 24h duration (2026-03-03)
- **Bug**: Dragging an all-day visit into a timed calendar slot produced a ~24h duration (start 9:00 AM, end next day 12:00 AM) because the all-day `endAt` was passed through to the backend without normalization.
- **Fix**: Added all-day → timed conversion guard in `rescheduleJob()` (`server/storage/calendar.ts`). When the current visit is all-day and the new request is timed, the incoming `endAt` is replaced with `startAt + durationMinutes` (preferring the job's existing duration, else `DEFAULT_VISIT_DURATION_MINUTES = 60`). This is the backend source of truth, independent of frontend clamping.
- **Files**: `server/storage/calendar.ts`

#### Job reopen failing with "Required at version" validation error (2026-03-02)
- **Root cause**: `reopenJobMutation` in `JobHeaderCard.tsx` sent `{ target: "in_progress" }` but the server `reopenJobSchema` requires `version` (optimistic locking) and the field name is `targetOpenSubStatus`, not `target`. Zod rejected the payload before the handler ran.
- **Fix**: Send `{ targetOpenSubStatus: "in_progress", version: job.version }` matching the server schema exactly.
- **Files**: `client/src/components/JobHeaderCard.tsx`

#### Dashboard overdue: remove from top strip, show only in Needs Attention (2026-03-02)
- **Bug 1**: The workflow strip Jobs section showed an "Overdue" row — not wanted. Overdue jobs should appear only under Needs Attention.
- **Bug 2**: Even after the overdue predicate fix (`NOW()` instead of midnight), Needs Attention still showed "All caught up!" because the composite `overdueCondition` SQL fragment was not composing correctly inside Drizzle's `and()` combinator. When a multi-clause `sql` template literal (containing AND operators) was passed as a single argument to Drizzle's `and()`, the generated SQL was malformed.
- **Fix — workflow strip**: Removed `overdueCount` from `WorkflowSummary` type and UI. Active count reverted to counting all `status='open'` jobs.
- **Fix — overdue SQL**: Replaced composite fragment with individual conditions (`eq(status, 'open')`, `sql\`scheduledStart IS NOT NULL\``, `sql\`effectiveEndExpr < NOW()\``) passed separately to `and()`. Extracted `effectiveEndExpr` CASE fragment for reuse.
- **Verified**: Direct query returns overdue job #10047 (`attentionType=overdue`, `end=2026-03-02T14:15:00Z < NOW()`).
- **Files**: `server/storage/dashboard.ts`, `server/routes/dashboard.ts`, `client/src/pages/Dashboard.tsx`

#### JobTemplateModal crash: `catalogData?.filter is not a function` (2026-03-02)
- **Root cause**: `/api/items?limit=200` returns `{ data: [...], meta: {...} }` (paginated wrapper) when `?limit` is explicit, but the component typed the response as `Item[]` and called `.filter()` on the object.
- **Fix**: Unwrap the paginated response in `queryFn` (`json.data` fallback) and added a defensive normalization guard before `.filter()` to handle TanStack Query cache sharing with other components.
- **Files**: `client/src/components/JobTemplateModal.tsx` (lines 111-126)

#### Client Quotes tab "No quotes yet" — null customerCompanyId (2026-03-02)
- **Root cause**: Quote creation fell back to `location.parentCompanyId` which is nullable. For unlinked/legacy locations this was NULL, so quotes were stored with `customerCompanyId = NULL`. The Client detail page queries by a non-null `customerCompanyId`, returning 0 results.
- **Fix — quote creation**: `POST /api/quotes` now uses `resolveCustomerCompanyForLocation()` which finds-or-creates the parent customer company and links the location, guaranteeing `customerCompanyId` is always set.
- **Fix — shared service**: Extracted `server/services/customerCompanyResolver.ts` with `resolveCustomerCompanyForLocation()` — reusable by quote creation, invoice creation, and any future flow that needs a customer company from a location.
- **Fix — backfill script**: Added `server/scripts/backfillQuoteCustomerCompanyId.ts` to repair existing quotes with NULL or mismatched `customerCompanyId`. Run: `npm run backfill:quotes-customer-company -- --fix`
- **Cleanup**: Removed all temporary debug artifacts (`[DEBUG ClientQuotes]` / `[DEBUG LocationQuotes]` console.logs, `GET /api/quotes/debug` endpoint).
- **Files**: `server/services/customerCompanyResolver.ts` (new), `server/routes/quotes.ts`, `server/scripts/backfillQuoteCustomerCompanyId.ts` (new), `package.json`, `client/src/pages/ClientDetailPage.tsx`, `client/src/pages/LocationDetailPage.tsx`


#### Client Overview "Active Work" not showing unscheduled jobs (2026-03-02)
- **Bug**: Client page Active Work filtered jobs with `isJobScheduled(j) || openSubStatus === "in_progress"`, which excluded unscheduled backlog jobs. Location page Active Work only requires `status === "open"` (no schedule requirement). Aligned Client page to match Location page: all open, non-overdue jobs now appear.
- **Files**: `client/src/pages/ClientDetailPage.tsx`

#### Quotes list not refreshing after create (2026-03-02)
- **Bug**: Creating a quote did not refresh the Quotes list page because `NewQuoteModal` invalidated `["/api/quotes"]` but the list queries `["/api/quotes/list"]`. Added `["/api/quotes/list"]` invalidation to `NewQuoteModal`, `QuoteDetailPage` (send/approve/decline/delete/convert mutations), and `ApplyQuoteTemplateModal`.
- **Files**: `client/src/components/NewQuoteModal.tsx`, `client/src/pages/QuoteDetailPage.tsx`, `client/src/components/ApplyQuoteTemplateModal.tsx`

### Changed

#### Client + Location Detail — Jobber-style two-column layout redesign (2026-03-02)
- **Client Detail**: Removed breadcrumb and "Corporate Client" label. Moved client name, status, tags, and locations list into a left-column header card. Actions restructured: Create Job and Add Location visible as compact buttons; Edit Company and Create Invoice moved into a More dropdown menu. Right column (Contacts, Notes) slides up to align with header card.
- **Location Detail**: Kept breadcrumb (Client / Location) but removed duplicate heading. Moved location info into a left-column header card. Actions restructured: Create Job visible; Edit Location, Create Invoice, Set as Primary, and Delete moved into a More dropdown. Delete requires confirmation dialog. Right column (Contacts, PM Schedule, Parts, Notes, Equipment) slides up to align with header card.
- **Layout**: Both pages now use a consistent `grid-cols-[1fr,320px]` two-column grid. Buttons use `size="sm"` with `h-8 px-3 text-xs` for compact Jobber-like appearance. Header card is constrained to left column width only.
- **Files**: `client/src/pages/ClientDetailPage.tsx`, `client/src/pages/LocationDetailPage.tsx`

#### Quotes list — Remove row actions menu (2026-03-02)
- **UI**: Removed the "..." dropdown menu (View/Edit/Send/Mark Approved/Mark Declined) from each row in the Quotes list page. Rows remain clickable for navigation to the quote detail page.
- **Files**: `client/src/pages/Quotes.tsx`

#### Quotes tab on Client + Location Overview (2026-03-02)
- **UI — Client page**: Added "Quotes" tab to the Overview card on Client detail page. Shows quotes scoped to the customer company (up to 5, with "more" link). Each row links to quote detail.
- **UI — Location page**: Added "Quotes" tab to the Overview card on Location detail page. Shows quotes scoped to that location. Each row links to quote detail.
- **Server**: Added optional `locationId` and `customerCompanyId` query params to `GET /api/quotes/list` endpoint for scoped filtering. No schema/migration changes.
- **Files**: `client/src/pages/ClientDetailPage.tsx`, `client/src/pages/LocationDetailPage.tsx`, `server/routes/quotes.ts`, `server/storage/quotes.ts`

#### Create Job Modal — Streamlined fields (2026-03-02)
- **UI**: Removed Job Type dropdown, Access Instructions textarea, and Billing Notes textarea from the Create/Edit Job modal (`QuickAddJobDialog.tsx`). Modal now only shows: Location, Summary, Scheduling, and Description.
- **Payload**: Create and update payloads no longer send `jobType`, `accessInstructions`, or `billingNotes`. Backend defaults `jobType` to `"maintenance"`; the other two fields were already optional in the insert schema.
- **No backend changes**: DB columns, API validation, and job detail views are untouched.
- **Files**: `client/src/components/QuickAddJobDialog.tsx`

### Added

#### QBO Mapping Config — Remove internal IDs from dropdown labels (2026-03-02)
- **UI**: Removed QBO internal ID suffixes (e.g., `(52)`, `(123)`) from income account and tax code dropdown option labels in Step 2 mapping config. Values still store QBO IDs internally; only display labels changed.
- **Files**: `client/src/pages/QboConsolePage.tsx`

#### QBO Item Type Mapping + Bundle Handling + Income Account Mapping (2026-03-02)
- **Schema**: Added `defaultIncomeAccountId` to `qboMappingConfigSchema` in `shared/schema.ts`. Stores the QBO Account ID used for `IncomeAccountRef` on Service/NonInventory items.
- **Server — Bundle skip**: `QboCatalogImportService` now explicitly tracks Bundle items as `action=SKIP` with reason "Bundle not supported" in import preview/run. Previously bundles were silently filtered. Bundles appear in the sample and are counted under `totals.skipped`.
- **Server — Income account validation**: `QboItemService.mapLocalItemToQBO()` now reads `defaultIncomeAccountId` from mapping config instead of hardcoding `IncomeAccountRef: { value: "1" }`. If missing, `syncCatalog()` fails fast with `MAPPING_MISSING_INCOME_ACCOUNT` error. `createQboItemFromLocalItem()` also fetches mapping config and throws with the same error code.
- **Server — Accounts endpoint**: Added `GET /api/qbo/accounts` endpoint that fetches Income-type accounts from QBO (via `SELECT ... FROM Account WHERE AccountType = 'Income'`) for the mapping config dropdown.
- **UI — Income account dropdown**: Step 2 (Type & Tax Mapping) now includes an "Income Account (required)" section with a dropdown populated from `GET /api/qbo/accounts`. Shows a warning if no income account is selected when mapping is otherwise configured.
- **UI — Bundle visibility**: Bundle items appear in catalog import preview with `action=SKIP` and `error="Bundle not supported"`, giving clear visibility into why they were excluded.
- **Type mapping preserved**: QBO→App import maps Service→"service", NonInventory/Inventory→"product". App→QBO sync maps "service"→Service, "product"→NonInventory (default).
- **Files**: `shared/schema.ts`, `server/services/qbo/QboCatalogImportService.ts`, `server/services/qbo/QboItemService.ts`, `server/routes/qbo.ts`, `client/src/pages/QboConsolePage.tsx`

#### QBO Catalog Sync — Error Surfacing + Resolution Hints (2026-03-01)
- **Server**: Added `errors[]` array to `CatalogSyncResult` in `QboItemService.syncCatalog()`. All failed items are captured regardless of the 5-item `sample[]` cap, each with `itemId`, `name`, `type`, `qboItemId`, and `error` message.
- **UI — Error panel**: When catalog sync (Step 3) returns errors > 0, a dedicated "X Items Failed" panel appears below the summary with a table showing: item name (linked to item edit page), type, local ID, QBO ID, error message, and a suggested fix.
- **UI — Error hints**: `getCatalogSyncErrorHint()` maps common QBO error patterns (duplicate name, invalid account ref, tax code, type mismatch, stale sync token, auth expired, rate limit, validation) to plain-English next steps.
- **UI — Sample table cleanup**: Non-error items and error items now render in separate tables — errors no longer hidden in the QBO ID column fallback.
- **Files**: `server/services/qbo/QboItemService.ts`, `client/src/pages/QboConsolePage.tsx`

#### QBO Onboarding Complete Lock + Reconciliation Mode UX (2026-03-01)
- **Schema**: Added `qbo_onboarding_catalog_imported_at` and `qbo_onboarding_customers_imported_at` nullable timestamp columns to `companies` table. Stamped once on first successful import run (fetched > 0) using `COALESCE` to preserve the original timestamp.
- **Server**: Catalog and customer import run endpoints now stamp onboarding timestamps after successful imports. Status endpoint (`GET /api/qbo/status`) expanded with `onboarding` object exposing both timestamps and a derived `complete` boolean.
- **UI — Onboarding badge**: QBO Console Import Tools card shows "Onboarding In Progress" (green outline) or "Onboarding Complete" (blue with CheckCircle) badge based on server state.
- **UI — Section relabeling**: After onboarding complete, Import Tools title appends "— Reconciliation", catalog/customer sections relabel to "Catalog Reconciliation (Advanced)" / "Customer Reconciliation (Advanced)", and helper text changes to "Your app is now the source of truth."
- **UI — Visual distinction**: Amber border and "Advanced" badge on Import Tools content area after onboarding complete.
- **UI — Wipe escalation**: Wipe confirmation dialogs change to "Wipe & Reconcile" titles with reconciliation-focused warnings after onboarding complete. Pre-onboarding dialogs unchanged.
- **UI — Status refetch**: Catalog and customer import run mutations now refetch status on success so onboarding state updates without reload.
- **Migration**: `migrations/2026_03_01_qbo_onboarding_timestamps.sql` — idempotent (`ADD COLUMN IF NOT EXISTS`). Run: `psql "$DATABASE_URL" -f migrations/2026_03_01_qbo_onboarding_timestamps.sql`
- **Files**: `shared/schema.ts`, `server/routes/qbo.ts`, `client/src/pages/QboConsolePage.tsx`, `migrations/2026_03_01_qbo_onboarding_timestamps.sql`

#### QBO Import — Duplicate Resolution / Conflict Detection (2026-03-01)
- **Catalog import**: When a QBO item matches multiple local items by SKU or Name, a conflict is detected instead of silently picking one. `buildMatchIndexes()` now uses array-valued maps (`Map<string, Item[]>`) to surface all candidates. `findMatch()` renamed to `findCandidates()` returning all matches plus `matchBasis`.
- **Customer import**: Added name-based fallback matching for unlinked parent companies and child locations. When no `qboCustomerId` match exists, the service tries normalized name matching. Single match → auto-link; multiple matches → conflict. Existing queries expanded to include `name`, `email`, `isActive` fields for conflict display.
- **Resolution API**: Both import run endpoints now accept an optional `resolutions` body parameter (`Record<string, { action: "MAP"|"CREATE"|"SKIP", localId?: string }>`) to resolve conflicts. MAP validates target is among candidates and prevents re-linking already-linked items. Unresolved conflicts are safely skipped.
- **UI conflict panel**: Amber-colored conflict resolution panels appear in the Import Tools section after preview/run when conflicts are detected. Each conflict shows QBO record details, match basis badge, and a radio group for selecting MAP (to specific candidate), CREATE (new), or SKIP (default). Unresolved conflict count warning displayed. Resolutions state resets on new preview.
- **Totals**: Added `conflicts` count to both `CatalogImportResult` and `CustomerImportResult` totals. Added `conflicts[]` array to result payloads. Added CONFLICT action type to catalog import.
- **Staleness protection (H1)**: MAP resolutions re-fetch the target row from the database before writing during actual runs. Guards against target being deleted, deactivated, or re-linked to a different QBO ID between preview and run. Added `fetchItemForResolution()`, `fetchCompanyForResolution()`, `fetchLocationForResolution()` helper methods.
- **Wipe + resolutions**: Fixed wipe confirm dialogs to pass resolutions state when triggering import run.
- **Files**: `server/services/qbo/QboCatalogImportService.ts`, `server/services/qbo/QboCustomerImportService.ts`, `server/routes/qbo.ts`, `client/src/pages/QboConsolePage.tsx`
- **Verification**: End-to-end test script (`scripts/test-conflict-resolution.ts`) covering catalog and customer conflicts with all resolution types (SKIP/MAP/CREATE) and invariant checks (no duplicate QBO IDs, no missing sync fields).

### Fixed

#### QBO Customer Import — Parent Companies Invisible on Clients Page (2026-03-01)
- **Root cause**: The Clients page queries `client_locations` only. QBO parent customers (no `ParentRef`) were imported into `customer_companies` but never given a `client_locations` row, making them invisible. Only QBO sub-customers (children) created `client_locations` rows.
- **Fix**: `QboCustomerImportService` now calls `ensurePrimaryLocation()` after each parent upsert. If the parent has no `client_locations` row, a primary location named "Main" is created with the parent's address/contact data. Works for both dry-run (counting) and real runs.
- **Backfill migration**: `migrations/2026_03_01_backfill_primary_locations_for_parent_companies.sql` — idempotent INSERT for existing orphan parent companies.
- **DB impact**: 26 previously orphaned parent companies now have primary locations. All 30 imported parent companies visible on Clients page.
- **Files**: `server/services/qbo/QboCustomerImportService.ts`, `migrations/2026_03_01_backfill_primary_locations_for_parent_companies.sql`

#### QBO Wipe Mode — confirmToken Validation Returns 400 Instead of 500 (2026-03-01)
- **Root cause**: Both catalog and customer import wipe endpoints used `z.literal("WIPE").parse(req.body)` to validate the confirmation token. When the token was missing/wrong, Zod threw a `ZodError` caught by the global error handler as HTTP 500 — an opaque server error instead of a client validation error.
- **Fix**: Replaced Zod `.parse()` with explicit guard: `if (mode === "wipe" && req.body?.confirmToken !== "WIPE")` → returns `400 { success: false, error: { code: "CONFIRM_TOKEN_REQUIRED", message: ... } }`. Removed unused `wipeConfirmSchema` constant.
- **Files**: `server/routes/qbo.ts` (catalog import run + customer import run endpoints)

#### QBO Customer Import — Zero Fetch Bug in QboCustomerImportService (2026-03-01)
- **Root cause**: `fetchAllCustomers()` accessed `response.data.QueryResponse.Customer` but `QboClient.processResponse()` already extracts the entity key from QBO's response wrapper. So `response.data` IS the `QueryResponse` content (i.e., `{ Customer: [...] }`), making `response.data.QueryResponse` always `undefined` and the customer array always `[]`.
- **Impact**: Import preview/run always reported `fetched: 0` — no customers were ever imported from QBO.
- **Fix**: Changed access pattern from `queryResponse.QueryResponse?.Customer` to `queryData?.Customer` to match the already-extracted structure.
- **Files**: `server/services/qbo/QboCustomerImportService.ts`

#### QBO Sandbox — Dev Seed Endpoint (2026-03-01)
- **Feature**: Added `POST /api/qbo/dev/seed-customers` endpoint for seeding QBO sandbox with deterministic test data.
- **Safety**: Gated by `QBO_ENVIRONMENT=sandbox` + admin role. Never available in production.
- **Creates**: 4 parents (Acme HVAC, Acme HVAC Alt, Beta Foods, Gamma Group inactive) + 2 children (Acme HVAC - Warehouse, Beta Foods - Location 1).
- **Idempotent**: If customers already exist (duplicate name), finds and returns existing IDs.
- **Files**: `server/routes/qbo.ts`

#### QBO Mapping Config — ESM require() Bug in parseQboMappingConfig (2026-03-01)
- **Root cause**: `parseQboMappingConfig()` used `require("@shared/schema")` (CJS) inside an ESM module. In ESM, `require` is undefined. The `try/catch` silently swallowed the error and returned `null`, causing `mappingStatus.configured` to always report `false` even when mapping was properly saved in the database.
- **Impact**: Step 4 (Import Customers) in QBO Console was permanently greyed out because `isMappingConfigured` was always `false`, despite mapping data being correctly persisted by the PUT endpoint.
- **Fix**: Replaced dynamic `require("@shared/schema")` with a static ESM `import { qboMappingConfigSchema }` at the top of the file.
- **Files**: `server/services/qbo/QboItemMapper.ts`

#### QBO NonInventory Item Sync — Strip Inventory-Only Fields + Fix SalesDesc (2026-02-28)
- **Root cause 1**: QBO rejects NonInventory/Service items with inventory-only properties (`TrackQtyOnHand`, `QtyOnHand`, `InvStartDate`, `AssetAccountRef`) returning "Request has invalid or unsupported property".
- **Root cause 2**: Payload included `SalesDesc` — QBO schema expects `SalesDescription`. The invalid property name triggered the same rejection error.
- **Fix** (`mapLocalItemToQBO`): Removed `SalesDesc` entirely — QBO defaults sales-side description from `Description`. Strips inventory-only and purchase-side fields for NonInventory/Service types. Added `stripEmptyFields()` to remove undefined/null/empty values.
- **NaN guard**: `UnitPrice` now validated with `isNaN()` check before inclusion.
- **Diagnostic logging**: `[QBO ITEM PAYLOAD]` console.log before QBO API calls (temporary — remove after debugging).
- **Files**: `server/services/qbo/QboItemService.ts`, `CHANGELOG.md`

#### QBO Tax Code Dropdown — Hash Name Fix + Readable Labels (2026-02-28)
- **Root cause**: QBO sandbox auto-creates TaxCode entities with `Name` set to a system-generated hash/UUID (e.g., `3f7a8b...`). The endpoint only fetched `Name`, not `Description`, so hash-named codes appeared as the dropdown label.
- **Server fix** (`GET /api/qbo/taxcodes`): Now fetches `Description` field. Name resolution: `Name` if readable → `Description` if readable → filtered out entirely. Hash detection: skips strings matching `/^[0-9a-f-]{20,}$/i`. Diagnostic logging for first 10 codes (Id, Name, Description, Taxable).
- **Sorting**: TAX and NON codes sorted to top, then alphabetical by name.
- **Hint**: Empty result returns `"No tax codes available from QBO. Ensure Sales Tax is enabled and configured in this QuickBooks company."`
- **UI fix**: Dropdown trigger always shows `name` (never raw ID). Fallback: `"(Unnamed tax code)"`. List items show `name (id)` with ID in smaller muted text.
- **"Use QBO defaults" button**: Auto-selects TAX → taxableCodeId, NON → nonTaxableCodeId if both exist. Only appears when defaults are available.
- **Files**: `server/routes/qbo.ts`, `client/src/pages/QboConsolePage.tsx`

### Changed

#### QBO Mapping — Type-Based Mapping (replaces global default items) (2026-02-28)
- **Conceptual correction**: Mapping config no longer stores global default QBO Item IDs (`serviceItemId`/`productItemId`). Instead, each catalog item is synced individually to QBO and carries its own `qboItemId`. Invoice lines reference the catalog item's `qboItemId` directly.
- **New mapping fields**: `serviceQboItemType` ("Service", locked) and `productQboItemType` ("NonInventory" | "Inventory") — determines what QBO Item.Type each catalog item type maps to during catalog sync.
- **Schema**: `qboMappingConfigSchema` updated with `serviceQboItemType`/`productQboItemType`. Legacy fields retained for backwards compat.
- **QboItemMapper rewrite**: `resolveItemRef()` now only uses explicit `qboItemRefId` (from catalog item). Removed `getItemIdForType()` global fallback. `checkConfigStatus()` checks type mappings instead of item IDs.
- **Invoice mapper** (`server/qbo/mappers.ts`): Removed company default item fallback. Lines without `qboItemId` from catalog will fail with clear error: "Item not synced to QuickBooks. Sync catalog first."
- **Invoice service** error message updated to direct users to QBO Console > Catalog Sync.
- **Catalog sync** (`QboItemService.syncCatalog`): Now reads mapping config to resolve QBO Item.Type from `productQboItemType`/`serviceQboItemType`.
- **UI Step 2**: Replaced item name dropdowns with type-only dropdowns. Service locked to "Service"; Product dropdown: Non-inventory / Inventory. Removed `/api/qbo/items` query for Step 2.
- **Tax code display**: Renders human-readable name (not raw ID) via explicit name lookup.
- **Files**: `shared/schema.ts`, `server/services/qbo/QboItemMapper.ts`, `server/services/qbo/QboItemService.ts`, `server/services/qbo/QboInvoiceService.ts`, `server/qbo/mappers.ts`, `client/src/pages/QboConsolePage.tsx`

### Added

#### Advanced QBO Import Tools — Catalog + Customer Import (QBO → Local) (2026-02-28)
- **New service**: `QboCatalogImportService` — imports items from QBO into local catalog with 3 modes:
  - **merge**: Match by SKU then Name (case-insensitive). Link qboItemId/syncToken. Only fill null/empty local fields.
  - **overwrite**: Same matching, but replace local fields with QBO values.
  - **wipe**: Soft-delete all QBO-linked items, then re-import fresh from QBO.
- **Extended service**: `QboCustomerImportService` — added `mode` parameter (merge/overwrite/wipe) with same semantics.
- **New endpoints** (all admin-only):
  - `GET /api/qbo/catalog/import/preview?mode=merge|overwrite|wipe` — dry-run catalog import
  - `POST /api/qbo/catalog/import/run?mode=merge|overwrite|wipe` — execute catalog import
  - `GET /api/qbo/customers/import/preview?mode=merge|overwrite|wipe` — dry-run customer import
  - `POST /api/qbo/customers/import/run?mode=merge|overwrite|wipe` — execute customer import
  - Wipe mode requires `confirmToken: "WIPE"` in POST body (server-validated).
- **UI**: Collapsible "Import Tools (QBO → Local)" section inside Advanced panel. Mode selector dropdown, Preview/Run buttons, results display (Alert totals + sample table + warnings list), wipe confirmation dialog requiring typed "WIPE".
- **Files**: `server/services/qbo/QboCatalogImportService.ts` (new), `server/services/qbo/QboCustomerImportService.ts`, `server/services/qbo/index.ts`, `server/routes/qbo.ts`, `client/src/pages/QboConsolePage.tsx`, `CHANGELOG.md`

#### QBO Catalog Sync — Push Items to QuickBooks (2026-02-28)
- **New endpoint**: `POST /api/qbo/catalog/sync?dryRun=1|0` — syncs local catalog items to QBO as Products & Services. Admin-only.
- **Dry-run mode**: `dryRun=1` computes create/update counts and a sample of first 5 items without calling QBO API.
- **Real sync**: Creates new QBO Items (Type=Service or NonInventory based on item type) and updates existing linked items (using Id + SyncToken for optimistic locking).
- **Field mapping**: Name→Name, SKU→Sku, Description→Description+SalesDesc, Price→UnitPrice, Taxable→Taxable, Active→Active, Type→Service/NonInventory (immutable after creation).
- **Schema**: Added `qbo_last_synced_at` timestamp column to `items` table. Migration: `migrations/2026_02_28_items_qbo_last_synced_at.sql`.
- **Service method**: `QboItemService.syncCatalog(dryRun)` — iterates active items, creates/updates in QBO, persists QBO references (Id, SyncToken, lastSyncedAt) back to DB.
- **UI**: New "Step 3: Catalog Sync" card on QBO Console page with Preview Sync and Run Sync buttons, results table, and confirmation dialog.
- **Step renumbering**: Import Customers is now Step 4, Invoice Sync is now Step 5.
- **Step 2 description**: Updated to explain service/product line type mapping.
- **Files**: `server/services/qbo/QboItemService.ts`, `server/routes/qbo.ts`, `client/src/pages/QboConsolePage.tsx`, `shared/schema.ts`, `CHANGELOG.md`
- **Migration**: `migrations/2026_02_28_items_qbo_last_synced_at.sql`

### Changed

#### QBO Mapping — Two-Item Model + Tax Code Display Fix (2026-02-28)
- **Two required item mappings**: Replaced single `productServiceItemId` with `serviceItemId` (QBO Type=Service for service/labor lines) and `productItemId` (QBO Type=NonInventory/Inventory for material/product lines).
- **Type-filtered dropdowns**: Service dropdown only shows QBO items with Type=Service. Product dropdown only shows NonInventory/Inventory items.
- **Tax code field rename**: `taxableCode`/`nonTaxableCode` → `taxableCodeId`/`nonTaxableCodeId`. Legacy fields auto-migrated by `parseQboMappingConfig()`.
- **Tax code display fix**: Tax code dropdown now explicitly renders the human-readable name (not the ID). Shows `name (id)` in the dropdown list for clarity.
- **QboItemMapper updated**: service→serviceItemId, material→productItemId, fee/discount→fallback to serviceItemId, unknown→serviceItemId. `checkConfigStatus` requires both service + product.
- **Backwards compat**: `parseQboMappingConfig()` migrates old field names forward (productServiceItemId/laborItemId→serviceItemId, materialItemId→productItemId, taxableCode→taxableCodeId).
- **Files**: `shared/schema.ts`, `server/services/qbo/QboItemMapper.ts`, `client/src/pages/QboConsolePage.tsx`

#### QBO Integration — Production Stabilization (2026-02-28)

**1. Split `/api/qbo/items` endpoint (Option A)**
- `GET /api/qbo/items` now returns ONLY a flat array `[{ id, name, type, active }]` for mapping dropdowns. No wrapped objects, no syncRunId.
- New `GET /api/qbo/items/advanced` endpoint for sync management UI — returns wrapped `{ success, items, totalCount, syncRunId }` with search and pagination.
- Frontend advanced query updated from `/api/qbo/items` to `/api/qbo/items/advanced`.
- **Files**: `server/routes/qbo.ts`, `client/src/pages/QboConsolePage.tsx`

**2. Simplified mapping — single Product/Service item**
- Added `productServiceItemId` to `qboMappingConfigSchema` — one QBO Item maps ALL invoice line types (service, material, fee, discount).
- `QboItemMapper.getItemIdForType()`: `productServiceItemId` takes priority; falls back to legacy per-type fields for backwards compatibility.
- `QboItemMapper.checkConfigStatus()`: only requires `productServiceItemId` (or legacy `serviceItemId`). Tax codes are optional.
- `parseQboMappingConfig()`: auto-promotes old `serviceItemId` → `productServiceItemId` for existing configs.
- UI Step 2 card: replaced 6 item dropdowns (service/labor/material/fee/discount/misc) with single "Product/Service" dropdown.
- Advanced section mapping card: shows only `productServiceItemId`, `taxableCode`, `nonTaxableCode`.
- **Files**: `shared/schema.ts`, `server/services/qbo/QboItemMapper.ts`, `client/src/pages/QboConsolePage.tsx`

**3. Fixed CSRF on Save Mapping**
- `saveMappingConfigMutation` was using raw `fetch()` without CSRF token header — always failed with "Invalid CSRF token".
- Changed to use `apiRequest()` which auto-injects CSRF token from session.
- Added user-friendly error message for CSRF/session expiry failures.
- **File**: `client/src/pages/QboConsolePage.tsx`

**4. Tax code retrieval fix**
- `GET /api/qbo/taxcodes` now returns structured `{ taxCodes: [...], hint?: string }` instead of flat array.
- Removed `WHERE Active = true` filter — returns all tax codes.
- When QBO returns no tax codes (taxes not enabled), returns `hint: "Enable Sales Tax in your QuickBooks company settings..."`.
- Frontend displays the hint message instead of generic "No tax codes found".
- Added diagnostic logging: count + first 3 tax codes.
- **Files**: `server/routes/qbo.ts`, `client/src/pages/QboConsolePage.tsx`

### Fixed

#### QBO Items Endpoint — Route Shadowing + Query Filter Fix (2026-02-28)
- **Route shadowing bug**: Superseded by endpoint split above.
- **Overly restrictive query**: `WHERE Active = true` filter removed from both dropdown and `QboItemService.listQboItems()`.
- **Diagnostic logging**: realmId, environment, query string, item count logged on both endpoints (no tokens).
- **Empty QueryResponse handling**: Logs safe fields and returns empty array instead of error.
  - **Files**: `server/routes/qbo.ts`, `server/services/qbo/QboItemService.ts`

### Added

#### QBO Company Info + Item/TaxCode Dropdowns (2026-02-27)
- **`GET /api/qbo/company-info`**: Calls QBO CompanyInfo API to return `{ companyName, realmId, environment }`. Shows the connected QBO company name and realm ID in Step 1 so users know which account is linked.
- **`GET /api/qbo/items`**: Queries active QBO Items (`SELECT Id, Name, Type, Active FROM Item`) for mapping dropdown selectors.
- **`GET /api/qbo/taxcodes`**: Queries active QBO TaxCodes (`SELECT Id, Name, Taxable FROM TaxCode`) for mapping dropdown selectors.
- **Shared `createTenantQboClient` helper**: Extracted token-fetch + client-create + persist-refresh pattern into a reusable function, reducing duplication across QBO endpoints.
  - **File**: `server/routes/qbo.ts`
- **Step 1 UI — Company details panel**: When connected, shows the QBO company name and realm ID in a bordered card. Shows loading spinner while fetching, and a fallback message if the API call fails.
- **Step 2 UI — Dropdown selectors**: Replaced manual ID text inputs with `<Select>` dropdowns populated from `/api/qbo/items` and `/api/qbo/taxcodes`. Shows item name + type in the dropdown, stores the QBO ID. Loading and empty states handled.
  - **File**: `client/src/pages/QboConsolePage.tsx`

### Fixed

#### Session Persistence + QBO OAuth Callback + Idle Timeout (2026-02-27)
- **Auth endpoint mismatch**: Client was querying `GET /api/auth/user` (non-existent route) instead of `GET /api/auth/me`. After login, cached data hid the bug in the current tab, but every new tab or full page load (including QBO OAuth return) hit a 404 → appeared logged out. Fixed query key to `/api/auth/me` everywhere.
  - **Files**: `client/src/lib/auth.tsx`, `client/src/pages/AdminTenantDetail.tsx`, `client/src/components/ImpersonationBanner.tsx`
- **QBO OAuth callback behind auth guard**: `GET /api/qbo/oauth/callback` was blocked by `requireAuth` middleware. Added to public paths since the callback validates its own CSRF state via session.
  - **File**: `server/auth/requireAuth.ts`
- **2-hour rolling idle timeout**: Changed session from 14-day fixed expiry to 2-hour rolling idle timeout (`rolling: true`, `maxAge: 7200000`). Active users stay logged in indefinitely; inactive users expire after 2 hours.
  - **File**: `server/index.ts`
- **Session-expired UX**: Added `SessionExpiredDialog` that shows a friendly modal when API calls return 401 after session expiry. Login page now supports `returnTo` query param to redirect users back to where they were.
  - **Files**: `client/src/components/SessionExpiredDialog.tsx` (new), `client/src/lib/queryClient.ts`, `client/src/App.tsx`, `client/src/pages/Login.tsx`

#### QBO OAuth db_save_failed — Missing Table (2026-02-27)
- **Root cause**: `qbo_connections` table did not exist in the database. The Drizzle schema and migration file existed but the migration was never executed. Every OAuth callback hit a "relation does not exist" error, which was silently swallowed by a bare `catch {}`.
  - **Fix**: Ran `migrations/2026_02_20_qbo_connections.sql` to create the table with unique index on `company_id`.
- **Bare catch replaced with diagnostic logging**: The `catch {}` block in the OAuth callback now logs the DB error message, code, constraint, table, and column (never secrets/tokens) so future failures are immediately diagnosable.
  - **File**: `server/routes/qbo.ts`
- **Manual SELECT→INSERT/UPDATE replaced with atomic upsert**: Used Drizzle's `onConflictDoUpdate` on the `companyId` unique index, eliminating the race-condition-prone check-then-write pattern.
  - **File**: `server/routes/qbo.ts`
- **QBO callback added to `ensureTenantContext` public endpoints**: The callback reads tenant info from session state, not `req.user`, so it doesn't need tenant context middleware.
  - **File**: `server/auth/tenantIsolation.ts`

#### QBO OAuth Callback 401 — Feature Gate Blocked Callback (2026-02-27)
- **Root cause**: `router.use(requireFeature("qboEnabled"))` on the QBO router applied to ALL routes including `/oauth/callback`. The callback bypasses `requireAuth` and `ensureTenantContext` (public path), so `req.companyId` is never set. `requireFeature` checks `req.companyId` → undefined → returns 401.
- **Fix**: Replaced blanket `router.use(requireFeature(...))` with a conditional middleware that skips the feature gate for `/oauth/callback`. The callback validates security via session-stored OAuth state instead.
  - **File**: `server/routes/qbo.ts`

### Added

#### Settings Page Redesign — Left Nav + Content Panel (2026-02-21)
- **`SettingsShell` layout component**: New two-panel layout for all `/settings/*` routes. Left panel (280px) has a searchable, scrollable vertical nav with all 14 settings categories. Right panel renders the active sub-page. Active nav item highlighted with primary color. Search filters by title and description.
  - **File**: `client/src/components/SettingsShell.tsx`
- **Settings overview page**: `/settings` now shows a centered prompt to select a category from the left nav, replacing the old card grid.
  - **File**: `client/src/pages/SettingsPage.tsx`
- **Route-level layout wrapping**: `App.tsx` Router conditionally wraps all `/settings/*` routes with `SettingsShell`, preserving nav state (search) across sub-page navigation. All existing routes and sub-page components are preserved unchanged.
  - **File**: `client/src/App.tsx`
- **Test ID mapping**: Settings nav items use `nav-*-settings` test IDs (mapped from former `card-*-settings` IDs on the removed card grid).

#### QBO OAuth Setup Guide (2026-02-21)
- **Self-reporting setup endpoint**: `GET /api/qbo/oauth/setup-info` — replaces `config-status`. Detects app origin behind proxies (`x-forwarded-proto`/`x-forwarded-host`), computes the exact redirect URI, lists missing env vars by name, and returns step-by-step setup guidance. Never exposes actual secret values.
  - **File**: `server/routes/qbo.ts`
- **Guided setup checklist in UI**: When OAuth is not configured, Step 1 card shows a collapsible "Setup QuickBooks Connection" panel with: detected app URL, exact redirect URI to copy, missing secret names, 5-step setup checklist, and a "Copy Setup Info" button that copies a ready-to-paste block with all required values.
- **Three-state badge**: Step 1 badge now shows "Connected" (green), "Ready" (blue, config present but not yet connected), or "Setup needed" (amber, missing config).
  - **File**: `client/src/pages/QboConsolePage.tsx`
- **Connect button gated**: "Connect QuickBooks" button is disabled when OAuth env vars are missing. Shows friendly message: "QuickBooks connection is not available yet. Please contact support." Technical env var names only visible in Advanced section.
- **Softened error messages**: `/oauth/start` returns generic "Unable to start QuickBooks connection. Please contact support." instead of listing missing env var names. Client toast also uses friendly copy.
  - **Files**: `server/routes/qbo.ts`, `client/src/pages/QboConsolePage.tsx`

#### QBO OAuth Connect Flow (2026-02-20)
- **`qbo_connections` table**: Tenant-scoped OAuth token storage. Stores `accessToken`, `refreshToken`, `realmId`, `environment`, and `accessTokenExpiresAt` per company. Unique index on `companyId`. Tokens are never returned to the client.
  - **Files**: `shared/schema.ts`, `migrations/2026_02_20_qbo_connections.sql`
- **OAuth endpoints**:
  - `GET /api/qbo/oauth/start` — Initiates Intuit OAuth 2.0 flow. Stores cryptographic nonce in session for CSRF protection. Returns `{ url }` for client redirect.
  - `GET /api/qbo/oauth/callback` — Handles Intuit redirect. Validates state nonce (10-minute expiry), exchanges authorization code for tokens via Intuit token endpoint, upserts `qbo_connections` row, redirects to QBO settings page.
  - `POST /api/qbo/oauth/disconnect` — Deletes `qbo_connections` row for tenant. Does not delete imported customers or mappings.
  - **File**: `server/routes/qbo.ts`
- **DB-backed token retrieval**: `getQboTokensForCompany()` now reads from `qbo_connections` table first, with env-var fallback for dev/admin testing only.
- **Token refresh persistence**: `persistRefreshedTokens()` helper writes updated `accessToken`, `refreshToken`, and `accessTokenExpiresAt` back to DB after QboClient auto-refreshes. Called from both `connection-status` and `preflight/import-customers` endpoints.
  - **File**: `server/routes/qbo.ts`
- **Connect/Disconnect UI**: Step 1 card now shows "Connect QuickBooks" button (triggers OAuth redirect) when not connected, and "Disconnect" button (with confirmation dialog) when connected. Auto-detects OAuth callback return via `?connected=` URL param and shows toast + refetches.
  - **File**: `client/src/pages/QboConsolePage.tsx`
- **Required env vars** for OAuth:
  - `QBO_CLIENT_ID` — Intuit app client ID
  - `QBO_CLIENT_SECRET` — Intuit app client secret
  - `QBO_OAUTH_REDIRECT_URI` — Must match Intuit app redirect settings
  - `QBO_ENVIRONMENT` — Optional, defaults to `"sandbox"`

### Changed

#### Step 1 Connection Status Separation (2026-02-20)
- **New endpoint**: `GET /api/qbo/connection-status` — lightweight check returning `{connected, environment, readOnlyMode, message}` with plain English messages. Checks tokens + safe QBO read query, separate from the heavier import preflight.
  - **File**: `server/routes/qbo.ts`
- **Step 1 uses connection-status**: Step 1 "Connect QuickBooks" card now uses `/api/qbo/connection-status` instead of deriving status from `/api/qbo/preflight/import-customers`. Shows server-provided message. Step 3 import gating still uses import preflight.
  - **File**: `client/src/pages/QboConsolePage.tsx`

#### QuickBooks Page Redesign — Self-Serve Setup Flow (2026-02-20)
- **Simplified page layout**: Renamed from "QuickBooks Online Console" to "QuickBooks Online" with guided subtitle. Replaced flat list of technical panels with a 4-step Setup grid.
  - **Step 1: Connect QuickBooks** — Shows Connected/Not connected badge based on connection status. Friendly server message.
  - **Step 2: Items & Tax** — Inline mapping form (service, labor, material, fee, discount, misc + tax codes). Disabled until connected. Shows "Complete" badge when configured.
  - **Step 3: Import Customers** — Disabled until connected AND mapping configured. Production hard-block and IMPORT typing confirmation preserved. Friendly gating messages.
  - **Step 4: Invoice Sync** — "Coming Soon" placeholder.
- **Advanced section collapsed by default**: All existing heavy tooling (Go-Live panel, status dashboard, sync queue, reconciliation, drift alerts, webhooks, runs, item linking, sync events) moved into a collapsible "Advanced (Support/Admin)" section at bottom.
- **Lazy-loaded advanced queries**: Heavy API calls (`/api/qbo/status`, `/api/qbo/events`, `/api/qbo/preflight`, `/api/qbo/webhooks`, `/api/qbo/drift-alerts`, `/api/qbo/runs`, `/api/qbo/queue`, `/api/qbo/items/local`) only fire when the Advanced section is expanded. Default page only queries `/api/qbo/connection-status`, `/api/qbo/mapping-config`, `/api/qbo/preflight/import-customers`, and `/api/qbo/read-only-status`.
- **Import gating**: Import buttons now require `mappingStatus.configured === true` in addition to `importPreflight.ok`. Shows "Finish Items & Tax setup to enable customer import" when mapping is incomplete.
  - **File**: `client/src/pages/QboConsolePage.tsx`
- **IntegrationsPage copy update**: QuickBooks card description changed to "Connect QuickBooks and import customers."
  - **File**: `client/src/pages/IntegrationsPage.tsx`

### Added

#### QBO Customer Import + Read-Only Mode (2026-02-20)
- **Global QBO read-only mode**: `QBO_READ_ONLY_MODE` env var now **defaults to TRUE** — all QBO writes are blocked unless explicitly set to `false`. No env configuration required for safe operation.
  - **Files**: `server/services/qbo/QboClient.ts`, `server/services/qbo/index.ts`
- **QBO Customer Import endpoint**: `POST /api/qbo/import/customers` — imports customers from QBO into the app. Supports `dryRun` (preview), `limit`, and `includeInactive` options. 2-pass import: parents first (→ customerCompanies), then children (→ clientLocations). Handles hierarchy flattening for >2-level QBO nesting, soft-delete restoration, and upsert by qboCustomerId.
  - **Files**: `server/services/qbo/QboCustomerImportService.ts` (new), `server/routes/qbo.ts`
- **Read-only status endpoint**: `GET /api/qbo/read-only-status` — returns current QBO_READ_ONLY_MODE state.
- **Import Customers UI**: New card in QBO Console with "Preview Import (Dry Run)" and "Run Import" buttons, summary/sample table, warnings display, and read-only mode badge.
  - **File**: `client/src/pages/QboConsolePage.tsx`
- **Unique constraints for QBO customer IDs**: Partial unique indexes on `(companyId, qboCustomerId) WHERE qboCustomerId IS NOT NULL` for both `customer_companies` and `client_locations` tables. Prevents duplicate QBO mappings within a tenant.
  - **Files**: `shared/schema.ts`, `migrations/2026_02_20_qbo_customer_unique_indexes.sql`
- **CUSTOMER_IMPORT event type**: Added to `qboSyncEventTypeEnum` for audit logging of import operations.
  - **File**: `shared/schema.ts`
- **ShipAddr field on QBOCustomerResponse**: Added shipping address to QBO customer response type for location service address mapping.
  - **File**: `server/qbo/mappers.ts`
- **Import preflight endpoint**: `GET /api/qbo/preflight/import-customers` — comprehensive 6-check validation: tokens, environment safety, import read-only override, global read-only status, QBO connectivity with token refresh, and DB unique indexes.
  - **File**: `server/routes/qbo.ts`

#### QBO Import Self-Protection (2026-02-20)
- **Import read-only override**: `isImportReadOnlyEnforced()` — import paths ALWAYS block QBO writes regardless of `QBO_READ_ONLY_MODE` env var. Hard safety guarantee that import logic can never write to QBO.
  - **Files**: `server/services/qbo/QboClient.ts`, `server/services/qbo/index.ts`
- **Sandbox-only default**: `getQboEnvironment()` defaults to `"sandbox"` when `QBO_ENVIRONMENT` is unset. No manual env configuration needed.
  - **Files**: `server/services/qbo/QboClient.ts`, `server/services/qbo/index.ts`
- **Production import hard-block**: `POST /api/qbo/import/customers` returns 403 when `QBO_ENVIRONMENT=production`. Server-side enforcement — cannot be bypassed from UI.
  - **File**: `server/routes/qbo.ts`
- **Enhanced read-only-status endpoint**: `GET /api/qbo/read-only-status` now returns `readOnly`, `importReadOnly`, `environment`, and `importAllowed` fields.
  - **File**: `server/routes/qbo.ts`
- **UI mode indicators**: Import card shows Environment, Import Read-Only, and Global Read-Only badges. Production environment shows hard-block alert. All preflight check details visible when passed.
  - **File**: `client/src/pages/QboConsolePage.tsx`

### Fixed

#### QBO Import CSRF + Safety Rails (2026-02-20)
- **CSRF fix**: Customer import mutation in QboConsolePage now uses the standard `apiRequest` helper (which includes `x-csrf-token` header and auto-retry on CSRF 403) instead of raw `fetch()`. Fixes "Invalid CSRF token" error on Preview/Import buttons.
  - **File**: `client/src/pages/QboConsolePage.tsx`
- **Preflight gate**: Import buttons are disabled until the preflight check passes (QBO tokens, connectivity, DB indexes, environment all OK).
- **Production environment hard-block**: Both server (403) and UI (buttons disabled) prevent import in production.
- **Typing confirmation**: "Run Import" dialog now requires typing "IMPORT" to confirm, preventing accidental imports.
  - **File**: `client/src/pages/QboConsolePage.tsx`

### Changed

#### Invoices List UI Polish (2026-02-20)
- **Removed premature scrollbar**: Replaced `react-window` `FixedSizeList` virtualization with plain `.map()` rendering so the page scroll handles overflow naturally. No scrollbar appears with small result sets.
- **Client column 2-line identity block**: Always shows company name (text-sm font-medium) on line 1 and location name (text-xs muted) on line 2 when both are available, matching the Jobs list pattern.
- **Improved spacing**: Increased cell padding to `px-4 py-3` (comfortable) / `px-4 py-2` (compact). Client column uses `minmax(260px, 1.8fr)` to prevent compression. Total/Balance columns use `tabular-nums` + `whitespace-nowrap` for consistent alignment.
  - **File**: `client/src/pages/InvoicesListPage.tsx`

#### UX Improvements — Close Job Dialog, Jobs List, Invoices List (2026-02-18)
- **Close Job errors → communication dialog**: User-actionable validation failures (no line items, already invoiced) now open a dialog with clear guidance and actionable choices (e.g. "Close & archive (no invoice)") instead of destructive toasts. Uncompleted visits and version conflicts retain their existing dedicated dialogs/recovery. Only truly unexpected errors still use a toast.
  - **File**: `client/src/components/JobHeaderCard.tsx`
- **Jobs list: removed Assignment column**: Simplifies the jobs table. Technician info is still available on the job detail page. Removed unused `useTechniciansDirectory` hook call and `techNameMap`.
  - **File**: `client/src/pages/Jobs.tsx`
- **Invoices list: replaced Issue Date with Description, improved Client display**: Shows Company + Location (two-line) using feed's `locationDisplayName`. Replaced Issue Date column with Description (from `workDescription`). Due Date remains. Search now includes description text.
  - **Files**: `client/src/pages/InvoicesListPage.tsx`, `server/storage/invoicesFeed.ts`
- **Job actions: hide Close Job for terminal states**: "Close Job" menu item is no longer shown for completed, archived, or invoiced jobs. The Close Job dialog already has an invoiced-state guard as fallback.
  - **File**: `client/src/components/JobHeaderCard.tsx`

#### Architecture Lock — Query Namespace + Audit (2026-02-16)
- **Architecture Lock Rules** added to `docs/ARCHITECTURE.md`: query namespace rules, payload strategy, mutation standard, exception list.
- **Hard rule**: "No new request pattern without updating canonicalization map."
- **Audit report**: `docs/AUDIT_2026_02_16_ARCHITECTURE_LOCK.md` — covers drift check, payload classification, list scalability, mutation patterns, flow audit.
- **3 FAIL items identified**: InvoicesListPage dead stats query (F1), unbounded `/api/jobs/action-required` (F2), unbounded `/api/reports/ar-aging` (F3).
- **Files**: `docs/ARCHITECTURE.md`, `docs/AUDIT_2026_02_16_ARCHITECTURE_LOCK.md`

#### Portal Email Sender — Verified Domain Config (2026-02-16)
- **Breaking**: Portal magic-link emails now require `PORTAL_FROM_EMAIL` env var set to a verified Resend domain address (e.g. `noreply@yourdomain.com`). The hardcoded `onboarding@resend.dev` sender has been removed.
- **Env vars**:
  - `PORTAL_FROM_EMAIL` (required) — verified sender email address from your Resend domain
  - `PORTAL_FROM_NAME` (optional, default `"Customer Portal"`) — display name for the sender
- **Startup validation**: Server logs a warning at boot if `RESEND_API_KEY` or `PORTAL_FROM_EMAIL` is missing. Portal requests return `sent: false` when email config is incomplete.
- **Deployment**: Verify a domain at https://resend.com/domains, then set `PORTAL_FROM_EMAIL` to an address on that domain.
- **Files**: `server/resendClient.ts`, `server/index.ts`, `server/routes/portal.ts`, `server/emailService.ts`

### Fixed

#### Job Version Conflict Recovery (2026-02-18)
- **Handle job version conflicts (409) by refreshing and retry-safe UX.** When close/archive (or status update) hits a VERSION_MISMATCH 409, the UI now shows a non-destructive "updated elsewhere, refreshing" toast instead of a red error, invalidates job/dashboard/calendar queries, and closes the dialog cleanly.
  - **Files**: `client/src/components/JobHeaderCard.tsx`, `client/src/pages/JobDetailPage.tsx`

#### Close Job "invoice_now" Status Race Condition (2026-02-18)
- **Root cause**: `createInvoiceFromJob()` unconditionally set `job.status = "invoiced"` in its own transaction BEFORE the lifecycle engine ran. The lifecycle engine then re-read the job, found `status = "invoiced"`, and rejected the close: "Cannot close job in status 'invoiced'". The job was stuck invoiced with incomplete close metadata.
- **Server fix**: When `creationSource === "JOB_CLOSE_ROUTE"`, `createInvoiceFromJob()` now only sets `invoiceId` — it skips setting `status`. The lifecycle engine (`transitionJobStatus`) is the sole owner of the status transition for the close flow. Standalone invoice creation (from the Invoices page) is unaffected.
- **Client fix**: Added "already invoiced" recovery branch in `closeJobMutation.onError` that shows a non-destructive toast and invalidates queries. Generic error path now always invalidates `["jobs"]` to prevent stale-state retry loops. Close Job dialog now detects invoiced status and shows a "View Invoice" link instead of close options.
  - **Files**: `server/storage/invoices.ts`, `client/src/components/JobHeaderCard.tsx`

#### Audit FAIL Items — Stats Dead Query + Unbounded List Endpoints (2026-02-17)
- **F1 — InvoicesListPage stats query had no `queryFn`**: The default queryFn tried to fetch URL `"invoices"` (the family prefix), which fails. Stats cards always showed 0. Added explicit `queryFn` fetching `/api/invoices/stats`.
  - **File**: `client/src/pages/InvoicesListPage.tsx`
- **F2 — `/api/jobs/action-required` unbounded response**: No pagination enforced. Large tenants could receive unbounded arrays. Added lenient pagination (default limit=50, max 200) using existing `parsePaginationLenient` + `applyOffsetPagination`. Backwards-compatible: callers without pagination params still receive a raw array.
  - **File**: `server/routes/jobs.ts`
- **F3 — `/api/reports/ar-aging` unbounded invoices array**: Report returned all outstanding invoices with no limit. Added pagination to the `invoices` array within the response (default limit=200, max 200). Summary and buckets always returned in full. Response now includes `meta: { total, limit, offset, hasMore }`.
  - **File**: `server/routes/reports.ts`

#### Invoice Query Namespace Unification (2026-02-16)
- **Bug**: Invoice detail page used `["invoice", id, ...]` (singular) while list/stats/dashboard used `["invoices", ...]` (plural). Invalidating `["invoices"]` did not refresh the detail view, causing stale data after mutations on other pages.
- **Fix**: Unified all invoice query keys under `["invoices", ...]` canonical namespace:
  - `["invoices", "detail", id]` — single invoice details
  - `["invoices", "detail", id, "payments"]` — invoice payments
  - `["invoices", "feed", params]` — list (already correct)
  - `["invoices", "stats"]` — stats (already correct)
  - `["invoices", "dashboard"]` — dashboard widget (already correct)
  - `["invoices", "byJob", jobId]` — job cross-link (renamed from `by-job`)
- Invalidating `["invoices"]` now correctly refreshes all invoice views site-wide.
- **Files**: `client/src/pages/InvoiceDetailPage.tsx`, `client/src/pages/JobDetailPage.tsx`

#### Visit Edit — Optimistic-Lock Conflict Handling (2026-02-16)
- **Bug**: When two users edit the same visit concurrently, the second save returns a 409 version-mismatch error displayed as a generic "Error" toast with no recovery path.
- **Fix**: Detect 409 status or version/optimistic keywords in error message. Show friendly "This visit was updated elsewhere. Refreshing…" toast, auto-invalidate visit/job queries, and exit edit mode so the dialog reloads fresh data.
- **Client-only change** — no server modifications.
- **Files**: `client/src/pages/JobDetailPage.tsx`

#### Portal Magic Link — Resend SDK Error Detection (2026-02-15)
- **Bug**: Resend SDK does not throw on API errors (403, 422, etc.) — it returns `{ data: null, error: {...} }`. The portal `request-link` handler only had `try/catch`, so delivery failures were silently swallowed: no log, no indication to the user.
- **Fix**: Check `result.error` after `client.emails.send()`. Log the structured error via `console.error`. Return `sent: false` in the JSON response when email delivery fails.
- **Frontend**: `PortalLogin.tsx` now reads the `sent` boolean. When `sent === false`, shows a non-enumerating "Email delivery is not configured right now. Please contact support." message instead of the misleading "Check your email" success state.
- **Anti-enumeration preserved**: Unknown emails (no contact in DB) still return `sent: true` to prevent email enumeration.
- **Files**: `server/routes/portal.ts`, `client/src/pages/portal/PortalLogin.tsx`, `tests/portal-magic-link.test.ts` (new)

### Added

#### Editable Visit Detail Dialog (2026-02-15)
- **Feature**: Visit detail dialog on Job Detail page is now editable. Users can assign a technician, set date/time, and set estimated duration directly from the dialog.
- **Edit mode**: "Edit Visit" added to the kebab (More) dropdown menu. Replaces read-only fields with editable inputs (datetime-local, technician select, duration number input).
- **Clear schedule**: "Clear Schedule" menu item sets scheduledStart/scheduledEnd to null without deleting the visit. Useful for placeholder visit #1 which cannot be deleted.
- **Save mutation**: Uses existing `PATCH /api/jobs/:jobId/visits/:visitId` endpoint. No new server endpoints created.
- **Server schema update**: `updateVisitSchema` in `jobVisits.routes.ts` expanded to accept `scheduledStart`, `scheduledEnd`, `isAllDay` fields (repository already supported them).
- **Files**: `client/src/pages/JobDetailPage.tsx`, `server/routes/jobVisits.routes.ts`

#### Customer Portal — Phase 1 (2026-02-15)
- **Feature**: Customer-facing portal (`/portal/*`) for viewing invoices and account info. Completely separate from the admin/technician app shell.
- **Authentication**: Magic link authentication flow. Customers enter their email, receive a single-use link (15 min expiry), and get a persistent session. No passwords required.
  - `POST /api/portal/auth/request-link` — sends magic link email via Resend
  - `GET /api/portal/auth/verify?token=...` — consumes token, sets portal session
  - `POST /api/portal/auth/logout` — clears portal session
  - `GET /api/portal/me` — returns portal identity + payments feature flag
- **Invoice endpoints**: Read-only, scoped to customer company + tenant.
  - `GET /api/portal/invoices` — list invoices (sent/partial_paid/paid only; never drafts/voided)
  - `GET /api/portal/invoices/:id` — detail with line items, tax breakdown, visibility toggles
- **Portal UI pages**: Mobile-first design with bottom nav.
  - `/portal/login` — email entry + magic link request
  - `/portal/verify` — token consumption + redirect
  - `/portal` — dashboard with balance summary + recent invoices
  - `/portal/invoices` — filterable invoice list (All/Open/Paid)
  - `/portal/invoices/:id` — invoice detail with line items, totals, notes
- **Pay Invoice stub**: "Pay Invoice" button visible on unpaid invoices. Opens a modal explaining online payments are coming soon. Feature-flagged via `customerPortalPaymentsEnabled` on `tenant_features`.
- **Feature flags**: Added `customer_portal_enabled` and `customer_portal_payments_enabled` to `tenant_features` table (both default `false`).
- **Schema**: New `portal_magic_tokens` table for hashed, single-use, time-limited magic link tokens.
- **Security**: Portal routes bypass staff auth middleware but enforce their own session-based auth. Strict tenant + customer company scoping on all data queries. Rate limiting on magic link requests (10/min/IP). Token hashes stored (never raw tokens). Email enumeration prevented.
- **Files**:
  - New: `server/routes/portal.ts`, `client/src/lib/portalAuth.tsx`, `client/src/components/PortalLayout.tsx`
  - New: `client/src/pages/portal/PortalLogin.tsx`, `PortalVerify.tsx`, `PortalDashboard.tsx`, `PortalInvoicesList.tsx`, `PortalInvoiceDetail.tsx`, `portalUtils.ts`
  - Modified: `shared/schema.ts` (portal_magic_tokens table + tenant_features columns), `server/routes/index.ts`, `server/auth/requireAuth.ts`, `server/auth/tenantIsolation.ts`, `server/storage/tenantFeatures.ts`, `client/src/App.tsx`
  - Migration: `migrations/2026_02_15_customer_portal.sql`

### Fixed

#### Close Job endpoint — visitService.getUncompletedVisits is not a function (2026-02-15)
- **Root cause**: The unified close-job endpoint (`POST /api/jobs/:id/close`) called `visitService.getUncompletedVisits()` and `visitService.bulkCompleteVisits()`, but these functions were never exported from `server/services/jobVisits.service.ts`. The underlying repository methods existed on `jobVisitsRepository` but had no service-layer pass-through. This caused a runtime crash (`is not a function`) when attempting "Close & Create Invoice".
- **Server fix**: Added two pass-through exports to `server/services/jobVisits.service.ts`: `getUncompletedVisits(companyId, jobId)` and `bulkCompleteVisits(companyId, jobId)`, delegating to the existing repository methods.
- **Client fix**: Hardened the `closeJobMutation.onError` handler in `JobHeaderCard.tsx` to filter out internal server error messages (e.g. "is not a function") and show a user-friendly fallback: "Failed to close job. Please try again or contact support." The 409 `UNCOMPLETED_VISITS` guardrail handler remains unchanged.
  - Files: `server/services/jobVisits.service.ts`, `client/src/components/JobHeaderCard.tsx`

#### Prevent deleting placeholder visit #1 — server + UI guard (2026-02-15)
- **Problem**: Placeholder visit #1 (visitNumber=1, scheduledStart=NULL, isActive=true) is created atomically with every job. Deleting it would break the invariant that every job always has at least one visit row.
- **Server guard**: `DELETE /api/jobs/:jobId/visits/:visitId` now fetches the visit first and rejects with 409 if it matches placeholder visit #1 definition. Message: "Cannot delete placeholder visit #1. Unschedule or clear it instead."
- **UI guard**: `VisitDetailDialog` in `JobDetailPage.tsx` disables the "Delete Visit" menu item for placeholder visit #1 and shows helper text: "Placeholder visit #1 can't be deleted. Unschedule/clear it instead."
  - Files: `server/routes/jobVisits.routes.ts`, `client/src/pages/JobDetailPage.tsx`

### Changed

#### Invoice Detail Page — Jobber-style header redesign (2026-02-15)
- **Header redesign**: `InvoiceHeaderCard` now displays a 4-column info grid (Billing Address, Service Address, Contact, Details) matching Jobber's invoice layout.
  - Billing address sourced from `customerCompany.billing*` fields; falls back to location address.
  - Service address sourced from the invoice's linked `client_location`.
  - Primary contact shows name, phone (clickable tel: link), email (clickable mailto: link).
  - Details column shows Job # (clickable link to `/jobs/:id`), Issued date, Due date, and payment terms selector (edit mode).
- **Payment terms moved into header**: Removed the standalone "Payment Terms" card from the right sidebar. Issue date, due date, and payment terms selector are now in the header's Details column.
- **Payment terms options**: Replaced old 7-option list (0/7/15/30/45/60/90) with spec-compliant 5-option list: Due on receipt (0), Net 15, Net 30, Net 45, Custom. "Custom" reveals an inline date picker for direct `dueDate` entry.
- **Invoice number editing**: Invoice number is now editable inline in the header when in edit mode. Click the pencil icon to enter edit mode; save triggers `PATCH /api/invoices/:id`. Uniqueness enforced per tenant via existing DB unique index (`invoices_company_invoice_number_uq`); 409 returned on conflict.
- **Backend DTO extension**: `GET /api/invoices/:id/details` now returns three additional fields: `billingAddress`, `serviceAddress`, `primaryContact` — structured objects derived from `customerCompanies` and `client_locations` data.
- **Backend PATCH update**: `PATCH /api/invoices/:id` now accepts `invoiceNumber` (string, 1-100 chars) and `paymentTermsDays: null` for custom terms with explicit `dueDate`. Catches DB unique constraint violations and returns `409 DUPLICATE_INVOICE_NUMBER`.
- **Files**: `client/src/components/InvoiceHeaderCard.tsx`, `client/src/pages/InvoiceDetailPage.tsx`, `server/routes/invoices.ts`

### Fixed

#### Duplicate "Client Message" cards on Invoice Detail page (2026-02-15)
- **Root cause**: Two cards both titled "Client Message" rendered in the right sidebar — one showing `invoice.clientMessage` and a second showing `invoice.notesCustomer`. The second card was an orphaned duplicate.
- **Fix**: Kept the first card (customer-facing `clientMessage`, editable in edit mode). Replaced the second card with "Internal Notes" (office-only, shows `invoice.notesInternal`). Internal Notes card is editable in edit mode and hidden when empty outside edit mode.
  - Files: `client/src/pages/InvoiceDetailPage.tsx`

#### Unschedule converts visit to placeholder instead of soft-deleting (2026-02-14)
- **Root cause**: `calendarRepository.unscheduleJob()` soft-deleted the current visit (`isActive = false`). The inactive row retained `visitNumber = 1`, but the unique constraint `job_visits_job_visit_number_uq` covers all rows (including inactive). When re-scheduling, `getNextVisitNumber()` only counted active rows, computed `visitNumber = 1`, and the INSERT collided with the inactive row.
- **Fix**: `unscheduleJob()` now converts the visit to a placeholder (clears `scheduledStart`/`scheduledEnd`, keeps `isActive = true`) instead of soft-deleting. This preserves the visit row and `visitNumber` so re-scheduling UPDATEs the placeholder instead of INSERTing a duplicate.
- **Regression test**: Test D in `tests/job-creation-visit.test.ts` — round-trip create → schedule → unschedule → re-schedule, asserts: 1 visit, same ID, `visitNumber = 1`, no constraint violations.
- **Updated tests**: `tests/visit-selection-invariants.test.ts` — unschedule tests updated to assert placeholder behavior (`isActive = true`, `scheduledStart = null`) instead of soft-delete.
  - Files: `server/storage/calendar.ts`, `tests/job-creation-visit.test.ts`, `tests/visit-selection-invariants.test.ts`

#### Dashboard "Needs Attention" shows date-only to avoid timezone confusion (2026-02-14)
- **Root cause**: `formatSchedule()` in Dashboard rendered times (e.g., "7:00 p.m.") which were misleading due to timezone differences between server UTC storage and client local time.
- **Fix**: Simplified `formatSchedule()` to date-only display (`"MMM d"`, e.g., "Mar 20"). No time or "All day" text is shown. Removed unused `end`/`isAllDay` parameters from the function.
  - Files: `client/src/pages/Dashboard.tsx`

#### Calendar scheduling collision on unscheduled jobs with initial visit (2026-02-14)
- **Root cause**: `calendarRepository.scheduleJob()` always called `createJobVisit()` (INSERT). With the new "createJob always creates placeholder visit #1" invariant, scheduling an unscheduled job would insert a second visit, causing `job_visits_job_visit_number_uq` violations or leaving orphan placeholder visits.
- **Fix**: `scheduleJob()` now checks for an existing placeholder visit (`scheduledStart IS NULL`, `isActive = true`) before inserting. If found, updates it in place via `updateJobVisit()` (preserves `visitNumber = 1`). Otherwise falls through to INSERT for follow-up visits.
- **Regression test**: Test C in `tests/job-creation-visit.test.ts` — creates unscheduled job (placeholder visit #1), schedules via `calendarRepository.scheduleJob`, asserts: still 1 visit, same ID, `visitNumber = 1`, `scheduledStart` set.
  - Files: `server/storage/calendar.ts`, `tests/job-creation-visit.test.ts`

#### Deleted jobs still visible in Jobs list after delete from JobDetailPage (2026-02-14)
- **Root cause**: `JobDetailPage.tsx` `deleteJobMutation.onSuccess` invalidated calendar, maintenance, dashboard, recurring-templates, and clients query keys — but **never invalidated `["jobs"]`**. The comment claimed "covered by family-wide ['jobs'] invalidation" but the actual call was missing. The Jobs list (`useJobsFeed`) uses `["jobs", "feed", ...]` keys, so without `["jobs"]` invalidation the stale cache persisted until a full page refresh.
- **Fix**: Added `queryClient.invalidateQueries({ queryKey: ["jobs"] })` to the `onSuccess` handler, matching the pattern already used in `JobDetailDialog.tsx` and `Calendar.tsx`.
  - Files: `client/src/pages/JobDetailPage.tsx`

### Added

#### Auto-Create Initial Visit on Job Creation (2026-02-14)
- **Root cause**: `createJob()` only inserted a job row — no `job_visits` row was created, so new jobs were invisible on calendar/dashboard visit surfaces.
- **Fix**: Wrapped job insert in a DB transaction that atomically creates an initial `job_visits` row.
  - Scheduled jobs (with `scheduledStart`) produce a visit with matching start/end/isAllDay.
  - Unscheduled jobs produce a placeholder visit (`scheduledStart=null`, `scheduledDate=now`).
  - Technician assignment forwarded from job payload (`primaryTechnicianId`, `assignedTechnicianIds`).
- **Secondary fix**: Route handler was deleting `durationMinutes` from job data before insert (comment said "computed, not stored" — incorrect, `jobs.duration_minutes` is a real column). Now preserves the derived value from scheduling domain logic, which also flows to the visit's `estimatedDurationMinutes`.
- **DEV diagnostic**: POST handler logs payload scheduledStart, returned job scheduledStart, and visit count for each created job. All diagnostic logs gated behind `IS_DEV` (`NODE_ENV === "development"` only — silent in test and production).
- **Invariant test**: `tests/job-creation-visit.test.ts` — locks the "createJob always creates initial visit" contract:
  - Test A: Scheduled job → 1 visit with matching `scheduledStart`, `estimatedDurationMinutes`
  - Test B: Unscheduled job → 1 placeholder visit with `scheduledStart=null`, default duration 60
  - Files: `server/storage/jobs.ts`, `server/routes/jobs.ts`, `tests/job-creation-visit.test.ts`

#### Phase 5 — Remaining Canonicalization + Structural Cleanup (2026-02-13)

**Part A — Invoice Family Canonicalization (Steps A1-A7):**
- Created `server/storage/invoicesFeed.ts`: canonical `InvoiceFeedFilters`, `InvoiceFeedItem`, `InvoiceStatsResult` types, `getInvoicesFeed(ctx, filters)` list query, and `getInvoiceStats(ctx)` aggregated stats.
- Wired `/api/invoices/list`, `/api/invoices/stats`, `/api/invoices/dashboard`, `/api/invoices/by-job/:jobId` to canonical builders.
- Fixed AR aging report: changed INNER JOIN → LEFT JOIN on clientLocations to include invoices with no/deleted locations.
- Created `client/src/hooks/useInvoicesFeed.ts`: canonical hooks with `["invoices", ...]` family key.
- Migrated all invoice consumers and mutation invalidations to `["invoices"]` family prefix.
  - Files: `server/storage/invoicesFeed.ts` (new), `server/routes/invoices.ts`, `server/storage/reports.ts`, `client/src/hooks/useInvoicesFeed.ts` (new), `client/src/pages/InvoicesListPage.tsx`, `client/src/pages/Dashboard.tsx`, `client/src/pages/JobDetailPage.tsx`, `client/src/components/JobHeaderCard.tsx`, `client/src/pages/InvoiceDetailPage.tsx`, `client/src/pages/QboConsolePage.tsx`

**Part B — Dashboard Canonicalization (Steps B1-B3):**
- Refactored `server/storage/dashboard.ts` from class-based DashboardRepository to function-based QueryCtx pattern with `getWorkflowSummary(ctx)` and `getNeedsAttentionJobs(ctx, todayDate, limit)`.
- Uses canonical `activeJobFilter()` and `activeInvoiceFilter()` guards.
- Exported typed `DashboardJobItem` with `attentionType` (Option B: presentation logic separate from core model).
- Migrated all dashboard query keys to `["dashboard", ...]` family prefix and all invalidations to `["dashboard"]` family.
  - Files: `server/storage/dashboard.ts`, `server/routes/dashboard.ts`, `client/src/pages/Dashboard.tsx`, `client/src/hooks/useMutationWithToast.ts`, `client/src/hooks/useCalendarApi.ts`, `client/src/pages/JobDetailPage.tsx`, `client/src/pages/TechVisitDetailPage.tsx`, `client/src/pages/Calendar.tsx`, `client/src/components/JobHeaderCard.tsx`

**Part C — Calendar Shared Base Join Helpers (Steps C1-C3):**
- Created `server/lib/queryHelpers.ts`: shared `locationDisplayNameExpr`, `bulkResolveTechnicians()`, `bulkResolveCustomerCompanies()`.
- Replaced duplicate bulk resolution blocks in `calendar.ts` (2× tech + 2× company = ~64 lines removed).
- Updated calendar architecture note with shared helper documentation.
  - Files: `server/lib/queryHelpers.ts` (new), `server/storage/calendar.ts`

**Part D — Equipment Table Migration Plan (Steps D1-D3):**
- Completed equipment table schema audit: legacy `equipment` vs canonical `locationEquipment` column mapping, FK analysis, and conflict detection.
- Created migration script `migrations/2026_02_13_equipment_consolidation.sql` with dry-run, insert, and verification steps (not yet executed).
- Documented endpoint consolidation plan in `docs/EQUIPMENT_MIGRATION.md`.
  - Files: `docs/EQUIPMENT_MIGRATION.md` (new), `migrations/2026_02_13_equipment_consolidation.sql` (new)

**Part E — Final Cleanup (Steps E1-E3):**
- Renamed `TERMINAL_STATUSES` → `JOB_TERMINAL_STATUSES` in `statusRules.ts` and `jobUtils.ts` to disambiguate from visit terminal statuses. Local constant in `JobDetailPage.tsx` renamed to `VISIT_TERMINAL_STATUSES`.
- Cleaned up 2 remaining old-format query keys: `TaskDialog.tsx` and `ScheduleJobModal.tsx`.
- Final `INVALIDATION_MAP.md` update with all canonical family keys.
  - Files: `server/statusRules.ts`, `client/src/components/job/jobUtils.ts`, `client/src/pages/JobDetailPage.tsx`, `client/src/components/TaskDialog.tsx`, `client/src/components/calendar/ScheduleJobModal.tsx`, `docs/INVALIDATION_MAP.md`

#### Surgical Cleanup — Dead Code Removal (2026-02-13)

- Deleted orphaned `client/src/hooks/useInvoicesFeed.ts` (0 external references; hooks not yet integrated into any pages).
- Deleted orphaned `client/src/hooks/useTextScale.ts` (0 external references).
- Deleted orphaned `client/src/hooks/useArrayRows.ts` (0 external references).
- Deleted orphaned `client/src/hooks/useImageUpload.ts` (0 external references).
  - Deleted: `useInvoicesFeed.ts`, `useTextScale.ts`, `useArrayRows.ts`, `useImageUpload.ts`

#### Phase 6 — Equipment Table Migration + Code Consolidation (2026-02-13)

- Both tables were empty (0 records) — no data migration needed.
- Redirected legacy `createEquipment()` and `getClientEquipment()` to use canonical `locationEquipment` table, then removed them.
- Updated bulk import route (`POST /api/clients/import`) to insert into `locationEquipment`.
- Removed orphaned `EquipmentDialog.tsx` and `EquipmentList.tsx` (649 lines, referenced non-existent `/api/equipment` endpoints).
- Fixed endpoint path mismatch in `LocationEquipmentSection.tsx` and `JobEquipmentSection.tsx`: `/api/locations/` → `/api/clients/`.
- Fixed HTTP method mismatch: `PUT` → `PATCH` for equipment updates in `LocationEquipmentSection.tsx`.
- Renamed legacy `equipment` table to `equipment_legacy_deprecated`.
  - Files: `server/storage/clients.ts`, `server/storage/index.ts`, `server/routes/clients.ts`, `client/src/components/LocationEquipmentSection.tsx`, `client/src/components/JobEquipmentSection.tsx`, `docs/EQUIPMENT_MIGRATION.md`, `docs/INVALIDATION_MAP.md`
  - Deleted: `client/src/components/EquipmentDialog.tsx`, `client/src/components/EquipmentList.tsx`
  - Migration: `migrations/2026_02_13_rename_legacy_equipment.sql`

### Fixed
- AR aging report now includes invoices with no/deleted location (was silently excluding via INNER JOIN).
- Invoice `createInvoiceMutation` now properly invalidates stats and dashboard via family key (was missing in JobDetailPage).

#### Phase 5.1-5.3 — Invalidation Gap Closure + Visit Feed Fixes (2026-02-13)

**Phase 5.1 — Close 3 dashboard invalidation gaps:**
- Added `["dashboard"]` invalidation to `clearHoldMutation`, `undoCloseMutation`, `closeJobMutation`.
  - Files: `client/src/pages/JobDetailPage.tsx`, `client/src/components/JobHeaderCard.tsx`

**Phase 5.2 — Close 4 calendar/DnD invalidation gaps:**
- Added `["dashboard"]` invalidation to `ActionRequiredModal.updateStatusMutation` and `Calendar.archiveOldAssignment`.
- Added `["jobs"]` + `["dashboard"]` invalidation to `useCalendarDnD.createAssignment` and `deleteAssignment`.
  - Files: `client/src/components/ActionRequiredModal.tsx`, `client/src/pages/Calendar.tsx`, `client/src/hooks/useCalendarDnD.ts`
- All known gaps in `docs/INVALIDATION_MAP.md` cleared.

**Phase 5.3 — QA regression fixes:**
- **(G4 HIGH)** Added `activeJobFilter()` to all 5 canonical visit query functions in `server/storage/visits.ts`. Visits for soft-deleted/inactive jobs were leaking into the visit feed and tech schedule.
- **(G3 MEDIUM)** Added `customerCompanies` LEFT JOIN + `COALESCE(customerCompanies.name, clientLocations.companyName)` to visit feed. Location names now consistent with jobsFeed, invoicesFeed, dashboard, and calendar.
- **(G1 MEDIUM)** Added `["dashboard"]` invalidation to `QuickAddJobDialog.createJobMutation`.
- **(G2 MEDIUM)** Added `["dashboard"]` invalidation to `createInvoiceMutation` in `JobHeaderCard.tsx` and `JobDetailPage.tsx`.
  - Files: `server/storage/visits.ts`, `client/src/components/QuickAddJobDialog.tsx`, `client/src/components/JobHeaderCard.tsx`, `client/src/pages/JobDetailPage.tsx`, `docs/INVALIDATION_MAP.md`

#### Phase 4 — Jobs Canonicalization + Technician Display Utility (2026-02-13)

**Pre-flight:**
- Fixed `buildVisitFeedKey` missing `excludeStatuses` in query key, causing cache collisions between filtered and unfiltered visit queries.
  - File: `client/src/hooks/useVisitFeed.ts`

**Part A — Canonical Jobs Feed Module (Steps A1-A8):**
- Created `server/storage/jobsFeed.ts`: canonical `JobFeedFilters`, `JobFeedItem`, `JobHeaderDetail` types, `getJobsFeed(ctx, filters)` list query, and `getJobHeader(ctx, jobId)` detail query.
  - Key fix: `getJobHeader` joins `customerCompanies` with `COALESCE(customerCompanies.name, clients.companyName)` for correct `locationDisplayName` — old `getJob()` was missing this join.
- Wired `GET /api/jobs` and `GET /api/jobs/:id` to canonical builders.
  - Files: `server/routes/jobs.ts`, `server/storage/jobsFeed.ts`
- Migrated `Jobs.tsx`, `JobDetailPage.tsx`, `ClientJobsTab.tsx`, `LocationDetailPage.tsx` to canonical types (`locationCompanyName` → `locationDisplayName`).
  - Files: `client/src/pages/Jobs.tsx`, `client/src/pages/JobDetailPage.tsx`, `client/src/components/ClientJobsTab.tsx`, `client/src/pages/LocationDetailPage.tsx`

**Part B — Technician Display Name Utility (Steps B1-B6):**
- Created `server/lib/resolveTechnicianName.ts`: single canonical fallback chain (fullName → firstName+lastName → firstName → lastName → email → "Unknown") replacing 6 divergent patterns.
- Replaced inline name resolution in: `calendar.ts` (2 occurrences), `timeTracking.ts`, `jobNotes.ts`, `scheduling.ts`, `jobs.ts` schedule audit.
  - Files: `server/lib/resolveTechnicianName.ts` (new), `server/storage/calendar.ts`, `server/storage/timeTracking.ts`, `server/storage/jobNotes.ts`, `server/domain/scheduling.ts`, `server/storage/jobs.ts`
- Updated `JobNotesSection.tsx` to use pre-resolved `userName` field.
  - File: `client/src/components/JobNotesSection.tsx`

**Part C — Jobs Family Keys + Client Hooks (Steps C1-C6):**
- Created `client/src/hooks/useJobsFeed.ts`: canonical `useJobsFeed(params)` and `useJobHeader(jobId)` hooks with `["jobs", "feed", ...]` and `["jobs", "detail", jobId]` query keys.
- Updated all mutation `onSuccess` handlers across 20 files to invalidate by family prefix `["jobs"]` instead of path-based `["/api/jobs"]` keys.
- Updated `useJobVisits.ts` fetch key to `["visits", jobId, "all"]` and invalidations to `["visits"]` family key.
- Updated `INVALIDATION_MAP.md` to reflect new family key format.
  - Files: `client/src/hooks/useJobsFeed.ts` (new), `client/src/hooks/useCalendarApi.ts`, `client/src/hooks/useJobVisits.ts`, `client/src/hooks/useMutationWithToast.ts`, `client/src/lib/jobScheduling.ts`, plus 15 component/page files.

**Part D — Invoice Dashboard Label Fix:**
- Fixed `getDashboardInvoices`: joined `customerCompanies` table and uses `COALESCE(customerCompanies.name, clients.companyName)` as `locationDisplayName`. Previously mislabeled `clients.companyName` as `customerCompanyName`.
  - File: `server/storage/invoices.ts`

### Fixed

- `getJob()` detail query now joins `customerCompanies` for correct location display name (was missing, causing list vs detail name mismatch).
- Invoice dashboard now shows parent company name when available instead of raw location company name.
- Visit feed filter cache key now includes `excludeStatuses` parameter.

#### Phase 3 — Canonical Visit Feed Migration (2026-02-12)

**Part A — Invalidation Map:**
- Created `docs/INVALIDATION_MAP.md`: comprehensive reference of every client-side mutation → TanStack Query invalidation relationship. Covers all query families, centralized helpers, 8 identified gaps.

**Part B — QueryCtx Pattern:**
- Created `server/lib/queryCtx.ts` with `QueryCtx` interface (`db`, `tenantId`, `userId`, `role`) and `getQueryCtx(req)` extractor. Used by all canonical repository queries.

**Part C — Canonical Visit Feed API:**
- Added `VisitFeedFilters`, `VisitFeedItem`, and `getVisitFeed()` to `server/storage/visits.ts`.
- `getVisitFeed()` uses `QueryCtx` and applies RBAC: technicians auto-scoped to assigned visits.
- `toVisitFeedItem()` mapper normalizes Drizzle Date objects to ISO strings.
- Created `server/routes/visits.ts`: `GET /api/visits` endpoint with Zod query validation.
- Registered route in `server/routes/index.ts`.

**Part D — Tech Page Migration:**
- Created `client/src/hooks/useVisitFeed.ts`: canonical hook with `['visits', ...]` family key prefix for family-wide invalidation.
- Migrated `TechSchedulePage` to `useVisitFeed` with 7-day range (was today-only via old endpoint).
- Migrated `TechHomePage` to `useVisitFeed` with today's date range.
- Updated `TechVisitDetailPage` invalidation to use `VISIT_FEED_FAMILY_KEY` instead of old endpoint keys.
- Deprecated `GET /api/tech/visits/today` (old consumers migrated, kept for backward compatibility).
- Files: `client/src/hooks/useVisitFeed.ts` (new), `client/src/pages/TechSchedulePage.tsx`, `client/src/pages/TechHomePage.tsx`, `client/src/pages/TechVisitDetailPage.tsx`, `server/routes/techField.ts`

**Part E — Calendar Separation Note:**
- Added architecture comment to `server/storage/calendar.ts` documenting why calendar is a separate projection family from the visit feed (CTE ranking, technician profiles, all-day logic).

**Part F — Server-Side Location Filtering:**
- `GET /api/jobs` now accepts `locationId` query param and passes it to the storage layer (was client-side only).
- `LocationDetailPage` now sends `locationId` to the API instead of fetching all jobs and filtering client-side.
- Files: `server/routes/jobs.ts`, `client/src/pages/LocationDetailPage.tsx`

### Fixed

#### Phase 2 — Data Freshness + Type Cleanup (2026-02-12)

**Part A — Bonus Hotfixes from Phase 1 Sweep:**
- **A1: Reports.tsx getMonth() off-by-one**: Added `+ 1` to two `getMonth()` calls so reports fetch correct month data.
  - File: `client/src/pages/Reports.tsx`
- **A2: Missing soft-delete/isActive filters (10 queries)**: Added `activeJobFilter()` to job queries in reports.ts, clients.ts (3 queries), invoices.ts (3 queries), timeTracking.ts, and jobVisits.ts (2 queries). Prevents returning deleted/inactive jobs.
  - Files: `server/routes/reports.ts`, `server/storage/clients.ts`, `server/storage/invoices.ts`, `server/storage/timeTracking.ts`, `server/storage/jobVisits.ts`
- **A3: Stale column name comments**: Fixed comments referencing `estimated_duration_minutes` → `duration_minutes`.
  - Files: `server/storage/maintenance.ts`, `server/storage/dashboard.ts`

**Part B — Cache Invalidation Gaps:**
- **B1**: Tech mobile mutations now invalidate calendar, jobs, and dashboard query keys.
- **B2**: Calendar reschedule now invalidates unscheduled sidebar.
- **B3**: Invoice send/void/payment/create mutations now invalidate `/api/invoices/stats` and `/api/invoices/dashboard`.
- **B4**: Job escalate/updateActionRequired now invalidate specific job detail cache. Reopen and updateStatus now invalidate calendar + dashboard.
- **B5**: `jobScheduling.ts` helper now invalidates `/api/calendar/range` and `/api/calendar/unscheduled`.
- **B6**: `useCompleteJob` now invalidates `/api/dashboard` and `/api/dashboard/needs-attention`.

**Part C — Type Cleanup:**
- Created `shared/types/visits.ts` with canonical `VisitJob` and `VisitLocation` types.
- Replaced local `Job` interfaces in Dashboard.tsx and TaskDialog.tsx with shared schema types.
- Deduplicated `ScheduleJobPayload` — jobScheduling.ts now extends the useCalendarApi.ts definition.
- Consolidated `TERMINAL_STATUSES` — scheduling.ts and dashboard.ts now import from statusRules.ts.

**Part D — Dead Code Removal:**
- Removed dead `getVisitsForUserInRange` from `jobVisitsRepository` (canonical version in `visits.ts`).

#### Phase 1 — Correctness Hotfixes from Canonical Query Audit (2026-02-12)

- **Fix 1: Tech mobile visit sync**: `techField.ts` en_route/start/complete handlers now call `syncJobScheduleFromVisits` after updating visit status, matching the pattern used by every other visit mutation. Previously, tech mobile status changes never propagated to the parent `jobs` table, causing stale data on calendar, dashboard, and job detail pages.
  - File changed: `server/routes/techField.ts`

- **Fix 2: Admin overdue column name**: Raw SQL in `admin.ts` batch job metrics referenced `estimated_duration_minutes` (a `job_visits` column) instead of `duration_minutes` (the correct `jobs` column). This caused overdue counts to always return 0.
  - File changed: `server/storage/admin.ts`

- **Fix 3: TechnicianDashboard month index**: `getMonth()` returns 0-indexed months but the calendar API expects 1-indexed. Added `+ 1` so the dashboard fetches the correct month's data instead of the previous month.
  - File changed: `client/src/pages/TechnicianDashboard.tsx`

- **Fix 4: Calendar getJobById soft-delete**: Added `deletedAt IS NULL` and `isActive = true` filters to `getJobById()` in `calendar.ts`. Previously could return soft-deleted or deactivated jobs for scheduling operations.
  - File changed: `server/storage/calendar.ts`

- **Fix 5: Admin getTenantDetail isActive**: Added `eq(jobs.isActive, true)` to all 4 job count queries (open, on-hold, overdue, scheduled-this-week) in `getTenantDetail`. Previously included deactivated jobs in admin panel counts.
  - File changed: `server/storage/admin.ts`

- **Fix 6: Timesheet job validation**: Added `deletedAt IS NULL` and `isActive = true` checks to the job validation query in `POST /api/admin/timesheets/entries`. Previously allowed creating time entries against soft-deleted jobs.
  - File changed: `server/routes/adminTimesheets.ts`

#### Tech Schedule 404 — Route diagnosis + canonical visit queries (2026-02-12)

- **404 root cause**: `GET /api/tech/visits/today` was returning 404 because the server process was running stale code that predated the `techField.ts` file and `index.ts` import. Route mounting is correct: `app.use("/api/tech", techFieldRouter)` in `server/routes/index.ts` line 232 + `router.get("/visits/today", ...)` in `server/routes/techField.ts`. After server restart, the endpoint returns 401 (auth required) for unauthenticated requests, confirming the route is registered. No path mismatch exists.
  - Files verified: `server/routes/techField.ts`, `server/routes/index.ts`, `client/src/pages/TechSchedulePage.tsx`

### Added

#### Canonical Visit Query Module (2026-02-12)

- **`server/storage/visits.ts`** — Single source of truth for visit reads, preventing query divergence between tech and calendar consumers. Provides:
  - `getVisitsForUserInRange(tenantId, userId, start, end)` — visits assigned to user in date range, enriched with job + location
  - `getUnscheduledVisitsForUser(tenantId, userId)` — visits with `scheduledStart IS NULL` assigned to user
  - `getVisitByIdForUser(tenantId, userId, visitId)` — single visit with assignment validation
  - `getVisitsForTenantInRange(tenantId, start, end, options?)` — superset for calendar/admin (optional userId filter, optional status exclusion)
  - Shared `ENRICHED_VISIT_SELECT` and `toEnrichedVisit()` mapper eliminate duplicated join/map logic
  - All functions enforce tenant isolation via `companyId`
  - Files added: `server/storage/visits.ts`

- **Tech routes refactored**: `/api/tech/visits/today` now calls `getVisitsForUserInRange` from the canonical module instead of `jobVisitsRepository` directly
  - Files changed: `server/routes/techField.ts`

- **Calendar cross-reference**: Added comment in `server/storage/calendar.ts` pointing to the canonical module for simpler visit list queries. Calendar retains its own CTE-based query (`getScheduledJobsInRange`) because it needs per-job ranking via `ROW_NUMBER()` and technician profile enrichment — different semantics from flat visit lists.
  - Files changed: `server/storage/calendar.ts`

#### Tech Field App — Auth + query fixes (2026-02-11)

- **Schedulable user auth**: Replaced `requireRole(TECH_ROLES)` with `requireSchedulable` middleware on all `/api/tech/*` endpoints. Access is now granted based on `users.is_schedulable` flag ("Show on calendar") rather than role. Any role (owner, admin, tech, etc.) with `isSchedulable=true` can use the tech app.
  - Files changed: `server/routes/techField.ts`

- **Timezone-aware "today" query**: `dayBounds()` now uses the tenant's timezone from `company_settings.timezone` (default: America/Toronto) instead of UTC midnight. Prevents visits scheduled near day boundaries from being missed or double-counted.
  - Files changed: `server/routes/techField.ts`

- **Location join fix**: Changed `j.client_id` (deprecated) to `j.location_id` in the raw SQL location enrichment query for `/api/tech/visits/today`. Fixes missing location data on visit cards.
  - Files changed: `server/routes/techField.ts`

- **Dev debug log**: Added structured JSON log on `/api/tech/visits/today` (dev only) printing userId, email, role, isSchedulable, timezone, day bounds, and visit count for troubleshooting.

### Added

#### Admin Timesheets — Jobber-style timesheet management (2026-02-11)

- **Single source of truth**: Admin reads and edits the same `time_entries` records created by the technician field app. No parallel time systems.

- **Tech field time entry fix**: Rewired `/api/tech/visits/:visitId/en-route`, `/start`, and `/complete` to use the canonical `recordJobStatus()` state machine instead of ad-hoc `startTimeEntry`/`stopTimeEntry` calls:
  - **EN ROUTE** now creates a `travel_to_job` time entry (was missing entirely)
  - **START VISIT** now stops the travel entry and starts an `on_site` entry via `recordJobStatus("arrived")`
  - **COMPLETE VISIT** now stops the on_site entry via `recordJobStatus("completed")`
  - All three record `technician_job_status_events` for audit trail
  - Files changed: `server/routes/techField.ts`

- **Job reassignment in time entries**: Extended `managerUpdateTimeEntrySchema` to accept optional `jobId` field. `updateTimeEntryManager()` now validates the target job belongs to the same tenant before allowing reassignment.
  - Files changed: `shared/schema.ts`, `server/storage/timeTracking.ts`

- **Delete time entry**: Added `deleteTimeEntry()` to `timeTrackingRepository` — hard delete with tenant isolation, invoice lock check, and structured audit logging.
  - Files changed: `server/storage/timeTracking.ts`

- **Admin Timesheets API** (`server/routes/adminTimesheets.ts`, mounted at `/api/admin/timesheets`):
  - `GET /users` — list active staff for user switcher dropdown
  - `GET /day?userId=...&date=YYYY-MM-DD` — time entries for a user on a date, enriched with job info, with travel/work/total breakdowns
  - `GET /week?userId=...&weekStart=YYYY-MM-DD` — aggregated grid: rows = jobs, columns = Mon–Sun, cells = duration totals, plus day and week grand totals
  - `GET /visits-for-reassign?userId=...&date=...` — visits within a 7-day window for the reassignment dropdown (same-tenant, assigned to user)
  - `PATCH /entries/:id` — edit time entry (start/end times, type, jobId reassignment, notes) with overlap validation and audit logging
  - `DELETE /entries/:id` — delete time entry with tenant + role validation
  - All endpoints require `MANAGER_ROLES` access (owner, admin, manager, dispatcher)
  - Files added: `server/routes/adminTimesheets.ts`
  - Files changed: `server/routes/index.ts` (registered adminTimesheetsRouter)

- **Admin Timesheets UI** (`client/src/pages/AdminTimesheetsPage.tsx`, at `/settings/timesheets`):
  - **Header**: User switcher dropdown + Day/Week toggle tabs
  - **Date navigation**: Left/right arrows, date picker input, Today button, date/week range label
  - **Day view**: Summary bar (total/work/travel) + card per entry showing type badge, job reference, start→end times, duration, notes, edit/delete buttons
  - **Week view**: Grid table with Mon–Sun columns, rows per job, HH:MM cells, day totals footer, week grand total
  - **Edit modal**: Start/end datetime inputs with auto-calculated duration, type selector, job reassignment dropdown (populated from visits-for-reassign API), notes field
  - **Delete confirmation**: AlertDialog with destructive action styling
  - Files added: `client/src/pages/AdminTimesheetsPage.tsx`
  - Files changed: `client/src/App.tsx` (added route), `client/src/components/SettingsLayout.tsx` (added nav item)

- **No migrations required** — all changes use existing `time_entries` and `technician_job_status_events` tables

##### Manual Verification Checklist
1. **As a tech**: Tap En Route → confirm `travel_to_job` time entry created in DB
2. **As a tech**: Tap Start Visit → confirm travel entry stopped + `on_site` entry started
3. **As a tech**: Tap Complete Visit → confirm on_site entry stopped with correct duration
4. **As an admin**: Navigate to Settings > Timesheets
5. **Admin Day view**: Select tech user + today → confirm tech's time entries appear
6. **Admin Day view**: Verify travel/work/total summary is accurate
7. **Admin Edit**: Click edit on an entry → change start/end times → save → verify totals update
8. **Admin Reassign**: In edit modal, reassign entry to different job → save → verify entry moves
9. **Admin Delete**: Click delete → confirm dialog → verify entry removed and totals update
10. **Admin Week view**: Switch to Week tab → verify grid shows per-job per-day totals
11. **Tenant isolation**: Confirm no cross-tenant data visible in user list or reassignment dropdown
12. **Desktop admin app unaffected** — existing payroll/time pages still work

#### Admin Timesheets — Tighten Pass (2026-02-11)

- **Overlap guard + auto-stop audit**: Rewrote `recordJobStatus()` state machine to auto-stop any running time entry before starting a new one. Prevents phantom/overlapping entries.
  - New `autoStopOpen()` helper stops the running entry, logs a structured `time_entry_auto_stopped` JSON event, and records an `auto_stop` event in `technician_job_status_events`
  - EN_ROUTE: auto-stops any open entry before creating `travel_to_job`
  - ARRIVED: auto-stops any open entry before creating `on_site` (replaces manual stop logic)
  - COMPLETED: only stops the running entry if it belongs to the same job (no phantom stops)
  - Files changed: `server/storage/timeTracking.ts`

- **Admin Day view grouped by Job**: Rewrote `GET /day` endpoint and UI to group entries under Job headers (Jobber-style):
  - API returns `groups` array (grouped by jobId) with per-group `travelMinutes`, `workMinutes`, `totalMinutes` subtotals
  - Joins with `clientLocations` for location name/address/city
  - UI shows summary bar (Work/Travel colored labels) + Card per job with header → Travel/Work badge rows → subtotals
  - No internal enum names exposed: all `travel_*` types → "Travel", `on_site` → "Work"
  - Files changed: `server/routes/adminTimesheets.ts`, `client/src/pages/AdminTimesheetsPage.tsx`

- **Reassign dropdown tightened**: Rewrote `GET /visits-for-reassign` endpoint:
  - Bounded ±7 day date window (was unbounded)
  - `.limit(50)` hard cap (was unlimited)
  - Optional `search` query param — ILIKE on job summary, job number, and client location name
  - No user-assignment filter (admin can reassign to any visit in tenant)
  - Joins with `clientLocations` for `locationName`
  - Tags results with `sameDay` boolean for UI partitioning ("Same Day" / "Recent" groups)
  - Files changed: `server/routes/adminTimesheets.ts`, `client/src/pages/AdminTimesheetsPage.tsx`

- **Admin "Add Time" manual entry**: New `POST /entries` endpoint + Add Time modal:
  - Schema: `technicianId`, `jobId` (required), `type` (`travel_to_job`|`on_site`), `startAt`, `endAt`, `notes`
  - Validates end > start, job + tech belong to tenant, no overlaps
  - Creates via `createFinishedTimeEntry` with structured audit logging
  - UI modal: Job dropdown with search (same-day/recent grouping), Type selector (Travel/Work), Start/End datetime inputs with auto-duration, Notes field, pre-fills 8:00–9:00 AM
  - "Add Time" button in date nav bar (day view only)
  - Files changed: `server/routes/adminTimesheets.ts`, `client/src/pages/AdminTimesheetsPage.tsx`

- **No migrations required** — all changes use existing tables

##### Manual Verification Checklist (Tighten Pass)
1. **Overlap guard**: As tech, start En Route on Job A → then En Route on Job B → confirm Job A's travel entry was auto-stopped with correct duration
2. **Auto-stop audit**: Check `technician_job_status_events` for `auto_stop` status entry with notes describing what was stopped
3. **No phantom stops**: Complete a visit → start En Route on new job → confirm completed job's entry was NOT re-stopped
4. **Grouped Day view**: Admin Day view shows entries grouped under Job cards with job#, summary, location header
5. **Summary bar**: Colored Work/Travel labels with correct totals match sum of all entries
6. **Per-group subtotals**: Each job card shows its own Travel + Work subtotals
7. **No internal enum names**: UI shows "Travel" and "Work" only — no `travel_to_job` or `on_site` visible
8. **Reassign search**: In edit modal, type in search box → results filter by job name/number/client
9. **Reassign grouping**: Results split into "Same Day" and "Recent" sections
10. **Add Time modal**: Click "Add Time" → fill job (required), type, start/end → confirm entry created
11. **Add Time overlap**: Try creating an entry that overlaps an existing one → confirm 409 error
12. **Add Time validation**: Try end before start → confirm validation error

#### Technician Field App — mobile-first web UI (2026-02-11)

- **New backend API** (`server/routes/techField.ts`, mounted at `/api/tech`):
  - `GET /api/tech/visits/today` — today's assigned visits with job + location enrichment
  - `GET /api/tech/visits/:visitId` — visit detail with job, location, and job notes
  - `POST /api/tech/visits/:visitId/en-route` — mark visit as en_route
  - `POST /api/tech/visits/:visitId/start` — start visit (on-site) + auto-start billable time entry
  - `POST /api/tech/visits/:visitId/complete` — complete visit with outcome modal (completed/needs_parts/needs_followup), required notes for non-completed outcomes, auto-stop time entry
  - `POST /api/tech/visits/:visitId/notes` — add a note to the visit's job
  - `GET /api/tech/time/summary` — today + this week time summary
  - All endpoints enforce `TECH_ROLES` access, tenant isolation, and assignment validation (tech can only see/act on visits assigned to them)

- **New frontend pages** (mobile-first, no sidebar/header):
  - `TechLoginPage` (`/tech/login`) — dedicated login redirecting to `/tech` on success
  - `TechHomePage` (`/tech`) — today's visits with greeting, date, visit count, scrollable card list
  - `TechSchedulePage` (`/tech/schedule`) — visits grouped by date
  - `TechVisitDetailPage` (`/tech/visit/:visitId`) — full visit detail with state-driven action buttons:
    - scheduled/dispatched → **EN ROUTE** button
    - en_route → **START VISIT** button (green)
    - in_progress/on_site → **COMPLETE VISIT** button → outcome modal
  - Complete Visit outcome modal: 3 outcome options (Completed, Needs Parts, Needs Follow-up), required note for non-completed outcomes
  - `TechTimesheetPage` (`/tech/timesheet`) — clock status, today's hours, weekly totals
  - `TechMorePage` (`/tech/more`) — profile info + sign out

- **TechnicianLayout** (`client/src/components/TechnicianLayout.tsx`):
  - Fixed bottom navigation with 4 tabs: Home, Schedule, Timesheet, More
  - Active state highlighting, mobile-optimized with safe-area padding

- **Routing**: `/tech/*` routes bypass the main sidebar/header layout entirely. AppContent detects `/tech*` paths and renders TechRouter directly.

- **Files added**: `server/routes/techField.ts`, `client/src/components/TechnicianLayout.tsx`, `client/src/pages/TechLoginPage.tsx`, `client/src/pages/TechHomePage.tsx`, `client/src/pages/TechSchedulePage.tsx`, `client/src/pages/TechVisitDetailPage.tsx`, `client/src/pages/TechTimesheetPage.tsx`, `client/src/pages/TechMorePage.tsx`
- **Files changed**: `server/routes/index.ts` (registered techFieldRouter), `client/src/App.tsx` (added TechRouter + /tech route handling)
- **No migrations required** — uses existing tables (job_visits, jobs, job_notes, time_entries)

##### Manual Verification Checklist
1. Navigate to `/tech/login` → see dedicated login screen (no sidebar)
2. Log in as technician → redirects to `/tech` (Home)
3. Home shows today's assigned visits with greeting + date
4. Tap a visit → visit detail page with job info, location, notes
5. Visit status=scheduled → "En Route" button visible
6. Tap "En Route" → status updates to en_route, button changes to "Start Visit"
7. Tap "Start Visit" → status updates to in_progress, button changes to "Complete Visit"
8. Tap "Complete Visit" → outcome modal appears
9. Select "Needs Parts" without note → validation error
10. Select "Needs Parts" with note → visit completes, note auto-created
11. Bottom nav tabs switch between Home/Schedule/Timesheet/More
12. More page → Sign Out logs out and redirects to `/tech/login`
13. Desktop admin app unaffected — `/` still shows sidebar + dashboard

### Changed

#### Settings page: Jobber-style two-column layout (2026-02-11)

- **New layout**: Replaced the card-grid Settings landing page with a two-column layout:
  - **Left column** (280px, desktop only): Scrollable vertical nav with section headers (General, Billing & Products, Jobs & Templates, Team & Time, Integrations) and compact nav items with icon + label + active highlight.
  - **Right column** (flex fill): Active settings page content.
- **Responsive**: On mobile (`<lg`), left nav collapses to a dropdown selector at the top of the page with expand/collapse toggle.
- **Deep linking**: Refreshing `/settings/tags` (or any sub-route) correctly renders the layout with the right page and active nav highlight.
- **Active state**: Current nav item highlighted with `bg-primary/10` + left border indicator, matching the app sidebar pattern.
- **Routing**: All `/settings/*` routes now render inside `SettingsLayout` via a shared `SettingsRouter` component. Uses two catch-all Route entries in the outer Switch (no wouter `nest` to preserve absolute `<Link>` paths in sub-pages).
- **Sub-pages unchanged**: Existing settings pages render as-is inside the right panel. Back buttons still work (navigate to `/settings` landing).
- **Files added**: `client/src/components/SettingsLayout.tsx`
- **Files changed**: `client/src/App.tsx` (routing restructured), `client/src/pages/SettingsPage.tsx` (card grid replaced with centered welcome message)
- **No breaking route changes** — all existing `/settings/*` URLs continue to work.

#### Explicit visit scheduling and close-job guardrail (2026-02-11)

- **Removed "Schedule Anyway"**: Deleted the "Schedule Anyway" button from the existing-visit conflict dialog in `JobDetailPage.tsx`. The dialog now offers two explicit choices:
  - **Reschedule Existing Visit** — opens the existing visit for rescheduling (UPDATE, never INSERT)
  - **Add Follow-up Visit** — creates a new visit with next visit_number
  - **Cancel** — dismiss dialog
- **Close-job uncompleted-visits guardrail**: `POST /api/jobs/:id/close` now checks for uncompleted visits (`is_active=true AND status NOT IN ('completed','cancelled')`) before closing. If found, returns 409 with `UNCOMPLETED_VISITS` code. Frontend shows a modal with:
  - **Go to Visits** — scrolls to visits section
  - **Mark Visits Completed & Close** — retries with `autoCompleteOpenVisits=true`, bulk-completing all open visits
  - **Cancel**
- **Bulk-complete visits**: Added `bulkCompleteVisits()` to `jobVisitsRepository` — sets status='completed', checkedOutAt, and actualDurationMinutes (consistent with existing transition logic at `jobVisits.ts:494`).
- **Follow-up visit endpoint**: Added `POST /api/jobs/:jobId/visits/follow-up` — explicit intent endpoint that always creates a new visit with auto-computed visit_number.
- **Removed dead code**: Removed `resolveConflictMutation` from `JobDetailPage.tsx` (no longer used after Schedule Anyway removal).
- **Files changed**: `server/routes/jobs.ts`, `server/routes/jobVisits.routes.ts`, `server/storage/jobVisits.ts`, `server/services/jobVisits.service.ts`, `client/src/pages/JobDetailPage.tsx`, `client/src/components/JobHeaderCard.tsx`
- **No migrations required** — all changes are application-level logic, no schema changes.

##### Manual Verification Checklist
1. Create job → visit #1 auto-created
2. Drag/drop visit on calendar → updates same visit id (no new visit created)
3. Click "Schedule follow-up" with existing active visit → modal offers "Reschedule Existing Visit" and "Add Follow-up Visit"
4. Choose "Add Follow-up Visit" → creates visit #2
5. Close job with open visits → "Uncompleted Visits" modal appears
6. Click "Mark Visits Completed & Close" → visits auto-completed, job closes successfully
7. Close job with no open visits → closes normally (no modal)

#### Hardened PM + job scheduling invariants (2026-02-11)

- **New DB constraint**: `jobs_allday_requires_start_check` — `scheduled_start IS NOT NULL OR is_all_day IS DISTINCT FROM TRUE`. Prevents marking a job as all-day without a scheduled date. Existing constraint `jobs_scheduled_end_requires_start_check` already enforces `scheduledEnd` requires `scheduledStart`.
- **Migration**: `migrations/2026_02_11_scheduling_invariants.sql` — adds the CHECK constraint. Pre-check confirmed 0 violating rows.
- **Schema**: Added `allDayRequiresStartCheck` to Drizzle schema in `shared/schema.ts`.
- **PM generation hardened**: Both `generateForTemplate()` and `generatePmForCurrentMonth()` in `server/domain/recurrence.ts` now explicitly tie `scheduledEnd` to `scheduledStart` (null when start is null) with invariant comments.
- **Canonical predicates verified**: `isJobScheduled()` returns true ONLY when `scheduledStart != null`. LocationDetailPage and ClientDetailPage use `getJobStatusDisplay(job)` with no local "scheduled" logic.
- **Tests**: `tests/job-scheduling-invariants.test.ts` — 9 tests: DB rejects isAllDay=true+null start, DB rejects scheduledEnd without start, valid unscheduled accepted, valid scheduled accepted, isJobScheduled predicate (null→false, set→true), getJobStatusDisplay returns "Open" not "Scheduled" for unscheduled, "Scheduled" for scheduled, valid all-day accepted.
- **Files changed**: `shared/schema.ts`, `server/domain/recurrence.ts`
- **Files added**: `migrations/2026_02_11_scheduling_invariants.sql`, `tests/job-scheduling-invariants.test.ts`

#### Active Work now includes all open jobs, including unscheduled PM jobs (2026-02-11)

- **Canonical rule**: Active Work = `activeJobFilter() AND status = 'open'`. No `scheduledStart` requirement.
- **New helper**: `activeWorkJobFilter()` in `server/storage/jobFilters.ts` — Drizzle ORM composable filter combining `deletedAt IS NULL`, `isActive = true`, and `status = 'open'`. Also added raw SQL equivalents `JOB_ACTIVE_WORK_SQL` and `JOB_ACTIVE_WORK_SQL_J`.
- **LocationDetailPage.tsx**: Removed `isJobScheduled(j) || openSubStatus === "in_progress"` restriction from Active Work filter. All open jobs for the location now appear, including unscheduled PM jobs and backlog.
- **ClientDetailPage.tsx**: Same fix — Active Work now shows all open jobs for the customer company.
- **Tests**: `tests/active-work-filter.test.ts` — 10 integration tests validating: unscheduled open jobs included, scheduled open jobs included, in_progress/on_hold included, completed/invoiced/archived excluded, soft-deleted excluded, deactivated excluded.
- **Files changed**: `server/storage/jobFilters.ts`, `client/src/pages/LocationDetailPage.tsx`, `client/src/pages/ClientDetailPage.tsx`
- **Files added**: `tests/active-work-filter.test.ts`

#### Removed Preview button from PM schedule card (2026-02-11)

- **What**: Removed the "Preview" button and its associated dialog from `PMScheduleCard.tsx`. The preview showed upcoming PM occurrences but was not useful for the PM workflow since generation is now month-keyed.
- **Cleanup**: Removed `previewOpen` state, preview query (`/instances?from=...&to=...`), preview dialog markup, and unused imports (`Eye` icon, `format` from date-fns).
- **Files changed**: `client/src/components/PMScheduleCard.tsx`

#### Consolidated legacy job status display to canonical jobUtils.ts (2026-02-11)

- **What**: Removed 3 duplicate/legacy `getJobStatusDisplay()` / `getStatusBadge()` functions that used 12+ legacy status strings (draft, scheduled, dispatched, en_route, on_site, requires_invoicing, cancelled, closed, etc.). All job status display now uses the single canonical implementation in `client/src/components/job/jobUtils.ts`.
- **JobHeaderCard.tsx**: Removed dead-code `getJobStatusDisplay()` (12 legacy statuses) and `getPriorityDisplay()` functions. Fixed `canReopen` check to use canonical statuses (`["completed", "archived"]` instead of including legacy `"requires_invoicing"`).
- **JobMetaCard.tsx**: Replaced local `getJobStatusDisplay(status, scheduledStart, openSubStatus)` with import of canonical `getJobStatusDisplay(job)` from jobUtils.ts. Uses full job object for overdue detection via `isJobOverdue()`.
- **ClientJobsTab.tsx**: Replaced legacy `getStatusBadge()` switch (in_progress, on_hold, cancelled, draft, scheduled) with canonical `getJobStatusDisplay(job)` from jobUtils.ts. Removed unused icon imports (CheckCircle, Clock, AlertCircle).
- **Dashboard.tsx**: Fixed legacy navigation links — "Requires Invoicing" now links to `/jobs?lifecycle=completed` instead of `/jobs?status=requires_invoicing`; "On Hold" now links to `/jobs?lifecycle=open&subStatus=on_hold` instead of `/jobs?status=on_hold`.
- **LocationDetailPage.tsx**: Fixed legacy overdue check (`status !== "cancelled"`) to use canonical model (`status === "open"`).
- **Files changed**: `client/src/components/JobHeaderCard.tsx`, `client/src/components/JobMetaCard.tsx`, `client/src/components/ClientJobsTab.tsx`, `client/src/pages/Dashboard.tsx`, `client/src/pages/LocationDetailPage.tsx`

#### Fixed PM jobs showing "Scheduled" when unscheduled (2026-02-11)

- **Bug**: PM jobs (status=open, scheduledStart=NULL) were showing "Scheduled" badge on LocationDetailPage and ClientDetailPage Active Work sections. The Jobs list correctly showed "Open" via canonical `getJobStatusDisplay()`.
- **Root cause**: Both pages had hardcoded badge logic: `job.openSubStatus === "in_progress" ? "In Progress" : "Scheduled"` — always showing "Scheduled" for any non-in_progress open job, regardless of whether `scheduledStart` was set.
- **LocationDetailPage.tsx**: Removed local `getStatusBadge()` function (legacy switch with "scheduled"/"in_progress"/"completed"/"overdue" cases). Replaced both Active Work badges and Jobs tab badges with canonical `getJobStatusDisplay(job)` from `jobUtils.ts`. Removed duplicate overdue detection (canonical helper handles it).
- **ClientDetailPage.tsx**: Replaced Active Work hardcoded badge and Jobs tab inline status logic (which used `isJobScheduled()` locally) with canonical `getJobStatusDisplay(job)`. Removed unused `isJobScheduled` import from `@shared/schema`.
- **Data sanity**: Verified both PM generation paths (`generateForTemplate` and `generatePmForCurrentMonth` in `server/domain/recurrence.ts`) correctly set `isAllDay: false` and `scheduledStart: null` for unscheduled PM jobs.
- **Files changed**: `client/src/pages/LocationDetailPage.tsx`, `client/src/pages/ClientDetailPage.tsx`

### Fixed

#### PM generate endpoint: pmResult missing from scope=current_month response (2026-02-11)

- **Root cause**: The `scope=current_month` route handler was syntactically correct but the running server had stale code (pre-change). Additionally, `scope` parsing used `req.query.scope ? String(...) : undefined` which could silently fail on edge-case falsy values.
- **Fix 1 — Robust scope parsing**: Changed to `String(req.query.scope ?? "")` so scope is always a non-undefined string. Eliminates any ambiguity in the `=== "current_month"` comparison.
- **Fix 2 — Explicit `return res.json`**: Added `return` before `res.json()` in the `scope === "current_month"` branch to make the early return pattern explicit and prevent any possibility of fallthrough.
- **Fix 3 — DEV diagnostic log**: Added `console.log("[recurringJobs.generate]", { templateId, scope, rawScope })` before the branch so scope routing is visible in dev server output.
- **Fix 4 — Legacy path includes `pmResult: null`**: The non-scope response now includes `pmResult: null` so the frontend never receives `undefined` for that field.
- **Fix 5 — Response shape test**: New test `"pmResult always includes reason, monthKey, createdCount keys"` validates the `PmCurrentMonthResult` shape for all three reason codes (CREATED, EXISTS, MONTH_EXCLUDED).
- **Files changed**: `server/routes/recurringJobs.ts`, `tests/pm-current-month.test.ts`

#### PM "Generate This Month" now works mid-month for period_start schedules (2026-02-11)

- **Root causes**: Two bugs prevented PM job generation mid-month:
  1. `computePmOccurrences()` filtered `occDate >= templateStart` at day-level. When a template was created mid-month (e.g., Feb 11) with `period_start` mode, the occurrence date (Feb 1) was before `templateStart` (Feb 11) and got filtered out.
  2. `generateForTemplate()` skipped instances with `status !== "pending"`. When a previously generated job was soft-deleted, the instance still had `status="generated"` pointing to a dead job, so regeneration was blocked.
- **Fix**: New `generatePmForCurrentMonth(companyId, templateId)` function in `server/domain/recurrence.ts` bypasses window-based logic entirely. Generates by monthKey (1st of month in company timezone) regardless of what day it is. Includes:
  - Month exclusion check (returns `MONTH_EXCLUDED` if current month not in `monthsOfYear`)
  - Active-job idempotency (queries `jobs` table directly for active jobs with matching `recurrence_template_id` + `recurrence_instance_date`)
  - Soft-delete recovery: if instance exists but linked job is deleted/inactive, resets instance to `pending` and creates new job (returns `RECOVERED_INSTANCE`)
  - Structured diagnostics: returns `PmCurrentMonthResult` with `createdCount`, `reason` enum (`CREATED | EXISTS | MONTH_EXCLUDED | RECOVERED_INSTANCE`), optional `existingJob` reference, and `monthKey`
- **Route update**: `POST /api/recurring-templates/:id/generate` now supports `?scope=current_month` query param. When set, uses `generatePmForCurrentMonth` instead of window-based `generateForSingleTemplate`. Response includes both `GenerationResult` shape (backward compat) and `pmResult` with diagnostics.
- **Frontend updates**:
  - `PMScheduleCard.tsx`: "Generate This Month" button now calls `?scope=current_month`. Handles `pmResult.reason` for better toasts (`EXISTS` shows job number, `MONTH_EXCLUDED` shows specific message). Falls back to cross-template discovery for edge cases.
  - `PMSetupModal.tsx`: Auto-generation on schedule create/edit now uses `?scope=current_month` instead of window-based generation. Removed unused `computeCurrentMonthWindowDays()`.
- **Tests**: `tests/pm-current-month.test.ts` — 8 integration tests: mid-month creation with correct instance_date, soft-delete recovery, fresh template after old deleted, idempotency (EXISTS + job reference), month exclusion, mid-month startDate template, inactive template error, non-PM template error.
- **Files changed**: `server/domain/recurrence.ts`, `server/routes/recurringJobs.ts`, `client/src/components/PMScheduleCard.tsx`, `client/src/components/PMSetupModal.tsx`
- **Files added**: `tests/pm-current-month.test.ts`

### Added

#### PM Schedule UI on Location Detail Page (2026-02-10)

- **PMScheduleCard** (`client/src/components/PMScheduleCard.tsx`): New collapsible card component for the Location Detail right column. Fetches recurring templates via `GET /api/recurring-templates` and identifies the PM template for the current location (jobType=maintenance with monthsOfYear configured, fallback to title prefix "PM"). Displays summary (months, generation timing, scheduling mode, parts) with Edit, Pause/Resume, Preview, Generate, and Delete actions.
- **PMSetupModal** (`client/src/components/PMSetupModal.tsx`): 2-step modal for creating/editing PM schedules. Step 1: month picker with presets (Quarterly, Bi-Annual, Annual, Monthly), generation mode (start of month / day of month), auto-schedule toggle with time/duration, and PM parts inclusion. Step 2: review summary before save. Validates required fields (>=1 month, valid day 1-31, valid HH:MM).
- **LocationDetailPage integration**: Replaced placeholder PM card with `PMScheduleCard` wired to existing recurring template API. Removed unused Select component imports.
- **Current-month-only generation**: "Generate This Month" button computes `windowDays` from today to end of current month (+2 buffer, max 35) so only the current month's PM job is created. Button only shown when schedule is active and current month is in `monthsOfYear`. After create/save in PMSetupModal, auto-generates current month if applicable. Idempotent — duplicate clicks are safe (no-op from backend).
- **No backend changes.** Uses existing `POST/PATCH/DELETE /api/recurring-templates`, `POST /api/recurring-templates/:id/generate`, and `GET /api/recurring-templates/:id/instances` endpoints.
- **Files added**: `client/src/components/PMScheduleCard.tsx`, `client/src/components/PMSetupModal.tsx`
- **Files changed**: `client/src/pages/LocationDetailPage.tsx`

### Fixed

#### Deleted jobs now fully invisible across all server endpoints and UI (2026-02-10)

- **Root cause**: Soft-deleted jobs (`deleted_at IS NOT NULL`, `is_active = false`) were excluded by `isNull(jobs.deletedAt)` in most queries, but `is_active = true` was never checked. Jobs deactivated via `is_active = false` without `deleted_at` would still appear in lists, search, dashboard, calendar backlog, and maintenance views.
- **Phase 1 — Canonical filter**: Created `server/storage/jobFilters.ts` with `activeJobFilter()` (Drizzle ORM), `JOB_ACTIVE_SQL_J` (raw SQL alias `j`), and `JOB_ACTIVE_SQL` (raw SQL full table name). All check both `deleted_at IS NULL AND is_active = true`.
- **Phase 2 — Patched 18+ query sites**:
  - `server/storage/jobs.ts`: Added `eq(jobs.isActive, true)` to `getJobs`, `getJob`, `updateJob` (no-version), `updateJobStatus`, `transitionJobStatus`, `getJobsOnHoldOrNeedsReview` (6 sites)
  - `server/storage/search.ts`: Added `AND ${JOB_ACTIVE_SQL_J}` to all 3 raw SQL job queries (exact number, range prefix, summary text)
  - `server/storage/recurringJobs.ts`: `getInstancesWithJobs` left join now filters out deleted/deactivated jobs so PM card never shows ghost job links
  - `server/storage/calendar.ts`: Added `AND j.is_active = true` to raw SQL + `eq(jobs.isActive, true)` to backlog query (2 sites)
  - `server/storage/admin.ts`: Added `AND is_active = true` to tenant health metrics raw SQL (1 site)
  - `server/storage/dashboard.ts`: Added `eq(jobs.isActive, true)` to `getJobCounts`, overdue jobs, and attention jobs (3 sites)
  - `server/storage/maintenance.ts`: Added `eq(jobs.isActive, true)` to recently completed and status summary (2 sites)
  - `server/storage/jobNotes.ts`: Added deletion guards to both job existence checks (2 sites)
- **Phase 3 — Job detail 404**: `getJob()` now returns null for deleted/deactivated jobs; all route handlers already throw 404 on null.
- **Phase 4 — Integration test**: `tests/deleted-job-exclusion.test.ts` — 11 tests: soft-delete verification, getJobs exclusion, getJob null, getJob active, dashboard counts, maintenance statuses, search exclusion, search active, updateJob null for deleted, getJobsAndInvoicesForLocations exclusion, getCustomerCompanyOverview exclusion.
- **Phase 5 — UI cache hardening**: Job deletion mutations now invalidate `/api/dashboard` and `/api/maintenance` in addition to `/api/jobs` and `/api/calendar`. Added `"dashboard"` to `QUERY_GROUPS` in `useMutationWithToast.ts`. All 3 delete mutation sites now also invalidate `/api/clients` (prefix-matches `["/api/clients", id, "overview"]`) so Client Detail page updates instantly after job deletion without manual refresh.
- **Phase 6 — Client Detail page fix**: `customerCompanies.ts` `getJobsAndInvoicesForLocations()` and `getCustomerCompanyOverview()` now apply `activeJobFilter()` to exclude deleted/inactive jobs. Previously these queries only filtered by `companyId` and `locationId`, allowing soft-deleted jobs to appear on the Client Detail page. Added DEV guardrail to log any leaked deleted jobs.
- **Files created**: `server/storage/jobFilters.ts`, `tests/deleted-job-exclusion.test.ts`
- **Files changed**: `server/storage/jobs.ts`, `server/storage/search.ts`, `server/storage/recurringJobs.ts`, `server/storage/calendar.ts`, `server/storage/admin.ts`, `server/storage/dashboard.ts`, `server/storage/maintenance.ts`, `server/storage/jobNotes.ts`, `server/storage/customerCompanies.ts`, `client/src/pages/JobDetailPage.tsx`, `client/src/pages/Calendar.tsx`, `client/src/components/JobDetailDialog.tsx`, `client/src/hooks/useMutationWithToast.ts`, `tests/deleted-job-exclusion.test.ts`

#### PM Card: Ghost job link after deleted job + second Generate click (2026-02-10)

- **Root cause**: `discoveredJob` state and React Query instances cache survived across generate clicks. After a job was deleted externally, clicking Generate again returned 0 jobs, cross-template discovery found nothing, but the stale `discoveredJob` from the prior run (or stale `currentMonthInstances` cache) still rendered a link to the now-deleted job.
- **Fix 1 — Clear stale state eagerly**: `setDiscoveredJob(null)` is now called at the start of `generateMutation.mutationFn` (before the API call), so the UI never renders a ghost link during the request.
- **Fix 2 — Always overwrite discoveredJob**: In the 0-jobs-created branch, `setDiscoveredJob(existingJob)` is now called unconditionally — even when `existingJob` is null. Previously the null case only showed a toast but left the old `discoveredJob` value intact.
- **Fix 3 — Clear on delete**: Both `archiveMutation.onSuccess` and `hardDeleteMutation.onSuccess` now call `setDiscoveredJob(null)` and invalidate the instances cache.
- **Fix 4 — Await cache invalidation**: `generateMutation.onSuccess` now `await`s `queryClient.invalidateQueries` for templates, jobs, and instances before reading cached data for cross-template discovery.
- **Fix 5 — PMSetupModal instances cache**: After auto-generation on save, `PMSetupModal` now also invalidates the instances `current-month` cache so the PMScheduleCard "This month" row shows fresh data.
- **Files changed**: `client/src/components/PMScheduleCard.tsx`, `client/src/components/PMSetupModal.tsx`

#### Test: Fix stale "assigned" status assertion in recurring-jobs test (2026-02-10)

- **Stale assertion**: Test 4 in `tests/recurring-jobs.test.ts` expected `status === "assigned"` for jobs generated from a template with `preferredTechnicianId`. Per Phase 2 Step 6, the generator always sets `status: "open"` — "assigned" is a derived state, not persisted. Changed assertion to `"open"`.
- **Audit**: Confirmed no code path in `server/domain/recurrence.ts` or `server/storage/jobs.ts` ever sets `status: "assigned"` during generation.
- **Files changed**: `tests/recurring-jobs.test.ts`

#### Backend: PM "Generate This Month" returns 0 after 1st of month (2026-02-10)

- **Root cause**: `generateForSingleTemplate` and `generateInstances` set `windowStart = today` (local midnight). For PM templates with `generationMode="period_start"`, the occurrence date is the 1st of the month. After the 1st, `occDate < windowStart` caused the occurrence to be silently filtered out by `computePmOccurrences`, resulting in 0 instances and 0 jobs. Same issue for `day_of_month` mode when `generationDayOfMonth < today`.
- **Fix**: Added `isPmTemplate()` helper and `pmWindowStart()` in `server/domain/recurrence.ts`. For PM templates (jobType=maintenance + monthsOfYear configured + locationId set, or legacy title prefix "PM"), `windowStart` is overridden to the 1st of the current month. Non-PM templates are unaffected. Applied in `generateForSingleTemplate`, `generateInstances`, and `previewGeneration`.
- **Timezone hardening**: Replaced raw `new Date(); setHours(0,0,0,0)` (server time) with `getCompanyToday(companyId)` — uses `Intl.DateTimeFormat` with the company's configured IANA timezone to determine the current calendar date, returned as a local-time `Date` (same basis as `parseLocalDate`). Prevents month-boundary bugs when UTC server clock is ahead of the company timezone (e.g., UTC 03:30 Feb 1 = Toronto 22:30 Jan 31). Applied consistently in `generateForSingleTemplate`, `generateInstances`, and `previewGeneration`.
- **Tests**: `tests/pm-window-start.test.ts` — 12 unit tests: period_start bug repro/fix, day_of_month bug repro/fix, non-PM unaffected, idempotency, no future-month flooding, plus 5 timezone boundary tests (Toronto Jan 31 vs UTC Feb 1, Toronto Feb 1, LA Feb 28 vs UTC Mar 1, pmWindowStart month-start at boundary).
- **Files changed**: `server/domain/recurrence.ts`
- **Files added**: `tests/pm-window-start.test.ts`

#### PM Card: PM-only filtering, improved 0-jobs diagnostics, UX tweaks (2026-02-10)

- **`isPmTemplate` helper**: Extracted shared predicate for PM template identification — `jobType=maintenance` + locationId match + monthsOfYear configured, with legacy fallback (title prefix "PM" + months). Used by `findPMTemplate` and cross-template discovery to prevent non-PM templates from leaking into search results.
- **Cross-template search restricted to PM templates**: The 0-jobs-created discovery loop now only iterates templates where `isPmTemplate(t, locationId)` is true AND `monthsOfYear` includes the current month. Prevents false matches against repair/install templates for the same location.
- **Improved "nothing generated" diagnostics**: When generate returns 0 jobs and no existing PM job is found via cross-template search, shows descriptive toast ("Nothing generated for Feb. No existing PM job found. Verify generation mode and day-of-month settings.") instead of misleading "already exists." DEV-only `console.warn` logs templateId, locationId, date range, windowDays, raw generate response, and list of PM templates searched — aids debugging whether the issue is out-of-window, idempotency, or misconfigured day-of-month.
- **Remove confirmation copy updated**: Archive dialog now explicitly states "Any PM jobs already generated will remain and must be removed manually if you don't want them." Toast updated to match.
- **Contacts card collapsed by default**: On LocationDetailPage, `contactsOpen` initial state changed from `true` to `false` — all right-column cards now start collapsed.
- **Files changed**: `client/src/components/PMScheduleCard.tsx`, `client/src/pages/LocationDetailPage.tsx`

#### PM Card: Tiered delete UX, Generate surfaces existing job (2026-02-10)

- **Tiered delete UX**: Default "Remove" button uses soft delete (`DELETE /api/recurring-templates/:id`, sets `isActive=false`). Schedule disappears from PM card (via `isActive` filter in `findPMTemplate`) but remains restorable from recurring templates admin. "Delete permanently..." link shown only for owner/admin roles — requires typing "DELETE" to confirm, calls `?hard=true`. Cascade verified safe: hard delete removes template + instances only; `jobs.recurrenceTemplateId` is a plain varchar (no FK), so jobs/job_parts/invoices are untouched.
- **Generate shows existing job (cross-template discovery)**: When "Generate This Month" returns 0 jobs created, searches PM templates for this location (including archived/soft-deleted) to find the existing PM job. Fixes bug where archive→recreate flow showed "No PM job needed" because the new template had no instances — the job was linked to the old archived template. Discovered job is stored in state so the "This month" row displays it as a fallback.
- **"This month" row always refreshed**: Instances cache invalidation moved to top of generate `onSuccess` so the row refreshes regardless of whether jobs were created or found cross-template.
- **"This month" row**: New inline row in the PM card showing current month's generated job status with a clickable link navigating to the job detail page. Shows "Not generated" if no job exists yet.
- **Preview job links**: Preview dialog now shows clickable job number links for instances that have generated jobs.
- **Instance type fix**: Fixed client-side instance type to match backend `InstanceWithJob` shape (`instanceDate`, nested `job` object) instead of incorrect flat fields.
- **Files changed**: `client/src/components/PMScheduleCard.tsx`, `CHANGELOG.md`

#### TeamMember type cascade — id: number → string (2026-02-10)

- **Root cause**: `TeamMember` interface in `useTechnicians.ts` declared `id: number`, but the API (`GET /api/team/technicians`) returns string UUIDs. This caused 17 TS errors across 10 files wherever `TeamMember.id` was used as a `SelectItem` value, Map key, or mutation argument.
- **Fix**: Changed `id: number` to `id: string`; made `firstName`, `lastName`, `status` optional (not guaranteed by API); added optional `roleId`, `isSchedulable`, `createdAt` fields used by consuming pages.
- **AddTimeEntryModal**: Changed `getTechName` param from `UserType` (full User schema) to `TeamMember` — the modal only needs the narrow hook type, not the full DB row.
- **TechnicianManagementPage**: Guarded `tech.createdAt` with optional fallback (API may not return it); removed unused local `Technician` interface that shadowed the hook type.
- **Files changed**: `client/src/hooks/useTechnicians.ts`, `client/src/components/time/AddTimeEntryModal.tsx`, `client/src/pages/TechnicianManagementPage.tsx`
- **No backend changes.** No runtime behavior changes — only TypeScript type corrections.

### Added

#### PM Scheduling Extension for Recurring Job Templates (2026-02-10)

- **Schema**: 6 new columns on `recurring_job_templates`: `months_of_year` (INT[]), `generation_mode` (TEXT, default 'phase'), `generation_day_of_month` (INT), `auto_schedule` (BOOL, default false), `scheduled_time_local` (TEXT), `include_location_pm_parts` (BOOL, default false). All backward-compatible with defaults.
- **Migration**: `migrations/2026_02_10_pm_scheduling_columns.sql` — additive ALTER TABLE with IF NOT EXISTS.
- **Zod schemas**: Both `insertRecurringJobTemplateSchema` and `updateRecurringJobTemplateSchema` accept new PM fields with validation (month 1-12, HH:MM format, cross-field rules).
- **Generation mode enum**: `generationModeEnum = ["phase", "period_start", "day_of_month"]` exported from `shared/schema.ts`.
- **PM occurrence computation**: New `computePmOccurrences()` in `server/domain/recurrence.ts` — month-by-month iteration with month-of-year filtering and day clamping.
- **Month filter for phase mode**: `filterByMonthsOfYear()` applies month restriction even to existing weekly/monthly phase patterns.
- **Auto-scheduling**: When `autoSchedule=true`, generated jobs get `scheduledStart`/`scheduledEnd` computed from `scheduledTimeLocal` + `defaultDurationMinutes` (fallback 60 min).
- **PM parts copy service**: New `server/services/pmJobParts.ts` — `copyLocationPMPartsToJob(companyId, locationId, jobId, tx?)` snapshots location PM part templates into `job_parts` with idempotency guard (skips if job already has parts). Accepts optional Drizzle transaction; wraps in its own transaction when called standalone. Uses efficient bulk INSERT (not N × createJobPart) since the target job is freshly generated and cannot be invoiced.
- **pmParts join extended**: `getLocationPMParts()` now includes `itemUnitPrice` from the `items` table JOIN.
- **Route validation**: POST/PATCH `/api/recurring-templates` validate cross-field constraints (generationDayOfMonth required for day_of_month mode, scheduledTimeLocal required when autoSchedule=true, monthsOfYear deduped).
- **Storage layer**: `createTemplate()` passes through all 6 new fields.
- **Day-of-month clamping**: `generationDayOfMonth=31` in February deterministically clamps to last day (28 or 29), no rollover.
- **Month restriction in phase mode**: Weekly/monthly templates with `monthsOfYear` set will only generate occurrences in those months.
- **Files changed**: `shared/schema.ts`, `server/domain/recurrence.ts`, `server/storage/recurringJobs.ts`, `server/storage/pmParts.ts`, `server/routes/recurringJobs.ts`, `server/services/pmJobParts.ts` (new), `migrations/2026_02_10_pm_scheduling_columns.sql` (new)

### Fixed

#### Tag delete error toast and stale UI (2026-02-10)

- **Root cause**: `apiRequest` in `client/src/lib/queryClient.ts` unconditionally called `response.json()` on success — 204 No Content responses (from DELETE endpoints) have no body, causing "Unexpected end of JSON input" error.
- **Fix (global)**: `apiRequest` now returns `undefined` for 204 / empty-body responses instead of attempting JSON parse. Prevents the same bug on any future DELETE endpoint.
- **Fix (optimistic UI)**: Tag delete mutation now uses `queryClient.setQueryData` to immediately remove the deleted tag from cache — item disappears instantly without waiting for refetch. Also clears inline-edit state if the deleted tag was being edited.
- **Files changed**: `client/src/lib/queryClient.ts`, `client/src/pages/TagsSettingsPage.tsx`

### Added

#### Manage Tags Settings Page (2026-02-10)

- **New page**: `client/src/pages/TagsSettingsPage.tsx` — admin page at `/settings/tags` for full tag CRUD (create, inline edit, delete with confirmation).
- **Features**: Tag name + 9-color picker for create/edit, live preview pill, inline editing with save/cancel, delete confirmation dialog with cascade warning, duplicate name validation, sorted alphabetically.
- **Settings card**: Added "Tags" card to `SettingsPage.tsx` (first position in grid) with Tag icon and description.
- **Route**: `/settings/tags` registered in App.tsx with `requireAdmin` protection.
- **Files changed**: `client/src/pages/TagsSettingsPage.tsx` (new), `client/src/pages/SettingsPage.tsx`, `client/src/App.tsx`, `CHANGELOG.md`

#### Tag Filtering for All Locations Page (2026-02-10)

- **Tag filter chips**: Added to `client/src/pages/Locations.tsx` — same UX pattern as Clients page. Clickable colored chips toggle tag filter on/off. Active chips show with full color + ring, inactive at 33% opacity.
- **AND logic**: Location must have ALL selected tags to be visible. Uses client-side filtering against the already-loaded `GET /api/tags/location-assignments` data — no new backend calls.
- **Performance**: `locationTagMap` (locationId → Set\<tagId\>) and `filteredLocations` computed via `useMemo`. Filtering, sorting, and selection all derive from the same memo chain.
- **Bulk edit compatibility**: "Select all" operates on filtered results. Bulk tag editing works correctly on the filtered subset.
- **Clear button**: Resets tag filter and shows all locations.
- **Files changed**: `client/src/pages/Locations.tsx`

#### Phase 2B: Bulk Tag Edit for Locations (2026-02-10)

- **Backend**: New `bulkUpdateLocationTags` method in `server/storage/clientTags.ts` — transactional, set-based inserts/deletes across multiple locations. Validates all location IDs and tag IDs belong to tenant.
- **API endpoint**: `POST /api/locations/bulk-tags` — accepts `{ locationIds, addTagIds, removeTagIds }`. Validates no overlap between add/remove lists. Registered before `/:id` param routes to avoid capture. Returns `{ updatedCount }`.
- **API endpoint**: `GET /api/tags/location-assignments` — returns all location tag assignments for the tenant (for list view tag pills).
- **BulkEditTagsModal generalized**: Added `entityType` prop (`"customerCompany"` | `"location"`) with config-driven endpoint, request body ID field, cache invalidation key, and display labels. Default `"customerCompany"` preserves backwards compatibility with Clients.tsx.
- **Locations.tsx page**: New `client/src/pages/Locations.tsx` — flat list of all service locations with location-level tag pills, checkbox selection, bulk action bar, and BulkEditTagsModal in location mode.
- **Route**: `/all-locations` registered in App.tsx before `/locations/:locationId`. "All Locations" button added to Clients page header for navigation.
- **Files changed**: `server/storage/clientTags.ts`, `server/routes/tags.ts`, `client/src/components/BulkEditTagsModal.tsx`, `client/src/pages/Locations.tsx` (new), `client/src/pages/Clients.tsx`, `client/src/App.tsx`, `CHANGELOG.md`

#### Phase 2A: Bulk Tag Edit for Clients (2026-02-10)

- **Backend**: New `bulkUpdateCustomerCompanyTags` method in `server/storage/clientTags.ts` — transactional, set-based inserts/deletes across multiple customer companies. Validates all IDs belong to tenant before proceeding.
- **API endpoint**: `POST /api/customer-companies/bulk-tags` — accepts `{ customerCompanyIds, addTagIds, removeTagIds }`. Validates no overlap between add/remove lists. Returns `{ updatedCount }`.
- **Clients.tsx row selection**: Checkbox column with header "select all visible" toggle. Selection count badge. Bulk action bar with "Bulk Edit Tags" and "Clear selection" buttons.
- **BulkEditTagsModal**: New `client/src/components/BulkEditTagsModal.tsx` — two-step modal:
  - Step 1 (Edit): Add/Remove tag pickers with search, inline tag creation (with color picker), overlap prevention between add/remove lists.
  - Step 2 (Review): Summary of changes (N clients, +X tags, -Y tags), preview of first 10 client names, Confirm & Apply / Back buttons.
- **Apply behavior**: On confirm, calls bulk endpoint, invalidates tag assignments cache, shows success toast, clears selection.
- **Files changed**: `server/storage/clientTags.ts`, `server/routes/tags.ts`, `client/src/pages/Clients.tsx`, `client/src/components/BulkEditTagsModal.tsx`, `CHANGELOG.md`

#### Phase 1B: Location Tags (2026-02-09)

- **Database schema**: New `location_tag_assignments` junction table (id, companyId, tagId, locationId, createdAt) with unique index on (companyId, locationId, tagId). Reuses existing `client_tags` table for tag definitions.
- **Migration**: `migrations/2026_02_09_location_tag_assignments.sql` — creates table with indexes for fast lookup by tenant+location and tenant+tag.
- **Storage layer**: Extended `ClientTagRepository` in `server/storage/clientTags.ts` with 3 new methods: `getTagsForLocation`, `updateLocationTags` (transactional bulk add/remove with tenant + location ownership validation), `getLocationTagAssignmentsByCompany` (for future list views).
- **API routes**: New `locationTagRouter` in `server/routes/tags.ts` — `GET /api/locations/:locationId/tags` (list tags for a location), `POST /api/locations/:locationId/tags` (add/remove tags with `{ addTagIds, removeTagIds }` payload).
- **EditTagsModal generalized**: Changed props from `customerCompanyId` to `entityType` + `entityId` to support both customer companies and locations. API URL and cache keys derived from entity type.
- **LocationDetailPage tag pills**: Colored tag pills in the header below status badges. Dashed "+ Add Tag" / "Edit" button opens EditTagsModal with `entityType="location"`.
- **No inheritance**: Location tags are fully independent from client tags — assigning a tag to a location does NOT affect client/company tag assignments.
- **Files changed**: `shared/schema.ts`, `server/storage/clientTags.ts`, `server/routes/tags.ts`, `server/routes/index.ts`, `client/src/components/EditTagsModal.tsx`, `client/src/pages/ClientDetailPage.tsx`, `client/src/pages/LocationDetailPage.tsx`, `CHANGELOG.md`
- **Migration file**: `migrations/2026_02_09_location_tag_assignments.sql`

#### Phase 1: Client Tags System (2026-02-09)

- **Database schema**: New `client_tags` table (id, companyId, name, color) with unique index on (companyId, name). New `client_tag_assignments` junction table (id, companyId, tagId, customerCompanyId) with unique index on (tagId, customerCompanyId).
- **Migration**: `migrations/2026_02_09_client_tags.sql` — creates both tables with indexes for fast lookup by tenant, customer company, and tag.
- **Storage layer**: New `server/storage/clientTags.ts` — `ClientTagRepository` with methods: `getTagsByCompany`, `createTag`, `updateTag`, `deleteTag`, `getTagsForCustomerCompany`, `updateCustomerCompanyTags` (transactional bulk add/remove with tenant validation), `getTagAssignmentsByCompany` (for list views).
- **API routes**: New `server/routes/tags.ts` — Tag CRUD (`GET/POST/PATCH/DELETE /api/tags`), bulk assignments endpoint (`GET /api/tags/assignments`), customer-company tag management (`GET/POST /api/customer-companies/:id/tags` with `{ addTagIds, removeTagIds }` payload). Duplicate name returns 409.
- **ClientDetailPage tag pills**: Colored tag pills in the header below the company subtitle. Dashed "+ Add Tag" / "Edit" button opens the EditTagsModal.
- **EditTagsModal**: New `client/src/components/EditTagsModal.tsx` — modal for managing tags on a customer company. Shows current tags as removable pills, search/filter existing tags, inline "Create" button with 9-color picker, keyboard Enter to create.
- **Clients list tag filter**: Tag filter chips above the client table in `Clients.tsx`. Click to toggle (AND filter — company must have ALL selected tags). "Clear" button resets. Tags column in the table shows assigned tag pills per company row. Uses `GET /api/tags/assignments` for efficient bulk loading.
- **Files changed**: `shared/schema.ts`, `server/storage/clientTags.ts` (new), `server/storage/index.ts`, `server/routes/tags.ts` (new), `server/routes/index.ts`, `client/src/components/EditTagsModal.tsx` (new), `client/src/pages/ClientDetailPage.tsx`, `client/src/pages/Clients.tsx`, `CHANGELOG.md`
- **Migration file**: `migrations/2026_02_09_client_tags.sql`

#### Location PM Parts: Row-Based Multi-Add Modal + Backend (2026-02-09)

- **Backend storage**: New `server/storage/pmParts.ts` — `PMPartRepository` with `getLocationPMParts` (LEFT JOIN to items for name/sku/category/cost) and `bulkUpsertPMParts` (transactional replace: soft-delete removed, upsert existing, insert new).
- **Backend routes**: New `server/routes/pm-parts.ts` — `GET /api/locations/:locationId/pm-parts` (list with item details) and `PUT /api/locations/:locationId/pm-parts` (bulk upsert with `{ parts: [{ productId, quantity }] }` payload). Registered at `/api/locations` in `routes/index.ts`.
- **Frontend modal rewrite**: `PartsSelectorModal.tsx` rewritten from two-panel picker to row-based multi-add UX. Each row has server-side search input (debounced 300ms, min 2 chars, calls `GET /api/items?q=TERM`), dropdown results, quantity input. "Add another part" button appends rows. Single "Save" submits all rows via bulk PUT. Duplicate detection with inline warning. Prefills existing parts on open.
- **Search fix**: Previous modal loaded full `/api/items` catalog and expected `{ items: Item[] }` but API returns raw array — search showed nothing. New modal uses per-row server-side search, correctly handling the API response shape.
- **LocationDetailPage**: Re-enabled PM parts query (`GET /api/locations/:id/pm-parts`, was `enabled: false`). Parts list now uses joined `itemName`/`itemSku` from the API response instead of a separate items query.
- **Files changed**: `server/storage/pmParts.ts` (new), `server/storage/index.ts`, `server/routes/pm-parts.ts` (new), `server/routes/index.ts`, `client/src/components/PartsSelectorModal.tsx`, `client/src/pages/LocationDetailPage.tsx`, `CHANGELOG.md`

#### ClientDetailPage: Notes Header "+ Add" Button (2026-02-09)

- **Notes header button**: Moved "+ Add Note" from NotesPanel body into the Notes card header on the Company/Client Detail page. Uses same `forwardRef`/`useImperativeHandle` pattern as LocationDetailPage — `notesPanelRef.current?.startAdding()` with `e.stopPropagation()` to avoid toggling the collapsible. Passes `hideAddButton` to suppress the internal button.
- **Files changed**: `client/src/pages/ClientDetailPage.tsx`, `CHANGELOG.md`

#### LocationDetailPage: Parts Card Styling + Notes Header Button (2026-02-09)

- **Parts card no scrollbar**: Removed `max-h-48 overflow-y-auto` from Location Parts card content — card now expands vertically to fit all parts, page scrolls instead.
- **Parts list dividers**: Replaced boxed rows (`rounded-lg border p-2`) with `divide-y` separator pattern for tighter, cleaner layout.
- **Notes "+ Add" in header**: Moved "+ Add Note" button from NotesPanel body into Notes card header (same pattern as Parts card). Uses `forwardRef` + `useImperativeHandle` on NotesPanel to expose `startAdding()`. Header button uses `e.stopPropagation()` to avoid toggling the collapsible.
- **NotesPanel ref API**: Added `NotesPanelRef` type export with `startAdding()` method; added `hideAddButton` prop to suppress internal button when parent provides its own.
- **Files changed**: `client/src/pages/LocationDetailPage.tsx`, `client/src/components/NotesPanel.tsx`, `CHANGELOG.md`

#### PM Parts Fixes: Query, Search, Dropdown Clipping (2026-02-09)

- **Parts not showing after save (root cause)**: `LocationDetailPage.tsx` pm-parts `useQuery` had no `queryFn`. The default `getQueryFn` uses `queryKey[0]` as the URL, which was just `"/api/locations"` — never reached the actual endpoint. Added explicit `queryFn: () => apiRequest(\`/api/locations/${locationId}/pm-parts\`)`.
- **Case-insensitive search**: `server/storage/items.ts` — changed `like` to `ilike` (Postgres ILIKE) so `?q=Ther` and `?q=ther` return the same results.
- **Dropdown clipping fix**: `PartsSelectorModal.tsx` — replaced absolute-positioned dropdown (clipped by parent `overflow-y-auto`) with inline results panel that participates in the scroll flow. Results render inside each row card with `max-h-52 overflow-y-auto`.
- **Modal sizing**: Dialog `max-w-4xl w-[95vw] max-h-[85vh]`; scroll area has `min-h-0` for proper flex containment.
- **Files changed**: `client/src/pages/LocationDetailPage.tsx`, `server/storage/items.ts`, `client/src/components/PartsSelectorModal.tsx`, `CHANGELOG.md`

#### Note Attachments + Visibility Flags + Scoped Notes Routes (2026-02-08)

- **Schema**: `client_notes.locationId` now nullable (NULL = company-wide note). Added `showOnJobs`, `showOnInvoices`, `showOnQuotes` boolean visibility flags.
- **New tables**: `files` (tenant-scoped file metadata) and `note_attachments` (join table linking notes to files, cascade delete).
- **File upload route**: `POST /api/uploads` — multipart/form-data, multer disk storage to `uploads/<companyId>/<fileId>`, 10 MB / 10 files max. CSRF-protected.
- **Secure file streaming**: `GET /api/files/:fileId` — tenant-scoped, streams from disk with correct Content-Type/Content-Disposition. No public static serving.
- **Location notes routes**: `GET/POST/PATCH/DELETE /api/locations/:locationId/notes` — strict locationId scoping, enriched with attachments, visibility flags support.
- **Company notes routes**: `GET/POST/PATCH/DELETE /api/companies/:companyId/notes` — WHERE locationId IS NULL, tenant guard.
- **Note attachments routes**: `POST/DELETE /api/notes/:noteId/attachments` — attach/detach files by fileId.
- **Back-compat**: Legacy `/api/clients/:clientId/notes` routes preserved (TODO: remove after migration).
- **Frontend NotesPanel component**: Reusable `<NotesPanel scope="location"|"company" />` with multi-file picker, visibility checkboxes (Jobs/Invoices/Quotes), image thumbnails, file download links, inline edit with flag toggles.
- **LocationDetailPage**: Notes card now uses `<NotesPanel>`, removed inline note state/mutations.
- **apiRequest FormData fix**: Skip auto-setting `Content-Type: application/json` when body is `FormData` (for multipart uploads).
- **Storage repos**: `FilesRepository`, `NoteAttachmentRepository` extending BaseRepository; `ClientNotesRepository` expanded with `listLocationNotes`, `listCompanyNotes`, `createCompanyNote`, `updateCompanyNote`, `deleteCompanyNote`.
- **Migration**: `migrations/2026_02_08_note_attachments.sql`
- **Files changed**: `shared/schema.ts`, `server/storage/clientNotes.ts`, `server/storage/files.ts` (new), `server/storage/noteAttachments.ts` (new), `server/storage/index.ts`, `server/routes/uploads.ts` (new), `server/routes/files.ts` (new), `server/routes/location-notes.ts` (new), `server/routes/company-notes.ts` (new), `server/routes/note-attachments.ts` (new), `server/routes/client-notes.ts`, `server/routes/index.ts`, `client/src/components/NotesPanel.tsx` (new), `client/src/pages/LocationDetailPage.tsx`, `client/src/lib/queryClient.ts`, `.gitignore`, `CHANGELOG.md`

#### ClientDetailPage: Replace bespoke notes with reusable NotesPanel (2026-02-09)

- **Schema**: Added `customerCompanyId` column to `client_notes` (nullable FK to `customer_companies`, cascade delete) for customer-company-level notes.
- **Migration**: `migrations/2026_02_09_customer_company_notes.sql` — adds column + partial index.
- **Storage**: Added `listCustomerCompanyNotes`, `createCustomerCompanyNote`, `updateCustomerCompanyNote`, `deleteCustomerCompanyNote`, `findRecentDuplicateForCustomerCompany`, and `assertCustomerCompanyOwned` to `ClientNotesRepository`. All join `users` for `createdByName` and enforce tenant isolation.
- **New route**: `server/routes/customer-company-notes.ts` — `GET/POST/PATCH/DELETE /api/customer-companies/:customerCompanyId/notes`. Tenant guard via `assertCustomerCompanyOwned`, enriched with attachments + createdByName, dedupe on POST, cascade-delete attachments on DELETE.
- **Route registration**: Mounted on `/api/customer-companies` in `server/routes/index.ts`.
- **NotesPanel**: Company scope now hits `/api/customer-companies/:id/notes` (was `/api/companies/:id/notes`). Query key updated to match.
- **ClientDetailPage**: Removed bespoke notes UI (state, query, 3 mutations, AlertDialog, Textarea). Replaced with `<NotesPanel scope="company" companyId={companyId} />` inside collapsible card matching LocationDetailPage style. Notes now support multi-file attachments, visibility flags (Jobs/Invoices/Quotes), and "Added by {name} · {timestamp}" footer.
- **Files changed**: `shared/schema.ts`, `server/storage/clientNotes.ts`, `server/routes/customer-company-notes.ts` (new), `server/routes/index.ts`, `client/src/components/NotesPanel.tsx`, `client/src/pages/ClientDetailPage.tsx`, `CHANGELOG.md`

#### Notes: Show author name, remove duplicate heading (2026-02-09)

- **API**: `listLocationNotes` and `listCompanyNotes` now join `users` table to return `createdByName` on each note.
- **NotesPanel**: Removed duplicate inner "Notes" heading (card header already provides it). Note footer now reads "Added by {name} · {date/time}" instead of just the timestamp.
- **Files changed**: `server/storage/clientNotes.ts`, `client/src/components/NotesPanel.tsx`, `CHANGELOG.md`

### Changed

#### Location Detail Page — Contacts view-only, remove Billing Settings, reorder right column (2026-02-08)

- **Contacts card moved to top** of right column and expanded by default; shows only location-scoped contacts (no inherited company contacts).
- **View-only contacts** — removed all "Add Contact" actions from this page; empty state links to the client page for contact management.
- **Billing Settings card removed** — handled via Edit Location modal instead. Removed `billingOpen` state, `toggleBillWithParentMutation`, and `Switch` import.
- **Right column reordered**: Contacts → PM Schedule → Location Parts → Notes → Equipment.
- **Default collapse states**: `contactsOpen=true`, all others `false` (notes was previously `true`).
- **Dead code cleanup**: removed unused `Pencil` import.
- **Files changed**: `client/src/pages/LocationDetailPage.tsx`, `CHANGELOG.md`

### Fixed

#### Contact Edit — Transactional Association Replace (2026-02-08)

- **Root cause** — PATCH endpoint only updated a single `client_contacts` row. When a person had multiple location associations, the frontend sent parallel PATCHes but could not add new locations, remove unchecked locations, or switch between company-wide and location-specific modes.
- **Storage layer** — Added `replacePersonContacts()` to `ClientContactRepository` using `db.transaction()`. Atomically deletes all existing rows (by ID list, tenant-scoped) then inserts new rows for the desired association state.
- **PATCH route upgraded** — `PATCH /api/customer-companies/:companyId/contacts/:contactId` now accepts optional `association` + `existingContactIds` fields. When present, uses transactional replace instead of single-row update. Returns split `{ companyContacts, locationContacts }` matching GET format.
- **Frontend mutation rewritten** — `updateContactMutation` now sends a single PATCH with full association payload and all existing row IDs, instead of parallel per-row PATCHes. Awaits `refetchQueries` after success for immediate UI consistency.
- **Backward compat** — Simple single-row PATCH (without association field) still works for legacy callers.
- **Files changed**: `server/storage/clientContacts.ts`, `server/routes/customer-companies.ts`, `client/src/pages/ClientDetailPage.tsx`

### Changed

#### Phase 5: Per-Location Roles in Contact Modal (2026-02-07)

- **Per-association role toggles** — Replaced global `isBilling`/`isScheduling` checkboxes with per-association `RoleFlags` (`{ billing, scheduling }`). New `AssociationState` discriminated union: `{ type: "company"; companyRoles }` or `{ type: "locations"; locationRolesById }`. Each location in the modal now has its own Billing/Scheduling checkboxes.
- **Edit prefill from PersonGroup** — `openEditContact` now accepts a `PersonGroup` instead of a raw `ClientContact`, reconstructing `companyRoles` or `locationRolesById` from all existing associations.
- **Create payload: per-location roles** — `createContactMutation` sends `association.locations[]` with per-location `roles` arrays (e.g., one location gets `["billing"]`, another `["scheduling"]`).
- **Edit payload: parallel PATCH** — `updateContactMutation` in locations mode PATCHes each association row with its own roles via parallel API calls.
- **Backend: new Zod schema field** — `contactFieldsSchema.association.locations[]` accepts `{ locationId, roles }` entries. POST handler prefers `locations[]` (per-location roles) over `locationIds[]` (legacy uniform roles).
- **Backward compat** — Legacy `locationIds[]` + global `roles` still works for older clients.
- **Files changed**: `client/src/pages/ClientDetailPage.tsx`, `server/routes/customer-companies.ts`

#### Contacts Card — Full Person-Level Dedup + Accordion Associations (2026-02-07)

- **Rewrote contact grouping** — New `peopleGroups` useMemo with `Assoc`/`PersonGroup` types. Grouping key uses prefixed namespace: `e:email` > `p:phone-digits` > `n:first|last` > `id:id`. `upsert` pattern merges base fields (phone/email/isPrimary) and accumulates per-association roles.
- **One row per person** — List maps exclusively over `peopleGroups`. All raw `companyContacts.map` / `locationContacts.reduce` patterns removed. Nadeem appears once, Jad appears once.
- **Collapsed row** — Name, Primary badge, Company badge (if company-wide), location summary badge ("Home" if 1 location, "Home +1" if 2+), phone/email inline. Clickable `<button>` toggles accordion.
- **Expanded associations** — Shows ALL associations: Company first, then locations alphabetically. Each row: fixed-width label + role badges (Billing, Scheduling). "No roles" fallback.
- **Sorted output** — Primary contacts first, then alphabetical by name. Associations sorted company-first then alpha.
- **Kebab menu (⋯)** — Edit/Delete using `primaryAssociationId` (prefers company-wide record). Menu is outside the `<button>`, no stopPropagation needed. Edit calls `openEditContact`, Delete triggers existing AlertDialog.
- **Dead code cleanup** — Removed unused `User` icon import.
- **Files changed**: `client/src/pages/ClientDetailPage.tsx`

#### Contact Save — Route Verification, CSRF Validation, Query Invalidation (2026-02-07)

- **Verified POST route mounting** — `POST /api/customer-companies/:companyId/contacts` confirmed reachable (403 without CSRF token, 401 with token but no auth). Route was already registered in `server/routes/index.ts` at `/api/customer-companies`.
- **Verified CSRF flow** — `csurf` middleware applied globally to `/api` before route registration. Frontend `apiRequest` lazily fetches CSRF token via `getCSRFToken()`, sends `x-csrf-token` header, and auto-retries on CSRF errors (403 EBADCSRFTOKEN).
- **Fixed TS errors** — `association` and `locationIds` were possibly undefined after Zod `.default()`. Added explicit runtime fallbacks in POST handler.
- **Improved query invalidation** — After contact create/update/delete, now invalidates both company-level (`/api/customer-companies/:id/contacts`) AND all location-level (`/api/clients/:locId/contacts`) queries so LocationDetailPage reflects changes immediately.
- **Files changed**: `server/routes/customer-companies.ts`, `client/src/pages/ClientDetailPage.tsx`

#### Contact Management — Association Selector, Location Contacts, Unified Modal (2026-02-07)

- **Association selector on Add Contact modal** — Contacts can now be assigned to "Company (all locations)" or "Specific location(s)" with a multi-select checkbox list. POST endpoint creates one row per selected location when `association.type === "locations"`.
- **Unified Add/Edit Contact modal** — Replaced three separate dialogs (add, edit, delete) with a single configurable modal (`contactModalMode: "add" | "edit"`) plus a delete AlertDialog. Edit pre-fills all fields including association type.
- **Location Contacts section on ClientDetailPage** — Contacts linked to specific locations now appear grouped by location below Company Contacts, with edit/delete actions per contact.
- **LocationDetailPage contacts** — Added a "Contacts" collapsible card in the right column showing location-specific contacts and inherited company-level contacts (with "Inherited" label). Links to company page for adding new contacts.
- **Backend: association-aware POST** (server/routes/customer-companies.ts) — `POST /api/customer-companies/:id/contacts` now accepts `association: { type: "company" | "locations", locationIds: string[] }`. Creates multiple rows for multi-location assignment. PATCH supports `locationId` changes.
- **Files changed**: `client/src/pages/ClientDetailPage.tsx`, `client/src/pages/LocationDetailPage.tsx`, `server/routes/customer-companies.ts`, `server/storage/clientContacts.ts`

#### ClientDetailPage — Fix Name Bug & Full Contact Management (2026-02-07)

- **Bug fix: Client name disappears after navigation** — `companyName` went blank when navigating to a location and returning because the overview query re-fetched and `parentCompany?.name` was temporarily `undefined` while `client.companyName` was empty (client fetched as CustomerCompany which uses `.name`). Fixed with a robust fallback chain: `parentCompany?.name || client.companyName || client.name || client.displayName || "Unnamed Client"`. Added `placeholderData: keepPreviousData` to the overview query to prevent flicker during navigation.
- **Company Contacts section with full CRUD** — Replaced the read-only contacts card with an interactive "Company Contacts" section directly on the detail page (not inside Edit Company modal). Shows each contact with name, role badges (billing/scheduling), phone, email. Hover reveals Edit/Delete actions. "Add Contact" button opens a dialog with first/last name, phone, email, billing/scheduling checkboxes. Validation: requires (first or last name) AND (phone or email).
- **New API endpoints** (server/routes/customer-companies.ts):
  - `POST /api/customer-companies/:id/contacts` — create a single contact with Zod validation
  - `PATCH /api/customer-companies/:id/contacts/:contactId` — update contact fields, validates merged state
  - `DELETE /api/customer-companies/:id/contacts/:contactId` — delete single contact
- **New storage methods** (server/storage/clientContacts.ts): `getContactById`, `createContact`, `updateContact`, `deleteContact` — all tenant-scoped
- **Cleanup**: Removed unused imports (Tabs, Building2, MapPin, Settings, useSearch, useEffect)
- **Files changed**: `client/src/pages/ClientDetailPage.tsx`, `server/routes/customer-companies.ts`, `server/storage/clientContacts.ts`

#### NewClientPage Jobber-Style Rewrite (2026-02-07)

- **Complete UI rewrite** to Jobber-like density with placeholder-based inputs (no stacked labels)
- **Layout**: 2-pane `grid-cols-[480px_1fr]`, max-w-[1600px], Cancel/Save in top-right header
- **Left card ("Client")**: First/Last name always visible, Company Name with dynamic placeholder (`*` when checkbox on, `optional` when off), "Saved as" preview in person mode, billing address, company contacts
- **Right card ("Locations")**: Segmented tab strip, "Location details" editor with 2-column grid, "Copy billing address" button replaces same-as-billing toggle, location contacts with Billing/Scheduling role toggles
- **Simplified data model**: `AddressForm` extracted as nested type, `LocationForm` flattened (phone/email at top level), roles reduced to `billing | scheduling` (primary contact handled separately via dedicated first/last fields)
- **Contact draft pattern**: `ContactEditor` component with Save/Cancel, save disabled until any field filled, no editing existing contacts (add-only + delete), separate `companyDraft`/`locDraft` state
- **Removed**: Maintenance schedule, same-as-billing Switch, Label components for most fields, DropdownMenu on locations (replaced with Remove button), inline contact editing
- **API shape preserved**: Payload still matches `/api/clients/full-create` with company, primaryLocation, additionalLocations, contacts arrays
- **Files changed**: `client/src/pages/NewClientPage.tsx`

#### NewClientPage UX Fixes — Contacts Draft, Segmented Tabs, Spacing (2026-02-07)

- **Contacts draft pattern**: "Add contact" now opens a draft editor that does NOT create an entry until Save. Save disabled until first/last name provided. Esc key or clicking away discards the draft. Applies to both company and location contacts. No more "Unnamed" contacts.
- **ContactInlineEditor**: Added `canSave`/`isDraft` props; shows "New contact" header + X (cancel) for drafts, "Edit contact" + Trash (delete) for existing. Save button disabled when `!canSave`.
- **ContactsSection**: Changed from `onAdd: () => void` to `onCommit: (contact) => void`. Draft state managed internally with blur/Esc discard. `useEffect` clears draft when `editingId` changes cross-section.
- **Location tabs**: Replaced pill-style selector with segmented tab strip (`rounded-lg border bg-muted/30 p-1`). Selected tab: `bg-background shadow-sm border`. Never shows "Unnamed" — falls back to "Location 1", "Location 2", etc.
- **Add location UX**: Auto-selects new tab, scrolls tab strip into view, focuses Location Name input via `requestAnimationFrame` + ref.
- **Spacing**: Grid `440px_1fr gap-8`, card content `space-y-6`, sections `space-y-3`, City/Province/Postal `grid-cols-[2fr_1fr_1fr] gap-4`
- **Company card person mode**: Checkbox correctly toggles Company Name vs First/Last fields; "Saved as" preview appears under name fields in both modes
- **Files changed**: `client/src/pages/NewClientPage.tsx`

#### NewClientPage Layout & Spacing Polish (2026-02-07)

- **Page width**: Increased max-width from 1200px to 1320px
- **Grid**: Changed to `lg:grid-cols-[420px_1fr]` (fixed left, fluid right)
- **Locations card**: Replaced vertical location list with horizontal scrollable "location pills" selector row (pill per location, primary dot indicator, selected pill highlighted)
- **Location editor**: Added "Location details" header with overflow menu (Set as primary / Delete); editor now uses 2-column grid — left: name, same-as-billing, address fields; right: phone/email, maintenance schedule, contacts
- **Removed** internal "Primary Location" heading from locations card
- **Company card**: Improved empty contacts state with bordered dashed placeholder box
- **Footer**: Full-width anchored bar with top border (`-mx-6 px-6 py-4 border-t`)
- **Files changed**: `client/src/pages/NewClientPage.tsx`

#### New Client Flow — Contacts, Name Source, Card-Based UI (2026-02-07)

**Data Model & API:**
- **Removed** "Legal Name" field from New Client form (UI + payload)
- **Added** `nameSource` column to `customer_companies` table (`'company'` or `'person'`) to preserve naming intent
- **Added** `client_contacts` table for multiple contacts per customer company or per location
  - `location_id` nullable: NULL = company-level contact, set = location-specific contact
  - Role flags stored as text array: `billing`, `scheduling`, `general`, `primary`
  - `is_primary` boolean flag
- **Added** `GET /api/clients/:clientId/contacts` endpoint
- **Added** `POST /api/clients/full-create` now accepts `contacts` array and persists via `clientContactRepository`
- **Added** `server/storage/clientContacts.ts` — new repository with `createContacts`, `getCompanyContacts`, `getLocationContacts`, `getAllContactsForCustomerCompany`, `deleteContactsByCustomerCompany`

**UI Redesign (NewClientPage.tsx):**
- **Redesigned** as two-column card layout: `grid gap-6 lg:grid-cols-[1fr_1.2fr]`
- **LEFT CARD ("Company")**: "Use company name as client name" checkbox (default on), conditional Company Name / First+Last fields, "Saved as" preview pill, phone/email, billing address, company-level contacts with compact display rows + inline editor
- **RIGHT CARD ("Locations")**: Clickable location list with Primary/Billing badges, contact counts, overflow menu (Set as primary / Delete) + location editor panel with name, same-as-billing address switch, phone/email, location contacts, PM schedule
- **Contact display**: `ContactDisplayRow` (compact read-only: name, muted email/phone, role Badge pills, edit/delete icons) ↔ `ContactInlineEditor` (edit mode with first/last, email/phone, role checkboxes, done/delete buttons)
- **Contacts reusable**: `ContactsSection` component manages display/edit toggle via single global `editingContactId`
- **Location primary swap**: `setAsPrimary(id)` demotes current primary to additional, promotes selected
- **Same-as-billing**: UI-only toggle on locations; address resolved from billing values at submit time
- **Save validation**: Save button disabled unless company/person name valid and at least one location exists
- **Form loads blank** — no placeholder/demo values
- **Files changed**: `client/src/pages/NewClientPage.tsx`, `server/routes/clients.ts`, `server/storage/clientContacts.ts` (new), `server/storage/customerCompanies.ts`, `server/storage/index.ts`, `shared/schema.ts`
- **Migration**: `migrations/2026_02_07_add_client_contacts_and_name_source.sql`

#### JobDetailPage Visit-Level Enhancements (2026-02-07)

- **Removed** `AssignTechnicianDialog` and "Assign Technician" button — technician assignment is visit-level only
- **Replaced** `<JobVisitsSection>` in middle column with compact inline visits list (single-line rows: date/time + tech + status pill)
- **Visits collapse**: Shows first 3 visits by default; "Show all visits (N)" toggle for >3; internal scroll only when expanded
- **Added** `VisitDetailDialog` — click any visit row to view full details (status, date, technician, duration, notes, check-in/out times)
- **Visit dialog actions**: Quick "Complete" button for scheduled visits, "More Actions" dropdown with Delete
- **Visit sort order**: Active visits first, then by date descending (newest first)
- **Right column**: Removed job-level "Scheduled" date with calendar popover; replaced with read-only "Created" (createdAt) and "Completed" (closedAt) dates
- **Removed**: `updateScheduleMutation`, `handleDateSelect`, `datePopoverOpen` state, `Popover`/`CalendarPicker` imports
- **Fixed** `SelectItem value=""` in `AddVisitDialog` — replaced with `"__unassigned__"` sentinel (Radix Select rejects empty string values)
- **Fixed** visit modal infinite loading — VisitDetailDialog only mounts when `selectedVisitId` is set; stable query key `["visit-detail", visitId]`
- **Added reschedule rule**: When scheduling a follow-up, checks for existing non-completed active visits. Empty drafts (no tech/notes/status changes) can be deleted; other visits can be cancelled or user can schedule anyway
- **Files changed**: `client/src/pages/JobDetailPage.tsx`, `client/src/components/AddVisitDialog.tsx`

#### JobDetailPage 2-Tier Layout Redesign (2026-02-07)

- **Goal**: Consolidate JobDetailPage top section into unified meta card, tighten layout
- **Top section** — replaced 3-card row (JobHeaderCard, JobAssignmentsCard, JobMetaCard) + standalone JobDescriptionCard with a single unified container using `grid-cols-[2fr_1.5fr_1fr]`:
  - **Left column**: JobHeaderCard (border-stripped via `[&_.shadcn-card]` selector), inline description, "Assign Technician" button
  - **Middle column**: JobVisitsSection (scrollable, `calc(100vh - 16rem)` max height, defaultOpen=true)
  - **Right column**: Inline status stack — Job#, Invoice link, Status dropdown, scheduled date with calendar popover, on-hold info
- **Scheduled date popover**: Click date → CalendarPicker opens → pick new date (preserves existing time, respects ALL DAY convention) → saves immediately. "Clear date" button to unset scheduledStart.
- **Status dropdown**: Replicates JobMetaCard logic — compound values (`open:in_progress`, `open:on_hold`), intercepts on_hold to open ActionRequiredModal
- **Main grid**: Changed from `grid-cols-[7fr,3fr]` to `grid-cols-[3fr_1fr]`
  - Left: Parts & Billing, Expenses, Recurring (unchanged)
  - Right sidebar reordered: Labour, Notes, Equipment, StatusTimeline, SchedulingHistory, Activity
  - Visits removed from sidebar (moved to top middle column)
- **Removed components**: JobDescriptionCard function (~118 lines deleted), JobAssignmentsCard import, JobMetaCard import
- **Fixed**: AssignTechnicianDialog tech.id number→string type mismatch (pre-existing from useTechniciansDirectory hook)
- **Fixed**: handleMetaStatusChange double-mutation for sub-status changes (removed redundant updateStatusMutation.mutate call)
- **File changed**: `client/src/pages/JobDetailPage.tsx`

#### Supplier Detail Page Tightening (2026-02-07)

- **Goal**: Make the Supplier Details page more compact and visually cleaner
- **Left column (Supplier Information)**:
  - Removed duplicate Phone input field (was rendered twice)
  - Removed "Primary Address" box entirely — address lives in the Locations table
  - Removed Website field from form state and UI
  - Email/Phone now fall back to primary location values when supplier record is blank
  - Final field order: Name, Email, Phone, Active toggle, QBO status
- **Right column (Locations table)**:
  - Replaced "Primary" text column header with blank icon-only column (w-70px)
  - Replaced "Active" text column header with blank icon-only column (w-60px)
  - Primary indicator is now a clickable star icon (filled when primary, outline otherwise)
  - Primary star uses optimistic cache update for instant visual feedback + rollback on error
  - Active indicator is now a small dot (green=active, gray=inactive)
  - Removed "Set Primary" button and "Primary" badge — star icon replaces both
- **Notes support for Supplier Locations**:
  - Added `notes` text column to `supplier_locations` table (`shared/schema.ts`)
  - Added `notes` to `updateSupplierLocationSchema` validation
  - Added Notes textarea to AddLocationDialog and EditLocationDialog
  - Migration: `migrations/2026_02_07_add_notes_to_supplier_locations.sql`
- **Files changed**:
  - `client/src/pages/SupplierDetailPage.tsx`
  - `client/src/components/suppliers/AddLocationDialog.tsx`
  - `client/src/components/suppliers/EditLocationDialog.tsx`
  - `shared/schema.ts`

#### Standalone Clients Page (2026-02-07)

- **Goal**: Remove legacy `?tab=` navigation, create dedicated route for Clients
- **New pages**:
  - `pages/Clients.tsx`: Standalone clients list page using TablePageShell
- **Routing changes**:
  - Added `/clients` route pointing to Clients page
- **Sidebar updates** (`AppSidebar.tsx`):
  - Changed Clients from onClick (`/?tab=clients`) to href (`/clients`)
- **Removed legacy tab navigation**:
  - Dashboard.tsx: Removed `?tab=clients` handling and ClientListTable tab
  - Updated ClientDetailPage.tsx: Back links now use `/clients`
  - Updated Header.tsx, AppHeader.tsx: Clients navigation uses `/clients`
- **Note**: ClientListTable.tsx kept for backwards compatibility with examples

#### Settings Products Page Standardization (2026-02-07)

- **Goal**: Apply standardized color + surface system to existing Settings Products page (Jobs reference)
- **Consolidated duplicate headers**:
  - `pages/PartsManagementPage.tsx`: Simplified to thin wrapper with workspace background only
  - `components/ProductsServicesManager.tsx`: Added seed parts mutation (moved from page)
  - `components/products-services/ProductsServicesToolbar.tsx`: Now the single source for header/title
    - Updated typography: `text-xl` → `text-lg font-semibold text-foreground` (matches Jobs)
    - Added Seed Parts button with Sprout icon
- **Standardized table surface**:
  - `components/products-services/ProductsServicesTable.tsx`:
    - Changed wrapper from `div` with border to `<ListSurface>`
    - Updated thead to use `bg-white dark:bg-gray-900` with explicit border colors
    - Updated row styling: `hover:bg-gray-100/60 dark:hover:bg-gray-800/60 transition-colors border-b border-gray-200 dark:border-gray-800`
- **3-layer surface model applied**:
  - Workspace: `bg-gray-200 dark:bg-gray-900`
  - Content surface: `<ListSurface>` (white/gray-900 with shadow-sm)
  - Row hover: standardized gray-100/60 / gray-800/60
- **Removed mistakenly created pages**:
  - Deleted `pages/Products.tsx` and `pages/Services.tsx` (top-level pages created in error)
  - Removed Products and Services from sidebar navigation
  - Removed `/products` and `/services` routes from App.tsx
  - Settings Products page (`/settings/products`) remains the canonical products management UI

#### TablePageShell Component - Consistent Page Width/Spacing (2026-02-07)

- **Goal**: Standardize page width, padding, and spacing across Jobs, Invoices, Quotes, Clients
- **Reference**: Jobs.tsx wrapper (`p-6 space-y-6`) used as source of truth
- **New file: `components/ui/table-page-shell.tsx`**:
  - `TablePageShell` - Reusable page wrapper component
  - Props: `title` (string), `actions` (ReactNode), `children`
  - Applies consistent `p-6 space-y-6` wrapper classes
  - Renders standardized page header row: title + actions
- **Refactored pages to use TablePageShell**:
  - `Jobs.tsx`: Uses shell (ensures shell matches Jobs exactly)
  - `InvoicesListPage.tsx`: Removed `max-w-[1400px] mx-auto` to match Jobs width
  - `Quotes.tsx`: Removed `max-w-[1400px] mx-auto` to match Jobs width
  - `ClientListTable.tsx`: Changed from `p-4 pt-3 space-y-3` to `p-6 space-y-6`
  - `SuppliersListPage.tsx`: Removed `max-w-[1400px] mx-auto` to match Jobs width

#### Reusable List Surface Primitives (2026-02-07)

- **Goal**: Create reusable primitives for list/table surfaces, reduce repeated class strings
- **New file: `components/ui/list-surface.tsx`**:
  - `ListSurface` - Container component: `rounded-lg bg-white dark:bg-gray-900 overflow-hidden shadow-sm`
  - `ListRow` - Row component for non-table lists with hover, borders, padding
  - `listSurfaceClass` - Raw class string for container styling
  - `tableRowClass` - Raw class string for table rows: `cursor-pointer hover:bg-gray-100/60 dark:hover:bg-gray-800/60 transition-colors border-b border-gray-200 dark:border-gray-800 last:border-b-0`
  - `listRowClass` - Raw class string for list rows (same as tableRowClass minus cursor)
- **Refactored pages to use primitives**:
  - `Jobs.tsx`: Uses `ListSurface` + `tableRowClass`
  - `InvoicesListPage.tsx`: Uses `ListSurface` + `tableRowClass` with cn() for compact mode
  - `Quotes.tsx`: Uses `ListSurface` + `tableRowClass`
  - `ClientListTable.tsx`: Uses `ListSurface` + `tableRowClass`

#### Typography and Header Standardization (2026-02-07)

- **Goal**: Consistent typography and table headers across all list pages
- **components/ui/table.tsx**:
  - `TableHeader`: Added explicit border color `border-gray-200 dark:border-gray-800`
  - `TableHead`: Updated to `text-xs font-medium uppercase tracking-wide text-muted-foreground` (Option A - clean + modern)
  - Reduced header height from `h-12` to `h-10` for tighter look
- **Page Titles** (all now use `text-lg font-semibold text-foreground`):
  - `Jobs.tsx`: Added page header with title + New Job button
  - `InvoicesListPage.tsx`: Changed from `text-2xl` to `text-lg`
  - `Quotes.tsx`: Changed from `text-2xl` to `text-lg`
  - `ClientListTable.tsx`: Changed from `text-2xl font-bold` to `text-lg font-semibold`

#### Global List Surface Standardization (2026-02-07)

- **Goal**: Apply Dashboard flat-row design to all table/list views
- **Jobs.tsx**:
  - Replaced Card wrapper with `rounded-lg bg-white dark:bg-gray-900 overflow-hidden shadow-sm`
  - Updated TableRow hover from `hover-elevate` to `hover:bg-gray-100/60 dark:hover:bg-gray-800/60`
  - Added `border-b border-gray-200 dark:border-gray-800 last:border-b-0` to rows
- **InvoicesListPage.tsx**:
  - Same container and hover updates as Jobs
  - Kept stats cards unchanged (they're not list rows)
- **Quotes.tsx**:
  - Same container and hover updates as Jobs
- **ClientListTable.tsx**:
  - Replaced `rounded-md border` with `rounded-lg bg-white dark:bg-gray-900 overflow-hidden shadow-sm`
  - Updated hover from `hover:bg-muted/50` to `hover:bg-gray-100/60 dark:hover:bg-gray-800/60`
  - Added consistent border-b dividers

#### Dashboard Visual Polish & Promotion (2026-02-06)

- **Goal**: Promote polished dashboard, unified frame color, company branding
- **App.tsx**:
  - Header and wrapper now use `bg-gray-200 dark:bg-gray-900` to match workspace
  - Added company name display in header (`text-base font-semibold text-foreground`), hidden on technician pages
  - Removed `/dashboard-preview-2` route (preview promoted to production)
  - Removed `DashboardPreview2` import
- **AppSidebar.tsx**:
  - Removed "Preview 2" menu item
- **Dashboard.tsx** (formerly DashboardPreview2.tsx):
  - Renamed from `DashboardPreview2.tsx` → `Dashboard.tsx`
  - Renamed export from `DashboardPreview2` → `Dashboard`
  - **TasksPanel**: Active/Completed tabs, Technician filter, Type filter
  - **NeedsAttentionWidget**: Flat rows, "Overdue" badge right-aligned with `mt-0.5`, no counter in header
  - **InvoicesWidget**: Flat rows, "Past due" badge right-aligned above amount, no counter in header
  - All rows use `hover:bg-gray-100/60 dark:hover:bg-gray-800/50` for visible hover
- **Deleted**: `client/src/pages/Dashboard.tsx` (old version)

#### 6-Digit Job Numbers and Search Improvements (2026-02-06)

- **Goal**: Better numeric search ordering (invoices first) + 6-digit job numbers for scalability
- **Search Ordering (`server/storage/search.ts`)**:
  - Invoice search now runs BEFORE job search for numeric queries
  - Invoice exact matches ranked above prefix matches via `ORDER BY CASE`
  - `interleaveResults()` now accepts optional `typeOrder` param for numeric queries
  - For numeric searches: `["invoice", "job", "customerCompany", "location", "supplier"]`
- **Frontend Group Ordering (`client/src/components/UniversalSearch.tsx`)**:
  - Added `TYPE_ORDER` constant for stable group display: invoice > job > customerCompany > location > supplier
  - `orderedTypes` filters TYPE_ORDER to only types with results
  - `flatResults` now uses `orderedTypes.flatMap()` so keyboard navigation matches visual order
  - Searching "1001" now shows INVOICES section first, with Invoice #1001 at top
- **6-Digit Job Numbers**:
  - Schema default changed from `10000` to `100000` (`shared/schema.ts`)
  - Hardcoded init values updated in `server/storage/jobs.ts` and `server/storage/invoices.ts`
  - Job number search logic updated for 6-digit range:
    - Exact match threshold: `>=6` digits (was `>=5`)
    - Prefix multiplier: `10^(6-digits.length)` (was `10^(5-digits.length)`)
    - Examples: `100` → 100000-100999, `1001` → 100100-100199, `100123` → exact
- **Migration (`migrations/2026_02_06_bump_job_numbers_to_6_digits.sql`)**:
  - Bumps existing companies with `next_job_number < 100000` to `100000`
  - Safe/idempotent: companies already at 6-digits are unaffected

#### Universal Header Rollout (2026-02-06)

- **Goal**: Single global header with UniversalSearch on all pages except auth pages
- **App.tsx Changes**:
  - Replaced old client-only search (Command dropdown) with `UniversalSearch` component
  - Removed old search state (`searchOpen`, `searchQuery`) and `/api/clients` query
  - UniversalSearch now visible on technician pages (`/technician`, `/daily-parts`)
  - "New" dropdown and Settings button remain hidden on technician pages
  - Overdue jobs alert behavior unchanged (still hidden on technician pages)
  - Removed unused imports: `Search`, `Command*`, `Popover*`
- **Page Cleanup**:
  - `ManageTeam.tsx`: Removed duplicate `<AppHeader />` - now uses global header
  - `TechnicianDashboard.tsx`: Removed duplicate `<AppHeader />` and `FeedbackDialog`
- **Dead Code**: `Header.tsx` and `AppHeader.tsx` components are now unused (previously used by removed page headers)
- **Note**: Page-level `<header>` tags in `ClientDetailPage.tsx` and `LocationDetailPage.tsx` are page title sections (breadcrumbs + actions), not navigation headers - intentionally kept

### Fixed

- **Search auth guard** (`server/routes/search.ts`): Added explicit auth guard to fail fast with 401 for unauthenticated requests instead of hanging on missing `companyId`

### Added

#### Dashboard Preview 2 - Frame Contrast + Flat Lists (2026-02-06)

- **Feature**: Design polish of cloned Dashboard.tsx (not a redesign)
- **File**: `client/src/pages/DashboardPreview2.tsx`
- **Route**: `/dashboard-preview-2`
- **Styling changes applied**:
  - **Frame contrast (TailPanel)**: `bg-gray-200` main content, sidebar/header stay unified white
  - **Flat list items**: Removed card-in-card pattern
    - `border-b border-gray-100` dividers between rows (not on last)
    - No individual row backgrounds or shadows
    - `hover:bg-gray-50` light hover
    - Preserved `border-l-4` colored status strips (red/amber/green)
  - **Card headers**: Separated header from list with `border-b`, footer with `border-t`
  - **Tasks panel**: Matches Needs Attention / Invoices with same flat row + divider behavior
- **Preserved exactly**: Layout, density, sections, all data hooks, no new sections
- **Note**: Original Dashboard.tsx completely unchanged

#### Universal Header Search (2026-02-04)

- **Feature**: Global search across jobs, invoices, customer companies, locations, and suppliers
- **Backend (`server/routes/search.ts`, `server/storage/search.ts`)**:
  - `GET /api/search?q=<query>&limit=<n>` endpoint
  - Returns typed results: `job | invoice | customerCompany | location | supplier`
  - Each result includes: `type`, `id`, `title`, `subtitle`, `match` (match type indicator)
  - Matching priority: job/invoice numbers (exact/prefix) → names/addresses → email → phone
  - Phone normalization: strips non-digits for flexible matching
  - Invoice number handling: supports `INV-22019`, `22019`, `220` prefix
  - Tenant isolation: all queries scoped by `companyId`
- **Indexes (`migrations/2026_02_04_add_search_trgm_indexes.sql`)**:
  - `pg_trgm` extension for fuzzy text search
  - GIN trigram indexes on: `customer_companies.name`, `client_locations.company_name`, `client_locations.address`, `jobs.summary`, `suppliers.name`
  - B-tree indexes on: `jobs(company_id, job_number)`, `invoices(company_id, invoice_number)`
- **Frontend (`client/src/components/UniversalSearch.tsx`)**:
  - Replaces old client-only search in Header
  - 200ms debounce, grouped dropdown by type
  - Keyboard navigation: `↑↓` navigate, `Enter` select, `Esc` close
  - Routes on selection: jobs, invoices, customers, clients, suppliers
- **Tests (`tests/search.test.ts`)**:
  - 19 tests covering: job/invoice number search, name/address/email/phone matching, tenant isolation

### Changed

#### Centralized calendar invalidation helpers to reduce unnecessary refetches (2026-02-03)

- **Goal**: Reduce duplicate React Query invalidations after calendar/visit mutations
- **Centralized Helpers Added** (`useCalendarApi.ts`):
  | Helper | Invalidates | Use Case |
  |--------|-------------|----------|
  | `invalidateCalendarQueries` | `/api/calendar`, `/api/calendar/range` | reschedule, complete (job stays on calendar) |
  | `invalidateCalendarAndUnscheduledQueries` | Above + `/api/calendar/unscheduled` | schedule, unschedule (job moves between calendar/backlog) |
  | `invalidateJobQueries` | `/api/jobs`, `/api/jobs/{jobId}` | All mutations that change job data |
  | `invalidateVisitQueries` | `/api/jobs/{jobId}/visits/*` | Mutations that affect job visits |
- **DEV-only Logging**:
  - Logs which query keys are invalidated per operation with timestamps
  - Warns if same key is invalidated twice within a single operation (duplicate detection)
  - Gated by `process.env.NODE_ENV === "development"`
- **Hooks Updated to Use Centralized Helpers**:
  - `useScheduleJob()` - calendar + unscheduled + jobs
  - `useRescheduleJob()` - calendar only + jobs (NOT unscheduled - job stays on calendar)
  - `useUnscheduleJob()` - calendar + unscheduled + jobs + visits
  - `useCompleteJob()` - calendar only + jobs (NOT unscheduled)
- **Components Migrated to Centralized Hooks/Helpers**:
  - `JobVisitsSection.tsx` - Now uses `useUnscheduleJob` hook instead of custom mutation
  - `AddVisitDialog.tsx` - Now uses centralized invalidation helpers
- **Invalidation Rules Enforced**:
  - schedule: calendar + unscheduled (job moves FROM backlog TO calendar)
  - reschedule: calendar only (job stays on calendar, just different slot)
  - unschedule: calendar + unscheduled (job moves FROM calendar TO backlog)
  - complete: calendar only (job stays on calendar, status changes)
- **Hard Stop Verified**:
  - No duplicate invalidation of same key within single operation
  - No regression in UI freshness (all necessary queries still invalidated)
- **Modified Files**:
  - `client/src/hooks/useCalendarApi.ts` - Added centralized helpers and DEV logging
  - `client/src/components/JobVisitsSection.tsx` - Switched to centralized hook
  - `client/src/components/AddVisitDialog.tsx` - Switched to centralized helpers

### Added

#### Calendar event cards: Visit #N display with deep link to job visits (2026-02-03)

- **Goal**: Display visit number on calendar cards with deep link to job detail visits section
- **Calendar Card Changes** (`DraggableClient.tsx`):
  - Shows "Visit #N" text when `visitNumber` is available in calendar event data
  - Added history icon button that navigates to Job Detail visits section
  - Deep link uses `?section=visits` query param to auto-expand visits collapsible
- **Server Changes** (ADDITIVE - no breaking changes):
  - `CalendarEventDto` now includes `visitId?: string` and `visitNumber?: number | null`
  - `server/storage/calendar.ts` - SQL query fetches `visit_number` from eligible job_visit
  - `server/routes/calendar.ts` - Transform includes visitId and visitNumber in response
- **JobDetailPage Deep Link Support**:
  - Parses `?section=visits` query parameter using `useSearch` from wouter
  - Passes `forceOpen` prop to JobVisitsSection to auto-expand when deep linked
- **JobVisitsSection Props Extended**:
  - Added `forceOpen?: boolean` prop for external control (deep link support)
  - useEffect syncs open state when forceOpen changes
- **Invariants Preserved**:
  - Existing calendar functionality unchanged - all fields are additive
  - Visit selection logic same as server: earliest future eligible, else most recent past
  - No changes to calendar write/schedule operations
- **Modified Files**:
  - `shared/types/calendar.ts` - Added visitId, visitNumber to CalendarEventDto
  - `server/storage/calendar.ts` - SQL fetches visit_number, interface updated
  - `server/routes/calendar.ts` - Transform includes visit info
  - `client/src/components/calendar/DraggableClient.tsx` - Visit #N display, history icon
  - `client/src/pages/JobDetailPage.tsx` - Deep link query param handling
  - `client/src/components/JobVisitsSection.tsx` - forceOpen prop for deep link support

#### "Schedule follow-up visit" button in JobVisitsSection (2026-02-03)

- **Goal**: Allow office users to schedule follow-up visits directly from the timeline
- **Button Location**: Top right of JobVisitsSection header (replaced "Add Visit")
- **Behavior**:
  - Always creates NEW visit via `POST /api/calendar/schedule` (preserves old visits)
  - Defaults technician from current eligible visit (same pattern as OfficeActionsStrip)
  - After scheduling, auto-scrolls to and highlights the new visit (green ring, 3s pulse)
- **AddVisitDialog Props Extended**:
  - `defaultTechnicianId?: string | null` - Pre-fills technician dropdown
  - `onVisitCreated?: (visitId: string) => void` - Callback for highlight/scroll
- **Server Response Enhanced**:
  - `POST /api/calendar/schedule` now returns `visit.id` in response for client highlighting
- **Hard Stop**: Follow-up always creates new `job_visits` row - never modifies existing visits
- **No New Endpoints**: Only existing endpoint response was enriched
- **Modified Files**:
  - `client/src/components/JobVisitsSection.tsx` - Added highlight state, scroll logic, renamed button
  - `client/src/components/AddVisitDialog.tsx` - Added defaultTechnicianId and onVisitCreated props
  - `server/routes/calendar.ts` - Added visit info to schedule response
  - `server/storage/calendar.ts` - Return visit info from scheduleJob

#### JobVisitsSection timeline tags for unambiguous visit eligibility (2026-02-03)

- **Goal**: Make it clear to office users which visit drives the job's calendar position
- **Timeline Tags Added**:
  | Tag | Meaning | Badge Style |
  |-----|---------|-------------|
  | CURRENT (mirrored) | Visit that syncJobScheduleFromVisits() picks | Primary (blue) |
  | UPCOMING | Future eligible visits after current | Light blue |
  | HISTORY | Not eligible for sync | Gray |
- **Eligibility Explanation**: Shows why history visits are not eligible:
  - `is_active=false` - Unscheduled via calendar
  - `status=completed` - Work finished
  - `status=cancelled` - Visit was cancelled
- **Eligibility Rules Match Server**: Uses same logic as `syncJobScheduleFromVisits`:
  - Eligible: `is_active=true AND status NOT IN ('completed','cancelled')`
  - Selection: earliest future visit, else most recent past visit
- **Section Headers Updated**: Explicit descriptions explaining what each section means
- **Tooltips Added**: Hover on tags to see detailed explanation
- **UI-only change**: No sync or calendar write logic modified
- **Modified Files**:
  - `client/src/components/JobVisitsSection.tsx` - Added timeline tags, tooltips, and section descriptions
  - `client/src/hooks/useJobVisits.ts` - Imported `isVisitIneligible` helper (already existed)

### Fixed

#### Safety: JobVisitsSection unschedule confirmation dialog (2026-02-03)

- **Goal**: Make unschedule from JobVisitsSection safe with explicit confirmation
- **Safety Rules Enforced**:
  1. Unschedule button only renders for CURRENT visit (`isCurrent && !inactive`)
  2. Uses canonical endpoint: `POST /api/calendar/unschedule/:jobId`
  3. Confirmation dialog required before execution
- **Confirmation Dialog Message**:
  > "This will remove the job from the calendar by setting is_active=false on the current visit. History is preserved."
- **Invalidations Verified** (all 4 required):
  - `["/api/jobs", jobId]` ✅
  - `["/api/jobs", jobId, "visits", "all"]` ✅
  - `["/api/calendar"]` ✅
  - `["/api/calendar/unscheduled"]` ✅
- **Hard Stop**: Unschedule never targets a non-current visit (enforced by `isCurrent` render condition)
- **Modified Files**:
  - `client/src/components/JobVisitsSection.tsx` - Added AlertDialog import, confirmation state, and dialog

#### Refactor: OfficeActionsStrip unschedule uses canonical useUnscheduleJob hook (2026-02-03)

- **Goal**: Ensure invalidations use centralized helpers, avoid drift between views
- **Before**: JobDetailPage defined inline `unscheduleMutation` with manual invalidations
- **After**: Uses `useUnscheduleJob()` from `client/src/hooks/useCalendarApi.ts`
- **Canonical Hook Invalidations**:
  - `/api/calendar` ✅
  - `/api/calendar/range` ✅ (was missing in inline version)
  - `/api/calendar/unscheduled` ✅
  - `/api/jobs` ✅ (prefix matches job-specific queries like `/api/jobs/${id}`)
- **Custom Callbacks Preserved**: Toast notifications for success/error passed via `mutate()` options
- **Modified Files**:
  - `client/src/pages/JobDetailPage.tsx` - Replaced inline mutation with hook import and usage

#### DEV: AddVisitDialog assertion guarantees POST /api/calendar/schedule (2026-02-03)

- **Goal**: Guarantee OfficeActionsStrip "Schedule another visit" always creates NEW visits
- **Call Chain Verified**:
  1. `OfficeActionsStrip.onScheduleVisit` → `setShowScheduleVisitDialog(true)`
  2. Opens `AddVisitDialog` component
  3. `AddVisitDialog` uses `POST /api/calendar/schedule` (line 66)
- **DEV-only Assertions Added** (guarded by `process.env.NODE_ENV === "development"`):
  - Logs: `[AddVisitDialog] Creating new visit via POST /api/calendar/schedule (jobId=...)`
  - Assert: Endpoint must NOT contain `:jobId` path param (that would be reschedule)
  - Assert: Method must be POST, not PATCH
- **Production Behavior**: Unchanged (logs only in development)
- **Modified Files**:
  - `client/src/components/AddVisitDialog.tsx` - Added DEV assertions in mutationFn

#### Fix: Overdue calculation now matches server/storage/dashboard.ts (2026-02-03)

- **Bug**: Frontend `getAttentionReason()` used different overdue logic than server
- **Server Logic** (`server/storage/dashboard.ts:222-226`):
  ```sql
  CASE
    WHEN scheduled_end IS NOT NULL THEN scheduled_end
    WHEN duration_minutes IS NOT NULL THEN scheduled_start + duration_minutes
    ELSE scheduled_start
  END < todayStart  -- midnight UTC of today
  ```
- **Previous Frontend Logic** (incorrect):
  - Compared against `new Date()` (current moment)
  - Used `durationMinutes && durationMinutes > 0` (excluded 0)
- **Fixed Frontend Logic** (now matches server):
  - Compares against midnight UTC of today: `todayStart.setUTCHours(0,0,0,0)`
  - Uses `durationMinutes != null` (includes 0, matches SQL `IS NOT NULL`)
- **Impact**: Jobs now correctly show as overdue only when effectiveEnd < midnight of today
- **Modified Files**:
  - `client/src/pages/JobDetailPage.tsx` - Updated `getAttentionReason()` and detail text computation

#### Fix: Status mutations missing required version field (2026-02-03)

- **Bug**: `updateStatusMutation` and `clearHoldMutation` in JobDetailPage were missing the required `version` field
- **Impact**: All status updates from JobDetailPage (including "Mark Invoiced" from OfficeActionsStrip) were failing with 400 validation errors
- **Root Cause**: Server schema at `server/routes/jobs.ts:303` requires `version: z.number().int().nonnegative()`
- **Fix**: Updated mutations to accept and pass `job.version` to the server
- **Modified Files**:
  - `client/src/pages/JobDetailPage.tsx` - Updated `updateStatusMutation` and `clearHoldMutation` signatures and all call sites
- **Verified Transitions**:
  - `completed → invoiced` ✅ (OfficeActionsStrip "Mark Invoiced")
  - `open → open` with `openSubStatus: null` ✅ (OfficeActionsStrip "Clear Hold")

#### Polish: OfficeActionsStrip Jobber-grade UX (2026-02-03)

- **Goal**: Make OfficeActionsStrip feel "Jobber-grade" with proper permissions and UX
- **Button Labels Match Reason**:
  | Reason | Primary | Secondary |
  |--------|---------|-----------|
  | requires_invoicing | "Schedule another visit" | "Mark Invoiced" (with confirm) |
  | on_hold | "Schedule another visit" | "Resume" |
  | overdue | "Reschedule" | "Unschedule" (hidden if not scheduled) |
- **Permission Checks Added**:
  - Uses `useAuth()` to get current user role
  - `MANAGER_ROLES` (owner, admin, manager, dispatcher) can perform all actions
  - Technicians see disabled buttons with tooltip: "You don't have permission..."
- **Invalid Actions Hidden**:
  - "Unschedule" button hidden for overdue jobs that aren't currently scheduled
- **Tooltips on Disabled Buttons**:
  - Permission denied: "You don't have permission to perform this action"
  - Action in progress: "Action in progress..."
- **Confirmation Dialogs**:
  - "Mark Invoiced" requires confirmation (lifecycle change: completed → invoiced)
  - Other actions don't require confirmation (reversible/no lifecycle change)
- **Modified Files**:
  - `client/src/pages/JobDetailPage.tsx` - Added permission helpers, useAuth, tooltips

### Changed

#### OfficeActionsStrip: Jobber-style workflow actions (2026-02-03)

- **Change**: Actions now depend on attention reason and follow Jobber workflow patterns
- **Modified Files**:
  - `client/src/pages/JobDetailPage.tsx` - Updated ATTENTION_CONFIG and OfficeActionsStrip component
- **Action Mapping by Reason**:
  - **requires_invoicing** (status=completed):
    - Primary: "Schedule another visit" (opens visit dialog)
    - Secondary: "Mark Invoiced" (with confirmation dialog - lifecycle change)
  - **on_hold** (status=open, openSubStatus=on_hold):
    - Primary: "Schedule another visit" (Jobber-like follow-up)
    - Secondary: "Resume" (clears openSubStatus via existing endpoint)
  - **overdue** (status=open, past scheduledEnd):
    - Primary: "Reschedule" (opens schedule dialog)
    - Secondary: "Unschedule" (uses POST /api/calendar/unschedule/:jobId)
- **Confirmation Dialog**: Added for "Mark Invoiced" action (lifecycle status change)
- **Safety Verified**:
  - ✅ No path archives jobs from on_hold or overdue states
  - ✅ requires_invoicing only transitions to "invoiced" (not "archived")
  - ✅ All actions use existing server endpoints (no new endpoints invented)
- **New Props**: `isMarkingInvoiced`, `isClearingHold` for loading states
- **UI Improvements**:
  - Primary button icon now varies by reason (CalendarPlus vs Calendar)
  - Secondary button shows spinner when action is pending

#### Phase 4: Compact Reason Details in Office Actions Strip (2026-02-03)

- **Change**: OfficeActionsStrip now shows context-specific details for each attention reason
- **Modified Files**:
  - `client/src/pages/JobDetailPage.tsx` - Updated OfficeActionsStripProps and rendering
- **Detail Text by Reason**:
  - **on_hold**: Shows hold reason + "Follow-up: <date>" if nextActionDate is set
  - **overdue**: Shows "Overdue since <date>" computed from effectiveEnd
  - **requires_invoicing**: Shows "Completed <date>" if closedAt is available
- **Props Added** to OfficeActionsStripProps:
  - `nextActionDate?: string | null` - For on_hold follow-up dates
  - `closedAt?: Date | string | null` - For requires_invoicing completion date
- **Hard Stop Verified**: No layout shifting on load
  - Detail text computed synchronously from existing job data
  - Uses stable `min-content` layout - text appears inline with badge
  - No async data fetching, no conditional loading states
- **Date Formatting**: Uses date-fns `format(date, 'MMM d')` for compact display (e.g., "Feb 3")

#### Phase 4: Completed Jobs Reopen on Follow-up Visit (2026-02-03)

- **Change**: Scheduling a follow-up visit on a completed job now reopens it to 'open' status
- **Modified Files**:
  - `server/storage/calendar.ts` - `scheduleJob()` now reopens completed jobs
- **Behavior** (Jobber-like):
  - When scheduling a visit on a completed job:
    1. New visit is created (as before)
    2. Job status is set to 'open' (new behavior)
    3. Job's `openSubStatus` is cleared
  - This is a valid status transition per `JOB_STATUS_FLOW: completed → open`
- **Rationale**:
  - A completed job means "the work is done"
  - Scheduling another visit means "more work is needed"
  - The job should return to 'open' status for correct calendar/backlog behavior
  - Without this, jobs would stay in "Requires Invoicing" state even with future visits
- **Audit**: New context label `storage:scheduleJob:PHASE4:reopen` captures the status change
- **Office Actions Strip Updates**:
  - Primary action "Schedule another visit" now properly reopens completed jobs
  - Secondary action "Mark Invoiced" transitions `completed → invoiced` (unchanged)

#### Phase 4: Office Actions Strip in Job Detail (2026-02-03)

- **Change**: Added Jobber-style "Office Action Required" banner in Job Detail when job needs attention
- **Modified Files**:
  - `client/src/pages/JobDetailPage.tsx` - Added OfficeActionsStrip component and integration
- **Attention Conditions** (matches server dashboard logic):
  - `requires_invoicing`: `status='completed'` → shows "Requires Invoicing" badge
  - `on_hold`: `status='open' AND openSubStatus='on_hold'` → shows "On Hold" badge with holdReason
  - `overdue`: `status='open' AND effectiveEnd < now` → shows "Overdue" badge
- **Overdue Calculation** (client-side, matches server semantics):
  - `effectiveEnd = scheduledEnd ?? (scheduledStart + durationMinutes) ?? scheduledStart`
  - Job is overdue when `effectiveEnd < now`
- **Actions per Attention Reason** (safe, Jobber-like):
  - **requires_invoicing**: Primary "Schedule another visit", Secondary "Mark Invoiced" (`completed → invoiced`)
  - **on_hold**: Primary "Schedule another visit", Secondary "Clear Hold" (sets `openSubStatus=null`)
  - **overdue**: Primary "Schedule another visit", Secondary "Unschedule" (`POST /api/calendar/unschedule/:jobId`)
- **Mutations Added**:
  - `clearHoldMutation`: Sets `openSubStatus=null` to resume normal workflow
  - `unscheduleMutation`: Uses canonical calendar endpoint to return job to backlog
- **Safety Constraints**:
  - No accidental archiving from on_hold or overdue states
  - All transitions use valid lifecycle rules per `server/statusRules.ts`
  - Unschedule uses canonical calendar endpoint (preserves job_visits history)
- **UI**:
  - Amber-themed banner at top of Job Detail (before header cards)
  - Only appears when conditions match
  - Responsive layout (stacks on mobile)

#### Phase 4: Spawn-on-Action Reschedule Behavior (2026-02-03)

- **Change**: Reschedule now creates a new visit when the current visit has been actioned
- **Modified Files**:
  - `server/storage/calendar.ts` - `rescheduleJob()` rewritten with spawn-on-action logic
  - `server/storage/jobVisits.ts` - Added `isVisitActioned()` helper function
- **Behavior**:
  - If visit has NO activity: updates that same visit (no extra visits created)
  - If visit IS actioned: soft-deletes old visit (`is_active=false`), creates new visit
- **Actioned Detection** (deterministic, uses existing schema fields):
  - `checkedInAt` is set (technician checked in)
  - `checkedOutAt` is set (technician checked out)
  - `actualDurationMinutes > 0` (time was tracked)
  - `status` progressed beyond 'scheduled' (dispatched, en_route, on_site, in_progress, on_hold, completed)
- **Invariants Preserved**:
  - Dragging an untouched visit back and forth does NOT create extra visits
  - History preserved: old actioned visits become inactive and appear in History section
  - No direct writes to jobs scheduling fields (uses `syncJobScheduleFromVisits()`)
  - Version handling unchanged (uses job.version for API compat)
- **Audit**: New context label `storage:rescheduleJob:spawn-on-action` for spawn events

#### Phase 4: AddVisitDialog Uses Canonical Calendar Endpoint (2026-02-03)

- **Change**: AddVisitDialog now uses `POST /api/calendar/schedule` instead of `POST /api/jobs/:jobId/visits`
- **Modified Files**:
  - `client/src/components/AddVisitDialog.tsx` - Changed endpoint and payload to match scheduleJobSchema
  - `client/src/components/JobVisitsSection.tsx` - Passes jobVersion to AddVisitDialog
- **Payload Changes** (old → new field names):
  - `scheduledDate` → `startAt` (ISO datetime string)
  - `estimatedDurationMinutes` → `durationMinutes`
  - `assignedTechnicianId` → `technicianUserId` (null for unassigned)
  - `visitNotes` → `notes`
  - Added: `jobId`, `version` (required by schema)
- **Cache Invalidation**: Now invalidates job detail, calendar, and unscheduled backlog queries
  - AddVisitDialog: `["/api/calendar/unscheduled"]` added (job moves from backlog to calendar)
  - JobVisitsSection: `["/api/calendar/unscheduled"]` added (job moves from calendar to backlog)
- **Rationale**: Single source of truth for scheduling - all schedule operations go through calendar endpoint

#### Phase 4: Job Detail Visits Panel with Timeline UI (2026-02-03)

- **Change**: Enhanced JobVisitsSection component with Current/Upcoming/History grouping
- **New Files**:
  - `client/src/hooks/useJobVisits.ts` - Hook with derived selectors for visit categorization
- **Modified Files**:
  - `client/src/components/JobVisitsSection.tsx` - Rewrote to show grouped visits with timeline UI
  - `client/src/components/AddVisitDialog.tsx` - Added calendar query invalidation
  - `server/storage/jobVisits.ts` - Added `listAllJobVisitsForJob()` for history display
  - `server/services/jobVisits.service.ts` - Added service wrapper
  - `server/routes/jobVisits.routes.ts` - Added `?all=true` query param for full history
- **Display Logic** (client-side only, matches server eligibility):
  - Eligible: `isActive=true` AND `status NOT IN ('completed', 'cancelled')`
  - Current: Earliest future eligible visit, else most recent past eligible
  - Upcoming: Future eligible visits after current
  - History: All other visits (completed, cancelled, inactive)
- **UI Features**:
  - Current Visit section with highlight ring
  - Upcoming Visits section (if any)
  - History section with inactive badge showing "Unscheduled"
  - Per-visit: DateTime range, duration, status chip, technician, notes
  - Unschedule action via calendar endpoint `POST /api/calendar/unschedule/:jobId`
- **Invariants Preserved**: No changes to `syncJobScheduleFromVisits`, eligibility rules, or calendar write logic

#### Phase 4: Calendar WRITE Path Migrated to job_visits (2026-02-02)

- **Change**: Calendar write endpoints now write to `job_visits` instead of directly updating `jobs` table
- **Endpoints Migrated**:
  - `POST /api/calendar/schedule` → Creates new job_visit row
  - `PATCH /api/calendar/schedule/:jobId` → Updates current eligible visit
  - `POST /api/calendar/unschedule/:jobId` → Sets visit status='cancelled'
  - `POST /api/calendar/resize` → Updates visit's scheduled_end
- **Current Visit Selection**: Same logic as calendar read - earliest future visit if any exist, else most recent past
  - Eligibility: `is_active=true`, `scheduled_start IS NOT NULL`, `status NOT IN ('cancelled', 'completed')`
- **jobs Table Sync**: After each write, `syncJobScheduleFromVisits()` mirrors data to jobs table for backwards compat
- **Optimistic Locking**: Still uses `jobs.version` for API compatibility; visit.version used internally
- **Unschedule Behavior**: Sets `is_active=false` (soft-delete, consistent with repository pattern)
- **Files Modified**:
  - `server/storage/calendar.ts` - `scheduleJob`, `rescheduleJob`, `unscheduleJob` rewritten
  - `server/routes/calendar.ts` - `/resize` endpoint rewritten
  - `server/storage/jobVisits.ts` - Added `getCurrentEligibleVisit()` and `syncJobToVisits()` helpers
- **Unchanged**: Calendar READ path (Phase 3), bypass functions (`scheduleJobBypassWorkingHours`, etc.)

#### Phase 3: Calendar API Reads from job_visits (2026-02-02)

- **Change**: Calendar API now reads scheduled events from `job_visits` table instead of `jobs.scheduledStart` (Model B migration)
- **Selection Rules**: Same as `syncJobScheduleFromVisits()` - uses earliest future visit, else most recent past visit
  - Excluded: `is_active=false`, `scheduled_start IS NULL`, `status IN ('cancelled', 'completed')`
- **Implementation**: Uses raw SQL CTE with window function `ROW_NUMBER() OVER (PARTITION BY job_id ORDER BY ...)` to rank visits per job
- **Technician Data**: Now sourced from visit fields (`assigned_technician_id`, `assigned_technician_ids`) instead of job fields
- **Files Modified**: `server/storage/calendar.ts`
- **Functions Updated**: `getScheduledJobsInRange()` - replaced Drizzle ORM query with CTE-based raw SQL
- **Backwards Compatibility**: `syncJobScheduleFromVisits()` still mirrors visit data to job fields for other consumers
- **Query Structure**:
  ```sql
  WITH eligible_visits AS (
    SELECT jv.* FROM job_visits jv
    WHERE jv.company_id = ? AND jv.is_active = true
      AND jv.scheduled_start IS NOT NULL
      AND jv.status NOT IN ('cancelled', 'completed')
  ),
  ranked_visits AS (
    SELECT ev.*, ROW_NUMBER() OVER (
      PARTITION BY ev.job_id
      ORDER BY
        CASE WHEN ev.scheduled_start >= NOW() THEN 0 ELSE 1 END,
        CASE WHEN ev.scheduled_start >= NOW() THEN ev.scheduled_start END ASC,
        CASE WHEN ev.scheduled_start < NOW() THEN ev.scheduled_start END DESC
    ) as rn FROM eligible_visits ev
  )
  SELECT rv.*, j.*, cl.company_name as location_name
  FROM ranked_visits rv
  JOIN jobs j ON rv.job_id = j.id
  WHERE rv.rn = 1 AND rv.scheduled_start >= ? AND rv.scheduled_start < ?
  ```

#### Step 2.4: syncJobScheduleFromVisits Helper (2026-02-02)

- **Change**: Added compatibility mirror that syncs the "next scheduled visit" onto `jobs.scheduled_*` fields
- **Purpose**: Maintains backwards compatibility while calendar transitions from Model A (job-based) to Model B (visit-based)
- **Selection Rules**:
  - Eligible visits: `is_active=true`, `scheduled_start IS NOT NULL`, `status NOT IN ('cancelled', 'completed')`
  - Prefer earliest future visit if any exist
  - Otherwise use most recent past visit (latest `scheduled_start`)
- **Mirrored Fields**: `scheduledStart`, `scheduledEnd`, `isAllDay`, `durationMinutes`, `primaryTechnicianId`, `assignedTechnicianIds`
- **Unschedule Branch**: If no eligible visits exist, all mirrored fields are cleared (including technician assignments)
- **Optimistic Locking**: Bumps `jobs.version` on every sync
- **Call Sites**: All 6 write methods - `createJobVisit`, `updateJobVisit`, `deleteJobVisit`, `updateJobVisitStatus`, `checkInJobVisit`, `checkOutJobVisit`
- **Files Modified**: `server/storage/jobVisits.ts`

#### Task Status Filter Simplified to Active/Completed (2026-02-01)

- **Change**: Simplified status filter from 4 options (Active, Pending, In Progress, Completed) to 2 options (Active, Completed)
- **Active**: Shows all non-completed tasks (pending, in_progress) - filters out completed and cancelled
- **Completed**: Shows only completed tasks
- **Files Modified**: `client/src/components/TasksSidebar.tsx`
- **Functions Updated**: `buildTasksUrl()`, `normalizeTasks()`, status state type

#### Task Panel Filter Buttons Replaced with Dropdowns (2026-02-01)

- **Change**: Replaced My/All toggle buttons and type buttons with two dropdown filters
- **Assignee Dropdown**: "All Technicians" (default) + list of technicians from `useTechniciansDirectory()`
- **Type Dropdown**: "All Types" (default), "General", "Supplier Visit"
- **Both filters work together**: e.g., selecting "John" + "General" shows only John's general tasks
- **Files Modified**: `client/src/components/TasksSidebar.tsx`
- **State Changes**: `scope` renamed to `assigneeFilter`, `type` renamed to `typeFilter`
- **Added Imports**: `Select` components, `useTechniciansDirectory` hook

#### Task Dialog Delete Button Moved to Footer (2026-02-01)

- **Change**: Moved the delete button from the header (icon next to title) to the dialog footer (left side)
- **Layout**: Footer now shows `[Delete]` on left, `[Cancel] [Update]` on right for edit mode
- **Files Modified**: `client/src/components/TaskDialog.tsx`
- **Removed Import**: `Trash2` icon from lucide-react (no longer used)

### Fixed

#### Edit Task Dialog Not Populating Existing Task Data (2026-02-01)

- **Problem**: When opening an existing task to edit, all form fields were blank - task data wasn't being loaded
- **Root Cause**: The `useQuery` calls used query keys like `["/api/tasks", taskId]`, but the default query function (`getQueryFn`) only uses `queryKey[0]` as the URL. This meant the fetch URL was `/api/tasks` instead of `/api/tasks/${taskId}`
- **Solution**: Changed query keys to include the full URL as the first element:
  - Task data: `["/api/tasks", taskId]` → `[\`/api/tasks/${taskId}\`]`
  - Supplier visit: `["/api/tasks", taskId, "supplier-visit"]` → `[\`/api/tasks/${taskId}/supplier-visit\`]`
- **Files Modified**: `client/src/components/TaskDialog.tsx` (lines 104-108, 113-117)

#### Task Creation "toISOString is not a function" Error (2026-02-01)

- **Problem**: Creating all-day tasks failed with "value.toISOString is not a function" error
- **Root Cause**: The task storage layer passed ISO date strings directly to Drizzle ORM, but Drizzle's `timestamp` column type uses `mode: 'date'` by default, which expects JavaScript Date objects. Drizzle internally calls `.toISOString()` on the value, which fails on strings.
- **Solution**: Convert ISO strings to Date objects before passing to Drizzle in both `createTask` and `updateTask` functions
- **Files Modified**: `server/storage/tasks.ts`
- **Code Change**:
  ```ts
  // Before: Passed string directly (caused error)
  values.scheduledStartAt = input.scheduledStartAt;

  // After: Convert string to Date for Drizzle
  const parsed = new Date(input.scheduledStartAt);
  if (!isNaN(parsed.getTime())) {
    values.scheduledStartAt = parsed;
  }
  ```

#### React Hooks Rule Violation in Calendar Component (2026-01-30)

- **Problem**: "Rendered more hooks than during the previous render" error in Calendar component
- **Root Cause**: The `renderUnscheduledItem` useCallback (line 1888) was defined AFTER conditional early returns (error state at line 1728, loading state at line 1749). This violated React's Rules of Hooks - hooks must be called unconditionally at the top level, in the same order every render.
- **Solution**: Moved `renderUnscheduledItem` useCallback to line 1729, before any early returns but after all its dependencies are available
- **Files Modified**: `client/src/pages/Calendar.tsx`

#### Server Route Optimization - Removed All Pre-Validation Queries (2026-01-30)

- **Problem**: Calendar schedule/reschedule/unschedule endpoints performed redundant validation queries (5-6 per operation)
- **Solution**: Removed ALL pre-validation queries, relying on DB constraints and WHERE clauses:
  - **POST /schedule**: Removed `validateTechnicianBelongsToTenant()` (FK handles), `validateSchedule()` (overbooking allowed)
  - **PATCH /schedule/:jobId**: Removed `getJobById()` pre-check - job ownership verified by UPDATE WHERE clause
  - **POST /unschedule/:jobId**: Removed `getJobById()` pre-check - job ownership verified by UPDATE WHERE clause
- **Trade-off**: Conflict checking removed - dispatchers can see overbooking visually on calendar
- **Error Handling**: FK violations (invalid technician) now caught via PostgreSQL error code `23503`
- **Files Modified**: `server/routes/calendar.ts`
- **Imports Removed**: `validateSchedule`, `ScheduleValidationError` from calendarValidation service
- **Expected Performance**:
  - POST /schedule: 1 query (was 3-4) → ~300-400ms (was ~1070ms)
  - PATCH /schedule: 1 query (was 2-3) → ~200-300ms (was ~856ms)
  - POST /unschedule: 1 query (was 2-3) → ~150-250ms (was ~777ms)
- **Note**: For additional ~200ms improvement per query, enable Neon connection pooler by updating DATABASE_URL to use `-pooler` hostname suffix

#### Unscheduled Panel Loading Spinner During Reschedule (2026-01-30)

- **Problem**: The unscheduled sidebar showed a loading spinner during reschedule operations that don't affect it, because `isSavingDrag` included `updateAssignment.isPending`
- **Solution**: Split saving state into two:
  - `isSavingUnscheduled` - Only `createAssignment.isPending || deleteAssignment.isPending` (for sidebar)
  - `isSavingDrag` (renamed internally to `isSavingAnyDrag`) - All drag operations (for calendar feedback)
- **Files Modified**:
  - `client/src/hooks/useCalendarDnD.ts` - Added `isSavingUnscheduled` export
  - `client/src/pages/Calendar.tsx` - Use `isSavingUnscheduled` for UnscheduledJobsSidebar

#### All-Day to Timed Event Duration Bug (2026-01-30)

- **Problem**: Dragging an all-day job to a timed slot used the all-day duration (1440 minutes) instead of a sensible default, creating events that span the entire day
- **Solution**: In `updateAssignment` mutation (both `mutationFn` and `onMutate`):
  - Check if duration is 1440 (all-day) or > 480 (8 hours)
  - If so, clamp to `DEFAULT_DURATION_MINUTES` (60 min)
  - Also detect all-day to timed conversion via `a.isAllDay && !isAllDay` and force default
- **Files Modified**: `client/src/hooks/useCalendarDnD.ts`

#### Unnecessary Unscheduled Query Invalidation on Reschedule (2026-01-30)

- **Problem**: Moving jobs around on the calendar (reschedule) caused unnecessary loading spinners because `invalidateCalendarQueries()` invalidated the unscheduled query on ALL operations
- **Solution**: Split invalidation into two functions:
  - `invalidateCalendarOnly()` - Only invalidates calendar queries, NOT unscheduled. Used for:
    - Reschedule operations (updateAssignment)
    - Duration changes (updateDuration)
    - Technician assignments (assignTechnicians)
    - Completion status changes (toggleComplete)
  - `invalidateCalendarAndUnscheduled()` - Invalidates calendar + unscheduled + clients. Used for:
    - Schedule operations (createAssignment) - job moves from unscheduled to calendar
    - Unschedule operations (deleteAssignment) - job moves from calendar to unscheduled
    - Clear schedule/day operations - jobs move to unscheduled
    - Error recovery paths - need full refresh
- **Files Modified**: `client/src/hooks/useCalendarDnD.ts`

### Changed

#### Server-Side Calendar API Performance Optimization (2026-01-30)

- **Problem**: Calendar schedule/unschedule API endpoints took 800-950ms due to excessive sequential DB queries
- **Root Cause**: Each scheduling operation performed 6-8 sequential database round-trips:
  - `validateJobBelongsToTenant()` - 1 query
  - `validateTechnicianBelongsToTenant()` - 1 query
  - `validateSchedule()` - 2 queries (tech exists + conflict check)
  - `getJobById()` - 1 query (for version check)
  - Transaction (UPDATE + INSERT audit) - 1-2 queries
  - `getJob()` for notification - 1 query
- **Solution**: Multi-pronged optimization:
  1. **Repository Layer** (`server/storage/calendar.ts`):
     - Removed separate `getJobById()` call before UPDATE
     - Moved version check + terminal status check into UPDATE WHERE clause
     - Only fetch job details on error path (to determine error type)
     - Reduced from 2 DB calls to 1 in happy path per operation
  2. **Route Layer** (`server/routes/calendar.ts`):
     - Parallelized `validateTechnicianBelongsToTenant()` and `validateSchedule()` using `Promise.all()`
     - Removed redundant `validateJobBelongsToTenant()` (now checked in UPDATE WHERE)
  3. **Connection Pool** (`server/db.ts`):
     - Changed `min: 0` to `min: 2` (prod) / `min: 1` (dev) to keep connections warm
     - Changed `idleTimeoutMillis` to 60s (prod) to reduce cold starts
     - Changed `allowExitOnIdle: false` to keep pool warm
  4. **Database Indexes** (`migrations/2026_01_30_calendar_performance_indexes.sql`):
     - Added `jobs_conflict_check_idx` for conflict detection queries
     - Added `jobs_company_id_lookup_idx` for tenant-isolated lookups
- **Expected Performance**:
  - Before: 800-950ms per schedule/reschedule/unschedule operation
  - After: 200-400ms per operation (2-4x faster)
- **Files Modified**:
  - `server/storage/calendar.ts` - Optimized `scheduleJob()`, `rescheduleJob()`, `unscheduleJob()`
  - `server/routes/calendar.ts` - Parallelized validations
  - `server/db.ts` - Warmed connection pool
- **Migration**: `migrations/2026_01_30_calendar_performance_indexes.sql` (run with `psql` without transaction flag)
- **Trade-off**: Audit log `oldFields` is now null (we don't pre-fetch existing job to capture old values)

#### Client-Side Drag Performance Optimization (2026-01-30)

- **Problem**: Sidebar cards re-rendered 50+ times during drag, causing janky experience
- **Root Cause**:
  - `DraggableClient` component not memoized, re-rendered on every state change
  - `renderItem` callback recreated on every Calendar.tsx render
  - Verbose DEV logging (`[UNSCHED-DRAG]`) fired on every render
  - Query refetch triggered by window focus during drag
- **Solution**:
  1. **DraggableClient.tsx**: Wrapped with `React.memo` + custom comparison function
  2. **Calendar.tsx**: Extracted `renderItem` to `renderUnscheduledItem` with `useCallback`
  3. **DraggableClient.tsx**: Throttled DEV logging (only once per card mount)
  4. **useCalendarApi.ts**: Added `refetchOnWindowFocus: false`, `refetchOnMount: false`
- **Expected Results**:
  - Rerenders during drag: 50+ → 0-2
  - `[UNSCHED-DRAG]` logs: 50+ per drag → 0
  - Smooth drag experience
- **Files Modified**:
  - `client/src/components/calendar/DraggableClient.tsx`
  - `client/src/pages/Calendar.tsx`
  - `client/src/hooks/useCalendarApi.ts`

#### DnD Performance Fix - Eliminate Refetch Thrash (2026-01-30)

- **Problem**: DnD operations took ~1800ms total due to invalidating 15+ queries on each operation
- **Root Cause**: `onSuccess` handlers called `refetchCalendar()` + `invalidateCalendarQueries()` which invalidated ALL `/api/calendar*` queries plus `/api/clients`
- **Solution**: Replace full refetch with targeted cache merge + narrow invalidation
- **New Helpers** in `useCalendarDnD.ts`:
  - `mergeServerResponseIntoCache(result, jobId, operation)` - Directly merges server response into React Query cache
  - `invalidateNarrow(includeUnscheduled)` - Only invalidates `/api/calendar/unscheduled` when needed
- **Changes to Mutation Handlers**:
  - `createAssignment.onSuccess`: Uses `mergeServerResponseIntoCache` + `invalidateNarrow(true)`
  - `updateAssignment.onSuccess`: Uses `mergeServerResponseIntoCache` only (no invalidation needed)
  - `deleteAssignment.onSuccess`: Uses `mergeServerResponseIntoCache` + `invalidateNarrow(true)`
- **Expected Performance**:
  - Before: ~1800ms total (1000ms+ in refetch/invalidation phase)
  - After: ~150-200ms total (cache merge is <5ms, narrow invalidation is <5ms)
  - UI updates at `optimistic-update-complete` (~3ms) - instant feel preserved
- **Files Modified**: `client/src/hooks/useCalendarDnD.ts`
- **Verification**:
  - `npm run check` passes
  - `npm run build` passes
  - Optimistic updates still work (UI updates before server response)
  - Error rollback still works (cache restored from snapshot)

#### DnD Performance Instrumentation (2026-01-30)

- **Improvement**: Added comprehensive performance instrumentation for calendar drag-and-drop operations
- **Purpose**: Identify bottlenecks in DnD operations (optimistic updates already work, but refetch/invalidation may cause perceived lag)
- **New File**: `client/src/lib/dndPerformance.ts`
  - `startPerfSession(operation, jobId)` - Start timing a DnD operation
  - `mark(name, data)` - Add timing checkpoint
  - `endPerfSession(success)` - End session and log summary with bottleneck detection
  - `trackInvalidation(queryKey)` - Track which queries are invalidated
  - `isDndPerfEnabled()` - Returns true in development or with `?dnd-perf=1` query param
- **Instrumented Mutations** in `useCalendarDnD.ts`:
  - `createAssignment` (schedule) - marks: mutation-fn-start, on-mutate-start, queries-cancelled, optimistic-update-complete, server-response-received, on-success-start, pre-refetch, refetch-complete, invalidation-complete
  - `updateAssignment` (reschedule) - same marks
  - `deleteAssignment` (unschedule) - same marks
  - `invalidateCalendarQueries` - tracks invalidated count and query keys
- **Console Output** (DEV only):
  ```
  [DnD-Perf] ▶ Session started: schedule job=abc123
  [DnD-Perf] 📍 mutation-fn-start: +0.2ms
  [DnD-Perf] 📍 optimistic-update-complete: +3.4ms  <-- UI updates HERE
  [DnD-Perf] 📍 server-response-received: +145.2ms
  [DnD-Perf] 📍 refetch-complete: +312.5ms
  [DnD-Perf] ⏱ Session complete: schedule
  [DnD-Perf] Total: 312.5ms
  [DnD-Perf] ⚠️ Bottleneck: "pre-refetch → refetch-complete" took 166.4ms
  ```
- **Verification**:
  - `npm run check` passes
  - `npm run build` passes
  - Logs appear in browser DevTools during DnD operations

#### Unambiguous Weekly Droppable IDs (2026-01-30)

- **Improvement**: Weekly view droppable IDs now include full date (YYYY-MM-DD) instead of just dayName+dayNumber
- **Motivation**: Previous format `weekly|Mon|14|30|28` was ambiguous when week spans two months - the month/year had to be reconstructed from view state, causing Bug 16 (Sunday boundary issue)
- **New Formats**:
  - Weekly timed: `weekly|YYYY-MM-DD|{hour}|{minute}` (was: `weekly|{dayName}|{hour}|{minute}|{dayNumber}`)
  - Weekly all-day: `allday|week|YYYY-MM-DD` (was: `allday|{dayName}|{dayNumber}`)
- **Backward Compatibility**: Legacy format still supported via `getWeeklyTargetDate()` fallback
- **Files Modified**:
  - `client/src/components/calendar/CalendarGridWeek.tsx` - updated droppable ID generation
  - `client/src/pages/Calendar.tsx` - updated drop handlers with format detection
- **Benefits**:
  - Date is authoritative and unambiguous
  - No dependency on view state or weekStartsOn calculation during drop handling
  - Prevents month-boundary bugs permanently

#### Centralized Development Mode Flags (2026-01-30)

- **Improvement**: Gate ALL dev-only console logs and schema checks behind a single `IS_DEV` flag
- **Changes**:
  - Created `server/utils/devFlags.ts` - exports `IS_DEV`, `IS_PROD`, `DEV_VERBOSE`
  - Created `client/src/lib/devFlags.ts` - client-side equivalent
  - Replaced scattered `process.env.NODE_ENV === 'development'` checks with centralized `IS_DEV` import
  - Production logs are now clean - dev-only logs only run when NODE_ENV=development
- **Files Modified**:
  - `server/utils/devFlags.ts` (new)
  - `client/src/lib/devFlags.ts` (new)
  - `server/utils/validationHelpers.ts` (use IS_DEV)
  - `server/utils/allDaySanitizer.ts` (use IS_DEV)
  - `server/routes/calendar.ts` (use IS_DEV)
  - `server/services/calendarValidation.ts` (use IS_DEV)
  - `server/storage/calendar.ts` (use IS_DEV)
  - `client/src/pages/Calendar.tsx` (use IS_DEV for all dev logs)
- **Verification**:
  - `npm run check` passes
  - `npm run build` passes
  - Production bundle has no dev-only log strings (client)
  - Server bundle has IS_DEV guards (runtime check)

#### TODO.md Development Workflow Notes (2026-01-30)

- Added prominent "DEVELOPMENT WORKFLOW NOTES" section at top of TODO.md
- Documents when server restart is required (Zod schema changes, route modules)
- Added "DnD Regression Checklist" section with test cases:
  - Day View: unscheduled→unassigned, tech→unassigned, unassigned→tech
  - Week (By Technician) View: tech→unassigned
  - Drop on empty space should do nothing (verified: code returns early on !over)

#### Unscheduled Sidebar Card Styling (2026-01-29)

- **Improvement**: Unified unscheduled sidebar job card styling to match calendar cards
- **Changes**:
  - Consistent flex layout structure (`flex flex-col min-h-0 overflow-hidden`)
  - Font weight changed from `font-semibold` to `font-medium` (matches calendar cards)
  - Line height changed from `leading-[1.2]` to `leading-tight` (consistent spacing)
  - Simplified two-line layout: company name + summary/location
- **Files Modified**:
  - `client/src/components/calendar/DraggableClient.tsx` (unscheduled layout block)

### Fixed

#### Bug 16: Sunday Boundary Date Mapping Bug in Week View (2026-01-30)

- **Bug**: Dragging unscheduled job onto Sunday in week view showed success toast but job disappeared (not visible on calendar, not in unscheduled)
- **Root Cause Analysis (Type B: Wrong date)**:
  - Weekly view droppable IDs encode: `weekly|{dayName}|{hour}|{minute}|{dayNumber}`
  - Only `dayName` (Mon/Tue/...) and `dayNumber` (1-31) are encoded, NOT month/year
  - When week spans two months (e.g., Jan 27 - Feb 2), code used view's `month`/`year` as fallback
  - If current view month = January but Sunday = Feb 2, job was scheduled to Jan 2 instead of Feb 2
  - Job "disappeared" because it was scheduled to a date not in the current week's fetch range
- **Fix**:
  - Added `getWeeklyTargetDate(dayName)` helper in Calendar.tsx
  - Maps dayName to day index (0-6) based on `regional.weekStartsOn` setting
  - Computes exact target date from weekStart + day index
  - Returns correct `{ targetDay, targetMonth, targetYear }` for any day in the week
  - Updated weekly all-day handler and weekly timed handler to use the helper
- **Files Modified**:
  - `client/src/pages/Calendar.tsx` (added getWeeklyTargetDate helper, updated weekly handlers)
- **Verification Steps**:
  1. Navigate to a week that spans two months (e.g., last week of January 2026)
  2. Drag unscheduled job → Sunday timed slot: job appears on Sunday immediately
  3. Drag unscheduled job → Sunday all-day lane: job appears on Sunday immediately
  4. After refresh: job still appears on Sunday (proves DB has correct date)
  5. Same action works on other days (no regression)

#### Bug 15: Unassign Operations Validation Failure (2026-01-30)

- **Bug**: Day View Unscheduled → Unassigned threw "Expected string, received null at technicianUserId"; Tech → Unassigned snapped back
- **Root Cause Analysis**:
  - The schemas already had `.nullable().optional()` from Bug 7 and Bug 9 fixes
  - **Issue was server running OLD CODE** before the `.nullable()` was added
  - Server restart required for schema changes to take effect
- **Verification**: Added schema sanity check at module load time
  - Confirms `scheduleJobSchema` accepts null ✓
  - Confirms `rescheduleJobSchema` accepts null ✓
  - Logs `[SCHEMA-CHECK]` messages at server startup
- **Additional Fixes**:
  - Enhanced DEV logging in `validateSchema()` to capture full input data on validation failures
  - Logs Zod issue details: path, message, code, received, expected
- **Files Modified**:
  - `server/routes/calendar.ts` (schema sanity check at module load)
  - `server/utils/validationHelpers.ts` (DEV logging for validation failures)
- **Verification Steps**:
  - Server restart required after schema changes
  - Look for `[SCHEMA-CHECK] scheduleJobSchema accepts null technicianUserId ✓` in startup logs
  - Day View: Unscheduled → Unassigned should succeed
  - Day View: Tech → Unassigned should succeed
- **Automated Test Results** (2026-01-30):
  - ✓ Server startup schema checks pass
  - ✓ Schema test: POST /schedule with `technicianUserId: null` - PASS
  - ✓ Schema test: PATCH /schedule/:id with `technicianUserId: null` - PASS
  - ✓ Schema test: POST /schedule with valid UUID - PASS
  - ✓ Schema test: POST /schedule without technicianUserId - PASS

#### Weekly Technician View Drag-and-Drop (2026-01-29)

- **Bug**: Drag-and-drop on weekly technician view was broken - jobs would automatically move to 'unscheduled' regardless of drop target
- **Root Cause #1**: The `handleDragEnd` function was missing a handler for the `techweek|` drop zone ID pattern
- **Root Cause #2**: The `customCollisionDetection` function didn't include `techweek|` in the drop zone filter, so drops were never detected
- **Fixes**:
  - Added `techweek|` handler to parse target format `techweek|{techId}|{YYYY-MM-DD}`
  - Added `id.startsWith('techweek|')` to `customCollisionDetection` drop zone filter
  - Added `technicianUserId` field to `CreateAssignmentParams` type in useCalendarDnD.ts
  - Added `'techweek'` to `DragLogData.targetType` union in calendarDiagnostics.ts
  - Updated `getTargetType()` to recognize `techweek|` prefix
- **Files Modified**:
  - `client/src/pages/Calendar.tsx` (techweek handler, collision detection filter, getTargetType)
  - `client/src/hooks/useCalendarDnD.ts` (technicianUserId in CreateAssignmentParams + mutationFn)
  - `client/src/lib/calendarDiagnostics.ts` (techweek in DragLogData.targetType)

#### Calendar DnD DEV Instrumentation (2026-01-29)

- **Debug**: Added comprehensive DEV-only logging for drag-and-drop debugging
- **Instrumentation Added**:
  - `[DnD] onDragStart` - logs active.id, activeData, activeRect
  - `[DnD] onDragOver` - logs over.id when hovering valid targets
  - `[DnD] onDragEnd` - logs active.id, over.id, collisions array
  - `[DnD] Droppable containers` - logs counts by prefix (daily, allday, techweek, etc)
  - `[QuarterDropZone] isOver=true` - logs when 15-min drop zone is active
  - `[AllDayDropZone] isOver=true` - logs when all-day lane is active
  - `[TechWeekDropZone] isOver=true` - logs when tech week cell is active
  - `[UnassignedDayDropZone] isOver=true` - logs when unassigned row cell is active
- **Fixes Applied**:
  - Fixed QuarterDropZone z-index: always z-20, z-50 when hovered (was only z-5 when hovered)
  - Removed `flex flex-col` from quarter drop zone overlay (was potentially causing 0-height issues)
- **Files Modified**:
  - `client/src/pages/Calendar.tsx` (onDragStart, onDragOver, onDragEnd, customCollisionDetection logging)
  - `client/src/components/calendar/CalendarGridDayJobber.tsx` (QuarterDropZone, AllDayDropZone logging)
  - `client/src/components/calendar/CalendarGridWeekTechnicians.tsx` (TechnicianDayDropZone, UnassignedDayDropZone logging)

#### Calendar DnD Technician Assignment Bugs (2026-01-29)

- **Bug 1**: Tech Week View drops not working
  - **Symptom**: Drag from Unassigned → Technician, or Unscheduled → anywhere, did nothing
  - **Root Cause**: Early-return condition at line 592 was missing `!overId.startsWith('techweek|')` check
  - **Fix**: Added `techweek|` to the prefix whitelist in the early-return guard
- **Bug 2**: Day View drops not assigning technicians
  - **Symptom**: Drag Unscheduled → Technician column would schedule but leave job unassigned
  - **Root Cause**: `technicianUserId` was only passed in `isExistingCalendarAssignment` branch, not in unscheduled branches
  - **Fix**: Added `technicianUserId: technicianId !== 'unassigned' ? technicianId : null` to:
    - `allday|` (Day view all-day lane) - both unscheduled branches
    - `daily|` (Day view timed slots) - both unscheduled branches
- **Files Modified**:
  - `client/src/pages/Calendar.tsx` (handleDragEnd early-return condition + 4 mutation calls)

#### False Scheduling Conflict Errors (2026-01-29)

- **Bug 3**: Conflict check matching soft-deleted jobs
  - **Symptom**: "Technician is already scheduled for Job #X" error when scheduling to a valid slot
  - **Root Cause**: `validateSchedule` conflict query was not excluding soft-deleted jobs
  - **Fix**: Added `isNull(jobs.deletedAt)` to overlapConditions in calendarValidation.ts
- **Bug 4**: Self-conflict when scheduling unscheduled jobs
  - **Symptom**: Scheduling an unscheduled job could conflict with its own old schedule data
  - **Root Cause**: `excludeJobId` was not passed to validateSchedule in POST /schedule endpoint
  - **Fix**: Added `excludeJobId: data.jobId` to validateSchedule call in calendar.ts
- **Bug 5**: Missing onDragCancel handler
  - **Symptom**: If drag was cancelled (e.g., Escape key), activeId might not reset
  - **Fix**: Added onDragCancel handler to DndContext that resets activeId
- **Bug 6**: Day View cards "dead" (not clickable/draggable) in technician columns
  - **Symptom**: Cards under technicians couldn't be clicked or dragged
  - **Root Cause**: QuarterDropZone had `pointer-events-auto` which captured all pointer events
  - **Fix**: Changed to `pointer-events-none` in CalendarGridDayJobber.tsx (dnd-kit uses getBoundingClientRect for collision, not pointer events)
- **Bug 7**: Unscheduled → Unassigned threw validation error "Expected string, received null"
  - **Symptom**: Dropping to Unassigned column would error with technicianUserId null validation
  - **Root Cause**: scheduleJobSchema only had `.optional()`, not `.nullable()`
  - **Fix**: Added `.nullable()` to scheduleJobSchema and converted null → undefined for repository
- **Bug 8**: Week Tech View "flash to Unassigned" before settling on technician
  - **Symptom**: When dropping Unscheduled → Technician, job would briefly appear under Unassigned
  - **Root Cause**: Optimistic update for createAssignment was missing technician fields
  - **Fix**: Added optimisticTechFields to createAssignment onMutate in useCalendarDnD.ts
- **Bug 9**: Zod schema chain order causing validation errors
  - **Symptom**: "Expected string, received null" even with `.nullable()` in schema
  - **Root Cause**: `.optional().nullable()` order differs from `.nullable().optional()` in Zod type narrowing
  - **Fix**: Changed to `.nullable().optional()` consistently across all schemas (server + shared)
- **Bug 10**: False conflict always referencing same Job #10017
  - **Symptom**: Any timed drop would error with conflict against Job #10017 regardless of slot
  - **Root Cause**: All-day jobs (scheduledStart=midnight, scheduledEnd=23:59:59) overlap any timed event on same day
  - **Initial Fix**: Added `eq(jobs.isAllDay, false)` filter to conflict query in calendarValidation.ts
  - All-day and timed jobs use separate "lanes" and should not conflict with each other
  - Added DEV logging to validateSchedule for debugging conflict issues
- **Bug 11**: Formalized all-day ("Anytime") conflict semantics (2026-01-29)
  - **Symptom**: Initial Bug 10 fix globally filtered all-day jobs, missing all-day vs all-day conflicts
  - **Root Cause**: `eq(jobs.isAllDay, false)` filtered ALL all-day jobs from conflict check
  - **Expected Conflict Behavior**:
    - Timed vs Timed: CONFLICT (standard double-booking prevention)
    - Timed vs All-day: NO CONFLICT (Anytime jobs are non-blocking)
    - All-day vs Timed: NO CONFLICT (Anytime doesn't block timed)
    - All-day vs All-day: CONFLICT (one Anytime job per tech per day)
  - **Fixes**:
    - Added `isAllDay?: boolean` parameter to `ValidateScheduleOptions` interface
    - Conditional conflict query: timed input checks against timed jobs only; all-day input checks against all-day jobs only
    - Added `ANYTIME_JOB_EXISTS` error code for all-day vs all-day conflicts
    - Updated error message: "Technician already has an Anytime job scheduled for this day"
    - Updated POST /schedule route to pass `isAllDay` to `validateSchedule`
    - Added DEV-only `verifyConflictSemantics()` function documenting expected behavior matrix
- **Bug 12**: Day View using wrong date for unscheduled drops (2026-01-30)
  - **Symptom**: Unscheduled → Technician timed slot always errored with constant Job #10015 conflict
  - **Root Cause**: Day View `daily|` handler used `unscheduledItem.month ?? month` instead of `targetMo` from drop zone ID
  - **Fix**: Changed to use `targetMo` and `targetYr` extracted from droppable ID
  - **File**: `client/src/pages/Calendar.tsx` lines 1033-1034
- **Bug 13**: Technician → Unassigned snapback in Day View (2026-01-30)
  - **Symptom**: Dragging a job from a technician to Unassigned would snap back instead of unassigning
  - **Root Cause**: PATCH /schedule/:jobId converted `null` (explicit unassign) to `undefined` (no change) via `data.technicianUserId ?? undefined`
  - **Fix**: Changed to preserve null: `data.technicianUserId === undefined ? undefined : (data.technicianUserId ?? null)`
  - **Also**: Updated repository type signature to accept `string | null | undefined` for technicianUserId
  - **Files**: `server/routes/calendar.ts`, `server/storage/calendar.ts`
- **Bug 14**: POST /schedule also converting null to undefined (2026-01-30)
  - **Symptom**: Unscheduled → Unassigned would fail to schedule without technician
  - **Root Cause**: POST /schedule had same `data.technicianUserId ?? undefined` conversion as Bug 13
  - **Fix**: Changed to pass `data.technicianUserId` directly (repository handles both null and undefined correctly)
  - **Also**: Updated `scheduleJob` and `scheduleJobBypassWorkingHours` type signatures to accept `string | null`
  - **Files**: `server/routes/calendar.ts`, `server/storage/calendar.ts`
- **Files Modified**:
  - `server/services/calendarValidation.ts` (conditional conflict logic, ANYTIME_JOB_EXISTS code, verifyConflictSemantics)
  - `server/routes/calendar.ts` (pass isAllDay to validateSchedule, fix null handling in PATCH)
  - `server/storage/calendar.ts` (accept null in rescheduleJob type signature)
  - `shared/schema.ts` (added .nullable() to scheduleJobSchema)
  - `client/src/pages/Calendar.tsx` (added onDragCancel handler, fix Day View date bug)
  - `client/src/components/calendar/CalendarGridDayJobber.tsx` (pointer-events-none for QuarterDropZone)
  - `client/src/hooks/useCalendarDnD.ts` (optimisticTechFields in createAssignment onMutate)

### Added

#### Jobber-style Day View Grid (CalendarGridDayJobber)

- **Feature**: Replaced the Day view with a proper Jobber-style dispatch grid layout
- **Layout**:
  - Technician columns (Unassigned + each visible tech) with sticky headers
  - Time rail on the left (24 hours)
  - All-day/Anytime lane under header with proper droppable IDs
  - Visit count badges showing number of active visits per technician
  - Jobs positioned as blocks based on minutes-from-midnight, sized by duration
  - Events can span multiple hours visually
- **Drag/Drop**:
  - 15-minute drop zones throughout the grid
  - Drag between tech columns to reassign
  - Drag to all-day lane to schedule as all-day event
  - All-day lane droppable ID format: `allday|{techIdOrUnassigned}|{YYYY-MM-DD}`
- **Business Hours**:
  - Hours outside business hours greyed out (visual only, scheduling still allowed)
  - Auto-scroll to business hours start on mount
  - DEV badge showing current business hours for debugging
- **Files**:
  - `client/src/components/calendar/CalendarGridDayJobber.tsx` (NEW - main component)
  - `client/src/components/calendar/index.ts` (export new component)
  - `client/src/pages/Calendar.tsx` (wire up new component, add day-allday drop handling)
  - `client/src/lib/calendarDiagnostics.ts` (add 'day-allday' target type)

#### Calendar Drag & Drop Automated Tests

- **Feature**: Added comprehensive automated tests for calendar drag & drop operations
- **Tests cover**:
  - Schedule job (drag from unscheduled sidebar to calendar)
  - Reschedule job (drag to new date/time, different day)
  - Change technician (drag to different tech column)
  - Unassign technician (drag to "Unassigned" column)
  - Unschedule job (drag back to unscheduled sidebar)
  - Version mismatch handling (optimistic locking)
  - All-day event scheduling (schedule as all-day, convert timed↔all-day)
  - Combined operations (reschedule + reassign in single update)
- **All-day UTC helpers**: Added `createAllDayStartUTC()` and `createAllDayEndUTC()` helper functions to construct proper UTC timestamps for all-day events (avoids timezone issues with `setHours()`)
- **Files**:
  - `tests/calendar-drag-drop.test.ts` (NEW - 14 tests, all passing)

#### Company Business Hours (Table-backed) + Settings UI + Day View Integration

- **Feature**: Company-wide business hours stored per-tenant, one row per weekday (7 rows per company)
- **Database**: New `company_business_hours` table with columns:
  - `id` (UUID PK)
  - `company_id` (FK to companies)
  - `day_of_week` (0=Sunday...6=Saturday)
  - `is_open` (boolean)
  - `start_minutes`, `end_minutes` (minutes from midnight, 0-1440)
  - Constraints enforce closed days have null times, open days have valid times with end > start
- **Migration**: `migrations/2026_01_28_add_company_business_hours.sql`
  - Seeds defaults for existing companies: Mon-Fri 06:00-16:30, Sat-Sun closed
  - Idempotent via `ON CONFLICT DO NOTHING`
- **API Endpoints**:
  - `GET /api/company/business-hours` - Returns all 7 days
  - `PUT /api/company/business-hours` - Updates all 7 days (manager+ role required)
- **Settings UI**: New `/settings/business-hours` page with:
  - Open/closed toggle per day
  - Time pickers in 15-minute increments
  - Settings card added to main Settings page with clock icon
- **Day View Calendar Integration**:
  - Hours outside business hours are greyed out (subtle `bg-muted/40` background)
  - Auto-scroll to business start on mount (30 minutes padding)
  - Scheduling still allowed in grey hours (no enforcement)
- Files:
  - `migrations/2026_01_28_add_company_business_hours.sql` (NEW)
  - `shared/schema.ts` (companyBusinessHours table + types)
  - `server/storage/businessHours.ts` (NEW - repository)
  - `server/storage/index.ts` (register repository)
  - `server/routes/businessHours.ts` (NEW - API routes)
  - `server/routes/index.ts` (mount routes)
  - `client/src/pages/BusinessHoursSettingsPage.tsx` (NEW - settings UI)
  - `client/src/pages/SettingsPage.tsx` (add card)
  - `client/src/App.tsx` (add route)
  - `client/src/pages/Calendar.tsx` (fetch + pass business hours)
  - `client/src/components/calendar/CalendarGridDay.tsx` (grey-out + auto-scroll)

### Added

#### Hover preview on all calendar views

- **Feature**: Added consistent hover preview across all calendar views
- **Consistency**: Same hover preview dialog now appears everywhere:
  - Monthly view (fixed - CalendarEventChip now forwards ref and spreads props)
  - Weekly view (already had it)
  - Weekly technician view (NEW - added DraggableTechJobCard component)
  - Daily view (already had it)
- **Files changed**:
  - `client/src/components/calendar/CalendarGridWeekTechnicians.tsx`:
    - Added `DraggableTechJobCard` component with `useDraggable` + `EventPreviewPopover`
    - Job cards are now draggable (were previously static divs)
    - Updated TechnicianDayDropZone and UnassignedDayDropZone to use new component
  - `client/src/components/calendar/CalendarEventChip.tsx`:
    - Convert to forwardRef to fix HoverCardTrigger compatibility
    - Accept and spread additional HTML props (onMouseEnter, onMouseLeave, etc.)
    - Merge external styles and className with internal ones

### Changed

#### Unified JobCard component for all calendar contexts

- **Refactor**: Created shared `JobCard` component used across all three job card contexts:
  - Scheduled timed jobs (via `ResizableJobCard` wrapper)
  - All-day jobs in the all-day lane
  - Unscheduled jobs in the sidebar
- **Benefits**:
  - Single source of truth for job card UI (hover preview, quick actions, styling)
  - Future changes automatically apply to all contexts
  - Reduced code duplication (~90 lines removed)
- **Component hierarchy**:
  - `JobCard` - Wraps `DraggableClient` with `EventPreviewPopover` and quick action buttons
  - `ResizableJobCard` - Uses `JobCard` internally, adds resize handle for timed events
  - All-day lane and unscheduled sidebar use `JobCard` directly
- **Files**:
  - `client/src/components/calendar/JobCard.tsx` (NEW - unified job card)
  - `client/src/components/calendar/ResizableJobCard.tsx` (refactored to use JobCard)
  - `client/src/components/calendar/CalendarGridDayJobber.tsx` (use JobCard for all-day lane)
  - `client/src/components/calendar/CalendarGridWeek.tsx` (use JobCard for all-day row)
  - `client/src/components/calendar/index.ts` (export JobCard)
  - `client/src/pages/Calendar.tsx` (use JobCard for unscheduled sidebar)

### Fixed

#### All-day cards missing job description text

- **Bug**: All-day job cards only showed client name, missing the job description/summary text that appears on timed job cards
- **Root cause**: `DraggableClient` only rendered the second line (summary/location) when `cardHeight > 28`, but all-day cards didn't pass a `cardHeight` prop
- **Fix**: Changed condition from `cardHeight && cardHeight > 28` to `cardHeight === undefined || cardHeight > 28` so the second line renders by default unless explicitly constrained by a small card height
- **Files changed**:
  - `client/src/components/calendar/DraggableClient.tsx` - Fix second line visibility condition

#### Unscheduled jobs missing hover preview and wrong click behavior

- **Bug**: Jobs in the Unscheduled sidebar didn't show the hover preview popover, and clicking them opened a different dialog instead of the Job Detail dialog
- **Root cause**: Unscheduled job rendering was missing `EventPreviewPopover` wrapper and using `setReportDialogClientId` instead of `handleClientClick`
- **Fix**:
  - Wrapped unscheduled `DraggableClient` with `EventPreviewPopover` for hover preview
  - Changed onClick handler to use `handleClientClick(clientData, item, true)` which opens JobDetailDialog focused on schedule section
- **Files changed**:
  - `client/src/pages/Calendar.tsx` - Import EventPreviewPopover, wrap unscheduled items, fix click handler

#### All-day job cards missing quick action buttons

- **Bug**: All-day job cards in the day view didn't have the reschedule/unschedule quick action buttons that timed job cards have
- **Fix**: Created `AllDayJobCard` component that matches `ResizableJobCard` functionality (minus resize handle):
  - Hover preview via `EventPreviewPopover`
  - Quick action buttons on hover (reschedule, unschedule)
  - Same visual styling as timed job cards for consistency
- **Files changed**:
  - `client/src/components/calendar/CalendarGridDayJobber.tsx` - Add `AllDayJobCard` component, use it in all-day lane

#### Technician assignment from calendar failing with "Required at 'version'" validation error

- **Bug**: Assigning a technician to a job from the calendar page failed with validation error because the API requires a `version` field for optimistic locking, but the client wasn't sending it
- **Root cause**: The `assignTechnicians.mutate()` calls weren't including the job's version field
- **Fix**:
  - Added `technicianUserId` field to `UpdateAssignmentParams` interface in `useCalendarDnD.ts`
  - Updated `updateAssignment` mutation to include `technicianUserId` in the API payload
  - Updated drag/drop handlers to include `technicianUserId` in the update mutation (single atomic call instead of two separate calls)
  - Updated `onAssignTechnicians` callback to pass version from `selectedAssignment`
- **Files changed**:
  - `client/src/hooks/useCalendarDnD.ts` - Add technicianUserId to UpdateAssignmentParams and mutation payload
  - `client/src/pages/Calendar.tsx` - Update drag/drop handlers and JobDetailDialog callback

#### Version error flash + double API call when assigning technician from JobDetailDialog

- **Bug**: When assigning a technician from the job detail dialog, there was a brief flash of "Required at 'version'" error, but the assignment would then succeed
- **Root cause**: `handleTechnicianToggle` in JobDetailDialog was making TWO API calls:
  1. `assignTechnicianMutation.mutate()` - without version field (caused error)
  2. `onAssignTechnicians()` callback - triggered a second call from Calendar.tsx (with version, succeeded)
- **Fix**:
  - Added `version` field to `assignTechnicianMutation` in JobDetailDialog (now included in API payload)
  - Removed redundant `onAssignTechnicians` callback call - the internal mutation now handles everything
- **Files changed**:
  - `client/src/components/JobDetailDialog.tsx` - Add version to mutation, remove duplicate callback

#### Cannot unassign technician (move job to "Unassigned" column)

- **Bug**: Dragging a job to the "Unassigned" column in day view didn't actually remove the technician assignment
- **Root cause**: When `technicianId === 'unassigned'`, the code set `technicianUserId: undefined` which meant it wasn't included in the API payload at all
- **Fix**: Changed `undefined` to `null` when unassigning - `null` explicitly tells the server to remove the technician
- **Files changed**:
  - `client/src/pages/Calendar.tsx` - Change `technicianUserId: undefined` to `technicianUserId: null` for unassign case

#### Calendar drag/drop feels sluggish (waiting for API response)

- **Bug**: Moving jobs on the calendar felt slow because the UI waited for the API response before updating
- **Root cause**:
  - `onSuccess` handlers used `await refetchCalendar()` which blocked the toast until refetch completed
  - `updateAssignment.onMutate` didn't update technician fields in optimistic update
  - `createAssignment.onMutate` didn't remove jobs from unscheduled sidebar optimistically
- **Fix**: Improved optimistic updates for instant visual feedback:
  - **updateAssignment**: Now includes technician fields (`assignedTechnicianId`, `assignedTechnicianIds`) in optimistic update for instant technician changes
  - **createAssignment**: Now removes job from unscheduled sidebar immediately when scheduling, includes client metadata for visual display
  - **All mutations**: Show success toast immediately, refetch calendar in background without blocking
  - Proper rollback on error restores both calendar and unscheduled sidebar state
- **Files changed**:
  - `client/src/hooks/useCalendarDnD.ts` - Enhanced optimistic updates and async refetch

#### Remove legacy `assignment.year`/`assignment.month` fallbacks causing "Invalid time value" errors

- **Bug**: JobDetailDialog and other components crashed with "Invalid time value" when using legacy fallback `${assignment.year}-${assignment.month}-01` because these fields no longer exist in canonical model
- **Fix**: Replaced all references to `assignment.year`, `assignment.month`, `assignment.day` with canonical date fields (`scheduledDate`, `date`, or parsed from `startAt`)
- **Files changed**:
  - `client/src/components/JobDetailDialog.tsx` - Remove legacy fallback in "Created" display
  - `client/src/pages/Calendar.tsx` - Update `calculatePartsWithDates`, `allWeekEvents` filter, old items dialog, unscheduled sidebar
  - `client/src/App.tsx` - Update `totalOverdueCount` filter for unscheduled backlog
- **Note**: The normalized `CalendarEvent` type still has `year`/`month`/`day` fields (these are derived from canonical fields during normalization and are valid)

#### Day View calendar crash due to UUID delimiter collision

- **Bug**: Day View calendar crashed in development mode when technicians had UUID IDs
- **Root cause**: Droppable IDs used `-` as delimiter (e.g., `daily-a20dcc3d-d306-49a8-8b2a-c26838f43069-0-0-28-0-2026`), but UUIDs also contain dashes. When split by `-`, this produced 11 segments instead of the expected 7, triggering a validation error.
- **Fix**: Changed delimiter from `-` to `|` for all calendar droppable IDs (daily, weekly, allday, techweek). Now IDs like `daily|a20dcc3d-d306-49a8-8b2a-c26838f43069|0|0|28|0|2026` split correctly into 7 segments.
- **Change scope**:
  - ID builders in `CalendarGridDay.tsx`, `CalendarGridWeek.tsx`, `CalendarGridWeekTechnicians.tsx`
  - ID parsers in `Calendar.tsx`
  - Collision detection and target type detection in `Calendar.tsx`
- Files: `client/src/components/calendar/CalendarGridDay.tsx`, `client/src/components/calendar/CalendarGridWeek.tsx`, `client/src/components/calendar/CalendarGridWeekTechnicians.tsx`, `client/src/pages/Calendar.tsx`

#### All-day constraint violation on Jobs API write paths

- **Bug**: `POST /api/jobs` and `PATCH /api/jobs/:id` could violate the `jobs_all_day_end_2359_check` PostgreSQL CHECK constraint when creating or updating all-day jobs
- **Root cause**: The Jobs storage layer (`createJob()`, `updateJob()`) did not call `sanitizeAllDayTimestamps()` before DB writes. The node-pg driver serializes JavaScript Date objects using local-timezone getters, which can produce incorrect timestamp values on non-UTC servers — breaking the constraint that requires `scheduledEnd` to be exactly `23:59:59` for all-day events
- **Fix**: Extracted `sanitizeAllDayTimestamps()`, `forceUTCTimestamp()`, and `assertAllDayUTCBoundaries()` from `server/storage/calendar.ts` into a shared utility (`server/utils/allDaySanitizer.ts`). Both calendar and jobs storage layers now import from the same utility. Added sanitization calls in `createJob()` and `updateJob()` right before the DB write.
- Files: `server/utils/allDaySanitizer.ts` (NEW), `server/storage/calendar.ts`, `server/storage/jobs.ts`

#### Timezone confirmation modal can't be dismissed (Prompt 5)

- **Bug**: After confirming timezone, the modal showed "saved" toast but stayed open, blocking the app
- **Root cause**: `invalidateQueries` triggers a background refetch; stale cache data (`timezoneConfirmed: false`) kept the modal visible during the refetch window
- **Fix**: Optimistically update the company settings cache via `queryClient.setQueryData` immediately on mutation success, setting `timezoneConfirmed: true` before the background refetch completes. Added `justConfirmed` local guard as a belt-and-suspenders defense against any stale-data flicker.
- Files: `client/src/components/TimezoneSetupDialog.tsx`

#### Timezone banner not dismissing after Regional Settings save (Prompt 6)

- **Bug**: Yellow "Set your company timezone" banner stayed visible after saving timezone in Regional Settings
- **Root cause**: Same stale-cache pattern — `RegionalSettingsPage` mutation only called `invalidateQueries` (background refetch) without optimistically updating the cache. Banner read stale `timezoneConfirmed: false` during the refetch window.
- **Fix**: Added `queryClient.setQueryData` in `RegionalSettingsPage` mutation `onSuccess` to immediately merge the server response (which includes `timezoneConfirmed: true`) into the cache. Banner and dialog both react instantly.
- Files: `client/src/pages/RegionalSettingsPage.tsx`

### Added

#### Taxes v1 Polish: Deletion Semantics + Invoice Consistency (Prompt 4)

- **`invoice_tax_lines` snapshot table**: New table freezes tax group composition at invoice creation time. Stores one row per component rate (e.g., GST 5% + PST 7% = 2 rows) with snapshotted rate name, percentage, taxable amount, and computed tax amount. Later edits to rates/groups do NOT affect historical invoices.
- **Tax DELETE hardening**: `DELETE /api/tax/:id` and `DELETE /api/tax/groups/:id` now check if the rate/group is referenced by any invoice (via `invoice_tax_lines` or `invoices.taxGroupId`). Always soft-deletes (sets `active=false`). Returns friendly message: "Deactivated because it's used on invoices. Historical invoices are unaffected."
- **Default group uniqueness**: `createTaxGroup`, `updateTaxGroup`, and `setDefaultTaxGroup` now use `SELECT FOR UPDATE` locking to prevent concurrent default assignment races (complements the partial unique index in PostgreSQL)
- **Invoice creation snapshots tax composition**: `POST /api/invoices/from-job/:jobId` now inserts `invoice_tax_lines` rows when applying the default tax group, freezing each rate's name, percentage, and computed tax amount
- **Migration**: `migrations/2026_01_28_add_invoice_tax_lines.sql`
- Files: `shared/schema.ts`, `server/storage/tax.ts`, `server/routes/tax.ts`, `server/routes/invoices.ts`

#### Timezone Required During Onboarding (Prompt 2 — onboarding gate)

- **Schema**: Added `timezoneConfirmedAt` timestamp column to `companySettings` (null = never confirmed)
- **Server**: `GET /api/company-settings` now includes `timezoneConfirmed` boolean derived from `timezoneConfirmedAt`
- **Server**: `PUT /api/company-settings` auto-stamps `timezoneConfirmedAt` when `timezone` field is included
- **Calendar API**: `GET /api/calendar` response now includes `timezoneConfirmed` flag; still returns fallback timezone when unconfirmed
- **TimezoneSetupDialog**: Blocking modal shown to owner/admin/manager roles when `timezoneConfirmed` is false; prefills from browser `Intl.DateTimeFormat`; cannot be dismissed without confirming
- **TimezoneSetupBanner**: Persistent amber banner shown globally when timezone is unconfirmed, linking to Regional Settings
- **Migration**: `migrations/2026_01_28_add_timezone_confirmed_at.sql`
- Files: `shared/schema.ts`, `server/routes/companySettings.ts`, `server/routes/calendar.ts`, `client/src/components/TimezoneSetupDialog.tsx`, `client/src/components/TimezoneSetupBanner.tsx`, `client/src/App.tsx`

#### Regional Settings Integration into Calendar UI (Prompt 3)

- **`useCompanyRegionalSettings()` hook**: New hook in `client/src/hooks/useCompanyRegionalSettings.ts` reads timezone, dateFormat, timeFormat, weekStartsOn from `/api/company-settings` with 5-minute cache; exports `nowInTimezone()` and `formatHourLabel()` helpers
- **Shared `TIMEZONE_OPTIONS`**: Consolidated into `client/src/lib/regionalConstants.ts` (superset of both previous lists); `RegionalSettingsPage.tsx` and `TimezoneSetupDialog.tsx` now import from shared constant
- **Calendar week/month views respect `weekStartsOn`**: `getWeekStart(date, weekStartsOn)` used in all 5 call sites (Calendar.tsx, CalendarGridWeek, CalendarGridWeekTechnicians, CalendarHeader, parts dialog); month grid day headers reorder to Mon-Sun or Sun-Sat; `firstDayOfMonth` offset adjusted for Monday-start grids
- **Calendar hour labels respect `timeFormat`**: CalendarGridWeek, CalendarGridDay, and CalendarHeader start-hour dropdown use `formatHourLabel(hour, timeFormat)` instead of inline 12h ternaries
- **Calendar "today" and "now" line use company timezone**: `nowInTimezone(tz)` replaces `new Date()` in CalendarGridWeek, CalendarGridDay, and CalendarGridWeekTechnicians for today highlight and current-time indicator
- **`timeFormat` threaded to event time display**: EventPreviewPopover, DraggableClient, and ResizableJobCard pass `timeFormat` to `formatTimeFromMinutes()` calls
- **Removed deprecated `getMondayOfWeek()`**: All callers migrated to `getWeekStart(date, weekStartsOn)`
- Files: `client/src/lib/regionalConstants.ts` (NEW), `client/src/hooks/useCompanyRegionalSettings.ts` (NEW), `client/src/pages/Calendar.tsx`, `client/src/components/calendar/calendarUtils.ts`, `client/src/components/calendar/CalendarHeader.tsx`, `client/src/components/calendar/CalendarGridWeek.tsx`, `client/src/components/calendar/CalendarGridDay.tsx`, `client/src/components/calendar/CalendarGridWeekTechnicians.tsx`, `client/src/components/calendar/CalendarGridMonth.tsx`, `client/src/components/calendar/EventPreviewPopover.tsx`, `client/src/components/calendar/DraggableClient.tsx`, `client/src/components/calendar/ResizableJobCard.tsx`, `client/src/pages/RegionalSettingsPage.tsx`, `client/src/components/TimezoneSetupDialog.tsx`

#### Company Regional Settings (Prompt 2)

- **Schema**: Added `dateFormat`, `timeFormat`, `weekStartsOn` columns to `companySettings` table
  - `dateFormat`: `"MM/DD/YYYY"` | `"DD/MM/YYYY"` | `"YYYY-MM-DD"` (default: `"MM/DD/YYYY"`)
  - `timeFormat`: `"12h"` | `"24h"` (default: `"12h"`)
  - `weekStartsOn`: `"monday"` | `"sunday"` (default: `"monday"`)
- **Zod validation**: Added regional fields to `updateCompanySettingsSchema` in `server/routes/companySettings.ts`
- **Calendar timezone fix**: `buildRangeResponse()` in `server/routes/calendar.ts` now returns company timezone from settings instead of server process timezone (`getServerTimezone()` removed as dead code)
- **Calendar utils**: `formatTimeFromMinutes()` now accepts `timeFormat` parameter for 12h/24h display; `getWeekStart()` replaces `getMondayOfWeek()` with `weekStartsOn` support (legacy `getMondayOfWeek()` retained as deprecated alias)
- **Regional Settings page**: New `client/src/pages/RegionalSettingsPage.tsx` with Timezone, Date/Time Format, and Week Start selectors
- **Route registered**: `/settings/regional` in `client/src/App.tsx`, accessible from Settings page via Globe icon card
- **Migration**: `migrations/2026_01_28_add_regional_settings.sql`
- Files: `shared/schema.ts`, `server/routes/companySettings.ts`, `server/routes/calendar.ts`, `client/src/pages/RegionalSettingsPage.tsx`, `client/src/pages/SettingsPage.tsx`, `client/src/App.tsx`, `client/src/components/calendar/calendarUtils.ts`

#### Tax Settings v1: Multi-Tax Rates & Groups (Prompt 3)

- **3 new DB tables**:
  - `company_tax_rates` — Individual tax rates (e.g., GST 5%, PST 7%, HST 13%)
  - `company_tax_groups` — Composable groups (e.g., "GST+PST" = 12%)
  - `company_tax_group_rates` — Junction table linking groups to rates
  - Partial unique index: one default group per company
- **Invoice integration**: Added `taxGroupId` column to `invoices` table (nullable, FK to `company_tax_groups`)
- **Storage layer**: `server/storage/tax.ts` — full CRUD repository for rates, groups, and default group management
- **API routes**: `server/routes/tax.ts` mounted at `/api/tax` — CRUD endpoints for rates (`GET/POST/PUT/DELETE`) and groups (`GET/POST/PUT/DELETE /groups`, `POST /groups/:id/set-default`)
- **Invoice line tax application**: When creating an invoice from a job, the default tax group's combined rate is automatically applied to all line items
- **`updateInvoiceLine`**: New storage method for updating individual invoice line fields (used by tax integration)
- **TaxBillingRulesPage**: Replaced "Coming Soon" placeholder with full CRUD UI for tax rates and tax groups, including add/edit/delete dialogs, rate composition checkboxes, combined rate display, and default group toggle
- **Migration**: `migrations/2026_01_28_add_tax_rates_and_groups.sql`
- Files: `shared/schema.ts`, `server/storage/tax.ts`, `server/storage/invoices.ts`, `server/storage/index.ts`, `server/routes/tax.ts`, `server/routes/index.ts`, `server/routes/invoices.ts`, `client/src/pages/TaxBillingRulesPage.tsx`

### Fixed

#### All-day scheduling UTC timestamp hardening (Prompt 1 regression guard)
- Added `assertAllDayUTCBoundaries()` DEV-only assertion in `server/storage/calendar.ts`
  - Validates ISO start ends with `T00:00:00.000Z` and end with `T23:59:59.000Z` before SQL cast
  - Emits `[ALLDAY ASSERT FAIL]` console error if domain layer produces bad boundaries
  - Runs inside `sanitizeAllDayTimestamps()` before Date→SQL replacement
- Updated DEV log to use `scheduledStartIso` / `scheduledEndIso` field names for clarity
- Existing hardening already in place: `forceUTCTimestamp()`, `sanitizeAllDayTimestamps()`, calls in all 4 write paths (`scheduleJob`, `rescheduleJob`, `scheduleJobBypassWorkingHours`, `rescheduleJobBypassWorkingHours`)
- Files: `server/storage/calendar.ts`

#### Fix jobs_all_day_end_2359_check constraint violation on all-day scheduling
- **Root cause**: `timestamp without time zone` columns + node-pg Date
  serialization. The pg driver serializes Date objects using LOCAL time
  (`date.getHours()`, etc.), not UTC. PostgreSQL strips the timezone offset
  for `timestamp` columns and stores the local representation. When the
  server process isn't in UTC, `23:59:59.000Z` gets stored as e.g.
  `18:59:59` (EST), failing the `AT TIME ZONE 'UTC'` check constraint.
- **Fix**: Added centralized `sanitizeAllDayTimestamps()` helper in the
  storage layer that replaces Date objects with UTC-safe SQL expressions
  (`date.toISOString()::timestamp`) before every DB write. PostgreSQL
  ignores the Z suffix for `timestamp` columns, storing the literal UTC
  time values — guaranteeing 00:00:00 start and 23:59:59 end.
- **Coverage**: Applied to all 4 storage write paths: `scheduleJob`,
  `scheduleJobBypassWorkingHours`, `rescheduleJob`,
  `rescheduleJobBypassWorkingHours`.
- **DEV log**: `[SCHEDULE ALLDAY]` emitted at both the route handler and
  storage layer before DB write, logging jobId, date, scheduledStart, and
  scheduledEnd ISO strings.
- Files: `server/storage/calendar.ts`, `server/routes/calendar.ts`

#### Eliminate useSortable for unscheduled cards — fix silent drag failures
- **Root cause**: `useSortable` internally registers both a draggable AND a
  droppable, and its SortableContext lookup silently fails for items whose IDs
  don't match the context array (e.g., after optimistic dedup or id mutation).
  This left specific cards (e.g., Basil Box) with inert listeners — pointerdown
  reached the draggable root but the sensor never activated, triggering the
  `[DRAG-WARN] pointerdown without drag-start within 250ms` diagnostic.
- **Fix**: Replaced all `useSortable` usage with a single unconditional
  `useDraggable` call for ALL items (both calendar and unscheduled). No sentinel
  IDs needed. No SortableContext dependency for individual items.
- **Drag rules (Model A)**: Draggable UNLESS `DRAG_ENABLED` is false OR
  `isSaving` is true. No legacy overdue/assigned/status checks — server rejects
  invalid drops.
- **DEV `[UNSCHED-DRAG]` logging**: Every unscheduled card render logs jobId,
  clientName, disabled state, reason, status, openSubStatus, version,
  scheduledStart, scheduledEnd, deletedAt, and listener info.
- **`rawItem` prop**: Calendar.tsx now passes `rawItem={item}` to DraggableClient
  for comprehensive DEV diagnostic logging.
- Files: `client/src/components/calendar/DraggableClient.tsx`,
  `client/src/pages/Calendar.tsx`, `client/src/components/UnscheduledJobsSidebar.tsx`

#### Fix unscheduled cards that won't drag (conditional hooks violation)
- **Eliminated conditional hook calls**: `DraggableClient.tsx` previously used
  `inCalendar ? useDraggable() : null` and `!inCalendar ? useSortable() : null`,
  violating React's rules of hooks. Under StrictMode or concurrent features,
  some card instances could get mismatched hook state, causing listeners to
  silently vanish (explaining why cards #2 and #4 specifically failed while
  others worked). Both hooks are now called unconditionally every render;
  the unused hook receives a sentinel ID (`__noop_drag_` / `__noop_sort_`
  prefix) so dnd-kit doesn't register conflicting draggable/sortable entries.
- **Cursor-grab on unscheduled cards**: `getCursorStyle()` was previously
  gated behind `${inCalendar ? getCursorStyle() : ""}`, giving unscheduled
  cards no grab cursor. Now applied unconditionally to all draggable cards.
- **DEV `onPointerDownCapture` diagnostic**: Unscheduled cards now log
  `[UNSCHEDULED pointerdown root]` with jobId, disabled state, reason, and
  target element info on every pointerdown in development mode.
- **Pointer guards on unscheduled interactive children**: Saving spinner
  (`Loader2`) and hidden-technician warning (`AlertTriangle`) now have
  `onPointerDown`/`onMouseDown` stopPropagation to prevent stealing drag.
- **Click handling fix**: Removed `inCalendar` gate from click predicate —
  unscheduled cards now properly fire their `onClick` callback.
- **data-testid consistency**: Unscheduled card testid changed from
  `unscheduled-client-${client.id}` to `unscheduled-client-${id}` to match
  the drag ID used by dnd-kit.
- Files: `client/src/components/calendar/DraggableClient.tsx`

#### Drag-start reliability hardening (Calendar + Unscheduled sidebar)
- **Drag listeners moved to root element**: In `DraggableClient.tsx`, moved
  `{...listeners}` from a nested child `<div>` to the root draggable container.
  Previously, padding around the inner div created dead zones where pointerdown
  missed the sensor entirely. Also added `touchAction: "none"` to prevent
  browser gestures from competing with drag.
- **CalendarEventChip touchAction**: Added `touchAction: "none"` to the chip
  root style to prevent mobile scroll/gesture interference.
- **Interactive children pointer guards**: Added `onPointerDown` and
  `onMouseDown` with `stopPropagation()` to all interactive children inside
  draggable cards: remove buttons and "+N more" PopoverTrigger in
  `CalendarGridMonth.tsx`, reschedule/unschedule quick-action buttons in
  `ResizableJobCard.tsx`. Prevents these elements from swallowing the
  pointer event before the drag sensor sees it.
- **Sensor distance reduced to 3px**: `PointerSensor` activation constraint
  in `Calendar.tsx` reduced from `distance: 5` to `distance: 3` for more
  responsive first-attempt drag activation.
- **DEV-only missed-drag diagnostic**: Calendar now monitors `pointerdown`
  events on draggable elements and logs `[DRAG-WARN] pointerdown without
  drag-start within 250ms` if the drag sensor doesn't fire. Timer is cleared
  on successful `handleDragStart`. Only active in development mode.
- Files: `client/src/components/calendar/DraggableClient.tsx`,
  `client/src/components/calendar/CalendarEventChip.tsx`,
  `client/src/components/calendar/CalendarGridMonth.tsx`,
  `client/src/components/calendar/ResizableJobCard.tsx`,
  `client/src/pages/Calendar.tsx`

#### Minute-precision diagnostic logging + canonical startMinutes derivation
- **DEV-only `[DROP]` logging**: `handleDragEnd` in `Calendar.tsx` now logs
  intended hour:minute for weekly- and daily- timed targets before firing
  mutations. Log format: `[DROP] weekly timed target: { intendedHour, intendedMinute, targetDay, ... }`.
- **DEV-only `[DROP-RESULT]` logging**: `createAssignment.onSuccess` and
  `updateAssignment.onSuccess` in `useCalendarDnD.ts` now capture and log
  the mutation result: `[DROP-RESULT] { jobId, serverStartAt, serverEndAt, serverVersion }`.
  Previously the result was discarded as `_`.
- **`getAssignmentStartMinutes()` canonical derivation**: Now prefers `startAt`
  (or `scheduledStart`) ISO datetime to derive minutes-from-midnight, falling
  back to legacy `scheduledHour`/`scheduledStartMinutes` only when no ISO
  field exists. Prevents stale minute values after `toCanonicalEvent()` or
  `canonicalizeCalendarCache()` updates the raw event's `startAt` but not the
  legacy fields. Affects time labels in `DraggableClient`, `ResizableJobCard`,
  `EventPreviewPopover`, and lane calculation in `calculateLanes`.
- **UI rounding audit**: Confirmed `formatTimeFromMinutes()` uses `minutes % 60`
  with `padStart(2, '0')` — no `Math.floor`/`Math.round` on the minute value.
  No rounding issues found in the display pipeline.
- Files: `client/src/pages/Calendar.tsx`, `client/src/hooks/useCalendarDnD.ts`,
  `client/src/components/calendar/calendarUtils.ts`

#### Calendar minute-precision contract: strict timed drop-target parsing
- **Strict timed-target validation in `handleDragEnd`**: `weekly-` and `daily-`
  target IDs now reject drops with missing/NaN minute or hour segments. On
  invalid parse: `console.error` with full target ID, abort mutation, show
  user toast "Invalid drop target time. Please refresh." No silent fallback to
  minute=0. (`client/src/pages/Calendar.tsx`)
- **DEV-only QuarterDropZone segment assertions**: In development mode,
  `QuarterDropZone` in `CalendarGridWeek.tsx` asserts `weekly-` IDs have
  exactly 5 segments; in `CalendarGridDay.tsx` asserts `daily-` IDs have
  exactly 7 segments. Throws `Error("Timed droppable id missing minutes: …")`
  on violation — catches regressions at render time before any drop occurs.
- **Audit confirmed**: All timed slot ID generators already emit minute
  segments via `[0, 15, 30, 45].map()` in `QuarterDropZone`. No legacy
  hourly-only IDs exist. `CalendarGridWeekTechnicians.tsx` uses `techweek-`
  prefix (day-level, not timed) — no change needed.
- Files: `client/src/pages/Calendar.tsx`,
  `client/src/components/calendar/CalendarGridWeek.tsx`,
  `client/src/components/calendar/CalendarGridDay.tsx`

#### Single canonical overdue predicate: calendar delegates to shared isJobOverdue()
- **Deleted duplicate overdue rules**: Removed `isEventOverdue()` (local multi-
  fallback logic) and `isOverdueDate()` (deprecated scheduledDate check) from
  `calendarUtils.ts`. Calendar now uses one thin adapter `isCalendarEventOverdue()`
  that maps CalendarEvent fields to the canonical `isJobOverdue()` from
  `shared/schema.ts`. Overdue is derived from `status + scheduledStart/scheduledEnd
  + durationMinutes` only — no `completed` flag, no `scheduledDate` fallback.
- **CalendarGridMonth.tsx**: Removed local day-level `dayDate < today` overdue
  variable. All 4 `!event.completed && isOverdue` checks replaced with
  `isCalendarEventOverdue(event)`.
- **CalendarGridWeek.tsx**: 2 overdue checks → `isCalendarEventOverdue(event)`.
- **CalendarGridDay.tsx**: 3 overdue checks → `isCalendarEventOverdue(event)`.
- Files: `client/src/components/calendar/calendarUtils.ts`,
  `client/src/components/calendar/CalendarGridMonth.tsx`,
  `client/src/components/calendar/CalendarGridWeek.tsx`,
  `client/src/components/calendar/CalendarGridDay.tsx`

#### Model A cache normalization + eliminate remaining assignments-only cache writes
- **`canonicalizeCalendarCache()` post-refetch**: All four `onSuccess` handlers
  that `await refetchCalendar()` (schedule, reschedule, resize, unschedule) now
  call `canonicalizeCalendarCache()` immediately after. This ensures fresh server
  responses (which may use `scheduledStart`/`scheduledEnd`) are patched to
  `{ startAt, endAt }` in the React Query cache before any downstream code reads
  them. (`client/src/hooks/useCalendarDnD.ts`)
- **TechnicianDashboard Model A naming**: Renamed `allAssignments` → `allEvents`
  to match Model A terminology; month merge already used
  `events ?? assignments` fallback. (`client/src/pages/TechnicianDashboard.tsx`)
- **`isEventOverdue()` replaced scheduledDate-based checks**: (Now superseded
  by `isCalendarEventOverdue()` above.)
- Files: `client/src/hooks/useCalendarDnD.ts`,
  `client/src/pages/TechnicianDashboard.tsx`,
  `client/src/components/calendar/calendarUtils.ts`,
  `client/src/components/calendar/CalendarGridWeek.tsx`,
  `client/src/components/calendar/CalendarGridDay.tsx`

#### Calendar minute-precision + time-field canonicalization (finish pass)
- **`toCanonicalEvent()` helper**: Added to `useCalendarDnD.ts` — maps
  `scheduledStart→startAt` and `scheduledEnd→endAt` on any raw or optimistic
  event written to React Query cache. Applied in both `createAssignment.onMutate`
  and `updateAssignment.onMutate` optimistic writes.
- **Defensive overdue date parsing**: Added `isOverdueDate()` helper to
  `calendarUtils.ts` using `toValidDate()` instead of raw `new Date()`.
  Replaced all `new Date(event.scheduledDate) < new Date()` calls in
  `CalendarGridWeek.tsx` (2 occurrences) and `CalendarGridDay.tsx`
  (3 occurrences) to prevent "Invalid time value" crashes.
- **Drop-target minute parsing verified**: Weekly drop zones produce
  `weekly-{day}-{hour}-{minute}-{dayNumber}` and daily zones produce
  `daily-{tech}-{hour}-{minute}-{day}-{month}-{year}`, both correctly parsed
  in `Calendar.tsx` `handleDragEnd`. No code changes needed.
- Files: `client/src/hooks/useCalendarDnD.ts`,
  `client/src/components/calendar/calendarUtils.ts`,
  `client/src/components/calendar/CalendarGridWeek.tsx`,
  `client/src/components/calendar/CalendarGridDay.tsx`

#### Calendar UX + correctness hardening (Model A)
- **Drop-time minutes preserved**: Optimistic updates in `useCalendarDnD.ts` now
  compute and include canonical `startAt`/`endAt` ISO strings so
  `normalizeAssignments()` picks up exact drop coordinates (12:45 stays 12:45,
  not rounded to 12:00). Mutation responses normalized scheduledStart→startAt.
- **"Invalid time value" eliminated**: `normalizeAssignments()` in
  `calendarUtils.ts` now patches `raw` to always carry `startAt`/`endAt`, even
  when the source event only has `scheduledStart`/`scheduledEnd`.
- **Unscheduled sidebar shows client + summary**: `getUnscheduledCompanyName()`
  now checks `customerCompanyName` (the actual API field); `DraggableClient`
  accepts and displays `summary` prop on unscheduled cards.
- **Drag activation improved**: `PointerSensor` distance reduced from 8→5 for
  more responsive first-attempt drag starts.
- Files: `client/src/hooks/useCalendarDnD.ts`, `client/src/pages/Calendar.tsx`,
  `client/src/components/calendar/DraggableClient.tsx`,
  `client/src/components/calendar/calendarUtils.ts`

#### All-Day CHECK constraints: evaluate times in UTC (timestamptz-safe)
- `EXTRACT(HOUR/MINUTE/SECOND FROM timestamptz)` uses session timezone, not UTC;
  UTC values (00:00:00Z / 23:59:59Z) can fail in non-UTC sessions
- Recreated `jobs_all_day_start_midnight_check` and `jobs_all_day_end_2359_check`
  with `AT TIME ZONE 'UTC'` so EXTRACT always evaluates against UTC
- Changed guard from `is_all_day = false OR ... IS NULL` to
  `is_all_day IS DISTINCT FROM TRUE` (NULL-safe, same semantics via CHECK NULL pass-through)
- Migration: `migrations/2026_01_27_fix_all_day_constraints_utc.sql`
- Drizzle schema updated: `shared/schema.ts` (check definitions match migration)

#### Calendar Diagnostics: 4xx/5xx errors now correctly classified as failures
- `addDiagEntry()` auto-derives `isFail: true` when `type` ends with `-error`,
  `type === 'invariant-fail'`, or `data.status >= 400`
- Previously `logMutationError` emitted `{ type: "mutation-error", status: 500, isFail: false }`
- `invariantFailures` count in `generateReport()` now increments for all failures
- File: `client/src/lib/calendarDiagnostics.ts`

#### All-Day Scheduling: Eliminate duplicate normalization causing DB constraint violations

- **Symptom:** `POST /api/calendar/schedule` with `{ allDay: true, date }` sometimes
  throws `violates check constraint "jobs_all_day_end_2359_check"`.
- **Root cause:** Storage layer had duplicate all-day normalization blocks that
  could diverge from the canonical `normalizeScheduleTimes()` helper. Both
  `scheduleJob()` and `rescheduleJob()` re-derived timestamps after the domain
  layer had already computed them, and bypass functions used inline derivation
  instead of the shared helper.
- **Fix: Single helper, single code path** — `normalizeScheduleTimes()` in
  `server/domain/scheduling.ts` is now the only place that computes all-day
  boundaries (`00:00:00.000Z` start, `23:59:59.000Z` end).
- **Storage layer cleaned** (`server/storage/calendar.ts`):
  - Removed duplicate all-day blocks from `scheduleJob()` and `rescheduleJob()`
    (domain layer's `applyJobSchedulingPatch` already normalizes)
  - Replaced inline normalization in `scheduleJobBypassWorkingHours()` and
    `rescheduleJobBypassWorkingHours()` with `normalizeScheduleTimes()` calls
- **Assertion tightened** (`server/domain/scheduling.ts`):
  - `assertAllDayTimestampInvariant()` no longer accepts next-day midnight;
    only `23:59:59` on the same day is valid, matching DB constraint exactly
- **Client fix** (`client/src/lib/jobScheduling.ts`):
  - `createJobWithSchedule()` now uses `T23:59:59.000Z` for all-day end
    instead of next-day midnight (`T00:00:00.000Z` of day+1)

#### All-Day Scheduling: Original normalizeScheduleTimes helper (prior session)

- **Created `normalizeScheduleTimes()` helper** (`server/domain/scheduling.ts`):
  - Single source of truth for computing scheduledStart/scheduledEnd from route input
  - All-day: `00:00:00.000Z` start, `23:59:59.000Z` end (zero milliseconds)
  - Timed: start from startAt, end from endAt or start + durationMinutes (default 60)
  - Used by both POST /api/calendar/schedule and PATCH /api/calendar/schedule/:jobId
- **Fixed `deriveScheduleFields()`** to delegate all-day computation to `normalizeScheduleTimes()`
- **Route handlers refactored** (`server/routes/calendar.ts`):
  - Replaced inline time computation with `normalizeScheduleTimes()` calls
  - Both POST and PATCH endpoints now go through the same normalization

#### Calendar Page: Fix crash from outdated API contract

- **Updated `client/src/pages/Calendar.tsx`** to read `events` field from server response
  instead of legacy `assignments` field, matching `CalendarRangeResponseDto`.
- Backward-compatible fallback: `data?.events ?? data?.assignments` during transition.
- Renamed variables: `rawAssignments` → `rawEvents`, outer `assignments` → `events`,
  inner `events` (in useMemo) → `normalized` to avoid shadowing.
- Updated all 12+ call sites (`events.some(...)`, `events.find(...)`, `events.filter(...)`)
  in drag handlers, active client lookup, and parts calculation.
- Added `v.events` check to `normalizeArray` utility (before legacy `v.assignments` fallback).
- Updated dev assertion error message to reference `events` instead of `assignments`.

#### Calendar Module: Complete Model A migration (client-side)

- **Canonical `assignmentId = jobId` mapping** (`client/src/components/calendar/calendarUtils.ts`):
  - `normalizeAssignments` now sets `assignmentId: a.jobId ?? a.id` (was `a.id`)
  - Ensures all drag/drop, grid keys, and mutations use the job ID consistently
  - Renamed function parameter `rawAssignments` → `rawEvents`; updated all dev-only
    log messages from "assignment" to "event" terminology
  - Updated `CalendarEvent` type JSDoc to document MODEL A contract
- **Optimistic cache updates** (`client/src/hooks/useCalendarDnD.ts`):
  - All three mutation blocks (create/update/delete) now read `events` field from cache
    (falling back to `assignments` for backward compat) and write back as `events`
  - Renamed internal `deletedAssignment` → `deletedEvent`
- **TechnicianDashboard** (`client/src/pages/TechnicianDashboard.tsx`):
  - Month data merge now reads `events` field first (`?.events ?? ?.assignments`)

### Changed

#### Jobs Page: Separate Schedule, Status, and Assignment Columns

- **Restructured Jobs table columns** (`client/src/pages/Jobs.tsx`):
  - **Schedule** column: shows date (e.g., "Jan 27, 2026") or "Not scheduled"
  - **Status** column: lifecycle badge (Open/Completed/Invoiced/Archived) +
    optional openSubStatus label (In Progress/On Route/On Hold/Needs Review) +
    Overdue and All-day indicators. "Backlog" never appears in this column.
  - **Assignment** column (NEW): shows primary technician name + "+N" for
    additional technicians, or "Unassigned". Fetches names via `/api/team/technicians`.
- Removed unused `Users` icon import
- Backlog concept retained in filters and dev reconciliation panel only

#### Eradicate Legacy "Assignment" Terminology + Regression Guard

- **Renamed `CalendarAssignmentWithDetails` → `CalendarJobWithDetails`**:
  - No separate "assignment" entity exists; calendar events ARE jobs
  - `CalendarRangeResult.assignments` → `CalendarRangeResult.jobs`
  - Updated all import sites and type references

- **Renamed CalendarRepository methods to job-centric terminology**:
  - `getAssignmentsInRange` → `getScheduledJobsInRange`
  - `getAssignmentsInRangeWithMetadata` → `getScheduledJobsInRangeWithMetadata`
  - `getAssignmentById` → `getJobById`
  - `createAssignment` → `scheduleJob`
  - `updateAssignment` → `rescheduleJob`
  - `deleteAssignment` → `unscheduleJob`
  - `createAssignmentBypassWorkingHours` → `scheduleJobBypassWorkingHours`
  - `updateAssignmentBypassWorkingHours` → `rescheduleJobBypassWorkingHours`

- **Renamed IStorage calendar bindings**:
  - `getCalendarAssignmentsInDateRange` → `getCalendarScheduledJobsInDateRange`
  - `getCalendarAssignment` → `getCalendarJob`
  - `createCalendarAssignment` → `scheduleCalendarJob`
  - `updateCalendarAssignment` → `rescheduleCalendarJob`
  - `deleteCalendarAssignment` → `unscheduleCalendarJob`

- **Audit context labels intentionally preserved** (`"storage:createAssignment"`,
  `"storage:updateAssignment"`, `"storage:deleteAssignment"`) — these are stored
  in the database; changing them would break historical audit data lookups.

- **Files updated**:
  - `server/storage/calendar.ts` — type rename, method renames, JSDoc updates
  - `server/routes/calendar.ts` — import rename, call site updates, destructuring updates
  - `server/storage/index.ts` — IStorage interface + storage bindings renamed
  - `tests/scheduling.smoke.test.ts` — call site + destructuring updates

### Added

#### Regression Test: No Legacy Job Statuses

- **New test `tests/no-legacy-statuses.test.ts`** — uses ripgrep to scan `server/`,
  `client/`, `shared/` for banned legacy status strings used as job lifecycle values:
  - Banned: `scheduled`, `assigned`, `unscheduled`, `overdue`, `in_progress`, `requires_invoicing`
  - `in_progress` uses PCRE2 negative lookbehind to exclude valid `openSubStatus` comparisons
  - Allowlist excludes migration scripts, status rules docs, display-only UI labels, tests, etc.
  - Prevents accidental reintroduction of legacy status values

#### Fix Scheduling Smoke Tests Schema Drift

- **Renamed `tests/ensureTestSchema.ts` → `tests/ensureTestDbInvariants.ts`**:
  - Scoped explicitly to NODE_ENV=test (throws on import outside tests)
  - Applies idempotent DDL patches, then runs a schema-expectation audit
  - Audit verifies required columns: `open_sub_status`, `version`,
    `scheduled_start`, `scheduled_end`, `deleted_at`
  - Audit verifies required constraints: `jobs_status_check`,
    `jobs_open_sub_status_invariant_check`, `jobs_scheduled_end_requires_start_check`,
    `jobs_all_day_start_midnight_check`, `jobs_all_day_end_2359_check`
  - Fails hard with actionable "apply real migrations" message if any are missing

- **Fixed `tests/scheduling.smoke.test.ts` Test 2 legacy status assertion**:
  - Removed `status: "scheduled"` from updateJob call (violated `jobs_status_check`)
  - Changed assertion from `status === "scheduled"` to `status === "open"`
  - Scheduling is now derived from `scheduledStart IS NOT NULL`, not status value

- **Updated `tests/setup.ts`**:
  - Sets `NODE_ENV=test` before importing invariants module
  - Calls `ensureTestDbInvariants()` in `beforeAll`

- **Files changed**:
  - `tests/ensureTestSchema.ts` — **NEW** — idempotent DDL patches
  - `tests/setup.ts` — calls ensureTestSchema in beforeAll
  - `tests/scheduling.smoke.test.ts` — fixed legacy status assertion

#### Phase 2 Step 10: Jobs Page Canonical Predicate Alignment

- **Fixed overdue filter/display drift in Jobs page**:
  - Overdue filter previously used `statusInfo.isOverdue` which short-circuits on sub-status
    (`in_progress`, `on_route`, etc.) before reaching the overdue check — missing overdue jobs
    that have a sub-status set. Now uses canonical `isJobOverdue` predicate directly via `_overdue`.
  - Overdue badge in table rows also switched from `statusInfo.isOverdue` to `_overdue`.
  - Added `_overdue` to enriched job alongside `_scheduled`, `_assigned`, `_backlog`.

- **Added dev-only reconciliation panel** (`import.meta.env.DEV` gated):
  - Toggle button shows/hides a panel comparing client-side counts vs `/api/calendar/state-snapshot`.
  - Client section: lifecycle counts, derived counts (openScheduled, backlog, overdue).
  - Server section: state-snapshot totals, invariant checks (open = scheduled + backlog, violations).
  - Diff section: highlights any drift between client and server counts.
  - Sample JobIds section: up to 10 job IDs per bucket for debugging.
  - Fetches state-snapshot only when panel is open; not loaded in production.

- **Files updated**:
  - `client/src/pages/Jobs.tsx` — canonical predicate alignment, dev reconciliation panel

#### Phase 2 Step 9: Soft-Delete Enforcement (Final Audit)

- **Fixed `deleteJob()` to use `deletedAt` instead of just `isActive`**:
  - Sets `deletedAt = NOW()` for canonical soft delete
  - Increments `version` for optimistic locking
  - Also sets `isActive = false` for legacy compatibility
  - Only deletes if not already deleted (`deletedAt IS NULL`)

- **Added `deletedAt IS NULL` filter to all job queries in `server/storage/jobs.ts`**:
  - `getJobs()` - job list query (line 226)
  - `getJob()` - single job fetch (line 371)
  - `updateJobStatusWithEvent()` - status update transaction (line 1245)
  - `getActionRequiredJobs()` - on-hold/needs-review query (line 1360)

- **Fixed UI query invalidation after job deletion**:
  - `JobDetailPage.tsx` now invalidates `/api/calendar` and `/api/maintenance` queries
  - Ensures deleted job disappears from calendar and maintenance views

- **Calendar storage already had correct filters**:
  - `getAssignmentsInRange()` - includes `isNull(jobs.deletedAt)` at line 193
  - `getUnscheduledJobs()` - includes `isNull(jobs.deletedAt)` at line 391

- **Files updated**:
  - `server/storage/jobs.ts` - Added `isNull` import, soft-delete filters to 4 queries, fixed `deleteJob()`
  - `client/src/pages/JobDetailPage.tsx` - Added calendar/maintenance query invalidation

#### Phase 2 Step 8: Canonical Duration (Eliminate Scheduling Drift)

- **Renamed `estimated_duration_minutes` → `duration_minutes`** on jobs table:
  - Single canonical duration source for scheduled jobs
  - Eliminates drift between "estimated" and "actual" scheduled duration
  - Column rename via migration (no data change needed)

- **Canonicalized `isJobOverdue` effectiveEnd computation**:
  - Priority order: scheduledEnd > scheduledStart + durationMinutes > scheduledStart
  - Removed estimatedDurationMinutes from overdue logic
  - Updated SQL in dashboard.ts, admin.ts, maintenance.ts

- **Canonicalized Calendar DTO durationMinutes**:
  - All-day: 1440 (24 hours)
  - Timed with scheduledEnd: computed from timestamps
  - Job has durationMinutes: use job.durationMinutes
  - Default fallback: 60 minutes
  - Ensures UI uses same duration as scheduling

- **Added durationMinutes to CalendarAssignmentWithDetails**:
  - Interface now includes `durationMinutes: number | null`
  - All calendar queries select jobs.durationMinutes
  - Transformation objects include durationMinutes

- **Files updated**:
  - `shared/schema.ts` - Renamed column, updated isJobOverdue
  - `server/storage/calendar.ts` - Added durationMinutes to interface and queries
  - `server/storage/dashboard.ts` - SQL uses durationMinutes
  - `server/storage/admin.ts` - SQL uses durationMinutes
  - `server/storage/maintenance.ts` - SQL uses durationMinutes
  - `server/routes/calendar.ts` - transformToDto uses job.durationMinutes
  - `client/src/components/job/jobUtils.ts` - Updated type signatures

- **Migration**: `migrations/2026_01_27_rename_estimated_to_duration_minutes.sql`
  - Renames column from estimated_duration_minutes to duration_minutes

- **Remaining estimatedDurationMinutes usages** (allowed - template/input defaults):
  - `recurring_job_templates.estimatedDurationMinutes` - template default
  - `job_visits.estimatedDurationMinutes` - visit duration estimate
  - `tasks.estimatedDurationMinutes` - task duration estimate

#### Phase 2 Step 7: Stability & Correctness Hardening

- **DB CHECK constraints** - Added hard enforcement at database level:
  - `jobs_status_check` - status must be one of: open, completed, invoiced, archived
  - `jobs_scheduled_end_requires_start_check` - scheduledEnd requires scheduledStart
  - `jobs_all_day_start_midnight_check` - all-day events must have scheduledStart at 00:00:00
  - `jobs_all_day_end_2359_check` - all-day events must have scheduledEnd at 23:59:59

- **Runtime `assertJobInvariants(job)` function** in `server/domain/scheduling.ts`:
  - Runs in all environments (production + dev), not just dev mode
  - Throws `InvariantViolationError` with code `INVARIANT_VIOLATION` (400 status)
  - Checks all 6 invariants: status, openSubStatus, scheduledEnd requires start, all-day timestamps, end >= start

- **Expanded `/api/calendar/state-snapshot` endpoint**:
  - Now returns `violations` object with counts and job IDs for each invariant type
  - Violation types: invalidStatus, orphanedOpenSubStatus, endWithoutStart, allDayStartNotMidnight, allDayEndNot2359, endBeforeStart
  - Added `_invariants.no_violations` and `_invariants.total_violation_count` for quick health checks

- **Files updated**:
  - `shared/schema.ts` - Added 4 new CHECK constraints to jobs table
  - `server/domain/scheduling.ts` - Added `InvariantViolationError` class and `assertJobInvariants()` function
  - `server/storage/calendar.ts` - Expanded `getStateSnapshot()` to query for violations
  - `server/routes/calendar.ts` - Updated state-snapshot response to include violations

- **Migration**: `migrations/2026_01_27_add_job_invariant_constraints.sql`
  - Adds 4 CHECK constraints for status, scheduling, and all-day invariants

#### Phase 2 Step 5: Canonical "Overdue" Derived Flag (Updated)

- **AUTHORITATIVE RULE** - A job is overdue ONLY when:
  - `status === 'open'` (completed/invoiced/archived are NEVER overdue)
  - `scheduledStart IS NOT NULL` (backlog/unscheduled is NEVER overdue)
  - `effectiveEnd < now` (job should have finished by now)

- **effectiveEnd calculation** (priority order):
  1. `scheduledEnd` if present (includes all-day jobs with 23:59:59 end time)
  2. `scheduledStart + estimatedDurationMinutes` if duration exists
  3. `scheduledStart` as fallback (point-in-time job)

- **Single canonical `isJobOverdue(job, now?)` predicate** in `shared/schema.ts`:
  - Used consistently across client and server code
  - All-day jobs only become overdue once the entire day has passed (23:59:59 end time)
  - Removed all duplicate inline overdue calculations

- **Files updated**:
  - `shared/schema.ts` - Updated `isJobOverdue(job, now?)` to use effectiveEnd with estimatedDurationMinutes
  - `client/src/components/job/jobUtils.ts` - Both functions use canonical predicate, includes priority field
  - `client/src/pages/Jobs.tsx` - Removed duplicate local `getJobStatusDisplay`, now imports from jobUtils.ts
  - `server/storage/admin.ts` - SQL CASE expression for effectiveEnd with estimatedDurationMinutes
  - `server/storage/dashboard.ts` - SQL CASE expression for effectiveEnd with estimatedDurationMinutes
  - `server/storage/maintenance.ts` - SQL CASE expression for effectiveEnd with estimatedDurationMinutes

- **Migration**: `migrations/2026_01_27_add_estimated_duration_minutes.sql`
  - Adds `estimated_duration_minutes` column to jobs table
  - Used for effectiveEnd calculation when scheduledEnd is not set
  - `client/src/pages/ClientDetailPage.tsx` - Uses `isJobOverdue`
  - `client/src/pages/LocationDetailPage.tsx` - Uses `isJobOverdue`
  - `server/storage/admin.ts` - SQL uses `COALESCE(scheduled_end, scheduled_start) < NOW()`
  - `server/storage/dashboard.ts` - SQL uses `COALESCE(scheduled_end, scheduled_start) < NOW()`
  - `server/storage/maintenance.ts` - SQL uses `COALESCE(scheduled_end, scheduled_start) < CURRENT_TIMESTAMP`

#### Phase 2 Step 6: Remove templateStatusDefaultEnum

- **Removed `templateStatusDefaultEnum`** - All generated jobs now have `status = 'open'` (hardcoded)
- **Renamed column** - `statusDefault` → `openSubStatusDefault`:
  - Template only controls the optional `openSubStatus` (null = backlog, "on_hold" = held)
  - Values: `null` (normal backlog) or any valid `openSubStatusEnum` value

- **Files updated**:
  - `shared/schema.ts` - Removed enum, updated table definition and schemas
  - `server/domain/recurrence.ts` - Simplified job creation, always sets `status: 'open'`
  - `server/storage/recurringJobs.ts` - Updated to use `openSubStatusDefault`
  - `server/routes/recurringJobs.ts` - Updated validation
  - `client/src/pages/RecurringJobsPage.tsx` - Updated UI to use new field
  - `tests/recurring-jobs.test.ts` - Updated test data

- **Migration**: `migrations/2026_01_27_rename_status_default_to_open_sub_status_default.sql`
  - Renames column from `status_default` to `open_sub_status_default`
  - Converts "open" values to NULL
  - Removes NOT NULL constraint (sub-status is optional)

### Refactored

#### Code Deduplication
- **Removed duplicate `getJobStatusDisplay` from Jobs.tsx** - The local function (63 lines) was a duplicate of the one in `jobUtils.ts`. Now imports from `@/components/job/jobUtils` instead. ([Jobs.tsx:83-145 removed])

#### Optimistic Locking + Completion Desync Fix

- **Removed all `version ?? 0` fallbacks** - No more silently inventing version 0:
  - Client sends actual version (undefined if missing)
  - Server rejects with 409 VERSION_NOT_INITIALIZED if version is null

- **Added VERSION_NOT_INITIALIZED error** in `server/domain/scheduling.ts`:
  - New `VersionNotInitializedError` class (statusCode: 409, code: VERSION_NOT_INITIALIZED)
  - `assertVersionMatch()` now throws this error for null/undefined versions

- **Version check on job completion flow**:
  - `POST /api/jobs/:id/status` now requires `version` in request body
  - Rejects VERSION_MISMATCH if versions don't match
  - Rejects VERSION_NOT_INITIALIZED if job has null version
  - On success: status updated, version incremented atomically

- **Initialized all job versions in DB**:
  - Migration sets `version = 1` for all jobs with NULL version
  - Added NOT NULL DEFAULT 1 constraint to jobs.version column
  - Schema updated: `version: integer("version").notNull().default(1)`

- **Files updated**:
  - `client/src/hooks/useCalendarDnD.ts` - Removed `assignment.version ?? 0` (2 occurrences)
  - `client/src/components/JobDetailDialog.tsx` - Removed `assignment.version ?? 0` (3 occurrences)
  - `client/src/components/ClientDetailDialog.tsx` - Removed `assignment.version ?? 0` (2 occurrences)
  - `client/src/components/calendar/ResizableJobCard.tsx` - Removed `assignment.version ?? 1`
  - `server/domain/scheduling.ts` - Added `VersionNotInitializedError`, updated `assertVersionMatch()`
  - `server/routes/calendar.ts` - Response version fallback changed to 1 (post-migration safe)
  - `server/routes/jobs.ts` - Added version to statusUpdateSchema, added version check
  - `server/storage/calendar.ts` - Updated version checks to throw VERSION_NOT_INITIALIZED
  - `shared/schema.ts` - Changed jobs.version default from 0 to 1

- **Migration**: `migrations/2026_01_27_initialize_job_versions.sql`
  - Sets version = 1 for all NULL versions
  - Adds NOT NULL DEFAULT 1 constraint

- **Removed ALL version response fallbacks** in `server/routes/calendar.ts`:
  - `transformToDto()`: Changed `(job as any).version ?? 1` → `job.version`
  - Schedule/reschedule/unschedule responses: Changed `result.version ?? 1` → `result.version`
  - DTO type `CalendarAssignmentWithDetails` already has `version: number` (non-optional)
  - Storage selects include `version: jobs.version` in all queries

- **Removed legacy completion API surface**:
  - Deleted `completeAssignment()` method from `server/storage/calendar.ts`
  - Removed `completeCalendarAssignment` from `IStorage` interface and bindings in `server/storage/index.ts`
  - Canonical completion path: `POST /api/jobs/:id/status` with version check
  - Uses `jobRepository.updateJobStatusWithEvent()` for atomic status + audit

- **Added GIN index for technician array queries** (performance):
  - Migration: `migrations/2026_01_27_add_gin_index_assigned_technician_ids.sql`
  - Creates `idx_jobs_assigned_technician_ids_gin` using GIN operator class
  - Optimizes array containment queries (@>, &&) for technician-based calendar filtering

- **Canonicalized `isJobScheduled` predicate**:
  - Canonical truth: `scheduledStart IS NOT NULL` (exported from `shared/schema.ts`)
  - Updated `client/src/pages/LocationDetailPage.tsx` to use `isJobScheduled(j)` instead of `j.scheduledStart != null`
  - Updated `client/src/pages/ClientDetailPage.tsx` to use `isJobScheduled(job)` in all scheduled checks

### Fixed

#### Calendar & Scheduling
- **VERSION_MISMATCH (409) on drag-and-drop scheduling** - Multiple fixes:
  1. Server now returns explicit `jobVersion` field in `/api/calendar/unscheduled` response
  2. Client eliminated all unsafe `version ?? 0` fallbacks (14 occurrences removed)
  3. Added `requireJobVersion()` and `requireAssignmentVersion()` guard functions that validate version is a finite number, show toast and refetch if missing
  4. Auto-retry logic fetches fresh version and retries once on 409 errors
  5. Detailed diagnostics logging for debugging version conflicts
  ([Calendar.tsx], [useCalendarDnD.ts], [calendar.ts])

- **All-day row overlapping timed slots in week view** - Created new `AllDayRow` component with dynamic height calculation. Row now grows based on content (min 64px, max 200px) instead of fixed 84px, preventing overlap with timed grid below. ([CalendarGridWeek.tsx])

#### Job Detail Dialog
- **Split schedule UI causing confusion** - Removed view/edit mode split. Schedule editor is now always visible inline for faster scheduling. Removed conflicting header "Reschedule" popover. ([JobDetailDialog.tsx])

- **Date picker flicker** - Eliminated by removing duplicate Reschedule popover that shared focus with schedule section picker.

- **All-day Save button disabled** - Fixed by ensuring `selectedDate` defaults to today for unscheduled jobs.

- **Delete Job deleting calendar assignment instead of job** - Fixed `deleteJobMutation` to call `DELETE /api/jobs/:jobId` instead of `/api/calendar/assignments/:id`. Job deletion now properly soft-deletes the job record. ([JobDetailDialog.tsx])

- **Status mismatch between Calendar and Jobs list** - Added "jobs" to query invalidation groups for all scheduling mutations (`toggleComplete`, `updateDate`, `updateSchedule`, `unscheduleJob`, `deleteJobMutation`) so both views stay synchronized.

### Changed

- **Query invalidation** - Scheduling mutations now invalidate both calendar and jobs query groups for consistency.
- **useCalendarDnD** - Now exports `invalidateCalendarQueries` helper for use in Calendar.tsx.

#### Canonical Scheduling Model (MODEL A) - Phase 1 Steps 2 & 2.5 Complete

- **MODEL A: Timestamp Canonical** - All scheduled jobs now have `scheduledStart IS NOT NULL`:
  - Timed events: `scheduledStart` = actual start time, `scheduledEnd` = actual end time
  - All-day events: `scheduledStart` = midnight (00:00:00), `scheduledEnd` = 23:59:59
  - `isAllDay` is now a **display flag only**, NOT a scheduling determinant
  - Canonical predicate: `isJobScheduled(job) = scheduledStart IS NOT NULL`

- **Removed old null invariant** - Previously, all-day events had `scheduledStart = NULL`. This caused:
  - All-day events missing from calendar range queries (invisible in calendar)
  - Inconsistent scheduling predicates across codebase
  - Now fixed: all-day events always have midnight timestamps

- **New invariant helper** - `assertAllDayTimestampInvariant(job)` validates:
  - All-day events have midnight `scheduledStart`
  - All-day events have 23:59:59 `scheduledEnd` (or next-day 00:00:00)
  - Timed events have `scheduledEnd > scheduledStart`

- **Files updated for MODEL A**:
  - `shared/schema.ts` - Canonical `isJobScheduled()` only checks `scheduledStart != null`
  - `shared/types/calendar.ts` - Updated CalendarAssignmentDto documentation
  - `server/storage/calendar.ts` - All write functions set midnight for all-day
  - `server/routes/calendar.ts` - API returns timestamps for all-day (not null)
  - `server/domain/scheduling.ts` - Added `assertAllDayTimestampInvariant()`
  - `client/src/components/calendar/calendarUtils.ts` - Updated normalization docs
  - `client/src/lib/calendarDiagnostics.ts` - Updated invariant checks

#### Job Status Model (BREAKING) - Phase 1 Step 1 Complete

- **Normalized job status to 4 lifecycle values** - Replaced 12+ status values with exactly 4:
  - `open` - Active job that can be worked on
  - `completed` - Work finished (may need invoicing)
  - `invoiced` - Invoice created (locked for billing)
  - `archived` - Historical archive (includes canceled jobs)

- **Derived states instead of status values** - "scheduled" and "assigned" are now derived from fields:
  - `isJobScheduled(job)` - true if `scheduledStart IS NOT NULL` (MODEL A: all-day events have midnight timestamps)
  - `isJobAssigned(job)` - true if `primaryTechnicianId IS NOT NULL OR assignedTechnicianIds.length > 0`

- **Workflow sub-status for open jobs** - New `openSubStatus` column (only valid when `status = 'open'`):
  - `null` - Default, no special workflow state
  - `in_progress` - Work actively being performed
  - `on_hold` - Job is blocked (requires holdReason)
  - `on_route` - Technician traveling to job site
  - `needs_review` - Needs supervisor/manager review

- **Migration mapping**:
  - `assigned`, `unscheduled`, `scheduled` → `open` (now derived)
  - `in_progress`, `on_hold` → `open` + appropriate `openSubStatus`
  - `action_required` → `open` + `openSubStatus = 'needs_review'`
  - `requires_invoicing` → `completed`
  - `closed`, `canceled`, `cancelled` → `archived`

- **Runtime Guard Added** - `assertNormalizedJobStatus()` function in `server/schemas.ts` throws immediately on invalid status values. Use in any code path that persists or transforms job status.

- **Legacy Status Removal (13 files updated)**:
  - `server/storage/jobs.ts` - Removed `in_progress`, `requires_invoicing`, `closed` checks
  - `server/storage/dashboard.ts` - Replaced `CLOSED_STATUSES` array with `TERMINAL_STATUSES`
  - `server/storage/admin.ts` - Renamed `actionRequiredCount` → `onHoldCount`
  - `server/storage/calendar.ts` - Removed `scheduled`/`assigned` status derivation
  - `server/storage/customerCompanies.ts` - Simplified to `status === "open"` filter
  - `server/routes/admin.ts` - Rewrote scheduling health checks
  - `server/routes/reports.ts` - Updated `action_required` queries to `needs_review`
  - `server/routes/clients.ts` - Simplified open jobs filter
  - `server/scripts/schedulingSanityCheck.ts` - Complete rewrite
  - `client/src/components/job/jobUtils.ts` - Complete rewrite
  - `client/src/pages/Jobs.tsx` - Updated filter types
  - `client/src/lib/jobScheduling.ts` - Removed `scheduled` status assignment

See `docs/audit/phase1_step1_legacy_status_removals.md` for detailed report.

### Added

- `logVersionMismatch()` function in calendarDiagnostics.ts for detailed 409 error logging
- `fetchFreshJobVersion()` helper in useCalendarDnD.ts for auto-retry logic
- `_isRetry` field in CreateAssignmentParams and UpdateAssignmentParams to prevent infinite retry loops
- `AllDayRow` component in CalendarGridWeek.tsx with dynamic height calculation
- `openSubStatus` column in jobs table with CHECK constraint enforcing invariant
- `openSubStatusEnum` in server/schemas.ts for Zod validation
- `normalizeJobStatus()` function in shared/schema.ts to map legacy values
- `deriveOpenSubStatus()` function in shared/schema.ts for migration
- `isJobScheduled()` and `isJobAssigned()` helper functions in shared/schema.ts
- Database migration: `migrations/2026_01_26_normalize_job_status.sql`

---

## Version History

_Previous versions were not tracked in this changelog. See git history for details._
