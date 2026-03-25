# Canonical Ownership Proof & Bypass Inventory

**Date**: 2026-03-18
**Scope**: Every write to 12 critical fields + every derivation of 6 semantic concepts
**Method**: Exhaustive grep + full file reads across all server/, client/, shared/ code

---

## 1. Canonical Write Matrix

### 1.1 `jobs.status`

**Canonical owner**: `server/domain/jobLifecycle.ts:applyLifecycleTransition()` → applied via `server/storage/jobs.ts:transitionJobStatus()` (line 1501)

| # | File | Function | Line(s) | Value(s) Written | Through `applyLifecycleTransition()`? | Classification | Reachability |
|---|------|----------|---------|-----------------|--------------------------------------|----------------|-------------|
| W1 | `server/storage/jobs.ts` | `transitionJobStatus()` | 1562-1570 | Per intent (open/completed/invoiced/archived) | **YES** | **Canonical** | Runtime — close/reopen/undo/markInvoiced routes |
| W2 | `server/services/jobLifecycleOrchestrator.ts` | `reconcileJobAfterVisitCompletion()` Rule 1 | 737 | `"completed"` | **NO** — direct `db.update(jobs)` | **Duplicate and inconsistent** | Runtime — POST /api/jobs/:jobId/visits/:visitId/complete |
| W3 | `server/services/jobLifecycleOrchestrator.ts` | `reconcileJobAfterVisitCompletion()` Rule 2 | 755 | `"open"` | **NO** — direct `db.update(jobs)` | **Duplicate but consistent** (keeps status=open) | Runtime — same route |
| W4 | `server/storage/jobs.ts` | `updateJobStatusWithEvent()` | 1352-1360 | Per `toStatus` param | **NO** — direct status write with audit event | **Canonical for sub-lifecycle** (hold/resume/substatus) | Runtime — orchestrator hold/resume/substatus |
| W5 | `server/storage/scheduling.ts` | `scheduleJobBypassWorkingHours()` | 1369,1393 | `"open"` (forced) | **NO** | **Dead** | No callers found |
| W6 | `server/scripts/sanity-check-lifecycle.ts` | `repairJob()` | 73-79 | Per repair patch | **NO** | **Maintenance utility** | CLI only — not runtime |

**Bypass count**: 2 runtime bypasses (W2, W3). W2 is the critical one — sets `status: "completed"` without `previousStatus`, `closedBy`, `version` increment, `scheduledStart/End` clearing, `pmBillingStatus`, or audit events.

---

### 1.2 `jobs.openSubStatus`

**Canonical owner**: `server/domain/jobLifecycle.ts:getOpenSubStatusClearingPatch()` for terminal transitions; `server/storage/jobs.ts:updateJobStatusWithEvent()` for hold/resume via orchestrator.

| # | File | Function | Line(s) | Value(s) Written | Classification | Reachability |
|---|------|----------|---------|-----------------|----------------|-------------|
| W1 | `server/storage/jobs.ts` | `transitionJobStatus()` | 1562-1570 | `null` (via lifecycle clearing patch) | **Canonical** (terminal transitions) | Runtime |
| W2 | `server/storage/jobs.ts` | `updateJobStatusWithEvent()` | 1352-1360 | `"on_hold"`, `"in_progress"`, `"on_route"`, `null` | **Canonical** (sub-lifecycle) | Runtime |
| W3 | `server/services/jobLifecycleOrchestrator.ts` | `reconcileJobAfterVisitCompletion()` Rule 1 | 738 | `null` | **Duplicate but consistent** | Runtime |
| W4 | `server/services/jobLifecycleOrchestrator.ts` | `reconcileJobAfterVisitCompletion()` Rule 2 | 756 | `"on_hold"` | **Duplicate but consistent** | Runtime |
| W5 | `server/services/jobLifecycleOrchestrator.ts` | `reconcileJobAfterVisitCompletion()` Rule 3 | 773 | `"on_hold"` | **Duplicate but consistent** | Runtime |
| W6 | `server/services/jobLifecycleOrchestrator.ts` | `reconcileJobAfterVisitCompletion()` Rule 4 | 796 | `null` | **Duplicate but consistent** | Runtime |

**Bypass count**: 4 runtime bypasses (W3-W6). Values are consistent with lifecycle semantics but lack audit events and version increments.

---

### 1.3 `jobs.previousStatus`

**Canonical owner**: `server/domain/jobLifecycle.ts` — set inside `applyCloseTransition()` and `applyMarkInvoicedTransition()`.

| # | File | Function | Line(s) | Value(s) Written | Classification | Reachability |
|---|------|----------|---------|-----------------|----------------|-------------|
| W1 | `server/storage/jobs.ts` | `transitionJobStatus()` | 1562-1570 | `currentStatus` (via lifecycle patch) | **Canonical** | Runtime |
| — | `server/services/jobLifecycleOrchestrator.ts` | `reconcileJobAfterVisitCompletion()` | 734-746 | **NOT SET** | **Inconsistent omission** | Runtime |

**Bypass count**: 1 inconsistent omission. When reconciliation sets `status: "completed"` (W2 above), it does NOT set `previousStatus`. This means `UNDO_CLOSE` and `REOPEN_JOB` cannot restore prior status for auto-completed jobs.

---

### 1.4 `jobs.closedAt`

**Canonical owner**: `server/domain/jobLifecycle.ts` — set in close/invoiced transitions.

| # | File | Function | Line(s) | Value(s) Written | Classification | Reachability |
|---|------|----------|---------|-----------------|----------------|-------------|
| W1 | `server/storage/jobs.ts` | `transitionJobStatus()` | 1562-1570 | `new Date()` (via lifecycle patch) | **Canonical** | Runtime |
| W2 | `server/services/jobLifecycleOrchestrator.ts` | `reconcileJobAfterVisitCompletion()` Rule 1 | 743 | `new Date()` | **Duplicate but consistent** (value matches) | Runtime |

**Note**: W2 sets `closedAt` but does NOT set `closedBy` — partial consistency.

---

### 1.5 `jobs.closedBy`

**Canonical owner**: `server/domain/jobLifecycle.ts` — set to `actor.userId` in close/invoiced transitions.

| # | File | Function | Line(s) | Value(s) Written | Classification | Reachability |
|---|------|----------|---------|-----------------|----------------|-------------|
| W1 | `server/storage/jobs.ts` | `transitionJobStatus()` | 1562-1570 | `actor.userId` (via lifecycle patch) | **Canonical** | Runtime |
| — | `server/services/jobLifecycleOrchestrator.ts` | `reconcileJobAfterVisitCompletion()` | 734-746 | **NOT SET** | **Inconsistent omission** | Runtime |

**Bypass count**: 1 inconsistent omission. Auto-completed jobs have `closedAt` but no `closedBy` — no attribution of who caused the close.

---

### 1.6 `jobs.scheduledStart`

**Canonical owner**: Scheduling domain — writes via `server/storage/jobVisits.ts:syncJobScheduleFromVisits()` (visit-driven) and `server/storage/jobs.ts:updateJob()` (direct edit).

| # | File | Function | Line(s) | Value(s) Written | Classification | Reachability |
|---|------|----------|---------|-----------------|----------------|-------------|
| W1 | `server/storage/jobs.ts` | `updateJob()` | 660-687 | User-provided value | **Canonical** (direct job edit) | Runtime — PATCH /api/jobs/:id |
| W2 | `server/storage/jobs.ts` | `transitionJobStatus()` | 1562-1570 | `null` (via `getScheduleClearingPatch()`) | **Canonical** (lifecycle clearing) | Runtime — close/reopen routes |
| W3 | `server/storage/jobVisits.ts` | `syncJobScheduleFromVisits()` unschedule | 423 | `null` | **Canonical** (visit sync) | Runtime — visit completion/cancel |
| W4 | `server/storage/jobVisits.ts` | `syncJobScheduleFromVisits()` reschedule | 493-496 | Derived from next eligible visit | **Canonical** (visit sync) | Runtime — visit reschedule |
| W5 | `server/storage/clients.ts` | `cleanupInvalidCalendarAssignments()` | 712 | `null` | **Canonical** (PM month enforcement) | Runtime — PATCH /api/clients/:id |
| W6 | `server/storage/scheduling.ts` | `scheduleJobBypassWorkingHours()` | 1393 | User-provided value | **Dead** | No callers found |

**Note**: Reconciliation (W2 in status table) does NOT clear scheduling fields when setting `status: "completed"`. The canonical lifecycle path (W2 here) does clear them via `getScheduleClearingPatch()`.

---

### 1.7 `jobs.scheduledEnd`

Same write sites as `scheduledStart` — always written together. Same classifications apply.

---

### 1.8 `jobs.isAllDay`

Same write sites as `scheduledStart` — always written together. Same classifications apply.

---

### 1.9 `jobs.version`

**Canonical owner**: Every storage write function that modifies jobs should increment version.

| # | File | Function | Line(s) | Method | Classification | Reachability |
|---|------|----------|---------|--------|----------------|-------------|
| V1 | `server/storage/jobs.ts` | `updateJob()` | 657,673 | `sql\`version + 1\`` (conditional or always) | **Canonical** | Runtime |
| V2 | `server/storage/jobs.ts` | `deleteJob()` | 772 | `sql\`version + 1\`` | **Canonical** | Runtime |
| V3 | `server/storage/jobs.ts` | `transitionJobStatus()` | 1566 | `sql\`version + 1\`` | **Canonical** | Runtime |
| V4 | `server/storage/jobs.ts` | `updateJobStatusWithEvent()` | 1356 | `sql\`version + 1\`` | **Canonical** | Runtime |
| V5 | `server/storage/jobVisits.ts` | `syncJobScheduleFromVisits()` | 430 | `sql\`version + 1\`` | **Canonical** | Runtime |
| V6 | `server/services/jobLifecycleOrchestrator.ts` | `reconcileJobAfterVisitCompletion()` Rules 1-4 | 734-809 | **NOT INCREMENTED** | **Inconsistent omission** | Runtime |

**Bypass count**: 4 reconciliation writes (lines 734, 752, 770, 794) do NOT increment version. This means:
- Frontend holding `version=N` can overwrite reconciliation state with a stale version
- Optimistic locking is broken for the reconciliation path

---

### 1.10 `job_visits.status`

**Canonical owner**: `server/services/jobLifecycleOrchestrator.ts:completeVisit()` for completion; `server/storage/jobVisits.ts` for non-terminal transitions.

| # | File | Function | Line(s) | Value(s) | Through Orchestrator? | Classification | Reachability |
|---|------|----------|---------|----------|----------------------|----------------|-------------|
| V1 | `server/storage/jobVisits.ts` | `createJobVisit()` | 580 | `"scheduled"` (default) | NO | **Canonical** (creation) | Runtime |
| V2 | `server/storage/jobVisits.ts` | `updateJobVisitStatus()` | 740 | Any non-completion status | NO | **Canonical** (non-terminal) | Runtime — POST /api/jobs/:jobId/visits/:visitId/status |
| V3 | `server/storage/jobVisits.ts` | `checkInJobVisit()` | 795 | `"on_site"` | NO | **Canonical** (check-in) | Runtime — POST /api/jobs/:jobId/visits/:visitId/check-in |
| V4 | `server/services/jobLifecycleOrchestrator.ts` | `completeVisit()` | 268 | `"completed"` | **YES** | **Canonical** (completion) | Runtime — /complete endpoints |
| V5 | `server/services/jobLifecycleOrchestrator.ts` | `bulkCompleteVisitsInternal()` | 842 | `"completed"` | **YES** | **Canonical** (bulk completion) | Runtime — force close flow |
| V6 | `server/routes/techField.ts` | POST /visits/:visitId/en-route | 173 | `"en_route"` | **NO** | **Duplicate and inconsistent** (no audit, no orchestrator) | Runtime |
| V7 | `server/routes/techField.ts` | POST /visits/:visitId/start | 222 | `"in_progress"` | **NO** | **Duplicate and inconsistent** (no audit, no orchestrator) | Runtime |

**Bypass count**: 2 route-level bypasses (V6, V7). These write visit status directly in route handlers without going through any service or orchestrator.

---

### 1.11 `job_visits.checkedInAt`

| # | File | Function | Line(s) | Value | Classification | Reachability |
|---|------|----------|---------|-------|----------------|-------------|
| C1 | `server/storage/jobVisits.ts` | `updateJobVisitStatus()` | 747 | `new Date()` (auto when status=on_site) | **Canonical** | Runtime |
| C2 | `server/storage/jobVisits.ts` | `checkInJobVisit()` | 794 | `new Date()` | **Canonical** | Runtime |
| C3 | `server/routes/techField.ts` | POST /visits/:visitId/start | 223 | `visit.checkedInAt ?? now` | **Duplicate but consistent** | Runtime |

---

### 1.12 `job_visits.checkedOutAt`

| # | File | Function | Line(s) | Value | Classification | Reachability |
|---|------|----------|---------|-------|----------------|-------------|
| O1 | `server/storage/jobVisits.ts` | `updateJobVisitStatus()` | 754 | `new Date()` (auto when completing + checked in) | **Canonical** | Runtime |
| O2 | `server/routes/jobVisits.routes.ts` | POST /check-out | 339-364 | `new Date()` (explicit check-out) | **Canonical** | Runtime |
| O3 | `server/services/jobLifecycleOrchestrator.ts` | `completeVisit()` | 279 | `now` (auto when completing + checked in) | **Canonical** | Runtime |
| O4 | `server/services/jobLifecycleOrchestrator.ts` | `bulkCompleteVisitsInternal()` | 852,857 | `now` (always, even if never checked in) | **Canonical** | Runtime |

---

## 2. Semantic Authority Matrix

### 2.1 Visit Eligibility / Actionable Visit

**Canonical owner should be**: A shared predicate (does not exist yet).

| # | File | Function/Location | Line(s) | Predicate | Classification |
|---|------|-------------------|---------|-----------|----------------|
| E1 | `server/storage/jobVisits.ts` | `getCurrentEligibleVisit()` | 184-192 | `isActive=true, scheduledStart IS NOT NULL, status NOT IN ('cancelled','completed'), archivedAt IS NULL` | **De facto canonical** |
| E2 | `server/storage/jobVisits.ts` | `syncJobScheduleFromVisits()` | 387-399 | Same as E1 | **Duplicate but consistent** |
| E3 | `server/storage/jobVisits.ts` | `getUncompletedVisits()` | 816-834 | `isActive=true, status NOT IN ('completed','cancelled'), archivedAt IS NULL` — **NO scheduledStart check** | **Duplicate and inconsistent** |
| E4 | `server/services/jobLifecycleOrchestrator.ts` | `reconcileJobAfterVisitCompletion()` | 712-726 | `isActive=true, archivedAt IS NULL, status NOT IN ('completed','cancelled'), (scheduledStart IS NOT NULL OR checkedInAt IS NOT NULL)` — **adds checkedInAt alternative** | **Duplicate and inconsistent** |
| E5 | `server/lib/visitIntelligence.ts` | `fetchScheduledVisits()` | 137-166 | Adds `scheduledStart >= CURRENT_DATE` and `< CURRENT_DATE + 1 day` — **date-bounded window** | **Duplicate and inconsistent** (narrower scope) |

**Contradiction proof**: E3 includes visits with `scheduledStart IS NULL` (unscheduled placeholders). E4 includes visits that were never scheduled but have `checkedInAt` set. E1/E2 require `scheduledStart IS NOT NULL`. **A visit with no schedule but a check-in passes E4 but fails E1/E2/E3.**

---

### 2.2 Job Overdue

**Canonical owner**: `shared/schema.ts:isJobOverdue()` (JS, line 1530) + `server/lib/queryHelpers.ts:effectiveEndExpr` (SQL, line 49).

| # | File | Function/Location | Line(s) | Predicate | Classification |
|---|------|-------------------|---------|-----------|----------------|
| O1 | `shared/schema.ts` | `isJobOverdue()` | 1530-1598 | `status='open', scheduledStart!=null, openSubStatus NOT IN ('in_progress','on_route'), effectiveEnd < now` | **Canonical JS** |
| O2 | `server/lib/queryHelpers.ts` | `effectiveEndExpr` | 49-54 | SQL CASE: `scheduledEnd ?? (scheduledStart + durationMinutes) ?? scheduledStart` | **Canonical SQL** |
| O3 | `server/lib/attentionRules.ts` | overdue rule | 98-169 | Uses `effectiveEndExpr` from O2 | **Canonical consumer** |
| O4 | `server/storage/dashboard.ts` | `getNeedsAttentionJobs()` | 284-303 | Uses `effectiveEndExpr` from O2 | **Canonical consumer** |
| O5 | `client/src/pages/Jobs.tsx` | useMemo enrichment | 242 | Calls `isJobOverdue(job, now)` from O1 | **Canonical consumer** (but client-side re-derivation) |
| O6 | `client/src/pages/ClientDetailPage.tsx` | job list display | ~162 | Calls `isJobOverdue()` from O1 | **Canonical consumer** |
| O7 | `server/lib/visitIntelligence.ts` | visit effective end | 316-320 | `v.scheduledEnd ? new Date(v.scheduledEnd) : new Date(start + durMin * 60_000)` — **misses start-only fallback** | **Duplicate and inconsistent** |

**Contradiction proof**: O7 does NOT fall back to `scheduledStart` when both `scheduledEnd` and `durationMinutes` are absent. O1 and O2 DO fall back to `scheduledStart`. A visit with only `scheduledStart` set would have `effectiveEnd = scheduledStart` in overdue checks but `effectiveEnd = NaN/undefined` in visitIntelligence travel time calculations.

---

### 2.3 Job Scheduled / Unscheduled

**Canonical owner**: `shared/schema.ts:isJobScheduled()` (line 1467).

| # | File | Function/Location | Line(s) | Predicate | Classification |
|---|------|-------------------|---------|-----------|----------------|
| S1 | `shared/schema.ts` | `isJobScheduled()` | 1467-1469 | `scheduledStart != null` | **Canonical** |
| S2 | `server/storage/dashboard.ts` | `unscheduledCount` | 106-112 | SQL: `status='open' AND scheduledStart IS NULL AND (openSubStatus IS NULL OR openSubStatus != 'on_hold')` | **Canonical consumer** (adds on_hold exclusion) |
| S3 | `server/lib/attentionRules.ts` | unscheduled rule | 226-282 | Same predicate as S2 | **Duplicate but consistent** |
| S4 | `client/src/pages/Jobs.tsx` | useMemo enrichment | 239 | Calls `isJobScheduled(job)` from S1 | **Canonical consumer** |

**No contradictions found.** Predicates are consistent.

---

### 2.4 Backlog Eligibility

**Canonical owner**: `shared/schema.ts:isBacklogEligible()` (line 1485).

| # | File | Function/Location | Line(s) | Predicate | Classification |
|---|------|-------------------|---------|-----------|----------------|
| B1 | `shared/schema.ts` | `isBacklogEligible()` | 1485-1511 | `status='open' && !isJobScheduled() && openSubStatus != 'on_hold'` | **Canonical** |
| B2 | `server/storage/dashboard.ts` | `unscheduledCount` | 106-112 | SQL equivalent of B1 | **Duplicate but consistent** |
| B3 | `server/lib/attentionRules.ts` | unscheduled rule | 226-282 | SQL equivalent of B1 | **Duplicate but consistent** |
| B4 | `client/src/pages/Jobs.tsx` | useMemo enrichment | 241 | Calls `isBacklogEligible(job)` from B1 | **Canonical consumer** |

**No contradictions found.** All implementations align with the canonical JS predicate.

---

### 2.5 Effective End Time

**Canonical owner**: `server/lib/queryHelpers.ts:effectiveEndExpr` (SQL) + `shared/schema.ts:isJobOverdue()` (JS logic).

| # | File | Function/Location | Line(s) | Computation | Classification |
|---|------|-------------------|---------|-------------|----------------|
| T1 | `server/lib/queryHelpers.ts` | `effectiveEndExpr` | 49-54 | `scheduledEnd ?? (scheduledStart + durationMinutes) ?? scheduledStart` | **Canonical SQL** |
| T2 | `shared/schema.ts` | inside `isJobOverdue()` | 1575-1594 | Same 3-tier priority as T1 | **Canonical JS** |
| T3 | `server/lib/visitIntelligence.ts` | inline | 316-320 | `scheduledEnd ?? (scheduledStart + durationMinutes)` — **MISSING scheduledStart fallback** | **Duplicate and inconsistent** |

**Contradiction proof**: Same as section 2.2 O7. Visit intelligence lacks the `scheduledStart` fallback.

---

### 2.6 Visit Status Display Label

**Canonical owner**: NONE EXISTS. Should be a shared constant.

| # | File | Location | Line(s) | `on_site` Label | Classification |
|---|------|----------|---------|-----------------|----------------|
| L1 | `client/src/components/dispatch/dispatchPreviewUtils.ts` | `visitStatusLabel()` | ~84 | "In Progress" | **De facto canonical** (dispatch) |
| L2 | `client/src/components/dispatch/DispatchDetailPanel.tsx` | `STATUS_LABELS` | 91 | "In Progress" | **Duplicate but consistent** with L1 |
| L3 | `client/src/components/visits/EditVisitModal.tsx` | `VISIT_STATUS_LABELS` | 73 | "In Progress" | **Duplicate but consistent** with L1 |
| L4 | `client/src/components/JobVisitsSection.tsx` | `STATUS_LABELS` | 65 | **"On Site"** | **Duplicate and INCONSISTENT** |
| L5 | `client/src/pages/JobDetailPage.tsx` | `VISIT_STATUS_LABELS` | 500 | **"On Site"** | **Duplicate and INCONSISTENT** |
| L6 | `client/src/pages/TechHomePage.tsx` | `STATUS_LABELS` | 39 | **"On Site"** | **Duplicate and INCONSISTENT** |
| L7 | `client/src/pages/TechVisitDetailPage.tsx` | `STATUS_LABELS` | 94 | **"On Site"** | **Duplicate and INCONSISTENT** |
| L8 | `client/src/pages/TechSchedulePage.tsx` | `STATUS_LABELS` | ~33 | **"On Site"** (+ `completed→"Done"`) | **Duplicate and INCONSISTENT** |
| L9 | `client/src/pages/UnassignedTimePage.tsx` | inline | 73 | **"On Site"** | **Duplicate and INCONSISTENT** |
| L10 | `client/src/pages/TimeAnalyticsPage.tsx` | inline | 80 | **"On Site"** | **Duplicate and INCONSISTENT** |
| L11 | `client/src/components/time/AddTimeEntryModal.tsx` | options array | 45 | **"On Site"** | **Duplicate and INCONSISTENT** |
| L12 | `client/src/components/time/EditTimeEntryModal.tsx` | options array | 41 | **"On Site"** | **Duplicate and INCONSISTENT** |

**Contradiction proof**: L1-L3 show "In Progress" for `on_site`. L4-L12 (9 surfaces) show "On Site". A user viewing the same visit on the dispatch board sees "In Progress" but on the job detail page sees "On Site".

---

## 3. Remaining Bypass Inventory

### 3.1 Critical Bypasses (status writes outside canonical lifecycle)

| ID | File | Function | Line(s) | What It Bypasses | End-to-End Trace |
|----|------|----------|---------|-----------------|------------------|
| **BP-1** | `jobLifecycleOrchestrator.ts` | `reconcileJobAfterVisitCompletion()` Rule 1 | 734-746 | `applyLifecycleTransition()`, version increment, `previousStatus`, `closedBy`, schedule clearing, `pmBillingStatus`, audit event | UI: Complete Visit button → POST /api/jobs/:jobId/visits/:visitId/complete → `lifecycle.completeVisit()` → `reconcileJobAfterVisitCompletion()` → **direct db.update(jobs)** |
| **BP-2** | `jobLifecycleOrchestrator.ts` | `reconcileJobAfterVisitCompletion()` Rules 2-4 | 752-809 | Version increment, audit event | Same route as BP-1 |
| **BP-3** | `server/routes/techField.ts` | POST /visits/:visitId/en-route | 170-178 | All visit lifecycle authority — direct route-to-DB write | Mobile App: En Route button → POST /api/tech/visits/:visitId/en-route → **direct db.update(jobVisits)** |
| **BP-4** | `server/routes/techField.ts` | POST /visits/:visitId/start | 219-228 | All visit lifecycle authority — direct route-to-DB write | Mobile App: Start button → POST /api/tech/visits/:visitId/start → **direct db.update(jobVisits)** |

### 3.2 Non-Critical Bypasses (scheduling writes with legitimate ownership)

| ID | File | Function | Line(s) | Justification |
|----|------|----------|---------|---------------|
| BP-5 | `server/storage/jobVisits.ts` | `syncJobScheduleFromVisits()` | 420-432, 493-496 | Legitimate — visit-driven schedule sync is a separate concern from lifecycle |
| BP-6 | `server/storage/clients.ts` | `cleanupInvalidCalendarAssignments()` | 707-724 | Legitimate — PM month enforcement is a configuration concern |
| BP-7 | `server/storage/invoices.ts` | `createInvoice()` | 1347-1353 | Legitimate — only writes `invoiceId` (not status). Comment explicitly defers lifecycle to caller |

### 3.3 Dead Code Bypasses (not runtime-reachable)

| ID | File | Function | Line(s) | Evidence |
|----|------|----------|---------|----------|
| BP-8 | `server/storage/scheduling.ts` | `scheduleJobBypassWorkingHours()` | 1315-1397 | No callers found in grep |
| BP-9 | `server/storage/jobs.ts` | `updateJobStatusWithMultipleEvents()` | 1393-1434 | Exported but no callers found in grep |

---

## 4. Contradiction Proofs

### Contradiction 1: Reconciliation vs Lifecycle — Missing Fields

**Path A** (Canonical): User clicks "Close Job → Invoice Later" →
```
POST /api/jobs/:id/close → lifecycle.forceCloseJob() → jobRepository.transitionJobStatus()
→ applyLifecycleTransition(job, {type:"CLOSE_JOB", mode:"invoice_later"}, actor)
→ patch = { status:"completed", previousStatus:currentStatus, closedAt:new Date(),
    closedBy:actor.userId, scheduledStart:null, scheduledEnd:null, isAllDay:false,
    openSubStatus:null, holdReason:null, holdNotes:null, nextActionDate:null, onHoldAt:null }
→ version incremented → jobStatusEvent created
```

**Path B** (Bypass): Tech completes last visit with outcome "completed" →
```
POST /api/jobs/:jobId/visits/:visitId/complete → lifecycle.completeVisit()
→ reconcileJobAfterVisitCompletion() → direct db.update(jobs)
→ patch = { status:"completed", openSubStatus:null, holdReason:null, holdNotes:null,
    nextActionDate:null, onHoldAt:null, closedAt:new Date(), updatedAt:new Date() }
→ NO version increment → NO previousStatus → NO closedBy → NO schedule clearing
→ NO pmBillingStatus → NO jobStatusEvent
```

**Fields missing from Path B vs Path A:**

| Field | Path A (Canonical) | Path B (Bypass) | Impact |
|-------|-------------------|-----------------|--------|
| `previousStatus` | `currentStatus` | NOT SET | UNDO_CLOSE fails with `NO_PREVIOUS_STATUS` |
| `closedBy` | `actor.userId` | NOT SET | No attribution in audit trail |
| `scheduledStart` | `null` | NOT CLEARED | Terminal job retains scheduling fields — violates lifecycle invariant |
| `scheduledEnd` | `null` | NOT CLEARED | Same |
| `isAllDay` | `false` | NOT CLEARED | Same |
| `pmBillingStatus` | `"invoiced"` (if PM) | NOT SET | PM billing state incorrect |
| `version` | `+1` | NOT INCREMENTED | Optimistic locking broken |
| `jobStatusEvent` | CREATED | NOT CREATED | Audit trail gap |

---

### Contradiction 2: Visit Eligibility Predicate Mismatch

**Scenario**: Visit with `scheduledStart=NULL, checkedInAt=2026-03-18T10:00, status="in_progress", isActive=true`

| Predicate | Result | Location |
|-----------|--------|----------|
| E1 `getCurrentEligibleVisit()` | **EXCLUDED** (scheduledStart IS NULL) | `jobVisits.ts:184` |
| E2 `syncJobScheduleFromVisits()` | **EXCLUDED** (scheduledStart IS NULL) | `jobVisits.ts:387` |
| E3 `getUncompletedVisits()` | **INCLUDED** (no scheduledStart check) | `jobVisits.ts:816` |
| E4 `reconcileJobAfterVisitCompletion()` | **INCLUDED** (checkedInAt IS NOT NULL) | `orchestrator.ts:724` |

**Impact**: Force-close flow calls `getUncompletedVisits()` (E3) to find visits to auto-complete. It finds this visit and completes it. Reconciliation (E4) also includes it. But schedule sync (E2) ignores it — so the job's `scheduledStart/End` won't reflect this visit's existence.

---

### Contradiction 3: on_site Display Label

Proven in Section 2.6. L1-L3 vs L4-L12. 3 surfaces show "In Progress", 9 surfaces show "On Site". Same DB value.

---

### Contradiction 4: Effective End Time — Missing Fallback

**Scenario**: Visit with `scheduledStart=2026-03-18T10:00, scheduledEnd=NULL, durationMinutes=NULL`

| Computation | Result | Location |
|-------------|--------|----------|
| T1 `effectiveEndExpr` (SQL) | `2026-03-18T10:00` (falls through to scheduledStart) | `queryHelpers.ts:54` |
| T2 `isJobOverdue()` (JS) | `2026-03-18T10:00` (same) | `shared/schema.ts:1594` |
| T3 `visitIntelligence.ts` | `NaN` or error (`durMin` is 0 or null, `start + 0 = start` — but logic path differs) | `visitIntelligence.ts:320` |

**Impact**: Visit intelligence may produce invalid travel time or running-long signals for visits without explicit end times.

---

## 5. Safe Deletion Candidates

| Item | File | Line(s) | Evidence | Risk |
|------|------|---------|----------|------|
| `scheduleJobBypassWorkingHours()` | `server/storage/scheduling.ts` | 1315-1397 | No callers found via exhaustive grep | Zero — dead code |
| `updateJobStatusWithMultipleEvents()` | `server/storage/jobs.ts` | 1393-1450 | Exported but no callers found | Zero — dead code |
| Duplicate `STATUS_LABELS` constants | 9 files (L4-L12 in section 2.6) | Various | Replace with import from shared constant | Zero — pure dedup |
| Duplicate `isTerminalStatus()` | `server/domain/scheduling.ts` | 68-71 | Identical to `jobLifecycle.ts:162-166` | Zero — import instead |

---

## 6. Recommended Fix Order

### Phase 1: Fix Critical Bypass BP-1 (reconciliation)
**Priority**: Highest. This is the most dangerous bypass — produces structurally different job state than canonical lifecycle.

**Action**: Refactor `reconcileJobAfterVisitCompletion()` Rule 1 (line 734-746) to call `jobRepository.transitionJobStatus()` with a lifecycle intent instead of direct `db.update(jobs)`. This ensures:
- `previousStatus` is set
- `closedBy` is set (use system actor or completing user)
- Scheduling fields are cleared
- Version is incremented
- Audit event is created
- `pmBillingStatus` is handled

**Files**: `server/services/jobLifecycleOrchestrator.ts`

### Phase 2: Fix Reconciliation Rules 2-4 (version + audit)
**Priority**: High. These don't change `status` to a terminal value, but they still skip version increment and audit events.

**Action**: Route Rules 2-4 through `jobRepository.updateJobStatusWithEvent()` instead of direct `db.update(jobs)`.

**Files**: `server/services/jobLifecycleOrchestrator.ts`

### Phase 3: Centralize visit eligibility predicate
**Priority**: High. Four different definitions create ongoing bug risk.

**Action**: Create `server/lib/visitPredicates.ts` with:
- `TERMINAL_VISIT_STATUSES = ["completed", "cancelled"]`
- `eligibleVisitFilter()` — Drizzle-compatible SQL predicate
- Decide: should `checkedInAt IS NOT NULL` be part of the canonical predicate or only the orchestrator's?

**Files**: New file + update `jobVisits.ts`, `scheduling.ts`, `orchestrator.ts`, `visitIntelligence.ts`

### Phase 4: Create shared visit status label constant
**Priority**: High. 12 duplicate definitions, 2 conflicting values.

**Action**: Create `client/src/lib/visitStatusDisplay.ts`. Replace all 12 local constants. Decide canonical label for `on_site` (recommend "In Progress").

**Files**: New file + update 12 consuming files

### Phase 5: Fix effective end in visitIntelligence
**Priority**: Medium. Missing fallback creates edge-case computation errors.

**Action**: Add `scheduledStart` fallback to `visitIntelligence.ts:316-320`.

**Files**: `server/lib/visitIntelligence.ts`

### Phase 6: Centralize tech field visit transitions
**Priority**: Medium. Route-level visit status writes should go through a service.

**Action**: Move BP-3 and BP-4 (techField.ts en-route/start) through a visit service or orchestrator method.

**Files**: `server/routes/techField.ts`, `server/services/jobLifecycleOrchestrator.ts` (or new visit service)

### Phase 7: Delete dead code
**Priority**: Low (safe anytime).

**Action**: Delete `scheduleJobBypassWorkingHours()`, `updateJobStatusWithMultipleEvents()`, duplicate `isTerminalStatus()`.

**Files**: `server/storage/scheduling.ts`, `server/storage/jobs.ts`, `server/domain/scheduling.ts`

---

*End of proof pass. Every claim is backed by exact file paths, line numbers, and traceable call chains.*
