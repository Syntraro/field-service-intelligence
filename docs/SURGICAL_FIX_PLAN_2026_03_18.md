# Surgical Fix Plan — Canonical Ownership Hardening

**Date**: 2026-03-18
**Source**: `docs/CANONICAL_OWNERSHIP_PROOF_2026_03_18.md`
**Scope**: Only proven bypasses and contradictions. No speculative work.

---

## Phase 1 — Critical Canonical Write Fixes

---

### BP-1: Reconciliation Terminal Status Bypass

**Problem**: `reconcileJobAfterVisitCompletion()` Rule 1 (orchestrator.ts:734-746) writes `status: "completed"` directly via `db.update(jobs)`, missing 8 fields that `CLOSE_JOB(mode=invoice_later)` sets through the canonical lifecycle engine.

**Function to modify**: `reconcileJobAfterVisitCompletion()` in `server/services/jobLifecycleOrchestrator.ts`, lines 730-748.

**Approach**: Replace the direct `db.update(jobs)` with a call to `jobRepository.transitionJobStatus()` using an existing intent.

**Exact rerouting**:

The existing `CLOSE_JOB` intent with `mode: "invoice_later"` already produces exactly the right patch for `open → completed`: it sets `status`, `previousStatus`, `closedAt`, `closedBy`, clears scheduling fields, clears hold fields, increments version, and emits an audit event. This is the semantic match — visit-completion auto-close IS "close job, invoice later."

```
Current:  reconcileJobAfterVisitCompletion() → db.update(jobs).set({status:"completed",...})
Proposed: reconcileJobAfterVisitCompletion() → jobRepository.transitionJobStatus(
            companyId, jobId, job.version,
            { type: "CLOSE_JOB", mode: "invoice_later" },
            { userId: completedByUserId, role: "system" }
          )
```

**Changes required**:

1. **Expand the `reconcileJobAfterVisitCompletion` function signature** — it currently receives `{ companyId, jobId, outcome, holdReason, holdNotes }`. It needs two additional fields:
   - `completedByUserId: string` — the user who completed the visit (for `closedBy` attribution). Already available in `CompleteVisitIntent.completedByUserId`.
   - `jobVersion: number` — needed for optimistic locking in `transitionJobStatus()`. Must be fetched from the full job row.

2. **Change the job query at line 693-696** from a partial select (`id, status, openSubStatus`) to a full select (or at minimum add `version` and `pmBillingDisposition`). `transitionJobStatus()` loads the full job itself inside its transaction, so alternatively pass version from the initial load.

3. **Replace lines 734-746** (the direct `db.update`) with:
   ```
   await jobRepository.transitionJobStatus(
     companyId,
     jobId,
     job.version,
     { type: "CLOSE_JOB", mode: "invoice_later" },
     { userId: completedByUserId, role: "system" }
   );
   ```

4. **Audit event action**: The canonical lifecycle will emit `action: "close"` with `meta: { mode: "invoice_later" }`. This is semantically correct — the job is being closed with invoicing deferred. If we want to distinguish auto-close-via-visit from manual close, add `meta: { trigger: "visit_reconciliation" }` to the audit event. This requires a minor extension: either pass extra meta through the intent, or accept the standard audit action.

   **Decision**: Accept the standard `close` action. The visit completion event on the visit itself already provides the causal link. Adding a new meta field would require changing the domain intent type, which violates the narrow scope.

**What NOT to change**:
- The visit eligibility query (lines 712-726) stays as-is — it's correct for reconciliation scope.
- Rules 2, 3, 4 are handled separately in BP-2.
- The `syncJobToVisits()` call at line 300 stays — it runs AFTER reconciliation.

**Invariants that must hold after change**:
- A job auto-completed via visit reconciliation has identical field state to one closed via `CLOSE_JOB(mode=invoice_later)`: `previousStatus`, `closedAt`, `closedBy`, `scheduledStart=null`, `scheduledEnd=null`, `isAllDay=false`, `openSubStatus=null`, `holdReason=null`, `version` incremented, `jobStatusEvent` created.
- `UNDO_CLOSE` works within 20s window (requires `closedAt` and `previousStatus`).
- `REOPEN_JOB` can restore `previousStatus`.
- PM jobs get `pmBillingStatus` set correctly.
- If the job was already closed/invoiced/archived between visit completion and reconciliation, `transitionJobStatus()` will throw (version mismatch or invalid state). The reconciliation function must handle this gracefully — catch `LifecycleTransitionError` with code `INVALID_STATE` and treat it as a no-op (job already terminal).

**Edge case — version mismatch**: `transitionJobStatus()` requires `expectedVersion`. Between the visit completion write and reconciliation, another request could have modified the job. The function must:
1. Load the full job inside reconciliation (already does at line 693).
2. Pass `job.version` to `transitionJobStatus()`.
3. If version mismatch (409), retry once with fresh version, or treat as no-op if job is already terminal.

**Recommendation**: Load the full job row (not partial select) and pass `job.version`. If `transitionJobStatus()` throws `VERSION_MISMATCH`, reload the job — if it's already `completed/invoiced/archived`, return `{ jobUpdated: false }`. If it's still `open`, retry once.

**Test cases required**:

| Test | What it proves |
|------|---------------|
| Complete last visit (outcome=completed) → job becomes "completed" with `previousStatus`, `closedAt`, `closedBy` all set | BP-1 fix works |
| Complete last visit → `scheduledStart`, `scheduledEnd`, `isAllDay` are null on the job | Schedule clearing via lifecycle |
| Complete last visit → `jobStatusEvents` row created with `fromStatus="open"`, `toStatus="completed"` | Audit trail restored |
| Complete last visit → `job.version` incremented by 1 | Optimistic locking restored |
| Complete last visit on PM job with `pmBillingDisposition` → `pmBillingStatus` set | PM billing consistency |
| Complete last visit → UNDO_CLOSE within 20s succeeds (has `closedAt` and `previousStatus`) | Undo path works |
| Complete last visit when job is already "completed" (race condition) → no error, returns `jobUpdated: false` | Graceful degradation |

---

### BP-2: Reconciliation Non-Terminal Version/Event Bypasses

**Problem**: Rules 2, 3, 4 in `reconcileJobAfterVisitCompletion()` (lines 752-809) write `openSubStatus` and hold fields directly via `db.update(jobs)` without incrementing version or creating audit events.

**Functions to modify**: Same function, lines 752-762 (Rule 2), 770-785 (Rule 3), 794-809 (Rule 4).

**Approach**: Route through the existing `jobRepository.updateJobStatusWithEvent()` — the same method used by `placeJobOnHold()`, `resumeJob()`, and `setJobSubstatus()` in the orchestrator. This method atomically updates the job AND creates a `jobStatusEvent`, and always increments version.

**Exact rerouting**:

```
Current (Rule 2):  db.update(jobs).set({ status:"open", openSubStatus:"on_hold", ... })
Proposed (Rule 2): jobRepository.updateJobStatusWithEvent(companyId, jobId, {
                     fromStatus: "open",
                     toStatus: "open",
                     changedBy: completedByUserId,
                     note: `Visit outcome: ${outcome} — placed on hold`,
                     meta: { action: "reconcile_hold", outcome, holdReason },
                     additionalUpdates: {
                       openSubStatus: "on_hold",
                       holdReason: holdReason || "other",
                       holdNotes: holdNotes || null,
                       onHoldAt: new Date(),
                     },
                   })
```

```
Current (Rule 3):  db.update(jobs).set({ openSubStatus:"on_hold", ... })
Proposed (Rule 3): jobRepository.updateJobStatusWithEvent(companyId, jobId, {
                     fromStatus: "open",
                     toStatus: "open",
                     changedBy: completedByUserId,
                     note: `Visit needs follow-up — hold applied`,
                     meta: { action: "reconcile_hold_partial", outcome, holdReason },
                     additionalUpdates: {
                       openSubStatus: "on_hold",
                       holdReason: holdReason || "other",
                       holdNotes: holdNotes || null,
                       onHoldAt: new Date(),
                     },
                   })
```

```
Current (Rule 4):  db.update(jobs).set({ openSubStatus:null, holdReason:null, ... })
Proposed (Rule 4): jobRepository.updateJobStatusWithEvent(companyId, jobId, {
                     fromStatus: "open",
                     toStatus: "open",
                     changedBy: completedByUserId,
                     note: "Subsequent visit completed — hold cleared",
                     meta: { action: "reconcile_resume" },
                     additionalUpdates: {
                       openSubStatus: null,
                       holdReason: null,
                       holdNotes: null,
                       onHoldAt: null,
                     },
                   })
```

**Signature change**: Same as BP-1 — `completedByUserId` must be passed into `reconcileJobAfterVisitCompletion()`. This is the same signature change, so BP-1 and BP-2 are implemented together.

**No new authority needed**: `updateJobStatusWithEvent()` already exists at `server/storage/jobs.ts:1325` and is the established pattern for sub-lifecycle mutations (hold, resume, substatus). Rules 2/3/4 are semantically identical to those operations.

**Invariants that must hold after change**:
- Rules 2/3/4 create `jobStatusEvents` rows (audit trail).
- Rules 2/3/4 increment `version` (optimistic locking).
- Rule 2 sets `status: "open"` (no change) + `openSubStatus: "on_hold"` — same as `placeJobOnHold()`.
- Rule 3 sets only `openSubStatus: "on_hold"` — same as `placeJobOnHold()` but without status change.
- Rule 4 clears hold fields — same as `resumeJob()`.
- All guard clauses (`eq(jobs.status, "open")` at lines 783, 807) are preserved — `updateJobStatusWithEvent` updates WHERE `id AND companyId`, so add the `status="open"` guard to the additionalUpdates' WHERE clause or validate before calling.

**Important**: `updateJobStatusWithEvent()` does NOT have a status guard in its WHERE clause — it filters by `id + companyId` only. Rules 3 and 4 currently guard with `eq(jobs.status, "open")`. To preserve this:
- Option A: Add pre-check before calling (we already loaded the job at line 693 and checked `status === "open"` at line 698).
- Option B: Accept the pre-check already done at the top of the function — if `job.status !== "open"`, we return early at line 698-704.

**Decision**: Option B. The status guard at lines 698-704 already ensures we only reach Rules 2/3/4 when `job.status === "open"`. The per-rule WHERE guards at 783/807 are defensive-in-depth. Since `updateJobStatusWithEvent()` runs in a transaction with version increment, a concurrent status change will be caught by the version check. Accept Option B.

**Test cases required**:

| Test | What it proves |
|------|---------------|
| Complete visit (needs_parts, no remaining visits) → `openSubStatus="on_hold"`, `holdReason` set, `jobStatusEvent` created, `version` incremented | Rule 2 through canonical path |
| Complete visit (needs_followup, remaining visits exist) → `openSubStatus="on_hold"`, `jobStatusEvent` created | Rule 3 through canonical path |
| Complete visit (completed, remaining visits, job was on_hold) → `openSubStatus=null`, hold fields cleared, `jobStatusEvent` created | Rule 4 through canonical path |
| Version increments for Rules 2/3/4 | Optimistic locking |

---

### BP-3/BP-4: techField Direct Visit Status Writes

**Problem**: `server/routes/techField.ts` lines 170-178 (en-route) and 219-228 (start) write `jobVisits.status` directly in route handlers without going through any service.

**Functions to modify**:
- Route handler at `techField.ts:154-197` (POST /visits/:visitId/en-route)
- Route handler at `techField.ts:203-239` (POST /visits/:visitId/start)

**Approach**: Create two new orchestrator methods: `setVisitEnRoute()` and `startVisit()`. These are NOT lifecycle transitions (the job stays open) — they're workflow state changes, analogous to how `setJobSubstatus()` works for jobs.

**Why a new authority is needed**: There is no existing visit-level workflow method in the orchestrator. `completeVisit()` handles terminal transitions. `updateJobVisitStatus()` in `jobVisits.ts:733` is a generic storage method — it auto-sets timestamps but has no audit trail. The tech field routes add time-tracking side effects that belong in an orchestrator method, not a route handler.

**New functions in `server/services/jobLifecycleOrchestrator.ts`**:

```
export interface SetVisitEnRouteIntent {
  type: "SET_VISIT_EN_ROUTE";
  companyId: string;
  visitId: string;
  jobId: string;
  technicianUserId: string;
  at?: Date;
}

export interface StartVisitIntent {
  type: "START_VISIT";
  companyId: string;
  visitId: string;
  jobId: string;
  technicianUserId: string;
  at?: Date;
}
```

**Implementation sketch for `setVisitEnRoute()`**:
1. Load visit via `jobVisitsRepository.getJobVisit()`.
2. Validate: not completed, not cancelled.
3. Write: `status: "en_route"`, `updatedAt`, `version + 1`.
4. Call `jobVisitsRepository.syncJobToVisits()` (already done in route — move here).
5. Return updated visit.

**Implementation sketch for `startVisit()`**:
1. Load visit via `jobVisitsRepository.getJobVisit()`.
2. Validate: not completed, not cancelled.
3. Write: `status: "in_progress"`, `checkedInAt: visit.checkedInAt ?? now`, `updatedAt`, `version + 1`.
4. Call `jobVisitsRepository.syncJobToVisits()` (already done in route — move here).
5. Return updated visit.

**Route changes**:
- `techField.ts` en-route handler (lines 170-181): Replace `db.update(jobVisits)` + `syncJobToVisits()` with `lifecycle.setVisitEnRoute(intent)`.
- `techField.ts` start handler (lines 219-231): Replace `db.update(jobVisits)` + `syncJobToVisits()` with `lifecycle.startVisit(intent)`.
- Time-tracking calls (lines 183-193, 233-239) stay in the route — they're side effects specific to the tech field app, not visit lifecycle.

**What stays in the route**: The `timeTrackingRepository.recordJobStatus()` calls. These are tech-field-app-specific side effects (travel/on-site time tracking). They don't belong in the orchestrator because non-tech-field status changes (e.g., dispatcher updating visit status) should NOT create time entries. The route is the correct place for app-specific side effects.

**Invariants that must hold after change**:
- Visit status transition validation (cannot update completed/cancelled) moves from route to orchestrator.
- Version is incremented atomically.
- `syncJobToVisits()` still runs after every status change.
- Time tracking still fires from the route (non-fatal on failure).
- The `getAssignedVisit()` auth check stays in the route (tech must be assigned).

**Test cases required**:

| Test | What it proves |
|------|---------------|
| Tech marks en-route → visit.status = "en_route", version incremented | Basic en-route flow |
| Tech starts visit → visit.status = "in_progress", checkedInAt set (if not already), version incremented | Basic start flow |
| Tech marks en-route on completed visit → 400 error | Guard preserved |
| Tech starts visit already checked in → checkedInAt preserved (not overwritten) | Idempotent check-in |
| After en-route/start → job.scheduledStart/End reflect visit state (syncJobToVisits) | Schedule sync preserved |

---

## Phase 2 — Semantic Centralization

---

### Visit Eligibility Predicate

**Problem**: 5 definitions of "eligible/actionable visit" with 3 inconsistencies (E1-E5 in proof).

**Analysis — are multiple predicates actually needed?**

Yes. There are genuinely 3 different business concepts hiding under "eligible":

| Concept | Used By | Predicate | Difference |
|---------|---------|-----------|------------|
| **Schedule-eligible** (can sync to job schedule) | `syncJobScheduleFromVisits()`, `getCurrentEligibleVisit()` | `isActive AND scheduledStart IS NOT NULL AND status NOT IN terminal AND archivedAt IS NULL` | Requires scheduledStart |
| **Reconciliation-actionable** (counts as pending work) | `reconcileJobAfterVisitCompletion()` | Same + `OR checkedInAt IS NOT NULL` | Includes checked-in but unscheduled |
| **Force-close-pending** (needs auto-completion) | `getUncompletedVisits()` | `isActive AND status NOT IN terminal AND archivedAt IS NULL` | No scheduledStart requirement |

These ARE semantically distinct. The fix is not to merge them but to name them explicitly.

**Canonical module**: Create `server/lib/visitPredicates.ts`

**Contents**:
```
export const TERMINAL_VISIT_STATUSES: string[] = ["completed", "cancelled"];

// Visits that can be synced to job scheduling fields
export function scheduleEligibleVisitFilter(companyId, jobId) → Drizzle AND conditions
  isActive=true, scheduledStart IS NOT NULL, status NOT IN terminal, archivedAt IS NULL

// Visits that represent real pending work (blocks job auto-close)
export function reconciliationActionableVisitFilter(companyId, jobId) → Drizzle AND conditions
  isActive=true, status NOT IN terminal, archivedAt IS NULL,
  (scheduledStart IS NOT NULL OR checkedInAt IS NOT NULL)

// Visits that need auto-completion before force-close
export function uncompletedVisitFilter(companyId, jobId) → Drizzle AND conditions
  isActive=true, status NOT IN terminal, archivedAt IS NULL
```

**Consumers to update**:

| Consumer | Current Location | Replace With |
|----------|-----------------|-------------|
| `getCurrentEligibleVisit()` | `jobVisits.ts:184-192` | `scheduleEligibleVisitFilter()` |
| `syncJobScheduleFromVisits()` | `jobVisits.ts:387-399` | `scheduleEligibleVisitFilter()` |
| `reconcileJobAfterVisitCompletion()` | `orchestrator.ts:712-726` | `reconciliationActionableVisitFilter()` |
| `getUncompletedVisits()` | `jobVisits.ts:816-834` | `uncompletedVisitFilter()` |
| `fetchScheduledVisits()` | `visitIntelligence.ts:137-166` | `scheduleEligibleVisitFilter()` + date bounds (intelligence-specific) |

---

### Effective End Time

**Problem**: `visitIntelligence.ts:316-320` computes effective end without the `scheduledStart` fallback that exists in `queryHelpers.ts:49-54` and `shared/schema.ts:isJobOverdue():1575-1594`.

**Canonical module**: `shared/schema.ts` — add an exported function.

**New function in `shared/schema.ts`**:
```
export function getEffectiveEnd(entity: {
  scheduledStart: Date | string | null;
  scheduledEnd?: Date | string | null;
  durationMinutes?: number | null;
  estimatedDurationMinutes?: number | null;
}): Date | null {
  // Priority: scheduledEnd > scheduledStart+duration > scheduledStart
  // Matches effectiveEndExpr in queryHelpers.ts and isJobOverdue() logic
}
```

This function serves both jobs (which have `durationMinutes`) and visits (which have `estimatedDurationMinutes`). The function accepts both field names.

**Consumers to update**:

| Consumer | File | Line(s) | Change |
|----------|------|---------|--------|
| `visitIntelligence.ts` effective end | `server/lib/visitIntelligence.ts` | 317-319 | Replace inline computation with `getEffectiveEnd(v)` |
| `isJobOverdue()` internal logic | `shared/schema.ts` | 1575-1594 | Refactor to call `getEffectiveEnd()` internally |

**Leave unchanged**: `effectiveEndExpr` in `queryHelpers.ts` — this is the SQL equivalent and must remain as raw SQL for query performance. Document in a comment that it mirrors `getEffectiveEnd()`.

---

### Visit Status Display Label

**Problem**: 12 independent `STATUS_LABELS` constants across 12 files, with `on_site` showing "On Site" on 9 surfaces and "In Progress" on 3.

**Canonical module**: `client/src/lib/visitStatusDisplay.ts` (new file)

**Contents** — re-export from `dispatchPreviewUtils.ts` which already has the canonical functions:
```
// Re-export canonical visit status display functions
export { visitStatusLabel, visitStatusColor, visitStatusDot, normalizeVisitStatusForDisplay }
  from "@/components/dispatch/dispatchPreviewUtils";

// Convenience constant for dropdowns/selects
export const VISIT_STATUS_OPTIONS = [
  { value: "scheduled",   label: "Scheduled" },
  { value: "dispatched",  label: "Dispatched" },
  { value: "en_route",    label: "En Route" },
  { value: "in_progress", label: "In Progress" },
  { value: "on_hold",     label: "On Hold" },
  { value: "completed",   label: "Completed" },
  { value: "cancelled",   label: "Cancelled" },
] as const;
```

Note: `on_site` is NOT in the options list. The `visitStatusLabel()` function normalizes it to "In Progress" via `normalizeVisitStatusForDisplay()`. All surfaces call `visitStatusLabel(status)` instead of looking up a local constant.

**Decision on canonical label**: "In Progress". Rationale:
- `on_site` is a legacy DB value (the DB stores it, but it means "technician is working").
- Dispatch board (primary scheduling surface) already shows "In Progress".
- "On Site" is ambiguous — could mean "arrived but not started" vs "working".
- `normalizeVisitStatusForDisplay()` in `dispatchPreviewUtils.ts` already implements this normalization.

**Consumers to update** — delete local constants, import from `visitStatusDisplay.ts`:

| File | Lines to Delete | Import to Add |
|------|----------------|---------------|
| `client/src/components/dispatch/DispatchDetailPanel.tsx` | 87-96 (`STATUS_LABELS`) | `import { visitStatusLabel } from "@/lib/visitStatusDisplay"` |
| `client/src/components/visits/EditVisitModal.tsx` | 58-78 (`VISIT_STATUS_COLORS`, `VISIT_STATUS_LABELS`) | `import { visitStatusLabel, visitStatusColor } from "@/lib/visitStatusDisplay"` |
| `client/src/components/JobVisitsSection.tsx` | 50-70 (`STATUS_COLORS`, `STATUS_LABELS`) | `import { visitStatusLabel, visitStatusColor } from "@/lib/visitStatusDisplay"` |
| `client/src/pages/JobDetailPage.tsx` | 289, 496-505 (`VISIT_STATUS_LABELS`) | `import { visitStatusLabel } from "@/lib/visitStatusDisplay"` |
| `client/src/pages/TechHomePage.tsx` | 35-44 (`STATUS_LABELS`) | `import { visitStatusLabel } from "@/lib/visitStatusDisplay"` |
| `client/src/pages/TechVisitDetailPage.tsx` | 90-99 (`STATUS_LABELS`) | `import { visitStatusLabel } from "@/lib/visitStatusDisplay"` |
| `client/src/pages/TechSchedulePage.tsx` | 31-37 (`STATUS_LABELS`) | `import { visitStatusLabel } from "@/lib/visitStatusDisplay"` |
| `client/src/pages/UnassignedTimePage.tsx` | 73 (inline) | `import { visitStatusLabel } from "@/lib/visitStatusDisplay"` |
| `client/src/pages/TimeAnalyticsPage.tsx` | 80 (inline) | `import { visitStatusLabel } from "@/lib/visitStatusDisplay"` |
| `client/src/components/time/AddTimeEntryModal.tsx` | 45 (options) | `import { VISIT_STATUS_OPTIONS } from "@/lib/visitStatusDisplay"` |
| `client/src/components/time/EditTimeEntryModal.tsx` | 41 (options) | `import { VISIT_STATUS_OPTIONS } from "@/lib/visitStatusDisplay"` |

Each consuming component replaces `STATUS_LABELS[status]` with `visitStatusLabel(status)` and `STATUS_COLORS[status]` with `visitStatusColor(status)`.

---

## Phase 3 — Safe Deletions

Each deletion is backed by proof from the ownership audit.

### 3.1 `scheduleJobBypassWorkingHours()`

**File**: `server/storage/scheduling.ts` lines 1315-1397
**Proof**: Exhaustive grep found zero callers. Function is exported but never imported.
**Action**: Delete the function. Remove from any export map if present.
**Risk**: Zero. Dead code.

### 3.2 `updateJobStatusWithMultipleEvents()`

**File**: `server/storage/jobs.ts` lines 1393-1450
**Proof**: Exhaustive grep found zero callers. Exported in `storage/index.ts` but never imported by any consumer.
**Action**: Delete the function. Remove from storage index exports.
**Risk**: Zero. Dead code.

### 3.3 Duplicate `isTerminalStatus()` in scheduling.ts

**File**: `server/domain/scheduling.ts` lines 68-71
**Proof**: Identical to `server/domain/jobLifecycle.ts:162-166`. Both import `TERMINAL_STATUSES` from `statusRules.ts`.
**Action**: Delete from `scheduling.ts`. Update all imports in `scheduling.ts` consumers to import from `jobLifecycle.ts`.
**Consumers to update**: Search for `import { isTerminalStatus } from "../domain/scheduling"` — replace with `import { isTerminalStatus } from "../domain/jobLifecycle"`.
**Risk**: Zero. Identical function.

### 3.4 Duplicate visit label constants (after Phase 2 centralization)

**Files**: 11 local constants listed in Phase 2 visit status label section.
**Action**: Delete each local constant AFTER the centralized import is in place and verified.
**Risk**: Zero if Phase 2 is completed first.

---

## Phase 4 — Regression Checklist

### 4.1 Close / Undo-Close

| # | Test | Expected Result | Validates |
|---|------|----------------|-----------|
| 1 | Close job via "Invoice Later" button | `status=completed`, `previousStatus=open`, `closedAt` set, `closedBy` set, `version+1`, `jobStatusEvent` created, schedule cleared | Canonical close path unchanged |
| 2 | Close job via "Archive" button | Same as above but `status=archived` | Canonical close path unchanged |
| 3 | Close job via "Invoice Now" button | `status=invoiced`, all terminal metadata set | Canonical close path unchanged |
| 4 | Undo close within 20s | `status` restored to `previousStatus`, `closedAt/closedBy/previousStatus` nulled | Undo path unchanged |
| 5 | Undo close after 20s | Rejected with `UNDO_WINDOW_EXPIRED` | Undo guard unchanged |

### 4.2 Complete Last Visit (BP-1 regression)

| # | Test | Expected Result | Validates |
|---|------|----------------|-----------|
| 6 | Complete last visit (outcome=completed) | Job: `status=completed`, `previousStatus=open`, `closedAt` set, `closedBy` = completing user, `scheduledStart=null`, `scheduledEnd=null`, `isAllDay=false`, `openSubStatus=null`, `version+1`, `jobStatusEvent` created | BP-1 fix — all 8 missing fields now set |
| 7 | Complete last visit (outcome=needs_parts) | Job: `status=open`, `openSubStatus=on_hold`, `holdReason` set, `version+1`, `jobStatusEvent` created | BP-2 fix — Rule 2 |
| 8 | Complete last visit (outcome=needs_followup) | Same as #7 | BP-2 fix — Rule 2 |
| 9 | Undo close on auto-completed job within 20s | Job reopens — proves `closedAt` and `previousStatus` are present | BP-1 enables undo |
| 10 | Complete last visit on PM job with `pmBillingDisposition` | `pmBillingStatus` set correctly | PM billing via lifecycle |
| 11 | Complete last visit when job was concurrently closed | No error, reconciliation returns `jobUpdated: false` | Race condition handling |

### 4.3 Force Close with Remaining Visits

| # | Test | Expected Result | Validates |
|---|------|----------------|-----------|
| 12 | Force close with `autoCompleteOpenVisits=true` | All open visits bulk-completed, then job closed via lifecycle | Existing flow unchanged |
| 13 | Force close without `autoCompleteOpenVisits` | Job closed, remaining visits untouched | Existing flow unchanged |

### 4.4 Tech En-Route / Start (BP-3/BP-4 regression)

| # | Test | Expected Result | Validates |
|---|------|----------------|-----------|
| 14 | Tech marks visit en-route | `visit.status=en_route`, `version+1`, job schedule synced | BP-3 fix |
| 15 | Tech starts visit | `visit.status=in_progress`, `checkedInAt` set, `version+1`, job schedule synced | BP-4 fix |
| 16 | Tech marks completed visit en-route | 400 error | Guard preserved in orchestrator |
| 17 | Tech starts already-checked-in visit | `checkedInAt` not overwritten | Idempotent check-in |
| 18 | Time tracking fires after en-route | `travel_to_job` time entry created | Side effect preserved in route |
| 19 | Time tracking fires after start | `on_site` time entry created | Side effect preserved in route |

### 4.5 Schedule Sync After Visit Completion

| # | Test | Expected Result | Validates |
|---|------|----------------|-----------|
| 20 | Complete visit, other visits remain | Job schedule mirrors next eligible visit | syncJobToVisits unchanged |
| 21 | Complete last visit | Job schedule cleared (scheduledStart=null) | syncJobToVisits unchanged |
| 22 | Cancel visit, other visits remain | Job schedule mirrors next eligible visit | syncJobToVisits unchanged |

### 4.6 UI Label Consistency (Phase 2 regression)

| # | Test | Expected Result | Validates |
|---|------|----------------|-----------|
| 23 | View visit with status `on_site` on job detail page | Shows "In Progress" | Phase 2 label fix |
| 24 | View visit with status `on_site` on dispatch board | Shows "In Progress" | Already correct |
| 25 | View visit with status `on_site` on tech home page | Shows "In Progress" | Phase 2 label fix |
| 26 | View visit with status `on_site` in edit visit modal | Shows "In Progress" | Already correct |
| 27 | View visit with status `on_site` in time tracking pages | Shows "In Progress" | Phase 2 label fix |

### 4.7 Optimistic Locking / Version Behavior

| # | Test | Expected Result | Validates |
|---|------|----------------|-----------|
| 28 | Complete last visit → check job.version | Version incremented by 1 (was missing in bypass) | BP-1 version fix |
| 29 | Place job on hold via reconciliation → check job.version | Version incremented by 1 (was missing in bypass) | BP-2 version fix |
| 30 | Two concurrent close attempts on same job | Second attempt gets 409 VERSION_MISMATCH | Optimistic locking works |
| 31 | Frontend loads job, visit completes auto-close, frontend tries stale close | 409 VERSION_MISMATCH (correct — job already closed) | No silent overwrites |

---

## Implementation Order

```
Phase 1a: BP-1 + BP-2 together (same function, same signature change)
  File: server/services/jobLifecycleOrchestrator.ts
  Depends on: nothing

Phase 1b: BP-3 + BP-4 together (same route file, same pattern)
  Files: server/services/jobLifecycleOrchestrator.ts (new methods),
         server/routes/techField.ts (route simplification)
  Depends on: nothing (independent of 1a)

Phase 2a: Visit eligibility predicates
  File: server/lib/visitPredicates.ts (new),
        server/storage/jobVisits.ts, server/services/jobLifecycleOrchestrator.ts,
        server/lib/visitIntelligence.ts
  Depends on: Phase 1a (reconciliation uses the predicate)

Phase 2b: Effective end
  File: shared/schema.ts, server/lib/visitIntelligence.ts
  Depends on: nothing

Phase 2c: Visit status display label
  File: client/src/lib/visitStatusDisplay.ts (new), 12 consumer files
  Depends on: nothing (pure frontend)

Phase 3: Safe deletions
  Depends on: Phase 2a (isTerminalStatus consumers updated),
              Phase 2c (label constants replaced)
```

Phase 1a and 1b can run in parallel.
Phase 2a, 2b, 2c can run in parallel.
Phase 3 runs last.

---

*End of plan. Every change maps to a proven bypass or contradiction. No speculative work included.*
