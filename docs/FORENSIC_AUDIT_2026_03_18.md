# Full-System Forensic Architectural Audit

**Date**: 2026-03-18
**Auditor**: Claude (Automated Forensic Pass)
**Scope**: All backend routes, storage, services, domain, shared code, frontend pages, hooks, components
**Files Analyzed**: 200+

---

## 1. Executive Summary

**Overall System Health: PARTIALLY ENFORCED CANONICAL ARCHITECTURE**

The system has undergone significant hardening toward a single-source-of-truth lifecycle model centered on `jobLifecycle.ts` (domain) and `jobLifecycleOrchestrator.ts` (service). Route-level discipline is strong — all major job lifecycle mutations in routes flow through the orchestrator. However:

**Biggest structural risks:**
1. **Reconciliation logic inside the orchestrator performs direct `db.update(jobs)` writes** — bypassing the very domain engine it was designed to funnel through. The `reconcileJobAfterVisitCompletion()` function sets `status: "completed"` directly on jobs without using `applyLifecycleTransition()`.
2. **Invoice status enum is defined with conflicting values** in `shared/schema.ts` vs `server/schemas.ts` — `awaiting_payment` exists in server but not in the shared type system.
3. **Visit status display labels are defined in 6+ locations** with the critical "on_site" label showing as "On Site" on 5 surfaces and "In Progress" on 3 surfaces.
4. **Client-side status derivation** — `isJobOverdue()`, `isJobScheduled()`, `isBacklogEligible()` are computed client-side in Jobs.tsx after fetching all data, duplicating server logic.
5. **Deprecated wrapper service still imported** — `jobVisits.service.ts` is fully deprecated but still imported in 2 route files.

**Most dangerous remaining legacy patterns:**
- "on_site" ↔ "In Progress" display inconsistency across the entire UI
- `reconcileJobAfterVisitCompletion()` direct writes that bypass domain lifecycle
- `legacyJobStatusEnum` still accepted in job status update route validation
- Duplicate `haversineMeters()` and `isTerminalStatus()` functions

**Most urgent sources of future bugs:**
- Invoice status enum mismatch (`shared/schema.ts` missing `awaiting_payment`)
- Visit eligibility predicates defined differently in 3+ locations
- Soft-delete semantics differ per table (jobs = `deletedAt AND isActive`, invoices = `isActive OR NULL`, visits = `isActive` only)

---

## 2. Findings by Severity

---

### CRITICAL FINDINGS

---

#### C-1: Orchestrator reconciliation bypasses domain lifecycle engine

**Severity**: Critical
**Category**: duplicate write path, lifecycle drift, service boundary violation
**Reachability**: runtime-reachable
**Classification**: Keep but centralize

**Files**:
- `server/services/jobLifecycleOrchestrator.ts` lines 734-746

**Problem**: `reconcileJobAfterVisitCompletion()` performs `db.update(jobs).set({ status: "completed", ... })` directly. This bypasses `applyLifecycleTransition()` — the declared single source of truth for all job status transitions. The direct write:
- Does NOT set `previousStatus`
- Does NOT clear scheduling fields (`scheduledStart`, `scheduledEnd`, `isAllDay`)
- Does NOT emit lifecycle audit events via `jobStatusEvents`
- Does NOT increment version (optimistic locking broken)
- Does NOT check `pmBillingStatus`

**Why dangerous**: A job auto-completed by visit reconciliation has different metadata than one completed via `CLOSE_JOB(mode=invoice_later)`. Undo-close won't work. Audit trail is incomplete. Version diverges from what the UI expects.

**Canonical rule violated**: Single lifecycle authority — all job status transitions must go through `applyLifecycleTransition()`.

**Resolution**: Refactor `reconcileJobAfterVisitCompletion()` to call `jobRepository.transitionJobStatus()` with a `CLOSE_JOB` intent instead of direct SQL.
**Resolution type**: refactor into canonical authority
**Confidence**: High

---

#### C-2: Invoice status enum mismatch between shared and server

**Severity**: Critical
**Category**: data model drift, frontend/backend contract mismatch
**Reachability**: runtime-reachable
**Classification**: Remove after canonical replacement is verified

**Files**:
- `shared/schema.ts` line 1055: `["draft", "sent", "partial_paid", "paid", "voided"]`
- `server/schemas.ts` lines 79-86: adds `"awaiting_payment"`, documents `"sent"` as legacy

**Problem**: `shared/schema.ts` (the declared source of truth for types) does NOT include `"awaiting_payment"`. Server route validation (`server/schemas.ts`) DOES include it. The send-invoice endpoint transitions `draft → awaiting_payment`. Frontend TypeScript types derived from `shared/schema.ts` cannot represent this value.

**Why dangerous**: Type-unsafe at compile time. Frontend code receiving `status: "awaiting_payment"` from API has no type for it. `InvoicesListPage.tsx` already handles it via string comparison (`inv.status === "awaiting_payment"`) — working around the type gap.

**Canonical rule violated**: Single source of truth for enums.

**Resolution**: Add `"awaiting_payment"` to `shared/schema.ts` invoiceStatusEnum. Mark `"sent"` as legacy with a comment.
**Resolution type**: schema follow-up
**Confidence**: High

---

#### C-3: Visit status "on_site" displays inconsistently across UI

**Severity**: Critical
**Category**: duplicate read logic, frontend/backend contract mismatch
**Reachability**: runtime-reachable
**Classification**: Keep but centralize

**Files**:
- `client/src/components/JobVisitsSection.tsx` line 65: `on_site: "On Site"`
- `client/src/pages/JobDetailPage.tsx` lines 289, 500: `on_site: "On Site"`
- `client/src/pages/TechHomePage.tsx` line 39: `on_site: "On Site"`
- `client/src/pages/TechVisitDetailPage.tsx` line 94: `on_site: "On Site"`
- `client/src/pages/UnassignedTimePage.tsx` line 73: `on_site: "On Site"`
- `client/src/pages/TimeAnalyticsPage.tsx` line 80: `on_site: "On Site"`
- `client/src/components/dispatch/DispatchDetailPanel.tsx` line 91: `on_site: "In Progress"`
- `client/src/components/visits/EditVisitModal.tsx` line 73: `on_site: "In Progress"`
- `client/src/components/dispatch/dispatchPreviewUtils.ts` line 84: `on_site: "In Progress"`
- `client/src/components/time/AddTimeEntryModal.tsx` line 45: `on_site: "On Site"`
- `client/src/components/time/EditTimeEntryModal.tsx` line 41: `on_site: "On Site"`

**Problem**: The same database value `"on_site"` displays as **"On Site"** on 8 surfaces and **"In Progress"** on 3 surfaces. There is no canonical visit status label utility. Each component defines its own `STATUS_LABELS` constant.

**Why dangerous**: Users see different labels for the same visit depending on where they look. Dispatch shows "In Progress" while job detail shows "On Site". This undermines trust in the UI.

**Canonical rule violated**: Single source of truth for read semantics.

**Resolution**: Create `client/src/lib/visitStatusDisplay.ts` with canonical `visitStatusLabel()`. Delete all 11 local STATUS_LABELS constants. Decide on one label (recommend "In Progress" since dispatch is the primary consumer).
**Resolution type**: server-side centralization + frontend cleanup
**Confidence**: High

---

#### C-4: Visit eligibility predicates differ across 3+ locations

**Severity**: Critical
**Category**: duplicate read logic, scheduling drift
**Reachability**: runtime-reachable
**Classification**: Keep but centralize

**Files**:
- `server/storage/jobVisits.ts` line 371: `EXCLUDED = ["cancelled", "completed"]`
- `server/storage/jobVisits.ts` line 177: same in `getCurrentEligibleVisit()`
- `server/storage/scheduling.ts` line 689: `AND pv.status NOT IN ('completed', 'cancelled')`
- `server/services/jobLifecycleOrchestrator.ts` line 712: `TERMINAL_VISIT = ["completed", "cancelled"]` + additional `isActive` + `archivedAt IS NULL` + `scheduledStart IS NOT NULL OR checkedInAt IS NOT NULL`

**Problem**: No shared `TERMINAL_VISIT_STATUSES` constant or `activeVisitFilter()` utility. The orchestrator's definition is the most restrictive (adds scheduledStart/checkedInAt requirement), meaning visits that pass storage-level eligibility can fail orchestrator-level eligibility — or vice versa.

**Why dangerous**: `syncJobScheduleFromVisits()` may sync a visit's schedule to a job when the orchestrator wouldn't consider that visit actionable. This creates data inconsistency between job-level schedule fields and the orchestrator's view of "what work remains."

**Canonical rule violated**: Single source of truth for visit eligibility.

**Resolution**: Extract `TERMINAL_VISIT_STATUSES` and `activeVisitPredicate()` to a shared module (e.g., `server/lib/visitPredicates.ts`). All consumers import from there.
**Resolution type**: merge into existing module
**Confidence**: High

---

### HIGH FINDINGS

---

#### H-1: Soft-delete filter semantics differ per table

**Severity**: High
**Category**: data model drift, hidden bug risk
**Reachability**: runtime-reachable
**Classification**: Keep but centralize

**Files**:
- `server/storage/jobFilters.ts` line 26: jobs = `deletedAt IS NULL AND isActive = true`
- `server/storage/jobVisits.ts` line 75: visits = `isActive = true` (no deletedAt check)
- `server/storage/invoices.ts` line 151: invoices = `isActive = true OR isActive IS NULL`

**Problem**: Three different soft-delete semantics. Invoices treat NULL as active (backward compat). Visits skip `deletedAt`. Jobs require both flags.

**Why dangerous**: A `JOIN` between jobs and visits may include soft-deleted visits if the visit filter only checks `isActive`. An invoice with `isActive = NULL` passes the invoice filter but would fail the jobs filter if applied generically.

**Resolution**: Document canonical soft-delete rules per table. Consider unifying to consistent `isActive = true AND deletedAt IS NULL` everywhere.
**Resolution type**: investigate before changing
**Confidence**: Medium (invoices NULL compat may be intentional)

---

#### H-2: Duplicate `isTerminalStatus()` function

**Severity**: High
**Category**: dead code, duplicate read logic
**Reachability**: runtime-reachable (both called)
**Classification**: Remove immediately (one copy)

**Files**:
- `server/domain/jobLifecycle.ts` lines 162-166
- `server/domain/scheduling.ts` lines 68-71

**Problem**: Identical function exported from two modules. Both import `TERMINAL_STATUSES` from `statusRules.ts`.

**Why dangerous**: If one is updated and the other isn't, terminal-status checks diverge between lifecycle and scheduling logic.

**Resolution**: Delete from `scheduling.ts`, import from `jobLifecycle.ts`.
**Resolution type**: delete entirely (one copy)
**Confidence**: High

---

#### H-3: Duplicate `haversineMeters()` and travel time functions

**Severity**: High
**Category**: dead code, duplicate write path
**Reachability**: runtime-reachable
**Classification**: Remove immediately (one copy)

**Files**:
- `server/lib/visitIntelligence.ts` lines 86-96: `haversineMeters()` + `estimateTravelMinutes()`
- `server/lib/autoGapScheduling.ts` lines 81-97: `haversineMeters()` + `travelMinutes()`

**Problem**: Identical distance calculation. Nearly identical travel time estimate. Defined in two separate files.

**Resolution**: Extract to `server/lib/geoHelpers.ts`.
**Resolution type**: merge into existing module
**Confidence**: High

---

#### H-4: Duplicate `upsertAttentionItem()` logic

**Severity**: High
**Category**: duplicate write path
**Reachability**: runtime-reachable
**Classification**: Remove immediately (one copy)

**Files**:
- `server/lib/attentionRules.ts` lines 294-317: `upsertAttentionItem()`
- `server/lib/visitIntelligence.ts` lines 104-130: `upsertAttention()`

**Problem**: Both implement identical `INSERT ... ON CONFLICT (tenant_id, dedupe_key) DO UPDATE` SQL.

**Resolution**: Extract to shared utility. Both modules import from it.
**Resolution type**: merge into existing module
**Confidence**: High

---

#### H-5: Deprecated `jobVisits.service.ts` still imported

**Severity**: High
**Category**: legacy code, stale abstraction
**Reachability**: runtime-reachable
**Classification**: Remove immediately

**Files**:
- `server/services/jobVisits.service.ts` (93 lines, all deprecated wrappers)
- `server/routes/jobs.ts` line 38: `import * as visitService from "../services/jobVisits.service"`
- `server/routes/jobVisits.routes.ts` line 2: `import * as service from "../services/jobVisits.service"`

**Problem**: Every function in this file is a thin pass-through to `jobVisitsRepository`. The file is fully deprecated (comments say so). Two route files still import it.

**Why dangerous**: New developers may add logic to this deprecated service instead of the repository or orchestrator.

**Resolution**: Replace imports with direct `jobVisitsRepository` usage. Delete the file.
**Resolution type**: delete entirely
**Confidence**: High

---

#### H-6: `effectiveEnd` computation inconsistent in visitIntelligence

**Severity**: High
**Category**: scheduling drift, hidden bug risk
**Reachability**: runtime-reachable
**Classification**: Keep but centralize

**Files**:
- `shared/schema.ts` `isJobOverdue()`: `scheduledEnd ?? (scheduledStart + duration) ?? scheduledStart`
- `server/lib/queryHelpers.ts` lines 49-54: same priority (correct)
- `server/lib/visitIntelligence.ts` lines 317-319: skips `scheduledEnd` priority, goes straight to `start + duration`

**Problem**: visitIntelligence computes `effectiveEnd` differently than the canonical SQL expression and the shared `isJobOverdue()` function. If a visit has `scheduledEnd` set but no `scheduledStart`, visitIntelligence will compute it wrong.

**Resolution**: Import/use canonical computation from `queryHelpers.ts` or extract a shared JS function.
**Resolution type**: replace with shared helper
**Confidence**: High

---

#### H-7: Client-side status derivation in Jobs.tsx

**Severity**: High
**Category**: duplicate read logic, frontend/backend contract mismatch
**Reachability**: runtime-reachable
**Classification**: server-side centralization

**Files**:
- `client/src/pages/Jobs.tsx` lines 239-242: `_scheduled`, `_assigned`, `_backlog`, `_overdue` computed per-render
- `shared/schema.ts`: `isJobOverdue()`, `isJobScheduled()` etc. also defined server-side
- `server/lib/queryHelpers.ts`: SQL predicates for the same concepts

**Problem**: Jobs.tsx fetches 200 jobs, then recomputes `isJobScheduled()`, `isJobOverdue()`, `isBacklogEligible()` client-side. These predicates exist server-side but the API doesn't return them as fields. Dashboard filter params like `?scheduling=unscheduled` trigger client-side post-filtering.

**Why dangerous**: If the server definition of "overdue" or "unscheduled" changes, the client-side computation diverges silently. Dashboard tiles navigate to Jobs.tsx with filter params, but the resulting list may not match what the dashboard counted.

**Resolution**: Return computed boolean flags from API (`isOverdue`, `isScheduled`, `isBacklog`) so frontend reads, not derives.
**Resolution type**: server-side centralization
**Confidence**: High

---

#### H-8: `legacyJobStatusEnum` still accepted in job status route

**Severity**: High
**Category**: legacy code, lifecycle drift
**Reachability**: runtime-reachable
**Classification**: Remove after canonical replacement is verified

**Files**:
- `server/schemas.ts` lines 59-75: defines `legacyJobStatusEnum` with old values (`in_progress`, `on_hold`, `needs_review`, etc.)
- `server/routes/jobs.ts` line 15: imports `legacyJobStatusEnum`
- `server/routes/jobs.ts` line 373: uses `legacyJobStatusEnum` for status query validation

**Problem**: The job list endpoint still accepts legacy status values as query parameters. While the route code normalizes them before querying, this keeps the old vocabulary alive in the API contract.

**Why dangerous**: API consumers (including frontend) may rely on sending legacy status values. When legacy support is removed, breakage occurs silently.

**Resolution**: Replace with canonical `jobStatusEnum` in the query validation. Add server-side normalization with deprecation warning headers.
**Resolution type**: remove after canonical replacement is verified
**Confidence**: Medium (need to verify frontend doesn't send legacy values)

---

#### H-9: Direct visit status mutations in techField.ts routes

**Severity**: High
**Category**: route ownership violation, lifecycle drift
**Reachability**: runtime-reachable
**Classification**: Keep but centralize

**Files**:
- `server/routes/techField.ts` lines 170-178: direct `db.update(jobVisits)` for en_route
- `server/routes/techField.ts` lines 219-228: direct `db.update(jobVisits)` for start/check-in

**Problem**: Visit status transitions (`en_route`, `in_progress`) are written directly in route handlers instead of going through the orchestrator or a service.

**Why dangerous**: No audit trail, no version checking, no validation of allowed transitions.

**Resolution**: Create visit-level lifecycle methods in the orchestrator (or a visit service) for `SET_VISIT_EN_ROUTE` and `START_VISIT`.
**Resolution type**: refactor into canonical authority
**Confidence**: High

---

### MEDIUM FINDINGS

---

#### M-1: Duplicate CSRF implementation

**Severity**: Medium
**Category**: dead code, stale abstraction
**Reachability**: `csrf.ts` is dormant (not imported anywhere)
**Classification**: Remove immediately

**Files**:
- `client/src/lib/csrf.ts` — standalone CSRF module (not imported by any component)
- `client/src/lib/queryClient.ts` — actual CSRF implementation in use

**Resolution**: Delete `csrf.ts`.
**Resolution type**: delete entirely
**Confidence**: High

---

#### M-2: Technician display name fallback differs server vs client

**Severity**: Medium
**Category**: duplicate read logic, frontend/backend contract mismatch
**Reachability**: runtime-reachable
**Classification**: Keep but centralize

**Files**:
- `server/lib/resolveTechnicianName.ts`: fallback chain ends with `"Unknown"`
- `client/src/lib/displayName.ts`: fallback chain ends with `"Unnamed"`, skips firstName-only/lastName-only

**Problem**: A technician with only `firstName` set shows "John" on server but "" (empty) on client. Fallback label is "Unknown" on server, "Unnamed" on client.

**Resolution**: Unify into a shared function in `shared/` or align client fallback chain.
**Resolution type**: replace with shared helper
**Confidence**: High

---

#### M-3: Duplicate visit status color/label constants in components

**Severity**: Medium
**Category**: duplicate read logic
**Reachability**: runtime-reachable
**Classification**: Remove immediately (duplicates)

**Files**:
- `client/src/components/dispatch/dispatchPreviewUtils.ts` — canonical
- `client/src/components/dispatch/DispatchDetailPanel.tsx` lines 87-96 — duplicate
- `client/src/components/visits/EditVisitModal.tsx` lines 58-78 — duplicate
- `client/src/components/JobVisitsSection.tsx` lines 50-70 — duplicate

**Resolution**: All 3 duplicates import from `dispatchPreviewUtils.ts` (or a new shared `visitStatusDisplay.ts`).
**Resolution type**: merge into existing module
**Confidence**: High

---

#### M-4: Duplicate task type label constants

**Severity**: Medium
**Category**: duplicate read logic
**Reachability**: runtime-reachable
**Classification**: Keep but centralize

**Files**:
- `client/src/components/dispatch/DispatchDetailPanel.tsx` lines 98-107: `"vehicle_maintenance": "Vehicle Maintenance"`
- `client/src/components/dispatch/DispatchTaskBlock.tsx` lines 37-46: `"vehicle_maintenance": "Vehicle"`

**Problem**: Same concept, different labels. "Vehicle Maintenance" in detail panel, "Vehicle" in task block.

**Resolution**: Extract to shared constant with `short` and `long` variants.
**Resolution type**: merge into existing module
**Confidence**: High

---

#### M-5: `paginatedCompat()` returns ambiguous types

**Severity**: Medium
**Category**: frontend/backend contract mismatch
**Reachability**: runtime-reachable (14 routes)
**Classification**: Remove after canonical replacement is verified

**Files**:
- `server/utils/paginatedResponse.ts`: `paginatedCompat()` returns `T[] | { data: T[]; meta }`

**Problem**: Return type depends on runtime parameter. Type-safe frontend consumption requires knowing which shape the backend returns for each endpoint.

**Resolution**: Migrate all endpoints to `{ data, meta }` shape. Remove `paginatedCompat()`.
**Resolution type**: remove after canonical replacement is verified
**Confidence**: Medium

---

#### M-6: Business logic in `server/utils/qboInvoiceLock.ts`

**Severity**: Medium
**Category**: service boundary violation
**Reachability**: runtime-reachable
**Classification**: Keep but rename / narrow scope

**Files**: `server/utils/qboInvoiceLock.ts`

**Problem**: Contains `BILLING_IMPACTING_FIELDS`, `buildOutOfSyncUpdate()`, `buildBillingLockUpdate()` — business rules masquerading as utilities.

**Resolution**: Move business rule constants/builders to a service. Keep lock-checking predicates in utils.
**Resolution type**: refactor into canonical authority
**Confidence**: Medium

---

#### M-7: Debug console.log left in production hook

**Severity**: Medium
**Category**: hidden bug risk
**Reachability**: runtime-reachable
**Classification**: Remove immediately

**Files**: `client/src/hooks/useProductsServices.ts` line 57

**Problem**: `console.log("[ProductsServices] API response:", JSON.stringify(json).slice(0, 200))` in production code.

**Resolution**: Delete the line.
**Resolution type**: delete entirely
**Confidence**: High

---

#### M-8: `TERMINAL_STATUSES` deprecated alias still exported

**Severity**: Medium
**Category**: legacy code
**Reachability**: runtime-reachable (imported by jobLifecycle.ts, scheduling.ts)
**Classification**: Remove after canonical replacement is verified

**Files**:
- `server/statusRules.ts` lines 92-94: `TERMINAL_STATUSES = JOB_TERMINAL_STATUSES`
- `server/domain/jobLifecycle.ts` line 36: imports `TERMINAL_STATUSES`
- `server/domain/scheduling.ts` line 44: imports `TERMINAL_STATUSES`

**Resolution**: Update imports to `JOB_TERMINAL_STATUSES`. Remove deprecated alias.
**Resolution type**: remove after canonical replacement is verified
**Confidence**: High

---

#### M-9: Dead escalation UI code in Jobs.tsx

**Severity**: Medium
**Category**: dead code, dead UI
**Reachability**: dormant (always false)
**Classification**: Remove immediately

**Files**: `client/src/pages/Jobs.tsx` lines 620-643

**Problem**: `needsEscalation = false` and `isEscalated = false` are hardcoded. Conditional renders are unreachable. Comment on line 228 documents that the mutations were already deleted.

**Resolution**: Delete dead conditional UI branches.
**Resolution type**: delete entirely
**Confidence**: High

---

#### M-10: Duplicate `ScheduledVisitRow` interfaces

**Severity**: Medium
**Category**: duplicate read logic, DTO drift
**Reachability**: runtime-reachable
**Classification**: Keep but centralize

**Files**:
- `server/lib/visitIntelligence.ts` lines 56-79
- `server/lib/autoGapScheduling.ts` lines 49-70

**Problem**: Nearly identical interfaces with slightly different fields.

**Resolution**: Extract shared base to `server/lib/intelligenceTypes.ts`.
**Resolution type**: merge into existing module
**Confidence**: High

---

### LOW FINDINGS

---

#### L-1: `getMemberSecondary()` unused export
**Files**: `client/src/lib/displayName.ts` line 20
**Classification**: Remove immediately | dormant

#### L-2: `CLOSEABLE_STATES` deprecated alias still exported
**Files**: `server/statusRules.ts` lines 188-203
**Classification**: Remove after canonical replacement is verified | dormant

#### L-3: `jobUtils.ts` exports deprecated `TERMINAL_STATUSES` alias (client-side)
**Files**: `client/src/components/job/jobUtils.ts` lines 44-45
**Classification**: Remove immediately | dormant (no imports found)

#### L-4: dispatchBus `setMaxListeners(200)` hardcoded
**Files**: `server/lib/dispatchBus.ts` line 26
**Classification**: Investigate before touching | runtime-reachable

#### L-5: Province/state normalization not shared between import flows
**Files**: `shared/jobImportTypes.ts` lines 301-375
**Classification**: Keep but centralize | runtime-reachable

---

## 3. Dead Code Inventory

### Definitely Dead
| Item | File | Type | Evidence |
|------|------|------|----------|
| `csrf.ts` entire file | `client/src/lib/csrf.ts` | file | Not imported anywhere |
| `needsCsrfToken()` | `client/src/lib/csrf.ts` | function | Not imported anywhere |
| `getMemberSecondary()` | `client/src/lib/displayName.ts` | function | Not imported anywhere |
| `TERMINAL_STATUSES` (client) | `client/src/components/job/jobUtils.ts` | constant | No imports found |
| Escalation UI branches | `client/src/pages/Jobs.tsx` lines 620-643 | UI code | `needsEscalation = false` always |

### Probably Dead
| Item | File | Type | Evidence |
|------|------|------|----------|
| `jobVisits.service.ts` | `server/services/jobVisits.service.ts` | file | All functions deprecated, pure pass-through |
| `reconcileJobInvoiceLinks()` | `server/storage/jobs.ts` line 1280 | function | Returns stub data, no real reconciliation |
| `CLOSEABLE_STATES` alias | `server/statusRules.ts` | constant | Marked deprecated, unknown import count |

### Needs Confirmation
| Item | File | Type | Evidence |
|------|------|------|----------|
| `legacyJobStatusEnum` usage | `server/routes/jobs.ts` line 373 | validation | Used for query params — may have active consumers |
| `updateJobStatusWithMultipleEvents()` | `server/storage/jobs.ts` line 1393 | function | Check if any caller still uses multi-step transitions |

---

## 4. Legacy Compatibility Inventory

| Item | Old Behavior | Still Needed? | Break Risk if Removed | Architecture Says |
|------|-------------|---------------|----------------------|-------------------|
| `legacyJobStatusEnum` in job list query | Accepts `in_progress`, `on_hold`, etc. as query params | Unclear — frontend may send these | Frontend job list filters may break | Should normalize then remove |
| `invoiceStatusEnum` `"sent"` value | Old "sent" status before `awaiting_payment` was added | Yes (existing data has `sent`) | Existing invoices break | Keep in enum but deprecate |
| `TERMINAL_STATUSES` alias | Old name before `JOB_TERMINAL_STATUSES` | No | Nothing (same object) | Remove |
| `CLOSEABLE_STATES` alias | Old name before `CLOSEABLE_STATUSES` | No | Nothing (same object) | Remove |
| `paginatedCompat()` | Returns `T[]` for old clients, `{data,meta}` for new | During migration | Clients expecting array break | Migrate all to `{data,meta}` |
| `on_site` → "On Site" labels | Legacy DB visit status value | Yes (DB has this value) | Display only | Normalize display to "In Progress" everywhere |

---

## 5. Duplicate Authority Matrix

| Concept | Canonical Owner (Should) | Actual Owners Found | Conflict? |
|---------|-------------------------|--------------------|-----------|
| Job lifecycle status | `jobLifecycle.ts` → `applyLifecycleTransition()` | 1. `jobLifecycle.ts` ✓ 2. `jobLifecycleOrchestrator.ts:reconcileJobAfterVisitCompletion()` ✗ | **YES** — reconciliation bypasses domain |
| Visit status transitions | `jobLifecycleOrchestrator.ts` | 1. Orchestrator ✓ 2. `techField.ts` routes (en_route, start) ✗ | **YES** — route-level mutations |
| Visit eligibility | Single predicate | 1. `jobVisits.ts` 2. `scheduling.ts` 3. `orchestrator.ts` | **YES** — 3 different predicates |
| "Active" job filter | `jobFilters.ts:activeJobFilter()` | 1. `jobFilters.ts` ✓ 2. Some storage queries inline ✓ | Minor — mostly consistent |
| Invoice status enum | `shared/schema.ts` | 1. `shared/schema.ts` 2. `server/schemas.ts` (adds value) | **YES** — conflicting enums |
| Visit status display labels | None (should be one) | 6+ component-local constants | **YES** — no canonical owner |
| Job overdue check | `shared/schema.ts:isJobOverdue()` | 1. `shared/schema.ts` 2. `Jobs.tsx` client-side 3. `queryHelpers.ts` SQL | **YES** — 3 implementations |
| Effective end time | `queryHelpers.ts:effectiveEndExpr` | 1. `queryHelpers.ts` 2. `visitIntelligence.ts` (different) | **YES** — divergent computation |
| Technician display name | None | 1. `server/lib/resolveTechnicianName.ts` 2. `client/src/lib/displayName.ts` | **YES** — different fallbacks |
| PM urgency (overdue/coming-due) | Server dashboard query | Server + client-side filtering in PMWorkspacePage | Minor — mostly server-driven |
| Scheduling fields clearing | `jobLifecycle.ts:getScheduleClearingPatch()` | 1. `jobLifecycle.ts` ✓ | No conflict |
| Dashboard metrics | Server routes | Server routes ✓ | No conflict (server-canonical) |

---

## 6. Query Definition Drift Matrix

| Concept | Dashboard Query | List Page Predicate | Detail Page | Dispatch Board |
|---------|----------------|--------------------|-----------|--------------|
| Active jobs | `status != 'archived'` (server) | `deletedAt IS NULL AND isActive` | Same | N/A |
| Unscheduled | Server count | Client-side: `status=open && !isJobScheduled()` | N/A | N/A |
| Overdue jobs | Server `isJobOverdue()` SQL | Client-side: `isJobOverdue(job, now)` | Client `isJobOverdue()` | N/A |
| Active visits | N/A | N/A | `isActive=true` | `status NOT IN (completed,cancelled)` |
| Actionable visits | N/A | N/A | N/A | `scheduledStart IS NOT NULL + isActive + not terminal` |
| Unpaid invoices | Server: `awaiting_payment, sent, partial_paid` | Client: `status === "awaiting_payment" \|\| status === "sent"` | N/A | N/A |
| Overdue invoices | Server: `dueDate < now + balance > 0` | Client: same logic recalculated | N/A | N/A |

---

## 7. Write-Path Violation Inventory

| Entity | Correct Authority | Violation Location | What It Writes | Severity |
|--------|------------------|--------------------|----------------|----------|
| `jobs.status` | `jobLifecycle.ts` via `transitionJobStatus()` | `orchestrator.ts:reconcileJobAfterVisitCompletion()` line 737 | `status: "completed"` directly | **Critical** |
| `jobs.openSubStatus` | `jobLifecycle.ts` via `transitionJobStatus()` | `orchestrator.ts:reconcileJobAfterVisitCompletion()` lines 756, 773 | `openSubStatus: "on_hold"` directly | **Critical** |
| `jobVisits.status` | Should be orchestrator | `techField.ts` lines 170, 219 | `status: "en_route"`, `status: "in_progress"` | High |
| `jobVisits.status` | Should be orchestrator | `jobVisits.ts:updateJobVisitStatus()` line 733 | Any status via parameter | Medium |

---

## 8. Read-Path Drift Inventory

| Business Meaning | Location A | Location B | Difference |
|-----------------|-----------|-----------|------------|
| Visit "on_site" label | JobVisitsSection, JobDetailPage, TechHomePage, etc. → "On Site" | DispatchDetailPanel, EditVisitModal, dispatchPreviewUtils → "In Progress" | Different label for same DB value |
| Technician fallback name | Server → "Unknown" | Client → "Unnamed" | Different fallback string |
| Job overdue | Server SQL via `effectiveEndExpr` | Client JS via `isJobOverdue()` | Same logic, different implementations |
| Effective end time | `queryHelpers.ts`: `scheduledEnd ?? (start + duration) ?? start` | `visitIntelligence.ts`: `scheduledEnd ?? (start + duration)` — misses start-only case | Different computation |
| Invoice "overdue" | Server: query predicate | Client: `InvoicesListPage.tsx` recomputes from `dueDate` | Duplicate derivation |

---

## 9. Schema / Field Risk Inventory

| Field(s) | Table | Risk |
|----------|-------|------|
| `invoiceStatusEnum` | invoices | Missing `awaiting_payment` in shared type |
| `isActive` + `deletedAt` | jobs | Both used for soft-delete — redundant? |
| `isActive` (nullable) | invoices | NULL treated as active — inconsistent with jobs |
| `previousStatus` | jobs | Not set by reconciliation path (C-1) |
| `closedAt` / `closedBy` | jobs | Not set by reconciliation path (C-1) |
| `pmBillingStatus` | jobs | Set by lifecycle but not by reconciliation |
| `openSubStatus` | jobs | Nullable enum — `null` means "default open" which is implicit |
| `status` on `job_visits` | job_visits | No TypeScript enum — implicit string values only |

---

## 10. Top 20 Highest-Value Deletions

| # | Item | Why |
|---|------|-----|
| 1 | `client/src/lib/csrf.ts` | Dead file, replaced by `queryClient.ts` |
| 2 | `server/services/jobVisits.service.ts` | Fully deprecated pass-through |
| 3 | Escalation UI code in `Jobs.tsx` lines 620-643 | Dead branches, always false |
| 4 | `TERMINAL_STATUSES` alias in `statusRules.ts` | Deprecated, update 2 imports |
| 5 | `CLOSEABLE_STATES` + other deprecated aliases in `statusRules.ts` | Dead compatibility shims |
| 6 | `TERMINAL_STATUSES` alias in client `jobUtils.ts` | No imports found |
| 7 | `getMemberSecondary()` in `displayName.ts` | Never imported |
| 8 | `isTerminalStatus()` duplicate in `scheduling.ts` | Import from `jobLifecycle.ts` instead |
| 9 | `haversineMeters()` duplicate in `autoGapScheduling.ts` | Extract to shared module |
| 10 | `upsertAttention()` duplicate in `visitIntelligence.ts` | Extract to shared module |
| 11 | Console.log in `useProductsServices.ts` | Debug logging in production |
| 12 | `ScheduledVisitRow` duplicate interface in `autoGapScheduling.ts` | Extract shared base |
| 13 | `STATUS_LABELS` in `DispatchDetailPanel.tsx` | Import from `dispatchPreviewUtils` |
| 14 | `STATUS_LABELS` + `STATUS_COLORS` in `EditVisitModal.tsx` | Import from canonical source |
| 15 | `STATUS_LABELS` + `STATUS_COLORS` in `JobVisitsSection.tsx` | Import from canonical source |
| 16 | `TASK_TYPE_LABELS` duplicate in `DispatchTaskBlock.tsx` | Shared constant with variants |
| 17 | `needsCsrfToken()` in `csrf.ts` | Dead function (file to be deleted) |
| 18 | `reconcileJobInvoiceLinks()` stub in `jobs.ts` storage | Returns stub data only |
| 19 | `paginatedCompat()` after migration | Removes type ambiguity |
| 20 | `legacyJobStatusEnum` after frontend migration | Removes legacy API surface |

---

## 11. Top 20 Highest-Risk Architectural Contradictions

| # | Contradiction | Risk |
|---|-------------|------|
| 1 | Orchestrator reconciliation writes `status: "completed"` bypassing domain lifecycle | Data corruption — missing previousStatus, closedAt, version increment, audit trail |
| 2 | Invoice status enum has different values in shared vs server | Type safety broken — frontend can't represent `awaiting_payment` |
| 3 | Visit "on_site" displays as "On Site" on 8 surfaces and "In Progress" on 3 | User confusion, support tickets |
| 4 | Visit eligibility predicates differ across 3 modules | syncJobScheduleFromVisits may sync wrong visit; orchestrator may miss actionable visits |
| 5 | Client-side `isJobOverdue()` duplicates server logic | Dashboard count may differ from Jobs page filtered list |
| 6 | techField.ts writes visit status directly in routes | No audit trail, no version check, no transition validation |
| 7 | Soft-delete semantics differ per table | JOINs may include/exclude rows inconsistently |
| 8 | `effectiveEnd` computed differently in visitIntelligence | Travel time estimates and conflict detection use wrong end time |
| 9 | Technician name shows "Unknown" on server, "Unnamed" on client | Inconsistent display |
| 10 | `legacyJobStatusEnum` still accepted in API | Old vocabulary stays alive in client code |
| 11 | `paginatedCompat()` returns two different shapes | Type-unsafe consumption |
| 12 | `jobVisits.service.ts` deprecated but still imported | Adds confusion about where to add visit logic |
| 13 | No centralized visit status enum in TypeScript | Visit status values are implicit strings |
| 14 | Duplicate `isTerminalStatus()` in lifecycle + scheduling | Could diverge |
| 15 | Dashboard "unscheduled" count from server vs Jobs page client-side filter | Count may not match list |
| 16 | No visit-level lifecycle authority (only job-level exists) | Visit transitions unprotected |
| 17 | `holdReason` mapping to `outcome` in NeedsFollowUpModal is client-only | Business rule not server-validated |
| 18 | Version resolved from cache in dispatch mutations | Stale version if cache not populated |
| 19 | Invoice overdue computed both server-side and client-side | Could diverge if definition changes |
| 20 | Multiple URL param vocabularies for Jobs page filters | `subStatus=overdue` conflicts with real openSubStatus values |

---

## 12. Recommended Remediation Order

### Phase 1: Delete Dead Code (1 day)
1. Delete `client/src/lib/csrf.ts`
2. Delete `server/services/jobVisits.service.ts` — update 2 route imports
3. Delete escalation dead code in `Jobs.tsx`
4. Delete deprecated aliases (`TERMINAL_STATUSES`, `CLOSEABLE_STATES`, client `TERMINAL_STATUSES`)
5. Delete `getMemberSecondary()`, console.log debug line
6. Delete duplicate `isTerminalStatus()` from `scheduling.ts`

### Phase 2: Centralize Shared Utilities (2 days)
7. Extract `server/lib/geoHelpers.ts` (haversineMeters + travel time)
8. Extract `server/lib/visitPredicates.ts` (TERMINAL_VISIT_STATUSES + activeVisitPredicate)
9. Extract `server/lib/intelligenceTypes.ts` (shared ScheduledVisitRow base)
10. Extract shared `upsertAttentionItem()` utility
11. Create `client/src/lib/visitStatusDisplay.ts` — delete 6+ local constants

### Phase 3: Harden Canonical Write Paths (3 days)
12. **Fix C-1**: Refactor `reconcileJobAfterVisitCompletion()` to use `transitionJobStatus()` instead of direct SQL
13. Refactor `techField.ts` visit mutations through orchestrator or service
14. Fix `effectiveEnd` computation in `visitIntelligence.ts`

### Phase 4: Fix Schema / Type Issues (1 day)
15. **Fix C-2**: Add `awaiting_payment` to `shared/schema.ts` invoiceStatusEnum
16. Add TypeScript visit status enum to `shared/schema.ts`
17. Document soft-delete semantics per table

### Phase 5: Frontend Cleanup After Backend Truth (2 days)
18. Return computed flags (`isOverdue`, `isScheduled`) from jobs API — remove client derivation
19. Standardize "on_site" → "In Progress" across all surfaces
20. Unify technician display name function
21. Standardize URL param vocabulary for Jobs page

### Phase 6: Migration Cleanup (1 day)
22. Migrate remaining `paginatedCompat()` endpoints to `paginated()`
23. Remove `legacyJobStatusEnum` from route validation
24. Remove `reconcileJobInvoiceLinks()` stub

---

*End of audit. All findings are codebase-specific with exact file paths and line numbers. No generic advice included.*
