# Refactoring Log

This document tracks significant refactoring decisions, architectural changes, and technical debt addressed in the codebase.

---

## 2026-03-25: Labor Unification Final Cleanup

### Problem
Three residual issues from the labor unification pass: (1) `reopenVisit` still wrote `actualDurationMinutes: null`, mutating historical labor data on workflow reopen; (2) manager check-out silently no-oped when no technician was assigned instead of failing fast; (3) `job_visits.actualDurationMinutes` column still existed in DB schema despite being fully deprecated.

### Solution
1. **reopenVisit:** Removed `actualDurationMinutes: null` from the reopen update set. Reopening now only resets workflow fields (status, outcome, completedAt, completedByUserId, isFollowUpNeeded, checkedOutAt). Historical duration/labor data is preserved — manual edits are a separate explicit action.
2. **Check-out guard:** Added `if (!visit.assignedTechnicianId) throw createError(400, ...)` before any write, matching check-in behavior. Validation order: visit exists → tech assigned → checkedInAt set → not already checked out.
3. **Column drop:** Removed `actualDurationMinutes` from `jobVisits` table definition in `shared/schema.ts` and from `insertJobVisitSchema` omit list. Migration `2026_03_25_drop_job_visits_actual_duration_minutes.sql` drops the column from the DB. Tasks domain column on separate table is untouched.

---

## 2026-03-25: Labor / Time Tracking Cleanup & Hardening

### Problem
Post-unification residual risks: (1) manager check-out `stopTimeEntry` call was unscoped — could stop a running entry for a different job; (2) dead `checkInJobVisit()` method still existed, setting legacy `status="on_site"`; (3) `actualDurationMinutes` still serialized in visit feed API despite being deprecated; (4) no visit selector in manual time entry modal; (5) no visit badge on labour card entries.

### Solution
1. **Scoped stop guard:** Check-out handler now finds running entry by `jobId` match before stopping by ID, preventing cross-job mis-stops.
2. **Dead code removal:** Deleted `checkInJobVisit()` (only place writing `status="on_site"`) and its 3 test cases.
3. **Surface cleanup:** Removed `actualDurationMinutes` from `VisitFeedItem` type and `toVisitFeedItem()` serializer.
4. **Visit selector:** Added optional visit dropdown to `AddTimeEntryModal` (only shows when visits exist).
5. **Visit badge:** Added `V#N` badge to labour card entry rows when `visitNumber` is present.

### Column drop status
`job_visits.actualDurationMinutes` column **retained in DB** — the `tasks` table uses the same column name (separate domain, still actively written). The column has zero runtime read/write consumers in the visit/labor domain.

---

## 2026-03-25: Labor / Time Tracking Unification

### Problem
Dual time-tracking system: `time_entries` tracked granular labor segments (billing source of truth), while `job_visits.actualDurationMinutes` independently computed visit-level duration from `checkedInAt/checkedOutAt`. Manager check-in/check-out only wrote visit metadata — no time entries created. Technician mobile flow wrote both. Result: manager-checked-in visits had zero labor tracked, and duration values could diverge between the two systems.

### Solution
Unified around `time_entries` as the single source of truth for all labor measurement.

**Key changes:**
1. Added `visitId` (nullable FK) to `time_entries` for visit-level attribution
2. Manager check-in now calls `lifecycle.startVisit()` + `recordJobStatus("arrived")` — creates on_site time entry with rate snapshots (same path as tech flow)
3. Manager check-out now calls `stopTimeEntry()` — stops running labor entry (same path as tech flow)
4. Stopped writing `actualDurationMinutes` across all 5 write locations (check-out route, completeVisit, bulkComplete, rescheduleVisit, scheduling conflict auto-complete)
5. Removed redundant `actualDurationMinutes` check from `isVisitActioned()` predicate (server + client) — `checkedInAt` check already covers this case

**Architecture preserved:**
- All billing rules, rate snapshots, invoice locks, approval locks, manager overrides unchanged
- Job status derivation unchanged (purely visit-driven, no time_entries dependency)
- Visit predicates (`scheduleEligibleVisitFilter`, `reconciliationActionableVisitFilter`) unchanged — they use negation logic (`NOT IN terminal`), not specific status checks
- `checkedInAt`/`checkedOutAt` retained as operational metadata on visits

**Migration:** `2026_03_25_add_visit_id_to_time_entries.sql`

---

## 2026-03-24: Job Expenses — Remove Approval Workflow, Add Edit + Receipt Upload

### Problem
Approval workflow (pending/approved/rejected) added friction without value for HVAC dispatching. Dispatchers/admins can directly review, edit, or delete expenses. Also: no edit capability existed (delete-and-recreate only), and receipt upload wasn't wired to UI.

### Changes Applied

| File | Change |
|---|---|
| `shared/schema.ts` | Removed `expenseApprovalStatusEnum`, `approvalStatus` column from `jobExpenses` table, removed from insert/update schemas |
| `migrations/2026_03_24_drop_expense_approval_status.sql` | `ALTER TABLE job_expenses DROP COLUMN approval_status` |
| `server/storage/jobExpenses.ts` | Removed `approvalStatus` from all SELECT lists, `updateExpense` param type, and set-values logic |
| `server/services/jobExpenseService.ts` | Removed `setApprovalStatus()` function and `ExpenseApprovalStatus` import. No approval guards on billable toggle. |
| `server/routes/jobExpenses.ts` | Removed `POST /:id/approve` and `POST /:id/reject` endpoints. Removed `expenseApprovalStatusEnum` import. |
| `client/src/components/JobExpensesCard.tsx` | Full rewrite: (a) Single dialog for create+edit mode, (b) Receipt upload via `/api/uploads`, (c) Receipt view via `/api/files/:id`, (d) Edit/Delete buttons per row (hidden when invoiced), (e) Billable/Internal badges replace approval badges, (f) Invoiced badge, (g) All mutations invalidate cost-summary query |

### Architectural Notes
- **Write Path Law preserved.** Route → Service → Storage. No domain logic in routes.
- **No duplication.** Receipt upload reuses existing `/api/uploads` endpoint pattern (same as `AddJobNoteDialog`).
- **Invoice eligibility simplified.** `isBillable = true AND billingStatus = "pending"` — no approval gate. `getBillableExpensesForJob()` unchanged (never filtered on `approvalStatus`).
- **Invoiced expense protection preserved.** Service blocks edit/delete when `billingStatus = "added_to_invoice"`.
- **Orphaned permission:** `expenses.approve` key remains in `roles.ts:44` permission catalog. Safe — no runtime code references it.

---

## 2026-03-24: Job Expenses System — Greenfield Build

### Problem
Job Detail page had a placeholder "Expenses" card with a "Coming Soon" toast. No expense tracking existed — no table, no API, no storage, no service. Permission keys were defined but not enforced against any routes.

### Changes Applied

| File | Change |
|---|---|
| `shared/schema.ts` | Added `jobExpenses` table, enums (`expenseCategoryEnum`, `expenseBillingStatusEnum`, `expenseApprovalStatusEnum`), insert/update schemas, and types |
| `migrations/2026_03_24_job_expenses.sql` | SQL migration creating `job_expenses` table with indexes |
| `server/storage/jobExpenses.ts` | `JobExpensesRepository` extending `BaseRepository` — CRUD + billable expense queries. No business logic. |
| `server/services/jobExpenseService.ts` | Canonical orchestrator — create/update/delete with validation, approval status transitions, billing integration hooks |
| `server/routes/jobExpenses.ts` | Thin transport layer — GET/POST/PATCH/DELETE + approve/reject endpoints |
| `server/routes/index.ts` | Route registration: `app.use("/api/jobs", jobExpensesRouter)` |
| `client/src/components/JobExpensesCard.tsx` | New component — expense list, add dialog, delete confirmation, approve/reject inline actions |
| `client/src/pages/JobDetailPage.tsx` | Replaced placeholder card with `<JobExpensesCard>` |

### Architectural Notes
- **Write Path Law enforced.** Route → `jobExpenseService` → `jobExpensesRepository`. No domain logic in routes.
- **Tenant isolation.** All storage methods scope by `companyId`. `BaseRepository` helpers used throughout.
- **No duplication.** Expenses are a distinct cost type from parts (line items) and labor (time entries). Each has its own table and pipeline.
- **Invoice integration ready.** `getBillableExpensesForInvoice()` and `markExpensesAsInvoiced()` provide the hooks for `refreshInvoiceFromJob()` extension.
- **Existing permissions reused.** `expenses.own.edit`, `expenses.all.view`, `expenses.all.edit`, `expenses.approve` (defined in `roles.ts:40-44`) are now enforceable.

---

## 2026-03-24: Edit Visit Modal — Layout Refinement and Visual Hierarchy

### Problem
Header and right-column Job Details panel duplicated the same information (customer name, location, job #). Action buttons were too visually aggressive (harsh red/green). Company name was not clickable.

### Changes Applied

| File | Change |
|---|---|
| `client/src/components/visits/EditVisitModal.tsx` | (a) Removed entire "Job Details" card from right column. (b) Simplified header: company name primary + clickable via `Link` to `/clients/${customerCompanyId}`, job summary as secondary line, Job # as muted inline link. (c) Added `customerCompanyId` optional prop. (d) Softened Complete Visit to `bg-emerald-500/90`. (e) Changed Mark Unscheduled from `variant="destructive"` to `variant="outline"` with amber classes. (f) Changed Open Full Job from `variant="outline"` to `variant="ghost"`. (g) Removed unused `Badge` import. |
| `client/src/pages/DispatchPreview.tsx` | Added `customerCompanyId` to `visitEditorState` type and threading from `visit.customerCompanyId`. |
| `client/src/pages/JobDetailPage.tsx` | Passes `customerCompanyId={job.parentCompany?.id \|\| job.location?.parentCompanyId}` to EditVisitModal. |

### Architectural Notes
- **UI-only change.** No business logic, mutations, or domain authority affected.
- **Reused existing navigation pattern.** `/clients/${customerCompanyId}` matches `DispatchDetailPanel.tsx:614` and `Clients.tsx` existing Link patterns.
- **All handlers preserved verbatim.** `handleCompleteVisit`, `handleUnschedule`, Open Full Job Link — zero logic changes.
- **New prop is optional.** When `customerCompanyId` is absent, company name renders as plain text (graceful fallback).
- **Existing Button variants reused.** `outline` + amber classes for warning, `ghost` for low-weight — no new design tokens.

---

## 2026-03-24: Edit Visit Modal — Improve Action Discoverability

### Problem
"Mark Unscheduled" was placed in the Schedule section header, making it easy to miss. Quick Actions buttons had flat/neutral styling with no visual hierarchy, requiring users to scan rather than immediately identify actions.

### Changes Applied

| File | Change |
|---|---|
| `client/src/components/visits/EditVisitModal.tsx` | (a) Removed "Mark Unscheduled" `Button` from Schedule section header. (b) Added it to Quick Actions card between Complete Visit and Open Full Job. (c) Restyled Complete Visit as primary `Button` (emerald bg). (d) Styled Mark Unscheduled with `variant="destructive"`. (e) Restyled Open Full Job as `variant="outline"` `Button` with `asChild` wrapping the `Link`. (f) Added `CalendarX2` icon import for Mark Unscheduled. |

### Architectural Notes
- **UI-only change.** No business logic, mutation handlers, or permission checks modified.
- **Reused existing Button variants.** `default` (primary), `destructive`, `outline` — all from the shared `button.tsx` component. No new abstractions.
- **Handler preserved verbatim.** `handleUnschedule` and `handleCompleteVisit` unchanged.
- **Visibility conditions preserved.** Mark Unscheduled still gated on `visit.scheduledStart && !isVisitCompleted && !isVisitCancelled`. Complete Visit still gated on `!isVisitCompleted && !isVisitCancelled`.

---

## 2026-03-24: Dispatch Tiles & Unscheduled Cards — Remove Saving Spinner Indicators

### Problem
Small `Loader2` spinner icons appeared on dispatch visit/task tiles (scheduled) and unscheduled visit cards during save operations. Product decision to remove all visible spinner indicators while keeping all underlying safety protections.

### Changes Applied

| File | Change |
|---|---|
| `client/src/components/dispatch/DispatchVisitBlock.tsx` | Removed `Loader2` import and the `{isSaving && <Loader2 .../>}` JSX block. Preserved `isSaving` usage in click-blocking (line 87), unschedule-button gating (line 208). |
| `client/src/components/dispatch/DispatchTaskBlock.tsx` | Removed `Loader2` import and the `{isSaving && <Loader2 .../>}` JSX block. `isSaving` prop still accepted for future use. |
| `client/src/components/dispatch/DispatchUnscheduledCard.tsx` | Removed `Loader2` import and the `isSaving ? <Loader2> : <GripVertical>` ternary. Grip icon now always renders. `isSaving` prop still accepted and passed from parent. |

### Architectural Notes
- **UI-only change.** No business logic, mutation guards, or domain authority affected.
- **Week view unaffected.** `WeekDispatchCell.tsx` never had a spinner or `isSaving` prop.
- **All interaction protections preserved:** click-block during save, unschedule-button hiding, drag/resize mutation serialization via `chainForVisit`.
- **Unscheduled card `isSaving` prop retained.** Parent (`DispatchUnscheduledPanel`) still passes `savingIds.has(v.id)`. Prop kept in interface for future interaction guards if needed.

---

## 2026-03-24: Dispatch Board — First-Click Loading Race + Completed Visit Unschedule Guard

### Problem
Two dispatch board bugs:
1. **First-click loading race:** Dragging an unscheduled job to the board and immediately clicking it opened EditVisitModal into a permanent spinner. The `["visit-detail", visitId]` query could resolve without data during the schedule mutation in-flight window, and the modal treated `!visit` as perpetual loading.
2. **Completed visit unschedule:** Completed/grayed-out visit blocks on the timeline showed the X unschedule control. Clicking it unscheduled the completed visit and moved it to the backlog. The server had no visit-level terminal status guard.

### Changes Applied

| File | Change |
|---|---|
| `client/src/components/dispatch/useDispatchPreviewMutations.ts` | Added `queryClient.prefetchQuery(["visit-detail", visitId])` after successful schedule POST. Seeds the modal cache before user can click. |
| `client/src/components/dispatch/DispatchVisitBlock.tsx` | (a) Added `if (isSaving) return` early exit in `handleClick` — blocks modal open during mutation. (b) Added `!isCompleted` to X button visibility. (c) Added `isCompleted` to `useDraggable.disabled`. |
| `client/src/components/visits/EditVisitModal.tsx` | Split `isLoading \|\| !visit` gate into three states: loading → spinner, missing → "Failed to load" + Retry, data → normal form. |
| `server/storage/scheduling.ts` | Added visit-level terminal status check in `unscheduleVisit()` using canonical `TERMINAL_VISIT_STATUSES` from `visitPredicates.ts`. |

### Architectural Notes
- **No new canonical owners.** All changes are within existing UI rendering (client) and storage (server) layers.
- **Canonical predicate reuse.** Server guard uses `TERMINAL_VISIT_STATUSES` (already imported in `scheduling.ts`), not ad hoc string checks.
- **Write path preserved.** Server guard is in storage layer (where the existing job-level terminal check lives). No domain logic added to routes.
- **No lifecycle side effects.** Unschedule guard rejects the operation; it does not trigger reopen or any state transition.
- **Existing detail-panel guard matched.** `DispatchDetailPanel.tsx:913` already had `!isCompleted` on its unschedule button — the timeline tile was the only missing guard.

---

## 2026-03-24: Delete-Last-Visit → Canonical On Hold

### Problem
Two related issues with deleting the only/last visit on a job:
1. **Placeholder guard blocked deletion:** Visit #1 (unscheduled, active) could not be deleted — 409 error "Cannot delete placeholder visit #1." forced users to unschedule instead, leaving a confusing inert placeholder.
2. **Unscheduled backlog pollution:** When a non-#1 last visit was deleted, `syncJobScheduleFromVisits` cleared job schedule fields, causing the job to appear in the unscheduled dispatch backlog. Jobs with all visits removed are not ready for scheduling — they need dispatcher review.

### Changes Applied

| File | Change |
|---|---|
| `server/routes/jobVisits.routes.ts` | Removed placeholder visit #1 guard (lines 197-204). Added post-delete check: `getUncompletedVisits()` returns zero + job is open + not already on_hold → call `placeJobOnHold()` with holdReason="other". |
| `client/src/components/visits/EditVisitModal.tsx` | Removed stale `isPlaceholderVisit` comment (line 390). |

### Architectural Notes
- **No new status/substatus.** Uses existing canonical `on_hold` — the same state used by manual hold, visit reconciliation (`needs_followup`/`needs_parts`), and the migrated `needs_review`/`action_required` legacy states.
- **Canonical write path preserved.** `placeJobOnHold()` from `jobLifecycleOrchestrator.ts` handles audit trail, version increment, status event logging.
- **"Zero actionable visits" determined by `uncompletedVisitFilter` predicate** — `isActive=true AND status NOT IN ('completed','cancelled')`. Not keyed on visit numbering.
- **`syncJobScheduleFromVisits` already guards on_hold** (line 395: `if openSubStatus === "on_hold" return`) — no schedule-clearing race condition.
- **Normal unschedule path unchanged.** Only delete-last-visit gains on_hold behavior.

### Removed Code
- Placeholder visit #1 deletion guard and 409 error message
- Stale `isPlaceholderVisit` comment in EditVisitModal

### Follow-Up: Hold-State Guard Correctness (same day)
Initial implementation used `!job.holdReason` as proxy for on_hold state because `storage.getJob()` did not include `openSubStatus` in its select. Fixed by:
1. Adding `openSubStatus: jobs.openSubStatus` to `getJob()` select in `server/storage/jobs.ts`
2. Replacing `!job.holdReason` with canonical `job.openSubStatus !== "on_hold"` in `jobVisits.routes.ts`

Rule: `openSubStatus` is the lifecycle state field. `holdReason`/`holdNotes`/`onHoldAt` are metadata about the hold — never use them as state proxies.

---

## 2026-03-24: Job Detail Lifecycle Controls Refactor

### Problem
The Job Detail page exposed a generic status dropdown allowing dispatchers to freely switch between any status. This caused:
1. **Invalid transitions:** `completed → open` via dropdown triggered server error: "Unsupported lifecycle transition … Use specific lifecycle endpoints (/close, /reopen) for terminal transitions."
2. **Technician execution states exposed:** `in_progress`, `on_route` were editable by dispatchers but are technician-driven workflow states.
3. **Competing write paths:** Generic `updateStatusMutation` bypassed canonical lifecycle endpoints, creating shadow workflows.

### Changes Applied

| File | Change |
|---|---|
| `JobDetailPage.tsx` | Removed status Select dropdown, replaced with read-only StatusPill. Removed `updateStatusMutation`, `clearHoldMutation`, `handleMetaStatusChange`, `handleStatusChange`. Added lifecycle-aware action bar: Schedule Visit (open/on_hold), Put on Hold (open), Complete Job (open), Reopen (completed), Create/View Invoice (completed), Archive (completed), Restore (archived). Complete Job confirmation now delegates to JobHeaderCard's canonical Close Job dialog. |
| `JobHeaderCard.tsx` | Converted to `forwardRef`, added `useImperativeHandle` exposing `openCloseJobDialog()` and `triggerReopenJob()` to parent. |
| `server/storage/scheduling.ts` | `scheduleJob()` now clears all hold fields (`openSubStatus`, `holdReason`, `holdNotes`, `nextActionDate`, `onHoldAt`) when scheduling a visit for an on-hold job. Removed `!existingJob.scheduledStart` guard so hold clearing works regardless of existing schedule. |

### Architectural Notes
- **No new write paths introduced.** All lifecycle transitions reuse canonical owners: `/api/jobs/:id/close`, `/api/jobs/:id/reopen`, `ActionRequiredModal` → `/api/jobs/:id/status`.
- **Schedule Visit as resume path:** On-hold jobs resume via scheduling (server clears hold state), not a separate Resume button.
- **No duplication:** JobHeaderCard owns close/reopen mutations; parent triggers them via imperative ref.

---

## 2026-03-23: Dispatch/Visit State-Sync & Completion Fixes

### Problem
Four related issues traced to three root causes:
1. **Stale modal data:** EditVisitModal's `["visit-detail", visitId]` query (5-min staleTime) was never invalidated by dispatch board mutations (`backgroundInvalidate`, `forceRefresh`, `invalidateAfterCompletion` all missed this key). Board changes (reschedule, unschedule, crew update) would not reflect in the modal.
2. **Incomplete unschedule clearing:** Backend `unscheduleVisit()` cleared `scheduledStart/End` but preserved `assignedTechnicianId` and `assignedTechnicianIds` on the visit record. Unscheduled visits retained stale technician assignments.
3. **Wrong completion path:** `handleCompleteVisit()` used `editMutation` (PATCH `{status: "completed"}`) instead of the canonical `POST /complete` endpoint. This skipped lifecycle orchestration: no outcome tracking, no parent job reconciliation, no audit note. Duration regression caused by `syncJobScheduleFromVisits` clearing job-level fields after visit became terminal.

### Changes Applied

| File | Change |
|---|---|
| `useDispatchPreviewMutations.ts` | Added `queryClient.invalidateQueries({ queryKey: ["visit-detail"] })` to `backgroundInvalidate()`, `forceRefresh()`, and `invalidateAfterCompletion()`. |
| `server/storage/scheduling.ts` | `unscheduleVisit()` now passes `assignedTechnicianId: null, assignedTechnicianIds: []` to `updateJobVisit()`. |
| `EditVisitModal.tsx` | Replaced `handleCompleteVisit` with `completeMutation` calling `POST /api/jobs/:jobId/visits/:visitId/complete` with `{ outcome: "completed" }`. Added 409 handling (idempotent). Updated `isPending` to include `completeMutation.isPending`. Updated comment on Complete button. |

### Canonical Behavior Contract Established
- **Unschedule:** Clears scheduledStart, scheduledEnd, assignedTechnicianId, assignedTechnicianIds
- **Complete:** Must use `POST /complete` with outcome, not `PATCH { status }`
- **Modal data:** `["visit-detail"]` must be invalidated whenever dispatch mutations modify visit state

---

## 2026-03-23: Dispatch/Visit UI Safe Fixes

### Problem
Four UI issues identified during dispatch board review:
1. Client and Location in visit modal styled like clickable links (green `text-emerald-700`) but not actually navigable.
2. Delete button hidden for unscheduled visits due to overly broad `isPlaceholderVisit` guard.
3. Technician filter dropdown missing "Unassigned" option — users couldn't toggle the unassigned lane.
4. "PM Test" showing in technician list — needed investigation.

### Changes Applied

| File | Change |
|---|---|
| `EditVisitModal.tsx` | Client/Location restyled from `text-emerald-700` to `text-slate-900`. Removed `isPlaceholderVisit` variable and conditional — Delete button now always visible. |
| `DispatchFiltersBar.tsx` | Added `includeUnassigned` prop. When true, renders "Unassigned" option with separator, gray dot, and italic label below technician list. Imported `UNASSIGNED_TECH_ID`. Badge count includes Unassigned when present. |
| `DispatchPreview.tsx` | `UNASSIGNED_TECH_ID` included in initial filter selection and "select all". Unassigned lane in both day and week views now respects filter toggle instead of auto-appending. `includeUnassigned` prop passed to `DispatchFiltersBar` based on presence of unassigned visits. |

### PM Test Decision
"PM Test" is a real user record in the database, not hardcoded test data. The backend already filters `disabled=true` and `isSchedulable=false` users. Correct fix: set `disabled=true` on the record via admin panel or SQL migration — no code change needed.

---

## 2026-03-23: Visit Modal Refinement — Preview Fidelity Pass

### Problem
Initial redesign was structurally correct but missed several approved preview details: header still showed "Visit editor" / "Visit #" / status chip, time fields used Select dropdowns instead of direct entry, right rail lacked visual polish, Job summary was not displayed, and "Complete visit" was missing from quick actions.

### Changes Applied

| File | Change |
|---|---|
| `EditVisitModal.tsx` | Header: removed "Visit editor" label, Visit #, status chip. Primary title = `Client — Summary`. Added `bg-slate-50/60` header tint. Time: `<input type="time">` replaces `<Select>`. Right rail: `shadow-sm`, `bg-slate-50` cards, emerald-700 links. Quick actions: restored visit-scoped "Complete visit" (PATCH only, no job reconciliation). Added `jobSummary` prop. |
| `DispatchPreview.tsx` | Added `jobSummary` to visitEditorState type and setter (from `visit.summary`). Passed to EditVisitModal. |
| `JobDetailPage.tsx` | Added `jobSummary={job.summary}` to EditVisitModal call. |

### Complete Visit — Substatus Safety Verification
"Complete visit" in Quick Actions calls `editMutation.mutate({ status: "completed" })` which sends `PATCH /api/jobs/:jobId/visits/:visitId`. This updates **visit status only** via `jobVisitsRepository.updateJobVisit()`. It does NOT call the `/complete` endpoint which triggers `lifecycle.completeVisit()` → job reconciliation → substatus mutation. Visit modal remains substatus-free.

---

## 2026-03-23: Visit Modal Redesign — Two-Column Layout + Substatus Detachment

### Problem
1. Visit modal contained disguised job-state mutations (complete with outcome, reopen, follow-up). These violated the architectural rule that visits are execution objects and jobs own business-state.
2. Modal layout was a single-column form using `JobScheduleFields` component with duration-based UX instead of the approved start/end time preview.
3. UI was cluttered with lifecycle buttons (Complete, Follow-Up, Reopen) that mixed dispatch/logistics concerns with job-state decisions.

### Classification
**Architectural enforcement + UI redesign** — removes drift-prone substatus coupling, implements approved visual direction.

### Audit Results

| Element | Mutates | Decision |
|---|---|---|
| `completeWithOutcomeMutation` | Visit + Job (substatus, hold) | **REMOVED** |
| `reopenMutation` | Visit + Job (reopens terminal job) | **REMOVED** |
| `NeedsFollowUpModal` | Job (on_hold, holdReason) | **REMOVED** |
| "Complete" / "Follow-Up" / "Reopen" buttons | Both | **REMOVED** |
| `jobStatus` prop | Guards removed buttons | **REMOVED** |
| `showFollowUp` state | Controls removed modal | **REMOVED** |
| `VISIT_STATUS_COLORS` | Display only | **REMOVED** (simplified) |
| `editMutation` (PATCH) | Visit only | **KEPT** |
| `deleteMutation` | Visit only | **KEPT** |
| Dispatch schedule/reschedule | Visit only | **KEPT** |

### Changes Applied

| File | Change |
|---|---|
| `EditVisitModal.tsx` | Complete rewrite: two-column layout, inline schedule with start/end time, substatus code removed, header matches preview |
| `JobDetailPage.tsx` | Removed `jobStatus` prop from EditVisitModal call |
| `CHANGELOG.md` | Added redesign entry |

### What Was NOT Changed
- `useDispatchPreviewMutations.ts` — dispatch mutations unchanged
- `DispatchPreview.tsx` — caller unchanged (already didn't pass `jobStatus`)
- `JobScheduleFields.tsx` — still used by `QuickAddJobDialog`, not deleted
- `NeedsFollowUpModal.tsx` — file left in place (may be used elsewhere); import removed from EditVisitModal
- Server routes — no changes needed; removed mutations were client-side only

### Substatus Detachment Confirmation
- Visit modal **cannot** mutate `openSubStatus`, `holdReason`, `holdNotes`, or job `status`
- No route calls to `/complete`, `/reopen`, or `/status` remain in the modal
- No imports of `NeedsFollowUpModal` or completion-related types remain
- The `jobStatus` prop has been removed from the interface — callers cannot pass it

---

## 2026-03-23: Canonical Visit Modal — Unified Header Contract

### Problem
EditVisitModal is the single canonical visit editor, but its header content differed between Dispatch (showed company/location/address) and Job Detail (showed only "Job # · Visit #N · Scheduled"). Same component, divergent data contract.

### Classification
**Data Contract Unification** — no new components, no structural change.

### Root Cause
JobDetailPage called `<EditVisitModal jobId={...} visitId={...} jobStatus={...} />` without passing `customerName`, `locationName`, `locationAddress`, or `jobNumber`. The modal's conditional header rendering fell through to the tertiary `DialogTitle` line.

### Changes Applied

| File | Change |
|---|---|
| `client/src/pages/JobDetailPage.tsx` | Pass `customerName` (`job.parentCompany?.name`), `locationName`, `locationAddress`, `jobNumber` to EditVisitModal |
| `client/src/components/visits/EditVisitModal.tsx` | Header restructured: `DialogTitle` = company name (primary, `font-semibold`). Location/address = secondary `<p>`. Job # link + status badge = minimal tertiary `<div>`. "Visit #N" removed entirely. Status badge shrunk to `text-[9px]` outline variant. Fallback title when no `customerName`: "Job #N" or "Edit Visit". |

### What Was NOT Changed
- No new components created
- No mutation paths changed
- DispatchPreview.tsx already passed correct props — unchanged
- Server endpoints unchanged

### Verification
- `grep -r "EditVisitModal" client/src/` confirms exactly 2 call sites (DispatchPreview, JobDetailPage) importing from the same `@/components/visits/EditVisitModal`
- No other visit editor modal exists in the codebase

---

## 2026-03-23: Dispatch Scheduling Canonical Write-Path Consolidation

### Problem
Six dispatch-board inconsistencies caused by divergent scheduling paths between drag-drop (canonical dispatch mutations with optimistic cache) and modal save (bespoke PATCH with no optimistic updates). Additionally, unscheduled cache lookup used job ID as key but EditVisitModal passed visit UUID, causing silent lookup failures.

### Classification
**Canonical Write-Path Consolidation** — eliminates divergent scheduling behavior, not a feature addition.

### Root Causes Identified

1. **Unscheduled cache identity mismatch:** `optimisticSchedule()`, `resolveVisitFromCache()`, and `patchCachedVersion()` looked up unscheduled items by `j.id === visitId`, but unscheduled items are keyed by **job ID** while EditVisitModal passes the actual **visit UUID** (`activeVisitId`). Drag-drop worked because it passed `visit.id` which equals the job ID for unscheduled items.

2. **PATCH race condition:** EditVisitModal fired a separate PATCH (for notes/multi-tech) in parallel with the schedule POST. Both updated the same visit row. The schedule call incremented the version, so the PATCH arrived with a stale version → 409 version mismatch.

3. **Stale openSubStatus on server:** `scheduleJob()` did not clear the job's `openSubStatus` when scheduling a backlog job. Jobs with leftover `in_progress` sub-status rendered as "In Progress" (blue) after the background invalidation overwrote the optimistic `null`.

### Changes Applied

| File | Change |
|---|---|
| `useDispatchPreviewMutations.ts` | `resolveVisitFromCache`: also matches `job.activeVisitId === visitId` in unscheduled cache |
| `useDispatchPreviewMutations.ts` | `patchCachedVersion`: also matches `j.activeVisitId === visitId` in unscheduled cache |
| `useDispatchPreviewMutations.ts` | `optimisticSchedule`: find + filter use both `id` and `activeVisitId` |
| `useDispatchPreviewMutations.ts` | `ScheduleParams` + `RescheduleParams`: added optional `visitNotes` field |
| `useDispatchPreviewMutations.ts` | `scheduleVisit` + `rescheduleVisit`: pass `notes` through to API body |
| `EditVisitModal.tsx` | Dispatch save path: removed parallel PATCH call; notes passed through dispatch callbacks; multi-tech via chained `assign-crew` |
| `EditVisitModal.tsx` | `onDispatchSchedule`/`onDispatchReschedule` callback types: added `visitNotes` param |
| `server/storage/scheduling.ts` | `scheduleJob()`: clears `openSubStatus` when scheduling a previously-unscheduled job |

### What Was NOT Changed
- Drag-drop behavior (already worked correctly via dispatch mutations)
- PATCH fallback path (used by JobDetailPage when no dispatch callbacks provided)
- Server schedule/reschedule schemas (already accepted `notes`)
- Visit detail API response (already includes `assignedTechnicianIds`)
- EditVisitModal header layout (already updated in prior pass)

### Canonical Write-Path Summary
- **Modal scheduling (from dispatch):** `onDispatchSchedule` → `scheduleVisit` → `optimisticSchedule` + `POST /api/calendar/schedule`
- **Drag scheduling:** `scheduleVisit` → same path
- **Both share:** optimistic cache movement, version chaining via `chainForVisit`, background invalidation
- **Notes:** flow through schedule/reschedule API calls (no separate PATCH)
- **Multi-tech:** flows through chained `updateVisitCrew` → `PATCH /api/calendar/visit/:visitId/assign-crew`
- **Non-dispatch modal:** PATCH fallback (JobDetailPage) — correct but without optimistic dispatch cache updates

---

## 2026-03-22: Visit Card Design System — VisitCardContent Shared Component

### Problem
Three visit card components rendered the same `DispatchVisit` entity with inconsistent typography (customer name weight varied, duration sizing differed), inconsistent completion state (unscheduled used dot-only instead of CheckCircle), and inconsistent selection ring (`ring-1` on week vs `ring-2` elsewhere).

### Classification
**Design System Standardization** — shared content renderer, not architectural change.

### Changes Applied

| File | Change |
|---|---|
| `dispatch/VisitCardContent.tsx` | **NEW** — Pure presentation component with 4 variants. `React.memo`-wrapped for timeline perf. No hooks/state. |
| `dispatch/DispatchVisitBlock.tsx` | Replaced inner content rows (wide/narrow branches) with `<VisitCardContent>`. Container, drag, resize, hover actions unchanged. |
| `dispatch/DispatchUnscheduledCard.tsx` | Replaced inner content (3-line layout) with `<VisitCardContent variant="unscheduled">`. Mode icon, drag/click, priority border unchanged. |
| `dispatch/WeekDispatchCell.tsx` | Replaced `WeekVisitItem` inner content with `<VisitCardContent variant="week">`. Added `font-semibold` to name. Normalized `ring-1` → `ring-2`. |

### What Was NOT Changed
- Container styling, positioning, drag/resize interaction in wrappers
- Status color tokens in `dispatchPreviewUtils.ts`
- Timeline border-based status encoding (no dot added)
- Week view density (no priority/job# forced in)
- Drag data payloads
- Any server code

---

## 2026-03-22: Create Invoice from Job — Canonical Extraction

### Problem
The "Create Invoice from Job" workflow existed as an inline dialog in `JobDetailPage.tsx` (~80 lines: mutation + handler + dialog JSX). Additionally, `JobHeaderCard.tsx` contained a duplicate `createInvoiceMutation` (~35 lines) that was dead code — the only usage passed `showActions={false}`, making the dropdown menu (and the mutation) unreachable.

### Classification
**Canonical Extraction** + **Dead Code Cleanup**

### Changes Applied

| File | Change |
|---|---|
| `client/src/components/CreateInvoiceFromJobDialog.tsx` | **NEW** — Canonical dialog. Owns mutation (`POST /api/invoices/from-job/:jobId`), cache invalidation (3 keys), toast, dialog close. Parent receives `onCreated(invoice)` callback for activity logging + navigation. |
| `client/src/pages/JobDetailPage.tsx` | Removed inline Dialog JSX (~40 lines), `createInvoiceMutation` (~35 lines), `handleCreateInvoice` (~3 lines). Removed unused Dialog import. Added `CreateInvoiceFromJobDialog` with `onCreated` callback that performs activity logging + navigation (identical behavior). |
| `client/src/components/JobHeaderCard.tsx` | Removed dead `createInvoiceMutation` (~20 lines), `handleCreateInvoice` (~7 lines), "Create Invoice" menu item (~8 lines). All were inside `showActions` block which was always `false`. |

### What Was NOT Changed
- API endpoint, payload, or response handling
- Cache invalidation keys
- Toast messages
- Activity logging structure or content
- Navigation behavior
- "Close Job & Create Invoice" two-button pattern
- Server routes or services

---

## 2026-03-22: Contact CRUD Canonicalization + Edit Client Extraction

### Problem
ClientDetailPage.tsx contained two substantial inline dialog components that should be shared:
1. **ContactFormDialog** (174 lines) — contact create/edit modal handling both company-level and location-level contacts. Already reused by two internal parent components, proving reusability.
2. **Edit Client dialog** (~62 lines inline JSX + ~20 lines mutation + ~15 lines form state) — company billing info editor embedded directly in the page.

Additionally, `EditClientDialog.tsx` (499 lines) existed as a standalone component but had zero importers — dead code targeting the legacy flat `Client` model with `PUT /api/clients/:id`.

### Classification
**Canonical Extraction** (ContactFormDialog + Edit Client) + **Dead Code Cleanup** (EditClientDialog.tsx)

### Changes Applied

| File | Change |
|---|---|
| `client/src/components/ContactFormDialog.tsx` | **NEW** — Extracted from ClientDetailPage. Exports `ContactFormDialog`, `ContactScope` type, `STANDARD_CONTACT_ROLES` constant. Zero behavioral changes. |
| `client/src/components/EditCompanyDialog.tsx` | **NEW** — Extracted from ClientDetailPage. Owns mutation (`PATCH /api/customer-companies/:companyId`), form state (9 fields), form init guard, and 3-key cache invalidation. |
| `client/src/pages/ClientDetailPage.tsx` | Removed inline ContactFormDialog (~174 lines), inline Edit Client dialog (~62 lines), editClientMutation (~20 lines), editClientForm state + init useEffect (~18 lines). Added 2 imports. Net reduction: ~270 lines. |
| `client/src/components/EditClientDialog.tsx` | **DELETED** — 499 lines of dead code. Zero importers. Legacy model. |

### What Was NOT Changed
- `CompanyContactsCompact` and `LocContactsCompact` remain page-local (layout-specific wrappers)
- Cache invalidation ownership unchanged — parent wrappers still own their invalidation keys via `onSuccess` callbacks
- No API endpoints changed
- No server code changed
- No validation logic changed

### Verification
- TypeScript compilation: clean (`npm run check` passes with zero errors)
- Contact CRUD: create/edit company + location contacts via identical mutation paths
- Edit Client: identical form fields, init guard, PATCH endpoint, cache invalidation

---

## 2026-03-22: Canonical Visit Identity Fix — Unscheduled Visits Clickable + Modal Layout

### Problem
Unscheduled visit cards on the dispatch board were a dead end — clicking them did nothing. The forensic investigation revealed:

1. `getUnscheduledJobs()` queried only the `jobs` table, never joining `job_visits`. Unscheduled items carried `jobId` as their identity but no real `visitId`.
2. The `DispatchVisit` type used `id` for dual purposes: visitId for scheduled items, jobId for backlog items. No separate `visitId` field existed.
3. `handleSelectVisit` correctly guarded against passing a job ID to EditVisitModal (the `kind === "backlog"` branch), but this made backlog items entirely non-interactive.
4. After unschedule → reschedule transitions, optimistic mutations didn't preserve the visit identity, causing stale state.

Additionally, the EditVisitModal had layout issues: controls overflowing modal bounds, non-clickable job number, unbalanced header hierarchy.

### Classification
**Bug Fix** (visit identity) + **Required Extension** (modal layout improvements)

### Fix Applied

| File | Change |
|---|---|
| `server/storage/scheduling.ts` | Added correlated subquery to `getUnscheduledJobs()` that selects `jv.id` from `job_visits` where `is_active = true`, `archived_at IS NULL`, and status not in terminal list. Returns as `activeVisitId` field. Uses existing `TERMINAL_VISIT_STATUSES` constant. |
| `server/routes/scheduling.ts` | Added `activeVisitId` to the unscheduled API response transformation. |
| `shared/types/scheduling.ts` | Added `activeVisitId?: string \| null` to `UnscheduledJobDto` interface. |
| `client/src/components/dispatch/dispatchPreviewTypes.ts` | Added `visitId: string \| null` to `DispatchVisit` type. For scheduled visits, equals `id`. For backlog items, sourced from `activeVisitId`. |
| `client/src/components/dispatch/dispatchPreviewMappers.ts` | `mapEventToDispatchVisit`: sets `visitId = event.visitId ?? event.id`. `mapUnscheduledToDispatchVisit`: sets `visitId = job.activeVisitId ?? null`. |
| `client/src/components/dispatch/useDispatchPreviewMutations.ts` | `optimisticUnschedule()`: preserves `activeVisitId` from the original event data so unscheduled items remain clickable. |
| `client/src/pages/DispatchPreview.tsx` | `handleSelectVisit` now checks `visit.visitId` instead of `visit.kind` to decide whether to open EditVisitModal. Both scheduled and unscheduled items with a real visitId open the same modal. Items without a visitId (rare: no active visit) are no-op. |
| `client/src/components/dispatch/dispatchPreviewMockData.ts` | Added `visitId` field to all mock DispatchVisit entries. |
| `client/src/components/visits/EditVisitModal.tsx` | Widened from `sm:max-w-md` to `sm:max-w-lg` with `overflow-hidden`. Footer uses `flex-wrap`. Job number is now a `<Link>` to job detail page. Header hierarchy: customer name (primary), job link + visit number + status badge. "Reopen Visit" shortened to "Reopen". |

### Canonical Visit Data Contract

The `DispatchVisit` type now carries explicit visit identity:

```typescript
{
  id: string;           // Display/drag identity (visitId for scheduled, jobId for backlog)
  visitId: string|null; // Canonical visit identity — use this for EditVisitModal
  jobId: string;        // Job identity — use for job-level operations
  kind: "visit"|"backlog"; // Display context discriminant
  // ...
}
```

Rule: Use `visitId` for opening EditVisitModal. Use `jobId` for job-level operations. Use `id` for display/drag identity. Use `kind` for display branching only.

### Not Changed
- Backend lifecycle orchestrator — unchanged
- EditVisitModal mutation logic — unchanged (still fetches visit data via `GET /api/jobs/:jobId/visits/:visitId`)
- Visit card components (DispatchVisitBlock, DispatchUnscheduledCard, WeekVisitItem) — unchanged, pure presentation
- Drag/drop scheduling — unchanged
- Job Detail page EditVisitModal usage — unchanged

### Architectural Verification
- Bug Fix + Required Extension classification
- Architecture Constitution §1.1: single canonical visit identity (`visitId`) for all surfaces
- Architecture Constitution §6: no duplicate identity semantics
- No new authorities or shadow workflows
- Correlated subquery uses existing `TERMINAL_VISIT_STATUSES` constant (canonical predicate reuse)
- No changes were made outside the defined scope

---

## 2026-03-22: Dispatch Visit UX Simplification — Direct EditVisitModal Open

### Problem
After the 2026-03-21 visit modal unification, clicking a real visit on Dispatch still opened a DispatchDetailPanel (intermediate floating popover) which only contained an "Edit / Complete Visit" button that then opened EditVisitModal. This was an unnecessary extra step — the intermediate panel no longer provided unique value for real visits since all lifecycle actions had already been moved to EditVisitModal.

### Classification
**Verified Cleanup** — removing an intermediate UI layer that became a passthrough wrapper after the 2026-03-21 unification.

### Fix Applied

| File | Change |
|---|---|
| `client/src/components/visits/EditVisitModal.tsx` | Added optional `customerName` and `jobNumber` props for display context in header. When provided, header shows client name prominently above the visit title. Renamed "Completed" button to "Complete" with `variant="outline"` (neutral styling before action). Promoted "Unschedule" from overflow menu to a visible `variant="ghost"` button in the footer (guarded: only shows when visit has a schedule and is not completed/cancelled). Delete remains in overflow menu for lower emphasis. |
| `client/src/pages/DispatchPreview.tsx` | `handleSelectVisit` now opens EditVisitModal directly for `kind === "visit"` items by setting `visitEditorState` with `customerName` and `jobNumber` from the DispatchVisit. Backlog items (`kind !== "visit"`) toggle selection as before. `floatingEditor` no longer renders DispatchDetailPanel for visits — only for tasks. `handleOpenVisitEditor` callback removed (was the intermediate step). `visitEditorState` type extended with optional `customerName` and `jobNumber` fields. |

### What Remains Dispatch-Specific
- **DispatchDetailPanel** — still rendered for **tasks** only (TaskDetail sub-component)
- **Drag/drop scheduling** on the timeline — unchanged
- **Backlog items** — not selectable (no real visitId), unchanged
- **Dead callbacks** — `handleRescheduleFromPanel`, `handleUpdateCrew`, `handleUpdateStatus`, `handleUpdateVisitNotes`, `handleScheduleFromPanel` are now defined but unreferenced. Left in place for now; harmless and can be cleaned in a follow-up pass.

### Not Changed
- Backend — no changes
- Schema — no changes
- JobDetailPage usage of EditVisitModal — unchanged, still works without `customerName`/`jobNumber` props (they're optional)
- DispatchDetailPanel TaskDetail sub-component — unchanged
- useDispatchPreviewMutations — unchanged
- NeedsFollowUpModal — unchanged

### Architectural Verification
- Verified Cleanup classification — Architecture Constitution §6 (Duplication Law), §14 (post-hardening surgical changes)
- No new authorities or shadow workflows
- No domain logic changes — purely UI layer
- EditVisitModal remains the single canonical owner of visit lifecycle
- No changes were made outside the defined scope

---

## 2026-03-21: Canonical Create Client Modal — Replace All Client Creation Flows

### Problem
Four separate client creation surfaces existed, each with different form logic, different API endpoints, different cache invalidation, and different UX patterns:
1. `NewClientPage.tsx` (892 lines) — full-page 2-pane layout with locations, contacts, parts
2. `AddClientPage.tsx` — legacy tabbed page using AddClientDialog + AddClientWithCompanyDialog
3. `QuickAddClientModal.tsx` (499 lines) — dialog using POST `/api/clients/with-company`
4. `NewAddClientDialog.tsx` (773 lines) — dialog using POST `/api/clients` + separate parts/equipment mutations
5. `QuickCreateDrawer.tsx` — inline client form using POST `/api/clients/quick-create`

Total: ~2,800 lines of duplicated form/mutation logic across 6 files. Helpers like `getPartDisplayName()`, month selection UI, and address autocomplete were duplicated 3-6x.

### Classification
**Canonical Reuse** — consolidating duplicate surfaces into one canonical modal.

### Product Decision
Client creation and client setup are separate concerns. The Create Client modal creates a minimal valid record, then navigates to Client Detail for all further setup (locations, parts, equipment, PM months, etc.).

### Fix Applied

| File | Change |
|---|---|
| `client/src/components/CreateClientModal.tsx` | **NEW** — Canonical client creation modal. Fields: company name (required), optional primary contact (first/last/phone/email), optional billing address (street/unit/city/province/postal). Uses `POST /api/clients/full-create` which atomically creates customer company + bare-minimum primary location + optional contact. On success: invalidates caches, navigates to Client Detail. On error: stays open, preserves form, shows server error inline. |
| `client/src/App.tsx` | Replaced `QuickAddClientModal` import/render with `CreateClientModal`. Removed `NewClientPage`/`AddClientPage` imports. Removed `/clients/new` and `/add-client` routes. `handleAddClient` now opens modal instead of navigating. Wired `onNewClient` on `QuickCreateDrawer`. |
| `client/src/pages/Clients.tsx` | "New Client" button now opens `CreateClientModal` via local state instead of navigating to `/clients/new`. |
| `client/src/components/QuickCreateDrawer.tsx` | Removed inline client form (100+ lines), `createClientMutation`, plan limit check, client form state (10 useState variables), `AddressAutocomplete` import. Added `onNewClient` prop. "New Client" menu item now calls `onNewClient()` callback which opens canonical modal. |
| `client/src/pages/Reports.tsx` | Replaced `NewAddClientDialog` with `CreateClientModal`. |
| `client/src/pages/CompanySettingsPage.tsx` | Replaced `NewAddClientDialog` with `CreateClientModal`. |
| `client/src/pages/Admin.tsx` | Replaced `NewAddClientDialog` with `CreateClientModal`. |

### Files Removed (Zero Importers Verified)

| File | Lines | Reason |
|---|---|---|
| `client/src/pages/NewClientPage.tsx` | ~900 | Full-page creation; replaced by modal |
| `client/src/pages/AddClientPage.tsx` | ~50 | Legacy tabbed page; replaced by modal |
| `client/src/components/QuickAddClientModal.tsx` | ~500 | Duplicate creation dialog; replaced by CreateClientModal |
| `client/src/components/NewAddClientDialog.tsx` | ~773 | Duplicate creation dialog; replaced by CreateClientModal |
| `client/src/components/AddClientDialog.tsx` | ~629 | Legacy form; only imported by deleted AddClientPage |
| `client/src/components/AddClientWithCompanyDialog.tsx` | ~892 | Legacy form; only imported by deleted AddClientPage |

### Not Changed
- Backend endpoints — all remain available; CreateClientModal uses existing `POST /api/clients/full-create`
- `EditClientDialog.tsx` — edit flow, not creation (zero importers currently but unrelated to this task)
- `LocationFormModal.tsx` — location creation/editing; distinct workflow
- Client Detail page — unchanged; receives navigation after creation
- `QuickAddJobDialog.tsx` inline "Add New Client..." — uses `/api/clients/quick-create` for bare-minimum client creation within job context; distinct surface with different intent (not a general-purpose create client action)

### Architectural Verification
- Canonical Reuse classification — Architecture Constitution §6 (Duplication Law)
- Single canonical mutation path: `POST /api/clients/full-create` → storage
- No new authorities, services, or shadow workflows
- No domain logic in client — UI only
- Tenant isolation preserved (endpoint enforces companyId scoping)
- No changes were made outside the defined scope

---

## 2026-03-21: Visit Modal Unification — Canonical EditVisitModal for All Surfaces

### Problem
Two separate UI surfaces independently implemented visit lifecycle actions (complete with outcome, follow-up, reopen, delete):
- **Job Detail** used `EditVisitModal.tsx` — confirmed working after Phase 0 fix.
- **Dispatch** used `DispatchDetailPanel.tsx` with its own buttons, `NeedsFollowUpModal` wiring, and mutation callbacks in `DispatchPreview.tsx`.

This duplication caused drift. The Phase 0 fix (same session) had to be applied to EditVisitModal because a prior fix to the dispatch path never propagated. Architecture Constitution §6 (Duplication Law) and §1.3 (Canonical Owner Extension Rule) require consolidation.

### Classification
**Canonical Reuse** — replacing duplicated visit lifecycle UI with the canonical owner.

### Fix Applied

| File | Change |
|---|---|
| `client/src/components/visits/EditVisitModal.tsx` | Added `reopenMutation` (POST `/api/jobs/:jobId/visits/:visitId/reopen`) and "Reopen Visit" button for completed visits. Added optional `onAfterMutation` callback prop — fires after any lifecycle mutation (complete, reopen, delete) so parent surfaces can coordinate cache invalidation. `onAfterMutation` is called in `completeWithOutcomeMutation.onSuccess`, `deleteMutation.onSuccess`, and `reopenMutation.onSuccess`. |
| `client/src/components/dispatch/DispatchDetailPanel.tsx` | Removed lifecycle action buttons from VisitDetail footer: "Completed Fully", "Needs Follow-Up", "Reopen Visit", "Delete Visit" (with confirmation). Removed `NeedsFollowUpModal` integration and import. Removed props: `onCompleteVisitWithOutcome`, `onReopenVisit`, `onDeleteVisit`. Added `onOpenVisitEditor` prop and "Edit / Complete Visit" button that opens the canonical EditVisitModal. Dispatch-specific actions (Unschedule) retained. |
| `client/src/pages/DispatchPreview.tsx` | Added `EditVisitModal` import and `visitEditorState` state. Added `handleOpenVisitEditor` callback (replaces `handleCompleteVisitWithOutcome`, `handleReopenVisit`, `handleDeleteVisit`). Renders `EditVisitModal` when visit editor is open. On close, closes dispatch detail panel and lets EditVisitModal's own invalidation refresh calendar data. `onAfterMutation` additionally invalidates `["/api/calendar"]` and `["/api/calendar/unscheduled"]` for dispatch board refresh. Removed `completeVisitWithOutcome`, `reopenVisit`, `deleteVisit` from `useDispatchPreviewMutations` destructuring. |

### What Became Canonical
`EditVisitModal.tsx` is the single canonical visit-lifecycle modal for all surfaces (Job Detail, Dispatch, Calendar). It owns: edit schedule, edit notes, complete with outcome, needs follow-up, reopen visit, delete visit.

### What Remains Dispatch-Specific (and Why)
- **Inline scheduling** (crew picker, date/time/duration editing with overlap clamping) — uses dispatch lane data for overlap prevention, not available in EditVisitModal's modal context.
- **Unschedule** — dispatch-only action for removing a visit from the calendar.
- **Schedule from panel** — dispatch-only for scheduling backlog items with inline date/tech picker.
- **Visit notes inline editing** — dispatch convenience UX; edits the same field via the same PATCH API as EditVisitModal.
- **Context display** — client name, location, contact, status badge in dispatch panel header.

### Not Changed
- Backend lifecycle orchestrator (`jobLifecycleOrchestrator.ts`) — unchanged, remains canonical
- Storage layer — no changes
- Schema — no changes
- `useDispatchPreviewMutations.ts` — lifecycle functions (`completeVisitWithOutcome`, `reopenVisit`, `deleteVisit`) still exported but no longer called from `DispatchPreview.tsx`. They remain available for any future callers but are not used by the dispatch board.
- `NeedsFollowUpModal.tsx` — unchanged, still used by EditVisitModal
- Job Detail page (`JobDetailPage.tsx`) — unchanged, already uses EditVisitModal

### Architectural Verification
- Canonical Reuse classification — Architecture Constitution §6 (Duplication Law), §1.3 (Canonical Owner Extension)
- Reopen Visit added to canonical owner (Required Extension) — reuses existing orchestrator endpoint
- No new authorities, services, or shadow workflows introduced
- Write paths unchanged: all lifecycle mutations still go Route → Orchestrator → Storage
- No changes were made outside the defined scope

---

## 2026-03-21: Phase 0 — EditVisitModal Needs Follow-Up Cache + Close Fix

### Problem
After completing a visit with "Needs Follow-Up" from the **Job Detail page**, the job showed "Open (Backlog)" instead of "On Hold". This persisted even after hard refresh. Runtime tracing revealed zero `[FOLLOWUP-TRACE]` logs from the dispatch path — the user was exercising `EditVisitModal.tsx` (Job Detail page), not `DispatchDetailPanel.tsx` (dispatch board). The dispatch path had already been fixed on 2026-03-20; the Job Detail path had the same defect but was never patched.

### Root Cause
Two defects in `EditVisitModal.tsx`:

1. **Response discarded:** `completeWithOutcomeMutation.onSuccess` took zero parameters. The API response `{ visit, reconciliation: { jobUpdated: true, newOpenSubStatus: "on_hold" } }` was silently ignored. No optimistic cache patch to `["jobs", "detail", jobId]` occurred.

2. **Fire-and-forget modal close:** `NeedsFollowUpModal.onConfirm` called `.mutate(data)` then immediately `setShowFollowUp(false)`. The modal closed before the async mutation settled. On failure, the error toast fired but the modal was already gone — the user saw "success" (modal closed) despite the backend never persisting.

### Fix Applied

| File | Change |
|---|---|
| `client/src/components/visits/EditVisitModal.tsx` | Typed `mutationFn` return as `{ visit, reconciliation }`. `onSuccess` now receives `(result, variables)` and patches `["jobs", "detail", jobId]` cache with `openSubStatus`, `holdReason`, `holdNotes`, `onHoldAt` when `reconciliation.jobUpdated === true`. Same pattern as dispatch path in `useDispatchPreviewMutations.ts`. |
| `client/src/components/visits/EditVisitModal.tsx` | Changed `NeedsFollowUpModal.onConfirm` from `.mutate()` + immediate `setShowFollowUp(false)` to `.mutateAsync().then(() => setShowFollowUp(false), () => {})`. Modal stays open until mutation settles. On error, `useMutation.onError` shows toast and modal remains for retry. |

### Instrumentation Cleanup (same session)
Temporary `[FOLLOWUP-TRACE]` `console.warn` lines added during investigation were removed from:
- `client/src/components/dispatch/DispatchDetailPanel.tsx`
- `client/src/pages/DispatchPreview.tsx`
- `client/src/components/dispatch/useDispatchPreviewMutations.ts`

### Not Changed
- Backend orchestrator, reconciliation, storage — all confirmed correct, no changes
- Dispatch path (`useDispatchPreviewMutations.ts`) — already had correct optimistic patch from 2026-03-20
- `NeedsFollowUpModal.tsx` — pure UI component, no changes needed
- `invalidateVisitQueries()` — still fires after success as safety net
- Edit/save/delete mutations in EditVisitModal — unchanged
- No new endpoints, services, or query patterns

### Architectural Verification
- Bug Fix classification — frontend cache management + modal lifecycle
- Architecture Constitution §2.5: allowed (presentation-layer cache management)
- No domain logic, lifecycle, or write path changes
- No new authorities or shadow workflows
- Job cache patch follows identical pattern to existing dispatch path code
- No changes were made outside the defined scope

---

## 2026-03-20: Reopen Visit — Canonical Lifecycle Sequence

### Problem
Clicking "Reopen Visit" on a completed visit (whose parent job was auto-closed by reconciliation) returned 409 "Reopen job to uncomplete a visit." The business rule requires that reopening a completed visit must auto-reopen the parent job as part of the same lifecycle operation — the user should not have to manually reopen the job first.

### Root Cause
The "Reopen Visit" button called the generic visit status endpoint `POST /api/jobs/:jobId/visits/:visitId/status` with `{ status: "scheduled" }`. This endpoint has a terminal-job guard at `jobVisits.routes.ts:228-235` that correctly blocks status changes when the parent job is in a terminal state. No code path existed that chained "reopen parent job" + "reset visit status" into a single operation.

### Fix Applied

| File | Change |
|---|---|
| `server/services/jobLifecycleOrchestrator.ts` | Added `ReopenVisitIntent` interface and `reopenVisit()` orchestrator method. If parent job is terminal, delegates to existing `reopenJob()` (no logic duplication). Resets visit to `status="scheduled"`, clears completion fields (`outcome`, `completedAt`, `completedByUserId`, `isFollowUpNeeded`, `checkedOutAt`, `actualDurationMinutes`). Syncs job schedule from visits. |
| `server/routes/jobVisits.routes.ts` | Added `POST /:jobId/visits/:visitId/reopen` thin route — validates auth, delegates to `lifecycle.reopenVisit()`, emits dispatch events. |
| `client/src/components/dispatch/useDispatchPreviewMutations.ts` | Added `reopenVisit()` mutation calling the new endpoint. Added `optimisticReopenVisit()` helper to revert `visitStatus` to `"scheduled"` in calendar cache. Patches job detail cache if job was reopened. |
| `client/src/components/dispatch/DispatchDetailPanel.tsx` | Added `onReopenVisit` prop. "Reopen Visit" button now calls `onReopenVisit(visit)` instead of `onUpdateStatus(visit, "scheduled")`. |
| `client/src/pages/DispatchPreview.tsx` | Added `handleReopenVisit` callback wiring `reopenVisit` mutation. Passes `onReopenVisit` prop to `DispatchDetailPanel`. |

### Not Changed
- Generic `updateVisitStatus` mutation — still used for non-reopen status changes (en_route, on_site, etc.)
- Terminal-job guard in `/status` route — still correctly blocks generic status changes on terminal jobs
- `reopenJob()` orchestrator method — reused as-is, no modification
- Reconciliation logic — unchanged
- Storage layer — no refactor
- `POST /api/jobs/:id/reopen` endpoint — unchanged, still available for standalone job reopen

### Architectural Verification
- Required Extension classification — extends existing `reopenJob()` canonical owner with visit-level entry point
- Architecture Constitution §1.3: reuses canonical owner, no parallel implementation
- Architecture Constitution §2.2: lifecycle mutation lives in orchestrator
- Architecture Constitution §5: write path is Route → Orchestrator → Storage
- No new authorities or shadow workflows

---

## 2026-03-20: Reopen Visit Error Classification Fix

### Problem
Clicking "Reopen Visit" on a completed visit (whose parent job was auto-closed by "Completed Fully") showed a "Schedule conflict" toast instead of the actual backend message "Reopen job to uncomplete a visit."

### Root Cause
Two-part error transport failure:
1. `createError(409, "Reopen job to uncomplete a visit.")` in `jobVisits.routes.ts:232` did not set a `code` property — only `status` and `message`.
2. The global error handler in `server/index.ts:167-179` returned `{ error, stack }` (dev) or `{ error }` (prod) without including `err.code`.
3. Frontend `ApiError` at `queryClient.ts:240-244` extracted `errorData.code` → `undefined`.
4. `isVersionConflict()` at `useDispatchPreviewMutations.ts:41-44` treated codeless 409 as version conflict (legacy fallback `return true`), triggering "Schedule conflict" toast.

### Fix Applied

| File | Change |
|---|---|
| `server/index.ts` | Added `...(err?.code && err.code !== 'EBADCSRFTOKEN' && { code: err.code })` to both prod and dev response objects in the global error handler. Error codes are now preserved in all HTTP error responses. |
| `server/routes/jobVisits.routes.ts` | Set `code: "JOB_TERMINAL"` on the 409 error thrown when a visit status change is rejected because the parent job is in terminal status. |

### Not Changed
- `isVersionConflict()` — already correct: checks code when present, only matches `VERSION_MISMATCH`
- `handleMutationError()` — already correct: falls through to actual error message for non-conflict 409s
- Backend business rule — job must be reopened before its visits can be uncompleted
- `createError()` utility — signature unchanged; code is set ad-hoc where needed
- No new endpoints, services, or lifecycle methods

### Architectural Verification
- Bug fix classification — error transport/classification only
- Backend business rule preserved (terminal job blocks visit reopen)
- No domain logic, lifecycle, or write path changes
- No new authorities or shadow workflows

---

## 2026-03-20: Needs Follow-Up Job Page Stale Cache Fix

### Problem
After completing a visit with "Needs Follow-Up" → selecting hold reason → "Complete & Place on Hold", the Job Detail page showed "Open (Backlog)" instead of "On Hold". Backend persistence was confirmed correct via hard-refresh API test — the defect was frontend cache staleness.

### Root Cause
`completeVisitWithOutcome` in `useDispatchPreviewMutations.ts` discarded the API response from `POST /complete`. The `optimisticCompleteVisit()` helper patched only the **visit** in the calendar cache (`visitStatus`, `visitOutcome`), not the **job's** `openSubStatus`. The job page query `["jobs", "detail", jobId]` relied on the 200ms `invalidateAfterCompletion()` refetch cycle. During this window, cached job data still showed `openSubStatus: null` → displayed as "Open (Backlog)".

### Fix Applied

| File | Change |
|---|---|
| `client/src/components/dispatch/useDispatchPreviewMutations.ts` | Captured the `POST /complete` response as typed `{ visit, reconciliation }`. When `reconciliation.jobUpdated` is true, immediately patches the job detail cache via `queryClient.setQueryData(["jobs", "detail", jobId])` with `status`, `openSubStatus`, and hold fields from the reconciliation result. |

### Not Changed
- Backend orchestrator, reconciliation, storage — all confirmed correct, no changes
- `optimisticCompleteVisit()` — still patches visit in calendar cache (unchanged)
- `invalidateAfterCompletion()` — still fires after 200ms for full refetch (unchanged)
- "Completed Fully" flow — structurally identical, no regressions
- NeedsFollowUpModal — unchanged
- No new endpoints, services, or query patterns

### Architectural Verification
- Frontend-only fix — presentation-layer cache management (Constitution §2.5: allowed)
- Optimistic job patch follows same pattern as existing `optimisticCompleteVisit()` for visits
- No domain business rules, predicates, or lifecycle logic introduced
- Backend write path unchanged: Route → Orchestrator → Storage

---

## 2026-03-20: Quick Create Client Search SQL Syntax Error Fix

### Problem
Typing any search query (2+ characters) in the Quick Create → New Job / New Invoice / New Quote client/location picker returned zero results. The client "Basil Box" (and all other clients) could not be found by name search, even though they existed in the database and appeared in the initial empty-query dropdown.

### Root Cause
The `GET /api/clients/search-locations` endpoint used `translate()` in its SQL to strip apostrophes and smart quotes for punctuation-insensitive matching. The `from` argument to `translate()` included a backtick character, but the entire SQL query was written as a JavaScript template literal (delimited by backticks). The `\`` escape was interpreted by JavaScript as a literal backtick, which broke the PostgreSQL string literal mid-argument, producing `syntax error at or near ")"` on every search query.

The empty-query code path (lines 153–168) did not use `translate()` and was unaffected, which is why the initial dropdown showed results alphabetically.

### Fix Applied

| File | Change |
|---|---|
| `server/routes/clients.ts` | Extracted the `translate()` strip-characters into a `const stripChars` variable (regular double-quoted string, no template literal escaping issues). Passed as parameterized `$5` binding instead of inlining in the SQL template literal. All 7 `translate()` call sites in the query now reference `$5`. |

### Not Changed
- Empty-query code path (initial dropdown load) — was already correct
- Search fields, ranking logic, LIMIT, tenant scoping — unchanged
- Frontend components (`QuickAddJobDialog`, `QuickCreateDrawer`) — unchanged
- No new endpoints, services, or query patterns introduced

### Architectural Verification
- Bug fix classification — SQL syntax error causing 100% search failure
- No business logic, lifecycle, or write path changes
- Tenant isolation preserved — `WHERE cl.company_id = $1` unchanged
- Performance preserved — same query structure, same index usage, one additional parameter binding (negligible)

---

## 2026-03-20: Visit Completion Stale Board State Fix

### Problem
After clicking "Needs Follow-Up" → selecting reason → "Complete and Place on Hold" on the dispatch board, the visit remained in its pre-completion state: the detail panel continued showing "Completed Fully" / "Needs Follow-Up" buttons instead of "Reopen Visit". The job detail page showed "Open (Backlog)" instead of "On Hold". Backend persistence was confirmed correct via static code trace — the defect was entirely in the frontend cache/invalidation layer.

### Root Cause (two gaps)
1. **No optimistic cache patch**: `completeVisitWithOutcome` discarded the API response and did not patch `visitStatus`/`visitOutcome` in the calendar query cache. `selectedVisit` (derived from `allVisits.find()`) showed stale data until the next cache refetch.
2. **Debounce could skip completion invalidation**: `backgroundInvalidate()` skips if `inflightRef.current > 0 && elapsed < 10s`. If the user had performed any other dispatch mutation recently (drag, reschedule, crew update), the completion's invalidation was silently dropped.

### Fix Applied

| File | Change |
|---|---|
| `client/src/components/dispatch/useDispatchPreviewMutations.ts` | (a) Added `optimisticCompleteVisit()` helper — patches `visitStatus: "completed"` and `visitOutcome` in calendar cache immediately after API success. Same `setQueriesData` pattern as `optimisticReschedule()` and `optimisticResize()`. (b) Added `invalidateAfterCompletion()` — unconditional invalidation that bypasses the debounce/in-flight guard. Invalidates `/api/calendar`, `/api/calendar/unscheduled`, `jobs`, `dashboard`, `visits` with 200ms delay. (c) `completeVisitWithOutcome` now calls both: optimistic patch first, then unconditional invalidation. 409 (already-terminal) error path also uses `invalidateAfterCompletion`. |

### Not Changed
- Backend orchestrator, reconciliation, storage — all confirmed correct, no changes
- `backgroundInvalidate()` — unchanged; other mutations (drag, reschedule, resize) continue to use the debounced path
- `forceRefresh()` — unchanged; used for version-conflict recovery only
- No new services, endpoints, query keys, or write paths
- NeedsFollowUpModal behavior — unchanged (isPending prop deferred)
- Card surface rendering logic — unchanged

### Architectural Verification
- Frontend-only fix — no backend, lifecycle, or storage changes
- Optimistic patch is presentation-layer only (Constitution §2.5: allowed)
- `optimisticCompleteVisit` follows identical pattern to 3 existing optimistic helpers in the same file
- `invalidateAfterCompletion` does not duplicate `backgroundInvalidate` — it serves a different concern (unconditional lifecycle completion vs debounced drag mutations)
- No domain business rules, predicates, or status definitions introduced

---

## 2026-03-20: ApiError Code Propagation — Reopen Visit False Conflict Fix

### Problem
Reopening a completed visit on the dispatch board showed "Schedule conflict" toast instead of the actual backend error message ("Reopen job to uncomplete a visit."). The issue was inconsistent: reopening visits whose parent job was still `open` succeeded, while reopening visits whose parent job was in terminal status (`completed`/`invoiced`/`archived`) silently showed the wrong error.

### Root Cause
`ApiError` class (`queryClient.ts`) did not carry the `code` field from the response body. The error middleware serializes 409 responses as `{ error: "...", code: "CONFLICT" }`, but `apiRequest()` only extracted `status` and `message` into `ApiError`. With `ApiError.code === undefined`, `isVersionConflict()` in `useDispatchPreviewMutations.ts` hit the legacy fallback at line 44 (`return true`), treating ALL code-less 409s as version conflicts.

### Fix Applied

| File | Change |
|---|---|
| `client/src/lib/queryClient.ts` | Added optional `code` field to `ApiError` class. Both `ApiError` throw sites (primary path line 239, CSRF retry path line 191) now extract `errorData.code` from parsed response body. |

### Not Changed
- `isVersionConflict()` in `useDispatchPreviewMutations.ts` — already correct; checks `code === "VERSION_MISMATCH"` when code is present
- `handleMutationError()` — fallthrough at line 551 already shows `err.message` for non-version-conflict errors
- Backend error middleware (`errorHandler.ts`) — already serializes `code` field correctly for 409s
- `completeVisitWithOutcome` 409 handling (line 880) — short-circuits before `handleMutationError`, unaffected

### Architectural Verification
- No backend changes — frontend-only fix
- No new services, write paths, or lifecycle logic
- `ApiError.code` is additive (optional field) — no breaking changes to existing error consumers
- `isVersionConflict` discrimination now works as designed: `VERSION_MISMATCH` → stale-edit toast; all other codes → actual error message

---

## 2026-03-20: Visit→Job Lifecycle Propagation — Complete Fix (Phase 1 + Phase 2)

### Problem
After the Phase 1 transaction isolation fix, visit completion still left parent jobs in `status=open` (backlog). Forensic investigation revealed two additional defects: (1) phantom actionable visits blocking reconciliation, (2) broken frontend error contract and missing query invalidation.

### Phase 1 Root Cause (prior fix — transaction isolation)
`reconcileJobAfterVisitCompletion()` was called INSIDE the visit-update transaction but queried via `db` (pool), not `tx`. Moved outside transaction so reconciliation reads committed visit status. **This fix remains in place.**

### Phase 2 Root Cause (this fix — phantom actionable visits)
The archive predicate in `scheduleJob()` at `scheduling.ts:966-983` only archived visits where `scheduledStart IS NULL` (placeholders). Visits from prior scheduling cycles that retained `scheduledStart IS NOT NULL` — created by direct visit creation (`POST /api/jobs/:jobId/visits`), orchestrator RESCHEDULE_VISIT, or unschedule/reschedule sequences — were NOT archived. These visits remained `isActive=true, archivedAt=null, status='scheduled', scheduledStart IS NOT NULL`, which matched `reconciliationActionableVisitFilter`. When the user completed their current visit, reconciliation found these phantom visits, set `hasRemainingVisits=true`, and returned `{ jobUpdated: false }` via the fallthrough at the end of `reconcileJobAfterVisitCompletion()`.

### Additional Defects Fixed

| Defect | Detail |
|---|---|
| Express error sanitization | Terminal-status error (generic `new Error(...)`) had no status code, fell through to 500 catch-all which replaced the message with "Operation failed". Client could not detect it. |
| Missing `["visits"]` invalidation | `backgroundInvalidate()` did not invalidate `["visits"]` family key. Job Detail visits section showed stale data after dispatch mutations. |

### Fix Applied

| File | Change |
|---|---|
| `server/storage/scheduling.ts` | Widened archive predicate from `isNull(scheduledStart)` to `notInArray(status, TERMINAL_VISIT_STATUSES)`. Now archives ALL non-terminal, non-current visits when scheduling. Terminal visits preserved for history. |
| `server/services/jobLifecycleOrchestrator.ts` | (a) Structured 409 error with `code: "VISIT_ALREADY_TERMINAL"` for terminal-status check. (b) Diagnostic logging when remaining actionable visits block job closure. |
| `server/middleware/errorHandler.ts` | Added 409 status handling — preserves original error message and code (previously fell through to generic 500). |
| `client/src/components/dispatch/useDispatchPreviewMutations.ts` | (a) Added `["visits"]` to `backgroundInvalidate()`. (b) Terminal-status detection uses `err.status === 409` instead of message string match. |

### Not Changed
- `reconcileJobAfterVisitCompletion()` Rules 1–4 — unchanged
- `reconciliationActionableVisitFilter` in `visitPredicates.ts` — unchanged
- `transitionJobStatus` / `updateJobStatusWithEvent` in `jobRepository` — unchanged
- Unscheduled backlog query in `scheduling.ts` — unchanged
- No new services, orchestrators, or write paths introduced

### Architectural Verification
- Canonical owner preserved: `jobLifecycleOrchestrator.completeVisit()` remains the single entry point
- Write path: Route → Orchestrator → Storage (unchanged)
- Archive predicate widening is in the Storage layer (`scheduling.ts`) — no domain logic added
- No duplicate lifecycle logic, predicates, or status definitions
- Performance: identical query count; archive UPDATE uses same indexed WHERE clause

---

## 2026-03-20: Frontend Integrity — Final Narrow Pass

### Fixes Applied

| ID | File | Change |
|---|---|---|
| UI-009 | `JobDetailPage.tsx` | Wired orphaned `clearHoldMutation` to new "Resume" button (visible when `status=open && openSubStatus=on_hold`). Mutation was fully defined but had zero call sites. |
| UI-012 | `NeedsFollowUpModal.tsx` | Replaced local `HOLD_REASONS` (4/6 labels diverged) with import from canonical `ActionRequiredModal.tsx:HOLD_REASONS`. |
| UI-022 | `JobDetailPage.tsx` | Removed unreachable else branch (`"Needs Review"` text) inside `openSubStatus === "on_hold"` guard — branch condition was guaranteed false by outer guard. |
| UI-026 | `ClientDetailPage.tsx` | Replaced raw `inv.status` Badge with `getInvoiceStatusBadge(status, false)` — canonical label rendering. |
| UI-027 | `EditVisitModal.tsx` | Replaced `jobStatus === "closed"` (not a valid status) with `jobStatus === "invoiced" \|\| jobStatus === "archived"`. |
| UI-027 | `DispatchDetailPanel.tsx` | Replaced `task.status === "closed"` (not a valid task status) with `task.status === "cancelled"`. |

### Not Changed
- No backend, lifecycle, or storage changes
- No constant centralization beyond the two HOLD_REASONS files
- No visual palette changes (local visit status color maps retained per original design intent)

### Reviewed But Not Fixed (with blockers)
| ID | Blocker |
|---|---|
| UI-019 | Local `getDisplayStatus` intentionally diverges from canonical: shows "Requires invoicing" for completed (business-specific label) + uses different variant type system. Cannot safely replace. |
| UI-023 | No exported canonical `VISIT_TERMINAL_STATUSES` on client side. Creating one would be scope expansion. |
| UI-025 | Overview endpoint does not return `isPastDue` field. Adding it requires backend work (out of scope). |
| UI-031 | Local visit color maps intentionally use different palette (bold 100-series) vs canonical dispatch palette (subtle 50-series). Comment at EditVisitModal.tsx:71 explicitly retains local colors. Visual regression risk. |

---

## 2026-03-20: Frontend Runtime-Hygiene + Dead-Code Cleanup

### Problem
Production browser consoles were flooded with unguarded `console.log` calls — most critically in `queryClient.ts` which logged on every mutating API request. Multiple dead UI components, dead exports, and two fully orphaned page files persisted after the prior remediation batch.

### Runtime Hygiene (Part 1)
| File | Change |
|---|---|
| `queryClient.ts` | Removed 3 `console.log` calls: CSRF init (line 73), CSRF refresh (line 84), CSRF inject (line 142). Retained `console.error` for CSRF fetch failure and `console.warn` for invalid-token retry (low-frequency error paths). |
| `useProductsServices.ts` | Removed `console.log` at line 57 (`JSON.stringify` of API response). |
| `LiveMapPage.tsx` | Removed 11-line debug `useEffect` block that logged map data on every 15s poll. |

### Dead Code Cleanup (Part 2)
| Target | Proof of Deadness | Lines Removed |
|---|---|---|
| `Jobs.tsx:ActionRequiredNotePopover` | Comment at line 754 confirms removal; zero JSX references in render tree | 64 |
| `Jobs.tsx:SLA_ESCALATE_HOURS` | Zero references after declaration | 1 |
| `Jobs.tsx:needsEscalation/isEscalated` | Hardcoded `false`; unreachable `Escalated` pill branch | 8 |
| `Jobs.tsx:_backlog/_assigned` enrichments | Computed at lines 255-256, zero reads downstream | 2 |
| `Jobs.tsx` dead imports | `useMutation`, `Popover*`, `Textarea`, `Label`, `AlertCircle`, `isJobAssigned`, `isBacklogEligible` — zero remaining usages | 7 imports |
| `useJobVisits.ts:isVisitInactive/isVisitIneligible/getVisitDisplayStatus` | Zero external importers | 18 |
| `useJobVisits.ts` dead imports | `useMutation`, `apiRequest` — zero usages after export deletion | 2 imports |
| `useMutationWithToast.ts:useApiMutation` | Zero external importers | 24 |
| `useMutationWithToast.ts` dead import | `apiRequest` — zero usages after export deletion | 1 import |
| `devFlags.ts` (entire file) | Zero imports in entire `client/src/` | 24 |
| `Technician.tsx` (entire file) | Route removed (Batch A/B); zero imports; zero sidebar links; zero redirects | 379 |
| `DailyParts.tsx` (entire file) | Route removed (Batch A/B); zero imports; zero sidebar links; zero redirects | ~80 |

### Not Changed
- SLA KPI query (`slaKpis`) in Jobs.tsx — actually used by SLA warning banners at lines 444-464 (audit incorrectly flagged as dead)
- `SLA_WARNING_HOURS` — actively used by SLA aging display
- `QUERY_GROUPS` and `invalidateQueries` in `useMutationWithToast.ts` — internal-only, kept (ambiguous external intent)
- No backend, lifecycle, or storage changes
- No constant centralization

---

## 2026-03-20: Frontend Integrity Remediation — Batch A/B

### Context
Forensic frontend audit (2026-03-20) identified 10 broken/misleading frontend surfaces requiring surgical fixes. All findings are presentation-layer corrections — no backend, lifecycle, or storage changes.

### Fixes Applied

| ID | File | Change |
|---|---|---|
| UI-001 | `App.tsx`, `AppSidebar.tsx`, `ProtectedRoute.tsx`, `Signup.tsx` | Removed `/technician` and `/daily-parts` routes (endpoints non-existent); redirects now point to `/` |
| UI-002 | `JobTemplateModal.tsx:83` | Changed `"pm"` → `"maintenance"` to match canonical DB job type |
| UI-005 | `InvoiceDetailPage.tsx:1120-1157` | Added `disabled` to 5 visibility `Switch` components (had no handlers) |
| UI-006 | `InvoiceDetailPage.tsx:826-829` | Removed dead "Add Item" button (no handler, no dialog) |
| UI-007 | `InvoiceDetailPage.tsx:1062,1091` | Made Client Message and Internal Notes textareas `readOnly` (values never persisted) |
| UI-008 | `LocationDetailPage.tsx:64,411,533` | Removed Invoices tab (no data query existed; permanently empty) |
| UI-010 | `JobDetailPage.tsx:1811` | Replaced `job.parentCompany?.name \|\| job.location?.companyName` with `job.locationDisplayName` |
| UI-011 | `ClientDetailPage.tsx:1627-1633` | Replaced stale `"accepted"`/`"rejected"` with `"approved"`/`"declined"`; added `"converted"` |
| UI-014 | `RecurringJobsPage.tsx:141` | Fixed response shape — extract `.data` from `{ data, pagination }` server response |
| UI-015 | `ClientDetailPage.tsx:17,201-215` | Replaced `window.location.search` with wouter `useSearch()` for reactive deep-linking |

### Not Changed
- No backend routes, services, storage, or domain logic
- No lifecycle, orchestrator, or write-path changes
- No constant centralization (deferred to separate batch)
- No dead-code deletion beyond the specific broken controls removed
- `Technician.tsx` and `DailyParts.tsx` files retained on disk (route exposure removed; file deletion deferred)

---

## 2026-03-20: Phase 5 — Eliminate Duplicate Attention Items Upsert Write Path

### Problem
`server/lib/visitIntelligence.ts` owned a local `upsertAttention()` function (lines 93-118) containing identical `INSERT INTO attention_items ... ON CONFLICT (tenant_id, dedupe_key) DO UPDATE SET ...` SQL as the canonical `upsertAttentionItem()` in `server/lib/attentionRules.ts` (lines 294-317). Two independent functions writing to the same table with the same SQL but different signatures — a write-path duplication violating Architecture Constitution §6 (Duplication Law).

### Fix
Exported `upsertAttentionItem()` from `attentionRules.ts`. Deleted `upsertAttention()` from `visitIntelligence.ts`. Rewired all 5 call sites to construct `AttentionMatch` objects (already-exported type) and call the canonical function.

| Call Site | ruleType | entityType | entityId |
|---|---|---|---|
| visit.late | `"visit.late"` | `"visit"` | `v.visitId` |
| visit.overdue | `"visit.overdue"` | `"visit"` | `v.visitId` |
| visit.running_long | `"visit.running_long"` | `"visit"` | `v.visitId` |
| tech.offline | `"tech.offline"` | `"technician"` | `tp.technicianId` |
| tech.idle | `"tech.idle"` | `"technician"` | `tp.technicianId` |

### Behavioral Equivalence Proof
- **dedupeKey:** Both used `${entityType}:${entityId}:${ruleType}` — identical template, identical field order.
- **INSERT columns:** Same 11 columns in same order.
- **ON CONFLICT SET:** Same 5 fields (`last_detected_at`, `meta`, `status`, `resolved_at`, `severity`).
- **meta payloads:** Each call site passes the same object shape as before, just via `{ meta: ... }` wrapper instead of flat param.

### Not Changed
- Attention read paths (dashboard, list, resolution)
- `resolveAttentionItem()` (stays private to attentionRules.ts)
- `recomputeAttentionForEntity()` and `recomputeAllAttention()` public API
- Any attention rule detection logic
- Visit intelligence signal computation, data fetchers, or downstream impact logic
- Any other file

---

## 2026-03-20: Phase 4D — Fix deriveNextDueForClient() Fallback Bug

### Problem
`deriveNextDueForClient()` in `routes/clients.ts:96` read `client.selectedMonth` (singular) — a field that does not exist in the schema. The actual field is `client.selectedMonths` (plural, `integer[]`). Since `client.selectedMonth` is always `undefined`, the guard `if (!selectedMonth) return ""` always fires, making the entire fallback branch dead code.

### Bug Evidence
- Schema: `selectedMonths: integer("selected_months").array().notNull()` (schema.ts:432)
- Code: `client.selectedMonth` (singular) → always `undefined` → always returns `""`
- Affected surfaces: `GET /api/clients` (list) and `GET /api/clients/:id` (detail)

### Fix
Replaced broken fallback with `computeNextDueDate(client.selectedMonths ?? [])` (canonical shared formula from Phase 4C). Calendar assignment priority path (lines 93-94) untouched.

| Scenario | Before | After |
|---|---|---|
| Client has calendar assignment | Returns assignment date | **Unchanged** |
| Client has selectedMonths, no assignment | Returns `""` (bug) | Returns computed `YYYY-MM-DD` (fixed) |
| Client has empty selectedMonths, no assignment | Returns `""` | Returns `""` (unchanged) |

### Not Changed
- `buildFutureDueIndex()` (calendar assignment lookup)
- `computeNextDueDate()` (shared formula)
- Response field name (`nextDue`)
- Any other route or client logic

---

## 2026-03-20: Phase 4C — Extract Shared Next-Due Date Formula

### Problem
The next-due date calculation (sorted months → find next month after today → 15th of month → wrap to next year) was duplicated in 3 files with identical date math but different wrapper logic (ISO strings vs Date objects, inactive handling, sentinel values).

### Fix
Created `shared/nextDue.ts` with `computeNextDueDate(selectedMonths: number[]): Date | null`. All 3 callers now delegate to the shared function; caller-specific concerns (ISO conversion, sentinel, inactive check) remain at the call site.

| File | Before | After |
|---|---|---|
| `server/routes/clients.ts` | 20-line local `calculateNextDue()` with inline date math | 3-line wrapper calling `computeNextDueDate()` + ISO/sentinel conversion |
| `client/src/components/NewAddClientDialog.tsx` | 22-line local `calculateNextDueDate()` with inline date math | 3-line wrapper calling `computeNextDueDate()` + inactive check |
| `client/src/pages/AddClientPage.tsx` | 22-line local `calculateNextDueDate()` with inline date math | 3-line wrapper calling `computeNextDueDate()` + inactive check |

### Not Changed
- `deriveNextDueForClient()` — intentionally not fixed (uses `client.selectedMonth` singular — known bug, deferred to separate phase)
- `buildFutureDueIndex()` — calendar assignment lookup, different concern
- `cleanupInvalidCalendarAssignments()` — enforcement, not calculation
- `domain/recurrence.ts` — different system (recurring job generation)
- API response shape or next-due persistence behavior

---

## 2026-03-20: Phase 4B — Route TechField Note Creation Through Storage

### Problem
`techField.ts` POST `/api/tech/visits/:visitId/notes` used direct `db.insert(jobNotes)` instead of the canonical `jobNotesRepository.createJobNote()` storage method. This bypassed the storage layer's active-job guard and created a competing write path.

### Fix
Replaced the 12-line direct insert with a single call to `jobNotesRepository.createJobNote(companyId, visit.jobId, userId, text.trim())`. Removed unused `jobNotes` import.

### Behavior Differences (Minor)
- Storage method adds an `activeJobFilter()` pre-check (defense-in-depth — job is guaranteed active via visit assignment)
- Timestamps now use schema defaults (`CURRENT_TIMESTAMP`) instead of explicit `new Date()` — functionally identical

### Not Changed
- Orchestrator `tx.insert(jobNotes)` in `completeVisit()` (tx-dependent, separate concern)
- Import service `tx.insert(jobNotes)` (tx-dependent)
- Route validation, authorization, visit assignment check
- Response shape (`res.status(201).json(note)`)

---

## 2026-03-20: Phase 4A — Invoice Audit Event Coverage

### Problem
Invoice status transitions had partial event coverage: `invoice.created` and `invoice.sent` were emitted, but `invoice.voided` and `invoice.paid` (the two highest-value financial milestones) were not.

### Fix
| Event | File | Line | Condition |
|---|---|---|---|
| `invoice.voided` | `routes/invoices.ts` | ~718 | After void handler succeeds (any → voided) |
| `invoice.paid` | `routes/payments.ts` | ~80 | After createPayment succeeds AND post-payment invoice status === "paid" |

### Deferred
- `invoice.unsent` (low audit value — draft reversion)
- `invoice.partial_paid` (intermediate state, not a milestone)
- Payment update/delete events (reversal events)
- `invoice.status_changed` (not introduced — events remain specific per Constitution)

### Not Changed
- Invoice business logic (void validation, payment transaction, balance recalculation)
- Existing `invoice.created` and `invoice.sent` events
- Storage methods (`updateInvoice`, `createPayment`, `recalculateInvoiceBalance`)
- Payment transaction boundaries

---

## 2026-03-20: Phase 3D — Centralize Invoice Status Badge Helper

### Problem
`getStatusBadge(status, isPastDue)` was defined identically in both `InvoicesListPage.tsx` (lines 47-74) and `InvoiceDetailPage.tsx` (lines 122-137). Same statuses, same labels, same variants, same isPastDue override. `statusBadges.ts` already owned `getQuoteStatusBadge()` with the same output shape.

### Fix
Added `getInvoiceStatusBadge()` to `statusBadges.ts`. Removed both local definitions. Updated call sites.

| File | Change |
|---|---|
| `lib/statusBadges.ts` | Added `getInvoiceStatusBadge(status, isPastDue)` |
| `pages/InvoicesListPage.tsx` | Removed local `getStatusBadge`, import canonical helper |
| `pages/InvoiceDetailPage.tsx` | Removed local `getStatusBadge`, import canonical helper |

### Not Changed
- Portal badge logic (`portalUtils.ts:statusBadgeVariant`)
- `StatusPill` component (`status-pill.tsx`)
- `getBalanceColor()` in InvoiceDetailPage
- `getQuoteStatusBadge()` in statusBadges.ts
- Any badge appearance or status wording

---

## 2026-03-20: Phase 3C — Centralize Unpaid Invoice Statuses Constant

### Problem
The unpaid invoice status set `["awaiting_payment", "sent", "partial_paid"]` was defined 7 times across 4 files (3 as local constants, 2 as inline SQL, 2 as inline arrays). Drift in any definition would cause inconsistent financial counts/reports.

### Fix
Renamed and exported the existing `UNPAID_STATUSES` in `invoicesFeed.ts` to `UNPAID_INVOICE_STATUSES`. Added `UNPAID_INVOICE_STATUS_SQL` derived constant for raw SQL usage (same pattern as `VISIT_TERMINAL_STATUS_SQL`).

| File | Before | After |
|---|---|---|
| `invoicesFeed.ts:123` | Private `UNPAID_STATUSES` | Exported `UNPAID_INVOICE_STATUSES` + `UNPAID_INVOICE_STATUS_SQL` |
| `invoices.ts:667` | Local `unpaidStatuses` | Import `UNPAID_INVOICE_STATUSES` |
| `invoices.ts:732` | Local `unpaidStatuses` | Import `UNPAID_INVOICE_STATUSES` |
| `dashboard.ts:401` | Local `UNPAID` | Import `UNPAID_INVOICE_STATUSES` |
| `dashboard.ts:134,141` | Inline SQL `IN ('awaiting_payment', 'sent', 'partial_paid')` | `IN (${sql.raw(UNPAID_INVOICE_STATUS_SQL)})` |
| `routes/invoices.ts:195` | Inline array | Import `UNPAID_INVOICE_STATUSES` |

### Not Changed
- `payments.ts` (different semantic: "can receive payment" = `["sent", "partial_paid"]`)
- `reports.ts` (different semantic: AR aging = `["sent", "partial_paid"]`)
- `portal.ts` (different semantic: portal visibility)
- Client-side code
- Actual status set (still exactly `["awaiting_payment", "sent", "partial_paid"]`)

---

## 2026-03-20: Phase 3B — Centralize Location Display Name COALESCE

### Problem
8 query sites across 7 storage files inlined `sql\`COALESCE(customerCompanies.name, clientLocations.companyName)\`` instead of using the existing canonical `locationDisplayNameExpr` helper in `queryHelpers.ts`. The helper existed since Phase 5 but was never consumed.

### Fix
Imported and used `locationDisplayNameExpr` at all 8 sites. No new helper created. `queryHelpers.ts` unchanged.

| File | Sites | Select Alias |
|---|---|---|
| `storage/jobsFeed.ts` | 1 | `locationDisplayName` |
| `storage/jobs.ts` | 2 | `locationCompanyName` |
| `storage/visits.ts` | 1 | `locationCompanyName` |
| `storage/invoicesFeed.ts` | 1 | `locationDisplayName` |
| `storage/invoices.ts` | 1 | `locationDisplayName` |
| `storage/dashboard.ts` | 1 | `locationDisplayName` |
| `storage/reports.ts` | 1 | `locationDisplayName` |

### Not Changed
- `queryHelpers.ts` (helper already existed)
- JS notification fallback chains (different semantics)
- Client-side display logic
- Query shape, joins, or DTO structure

---

## 2026-03-20: Phase 3A — Canonical Filter Helpers for Clients, Companies, Visits

### Problem
Three entity types lacked canonical soft-delete/active filter helpers, causing 27 inline filter patterns across 7 files. Jobs and invoices already had `activeJobFilter()` and `activeInvoiceFilter()`.

### Helpers Added

| Helper | File | Semantics | Replaces |
|---|---|---|---|
| `activeVisitGuard()` | `lib/visitPredicates.ts` | `isActive=true AND archivedAt IS NULL` | 12 inline sites |
| `notDeletedClientFilter()` | `storage/jobFilters.ts` | `deletedAt IS NULL` | 9 inline sites |
| `notDeletedCustomerCompanyFilter()` | `storage/jobFilters.ts` | `deletedAt IS NULL` | 6 inline sites |

### Replacement Sites

| File | Helper Used | Sites Replaced |
|---|---|---|
| `storage/jobVisits.ts` | `activeVisitGuard()` | 7 (list, get, update guards) |
| `storage/visits.ts` | `activeVisitGuard()` | 5 (all query functions) |
| `storage/customerCompanies.ts` | `notDeletedCustomerCompanyFilter()` | 4 |
| `storage/customerCompanies.ts` | `notDeletedClientFilter()` | 6 (location queries) |
| `services/jobImport.ts` | `notDeletedCustomerCompanyFilter()` | 2 |
| `services/jobImport.ts` | `notDeletedClientFilter()` | 1 |
| `services/clientImport.ts` | `notDeletedClientFilter()` | 1 |
| `storage/adminQbo.ts` | `notDeletedClientFilter()` | 1 |

### Not Changed
- Existing visit predicates (`scheduleEligibleVisitFilter`, `reconciliationActionableVisitFilter`, `uncompletedVisitFilter`)
- Route-level raw SQL patterns (deferred)
- Client `inactive` legacy NULL semantics (deliberately not centralized)
- `customerCompanies.ts` line 62 combined `isActive + deletedAt` filter (one-off, left inline)

---

## 2026-03-20: Phase 2A — QBO Customer Company nameNormalized Integrity

### Problem
`QboCustomerImportService.ts:upsertCustomerCompany()` created and updated `customerCompanies` records without computing `nameNormalized`. The canonical `customerCompanyRepository.createCustomerCompany()` always computes this field via `normalizeForMatch(name)`. QBO-imported records had NULL `nameNormalized`, breaking dedup lookups via `findCustomerCompanyByNormalizedName()`.

### Why Not Route Through Repository
`createCustomerCompany()` uses explicit field mapping (not spread) and does not accept QBO link fields (`qboCustomerId`, `qboSyncToken`, `qboLastSyncedAt`, `qboSyncStatus`, `qboSyncError`), `legalName`, `billingStreet2`, or `isActive`. Extending the repository was out of scope. Inline `normalizeForMatch()` matches the repository's behavior exactly.

### Fix
| Mutation | Line | Change |
|---|---|---|
| U3 (merge update) | ~725 | Added `nameNormalized: normalizeForMatch(name)` only when `name` is being written |
| U4 (overwrite update) | ~744 | Added `nameNormalized: normalizeForMatch(name)` to overwrite payload |
| U5 (insert) | ~753 | Added `nameNormalized: normalizeForMatch(name)` to insert values |

### Not Changed
- QboCatalogImportService.ts (items — integration-state writes, allowed by §5.1)
- QboItemService.ts (items — sync status bookkeeping, allowed by §5.1)
- Client locations logic in QboCustomerImportService
- Wipe mode transaction behavior
- Merge/overwrite/link_only semantics beyond nameNormalized
- Any repository methods

---

## 2026-03-20: Phase 1C — Remove Unreachable Completed-Status Auto-Timestamp

### Problem
`updateJobVisitStatus()` in `storage/jobVisits.ts` contained a `status === "completed"` branch that auto-set `checkedOutAt` and `actualDurationMinutes`. This branch is unreachable: the route caller rejects `"completed"` at line 224 (`jobVisits.routes.ts`), and the orchestrator caller passes `"cancelled"`. The branch was dead code that implied storage participates in visit completion — misleading since completion is canonically owned by the orchestrator.

### Fix
Deleted the `if (status === "completed") { ... }` block (lines 738-749). Kept the `on_site` checkedInAt auto-timestamp (line 734-736) — this is live and canonical for the office manual status flow.

### Reachability Proof
| Caller | Status passed | Can trigger completed branch? |
|---|---|---|
| `routes/jobVisits.routes.ts:236` | Any except `"completed"` (blocked at line 224) | **No** |
| `jobLifecycleOrchestrator.ts:838` (`cancelVisit`) | `"cancelled"` | **No** |

### Not Changed
- `on_site` checkedInAt auto-timestamp (kept — live canonical path)
- `checkInJobVisit()` (separate method, untouched)
- Orchestrator `completeVisit()` (canonical completion owner, untouched)
- Route validation blocking `"completed"` (untouched)
- Cancel visit flow (untouched)

---

## 2026-03-20: Phase 1B — Merge Misplaced Completed-Job Terminal Guard

### Problem
`scheduleJob()` in `storage/scheduling.ts` had two terminal guards:
- Guard #1 (line 862): `JOB_TERMINAL_STATUSES.includes(status)` — blocked invoiced/archived **before** visit mutations
- Guard #2 (line 985): `existingJob.status === 'completed'` — blocked completed **after** visit mutations

Guard #2 was legacy residue from removed Rule D (implicit reopen of completed jobs on schedule, removed 2026-03-18). It was placed where the reopen logic used to live. A completed job reaching `scheduleJob()` would have visits created/updated, then error — wasted work.

### Fix
Merged `|| existingJob.status === 'completed'` into guard #1. Deleted guard #2. Single early check now blocks all non-open jobs before any visit mutations.

### Behavioral Impact
| Aspect | Before | After |
|---|---|---|
| Invoiced/archived jobs | Blocked before mutations | **Unchanged** |
| Completed jobs | Blocked AFTER visit mutations (visits created, then error) | Blocked BEFORE visit mutations (clean rejection) |
| Open jobs | Allowed through | **Unchanged** |
| Error class/message | `TerminalJobImmutableError` | **Unchanged** |

### Not Changed
- Route error handling
- Orchestrator logic
- Other scheduling methods (`rescheduleVisit`, `unscheduleVisit`)
- Audit log dead branch (`wasReopened` at line 990 — left as-is per scope lock)
- Version check ordering
- Visit conflict detection

---

## 2026-03-20: Phase 1A — Extract Reschedule Orchestration from Storage

### Problem
`server/storage/scheduling.ts:rescheduleVisit()` contained workflow orchestration logic: spawn-on-action decision branching, terminal status guards, visit completion during reschedule. Per Architecture Constitution §2.3, storage must be "dumb by design" — no business logic, no orchestration.

### Ownership Change
| Concern | Before | After |
|---|---|---|
| Spawn-on-action decision | `storage/scheduling.ts` | `services/jobLifecycleOrchestrator.ts` |
| Terminal status guard | `storage/scheduling.ts` | `services/jobLifecycleOrchestrator.ts` |
| Visit completion in reschedule | `storage/scheduling.ts` | `services/jobLifecycleOrchestrator.ts` |
| Version check | `storage/scheduling.ts` | `services/jobLifecycleOrchestrator.ts` |
| All-day→timed conversion | `storage/scheduling.ts` | `services/jobLifecycleOrchestrator.ts` |
| Route call target | `schedulingRepository.rescheduleVisit()` | `lifecycle.rescheduleVisit()` |

### Files Changed
| File | Change |
|---|---|
| `services/jobLifecycleOrchestrator.ts` | Added `RescheduleVisitIntent`, `RescheduleVisitResult`, `rescheduleVisit()` method |
| `routes/scheduling.ts` | Changed call from `schedulingRepository.rescheduleVisit()` to `lifecycle.rescheduleVisit()` |
| `storage/scheduling.ts` | Deleted `rescheduleVisit()` method |

### Not Changed
- Any other scheduling methods (`scheduleJob`, `unscheduleVisit`, etc.)
- Route error handling (string-based `error.message?.includes()` preserved as-is)
- Return shape (`{ ...job, visitId, visitVersion }`)
- Downstream persistence methods (`updateJobVisit`, `createJobVisit`, `getJobById`)
- Schedule sync behavior (triggered by `updateJobVisit`/`createJobVisit` internally)

---

## 2026-03-20: Phase 0 Dead Code Deletion — Forensic Audit

### Context
Forensic architectural audit (2026-03-20) identified dead code candidates. Each was verified with zero-caller proof before deletion.

### Verification and Deletion Results

| Target | Grep Evidence | Barrel Export? | Action |
|---|---|---|---|
| `server/services/calendarValidation.ts` | 0 code imports (only in .md docs) | No | **DELETED** |
| `shared/calendarRules.ts` | 0 imports anywhere | No | **DELETED** |
| `scheduling.ts:validateTechnicianBelongsToTenant()` | 0 callers (1 comment-only mention in routes) | Yes (`validateCalendarTechnician`) — 0 callers | **DELETED** + barrel cleaned |
| `scheduling.ts:validateJobBelongsToTenant()` | 0 callers | Yes (`validateCalendarJob`) — 0 callers | **DELETED** + barrel cleaned |
| `jobVisits.ts:isVisitEmpty()` | 2 active callers (`scheduling.ts:906`, `JobDetailPage.tsx:92`) | No | **RETAINED** |
| 8 orphaned pages | 0 imports, 0 route registrations | No | **DELETED** |

### Orphaned Page Deletion Detail

All 8 pages verified: zero imports, zero route registrations in App.tsx, no lazy imports, no barrel exports, no dynamic loading.

| File | Lines | Evidence |
|---|---|---|
| `TechHomePage.tsx` | 130 | No `/tech` route in App.tsx |
| `TechSchedulePage.tsx` | 160 | No `/tech/schedule` route |
| `TechTimesheetPage.tsx` | 151 | No `/tech/timesheet` route |
| `TechVisitDetailPage.tsx` | 516 | No `/tech/visit/:id` route |
| `TechLoginPage.tsx` | 123 | No `/tech/login` route |
| `TechMorePage.tsx` | 72 | No `/tech/more` route |
| `TechnicianDashboard.tsx` | 451 | Import already removed from App.tsx in prior cleanup |
| `AdminTimesheetsPage.tsx` | 723 | No `/settings/timesheets` route |

### Not Changed
- Any route, service, orchestrator, storage, or lifecycle logic
- `isVisitEmpty()` — retained (active callers proven)
- Any live imports or barrel exports

---

## 2026-03-20: Surgical Compliance Cleanup — Import/QBO Audit Findings

### Context
Forensic architectural audit (2026-03-20) identified 4 medium-severity and 1 low-severity finding in import/QBO code added after hardening. All relate to write-path violations, a missing transaction, and orphaned exports.

### Fixes Applied

| ID | Severity | File | Change |
|---|---|---|---|
| F-03 | MEDIUM | `services/qbo/QboCustomerImportService.ts` | Wrapped wipe-mode `db.update(clientLocations)` + `db.update(customerCompanies)` in single `db.transaction()` |
| F-01 | MEDIUM | `services/jobImport.ts`, `storage/jobs.ts` | `executeJobRow()` now calls `jobRepository.createJobWithExplicitNumber(…, tx)` instead of `tx.insert(jobs)`. Added `txHandle` param to storage method |
| F-02 | MEDIUM | `services/productImport.ts` | `executeRow()` now calls `itemRepository.createItem()` instead of `db.insert(items)` |
| F-04 | MEDIUM | `routes/jobImport.ts` | Replaced 2 inline active-job filters with `activeJobFilter()` import |
| F-05 | LOW | `client/src/components/job/jobUtils.ts` | Removed `JOB_TERMINAL_STATUSES` and `isTerminalStatus()` — zero client consumers |

### Before/After Ownership Paths

**F-01 (Job Import):**
- Before: `jobImport.ts:executeJobRow()` → `tx.insert(jobs)` (direct Drizzle, bypasses storage)
- After: `jobImport.ts:executeJobRow()` → `jobRepository.createJobWithExplicitNumber(…, tx)` → storage owns insert

**F-02 (Product Import):**
- Before: `productImport.ts:executeRow()` → `db.insert(items)` (direct Drizzle, bypasses storage)
- After: `productImport.ts:executeRow()` → `itemRepository.createItem()` → storage owns insert

**F-03 (QBO Wipe):**
- Before: Two sequential `db.update()` calls — partial failure leaves inconsistent state
- After: Both updates inside `db.transaction()` — atomic commit or full rollback

### Not Changed
- Any lifecycle, orchestrator, or reconciliation logic
- Normal job/item creation paths
- Import behavior or semantics
- Transaction boundaries for location + note creation in job import (simple CRUD, allowed per Constitution §5.1)
- Any route-level domain write behavior

---

## 2026-03-20: Hardening Completion Verification & Final Dedup

### Context
Post-hardening completion pass to verify all critical bypasses (BP-1 through BP-4) are eliminated, visit predicates are centralized, and no duplicate display constants remain.

### Verification Results (code-proven)
| Item | Status | Evidence |
|---|---|---|
| BP-1 (reconciliation→lifecycle close) | **Fixed** | `reconcileJobAfterVisitCompletion()` Rule 1 calls `jobRepository.transitionJobStatus()` with `CLOSE_JOB` intent |
| BP-2 (reconciliation Rules 2-4 version+audit) | **Fixed** | Rules 2-4 call `jobRepository.updateJobStatusWithEvent()` |
| BP-3 (techField en-route) | **Fixed** | Route delegates to `lifecycle.setVisitEnRoute()` |
| BP-4 (techField start) | **Fixed** | Route delegates to `lifecycle.startVisit()` |
| Visit eligibility predicates | **Centralized** | `jobVisits.ts` imports `scheduleEligibleVisitFilter`, `uncompletedVisitFilter` from `visitPredicates.ts` |
| Dead code (`scheduleJobBypassWorkingHours`, `updateJobStatusWithMultipleEvents`, dup `isTerminalStatus`) | **Deleted** | Tombstone comments cite 2026-03-18 |

### Fix Applied
Removed last duplicate `VISIT_STATUS_OPTIONS` from `dispatchPreviewTypes.ts`. Rewired 2 consumers to import from canonical `lib/visitStatusDisplay.ts`.

| File | Change |
|---|---|
| `components/dispatch/dispatchPreviewTypes.ts` | Removed duplicate `VISIT_STATUS_OPTIONS` array, added tombstone comment |
| `components/dispatch/DispatchFiltersBar.tsx` | Import `VISIT_STATUS_OPTIONS` from `@/lib/visitStatusDisplay` |
| `pages/DispatchPreview.tsx` | Import `VISIT_STATUS_OPTIONS` from `@/lib/visitStatusDisplay` |

### Not Changed
- Any lifecycle, orchestrator, storage, or route logic
- Visit predicate definitions (already canonical)
- Type exports from `dispatchPreviewTypes.ts` (still needed by 20+ dispatch components)

---

## 2026-03-20: TypeScript Baseline Cleanup — Zero Errors

### Problem
3 pre-existing TypeScript errors remained through all prior hardening passes.

### Fixes
| Error | File | Root Cause | Fix |
|---|---|---|---|
| TS2339: `isPastDue` not on `EnrichedInvoice` | `InvoicesListPage.tsx:141` | Server feed returns `isPastDue` (computed by `invoicesFeed.ts` mapper), but client type didn't declare it | Added `isPastDue?: boolean` to `EnrichedInvoice` interface |
| TS2339: `jobId` not on validated schema (×2) | `adminTimesheets.ts:377` | Route reads `validated.jobId` for job reassignment, but `managerUpdateTimeEntrySchema` didn't include the field | Added `jobId: z.string().nullable().optional()` to schema |

### Runtime Impact
- **`isPastDue` fix:** Type-only change. No runtime effect — the field was already present at runtime from the server response; only the TypeScript declaration was missing.
- **`jobId` fix:** The Zod schema now accepts `jobId` in the request body where previously it was silently stripped by `.strict()` or passed through unvalidated. This is a correctness improvement — the route was already using the field at runtime, the schema just wasn't declaring it for validation.

### Not Changed
- Any route logic, lifecycle, invoice, visit, or storage code

---

## 2026-03-20: Dead Storage Export Cleanup

### Problem
5 methods exported through the `storage` barrel in `server/storage/index.ts` had zero live callers — they were superseded by canonical versions in other modules or were never called.

### Verification (zero callers confirmed by grep)
| Item | Grep Pattern | Live Callers | Status |
|---|---|---|---|
| `storage.getInvoiceStats` | `storage\.getInvoiceStats` | 0 | DELETED |
| `storage.getDashboardInvoices` | `storage\.getDashboardInvoices` | 0 | DELETED |
| `storage.createJobStatusEvent` | `storage\.createJobStatusEvent` | 0 | DELETED |
| `storage.getAllCalendarAssignments` | `storage\.getAllCalendarAssignments` | 0 | DELETED |
| `createCompany` inline | `storage\.createCompany` | 0 | DELETED |
| `getInvitationByToken` | `storage\.getInvitationByToken` | 1 (`routes/auth.ts:183`) | **KEPT** |
| `updateInvitation` | `storage\.updateInvitation` | 1 (`routes/auth.ts:190`) | **KEPT** |

### Not Changed
- Underlying repository methods (still exist in their files for internal use)
- Live barrel exports
- Any route, service, or lifecycle code

---

## 2026-03-20: Canonical Filter and Predicate Cleanup

### Problem
3 sites inlined `isNull(jobs.deletedAt), eq(jobs.isActive, true)` instead of using `activeJobFilter()`. 1 server file redefined `VISIT_TERMINAL_STATUSES` locally. 3 raw SQL sites hardcoded `NOT IN ('completed', 'cancelled')` instead of using the canonical constant.

### Fix
| Target | File | Change |
|---|---|---|
| Inline active-job (update guard) | `storage/jobs.ts:664` | → `activeJobFilter()` |
| Inline active-job (list guard) | `storage/jobNotes.ts:24` | → `activeJobFilter()` |
| Inline active-job (create guard) | `storage/jobNotes.ts:105` | → `activeJobFilter()` |
| Inline active-job (LEFT JOIN) | `storage/invoicesFeed.ts:276` | → `activeJobFilter()` |
| Local terminal set | `storage/scheduling.ts:877` | → import `TERMINAL_VISIT_STATUSES` |
| Raw SQL terminal | `lib/autoGapScheduling.ts:135` | → `VISIT_TERMINAL_STATUS_SQL` |
| Raw SQL terminal | `lib/visitIntelligence.ts:160` | → `VISIT_TERMINAL_STATUS_SQL` |
| Raw SQL terminal | `lib/visitIntelligence.ts:539` | → `VISIT_TERMINAL_STATUS_SQL` |
| Raw SQL terminal | `storage/scheduling.ts:692` | → `VISIT_TERMINAL_STATUS_SQL` |

New canonical constant added:
- `lib/visitPredicates.ts:VISIT_TERMINAL_STATUS_SQL` — raw SQL string `'completed', 'cancelled'` derived from `TERMINAL_VISIT_STATUSES` array

### Not Changed
- Query semantics (exact same filter conditions, just imported instead of inline)
- `activeJobFilter()` definition (unchanged)
- `TERMINAL_VISIT_STATUSES` array (unchanged)
- Any route, lifecycle, invoice, or visit completion logic

---

## 2026-03-19: Invoice Path Consistency — Close+Invoice_Now Unified

### Problem
`POST /api/jobs/:id/close` with `mode=invoice_now` called `storage.createInvoiceFromJob()` + `storage.refreshInvoiceFromJob()` directly (lines 667-674), bypassing the canonical invoice creation service. This produced invoices with populated lines but **no tax application** and **no tax snapshots** — structurally different from invoices created via `POST /api/invoices/from-job/:jobId`.

| Step | `POST /invoices/from-job` (canonical) | `POST /jobs/:id/close` invoice_now (before fix) |
|---|---|---|
| Create invoice | `createInvoiceFromJobService()` | `storage.createInvoiceFromJob()` |
| Refresh lines | Inside service tx | `storage.refreshInvoiceFromJob()` |
| Resolve tax group | Inside service tx | **MISSING** |
| Batch apply tax | Inside service tx | **MISSING** |
| Tax snapshots | Inside service tx | **MISSING** |

### Fix
Replaced the 2-step inline call with `createInvoiceFromJobService(companyId, jobId, opts, "JOB_CLOSE_ROUTE")`. The canonical service handles all 5 steps with proper transaction atomicity.

### After Fix
Both paths now produce structurally identical invoices:
- Lines populated from job parts + labor entries
- Default tax group resolved and applied (single batched UPDATE)
- Tax component snapshots created
- All within service transaction boundary

### Not Changed
- Close-job lifecycle logic (orchestrator call unchanged)
- Response shape (still returns `{ job, invoice, autoCompletedVisitCount }`)
- Visit bulk-completion behavior
- Standalone invoice creation
- PM billing

---

## 2026-03-19: Invoice Create-From-Job Retry Safety

### Problem
If Phase A (invoice row creation) commits but Phase B (line population + tax) fails and rolls back, retrying the creation endpoint returns the existing $0 draft invoice with `created: false`, skipping enrichment entirely. The invoice remains permanently empty.

Additionally, `invoice_tax_lines` has no unique constraint, so if enrichment were somehow re-run (e.g., via manual refresh endpoint), tax snapshots would duplicate.

### Fix
| Change | Detail |
|---|---|
| Retry-aware guard | When `created=false` AND invoice is `status="draft"` with 0 lines, fall through to Phase B enrichment instead of returning early |
| Idempotent tax snapshots | Added `DELETE FROM invoice_tax_lines WHERE invoiceId = ?` before INSERT in the enrichment transaction |

### Verification: 7 Focus Questions

1. **Phase-A-only state:** Invoice with `status="draft"`, `subtotal="0"`, `total="0"`, 0 lines. Visible in invoice list as "Draft, $0". Now recoverable via retry.
2. **Visible in feeds?** Yes — draft invoices appear in invoice list (intentional). Correctly excluded from dashboard counts, AR reports, overdue calculations.
3. **Retry idempotent?** Yes — `refreshInvoiceFromJob` uses delete-then-insert, `batchApplyLineTax` uses absolute SET, tax snapshots now use delete-then-insert.
4. **Duplicate lines on retry?** No — refresh deletes all `source="job"` lines before inserting.
5. **Duplicate tax snapshots?** No — delete-before-insert added.
6. **Standalone invoices affected?** No — none of the modified code paths are reached by non-job invoice creation.
7. **PM invoice tracking?** Unaffected — uses `createInvoiceFromBillingEvent`, not `createInvoiceFromJob`.

### Not Changed
- Phase A locking/idempotency (`SELECT FOR UPDATE`)
- Standalone invoice creation
- PM billing service
- Batched tax application semantics
- Invoice feed/list/dashboard queries

---

## 2026-03-19: Invoice Create-From-Job Full Transaction Atomicity

### Problem
The service's `db.transaction()` opened a transaction but 4 of 5 steps escaped it by calling storage methods that used the global `db` handle independently.

| Step | Before | Transaction? |
|---|---|---|
| 1. `storage.createInvoiceFromJob()` | Own `db.transaction()` with SELECT FOR UPDATE | Committed independently |
| 2. `storage.refreshInvoiceFromJob()` | Own `db.transaction()` | Committed independently |
| 3. `storage.updateInvoice()` | Global `db` (no tx) | Auto-committed |
| 4. `storage.batchApplyLineTax()` | Own `db.transaction()` | Committed independently |
| 5. `tx.insert(invoiceTaxLines)` | Outer service tx | Inside outer tx |

### Fix
Added optional `txHandle` parameter to 3 storage methods (`refreshInvoiceFromJob`, `updateInvoice`, `batchApplyLineTax`). When provided, methods use the caller's handle instead of creating their own transaction. Service now passes `tx` to all calls.

| Step | After | Transaction? |
|---|---|---|
| 1. `storage.createInvoiceFromJob()` | Own tx (SELECT FOR UPDATE + commit) | **Intentionally independent** — must commit before lines are populated |
| 2. `storage.refreshInvoiceFromJob(…, tx)` | Caller's `tx` | **Inside outer tx** |
| 3. `storage.updateInvoice(…, tx)` | Caller's `tx` | **Inside outer tx** |
| 4. `storage.batchApplyLineTax(…, tx)` | Caller's `tx` | **Inside outer tx** |
| 5. `tx.insert(invoiceTaxLines)` | Caller's `tx` | **Inside outer tx** |

### Design Decision: Step 1 remains independent
`createInvoiceFromJob()` must commit its own transaction so the invoice row and counter increment are durable before line population begins. The SELECT FOR UPDATE lock prevents concurrent creation. If steps 2–5 fail and roll back, the invoice exists but has no lines — callers can retry or the user can refresh.

### Not Changed
- `createInvoiceFromJob()` internal locking
- Batched tax application (`batchApplyLineTax` — single UPDATE, not per-line)
- Non-job invoice creation flows (no `txHandle` passed, standalone behavior preserved)
- `updateInvoice()` behavior when called without `txHandle` (all existing callers unchanged)

---

## 2026-03-19: Invoice Authority Hardening — Service Extraction + Due Date Dedup

### Problem (F-05)
`POST /api/invoices/from-job/:jobId` owned a 5-step multi-step mutation inline: create invoice → refresh lines → resolve tax group → batch apply tax → insert tax snapshots. The final step was a direct `db.insert(invoiceTaxLines)` in the route. No transaction boundary.

### Problem (F-06)
Due date calculation (`issuedAt + paymentTermsDays * 86400000`) was duplicated in 3 handlers: PATCH, send, and re-send.

### Fix
| Layer | Change |
|---|---|
| `server/services/invoiceCreationService.ts` (new) | Canonical `createInvoiceFromJob()` encapsulating full 5-step workflow. Steps 2–5 run inside `db.transaction()`. Exports `calculateDueDate()` shared helper. |
| `server/routes/invoices.ts` | Route calls service. Removed `taxRepository`, `invoiceTaxLines`, `db` imports. 3 inline due date calculations replaced with `calculateDueDate()`. |

### Transaction Boundary
| Step | Transaction? |
|---|---|
| Step 1: `storage.createInvoiceFromJob()` | Own internal SELECT FOR UPDATE tx |
| Step 2: `storage.refreshInvoiceFromJob()` | Inside outer `db.transaction()` |
| Step 3: `taxRepository.getDefaultTaxGroup()` | Inside outer tx (read) |
| Step 4: `storage.batchApplyLineTax()` | Inside outer tx (inner SAVEPOINT) |
| Step 5: `tx.insert(invoiceTaxLines)` | Inside outer tx |

### Not Changed
- `batchApplyLineTax()` batch semantics (single UPDATE + one recalculation)
- Invoice creation guard / idempotency / locking
- Response shape
- MARK_INVOICED lifecycle call (remains in route — separate from creation)
- Event logging (remains in route)
- `routes/jobs.ts` close+invoice path (separate caller, can adopt service later)

---

## 2026-03-19: Visit Completion Transaction Boundary

### Problem
`completeVisit()` performed 5+ independent database statements against the global `db` handle with no wrapping transaction. If the job note insert failed after the visit was marked completed, the note was lost. If reconciliation failed after the visit update, the job state could be inconsistent.

| Write | Transaction? |
|---|---|
| `db.update(jobVisits)` — visit terminal update | **NO** |
| `db.insert(jobNotes)` — auto job note | **NO** |
| Reconciliation → `transitionJobStatus()` | Own internal tx |
| Reconciliation → `updateJobStatusWithEvent()` | Own internal tx |
| `syncJobToVisits()` — schedule denorm | **NO** |

### Fix
Wrapped steps 2–3 (visit update, job note, reconciliation) in a single `db.transaction()`. Inner repository calls become SAVEPOINTs inside the outer transaction.

| Write | After Fix |
|---|---|
| Visit terminal update | **Inside outer tx** (uses `tx.update`) |
| Auto job note | **Inside outer tx** (uses `tx.insert`) |
| Reconciliation | **Inside outer tx** (inner txs become SAVEPOINTs) |
| Schedule sync | **Intentionally outside** — denormalization reads committed state |

### Design Decisions
- **Read outside tx:** The initial visit load (`getJobVisit`) stays outside the transaction. It's a read-only guard; the version check inside the update prevents stale writes.
- **Schedule sync outside tx:** `syncJobToVisits()` needs to read the committed visit state to compute the next schedule. Holding a transaction open during this query would extend lock duration unnecessarily. It already handles concurrent state correctly.
- **SAVEPOINT nesting:** Drizzle ORM on Neon/Postgres supports nested `db.transaction()` calls as SAVEPOINTs. The inner repository transactions continue to work correctly.

### Not Changed
- Visit completion semantics
- Reconciliation rules
- Schedule sync logic
- Response shape
- Any other function in the orchestrator

---

## 2026-03-19: Visit Completion Atomicity Hardening

### Problem
After `lifecycle.completeVisit()` returned, `techField.ts` performed 2 additional direct domain writes: (1) `db.update(jobVisits)` to append outcome text to `visitNotes`, (2) `db.insert(jobNotes)` to auto-create a job note documenting the outcome. These bypassed the orchestrator, had no version increment or audit event, and could race with concurrent writes.

### Fix
| Layer | Change |
|---|---|
| `jobLifecycleOrchestrator.ts` | Extended `CompleteVisitIntent` with `outcomeNote?: string` and `visitNumber?: number`. `completeVisit()` now appends outcome to `visitNotes` in the same update that writes terminal fields, and inserts a job note if `outcomeNote` is provided — both before reconciliation. |
| `server/routes/techField.ts` | Removed direct `db.update(jobVisits)` and `db.insert(jobNotes)`. Route passes `outcomeNote` and `visitNumber` through the intent. Removed unused `jobVisits` table import. |

### Proof of Single Owner
After this change, the `POST /api/tech/visits/:visitId/complete` route performs:
1. Validation + auth (thin controller)
2. `lifecycle.completeVisit()` — **all domain writes** (visit status, visitNotes, job note, reconciliation, schedule sync)
3. `timeTrackingRepository.recordJobStatus()` — separate domain, non-fatal side effect
4. Response

Zero direct `db.update(jobVisits)` or `db.insert(jobNotes)` remain in the route.

### Not Changed
- Visit completion semantics (same fields, same note text, same behavior)
- Reconciliation logic
- Time tracking side-effect (correctly remains in route as cross-domain)
- Other routes or endpoints
- Response shape

---

## 2026-03-19: Lifecycle Authority Hardening — Single Owner

### Problem
`server/statusRules.ts` competed with `server/domain/jobLifecycle.ts` for lifecycle authority. Both files exported lifecycle constants, transition validators, and helper functions. Routes imported from both, creating split authority. Two imports in `routes/jobs.ts` referenced deleted aliases (`CLOSEABLE_STATES`, `REOPENABLE_STATES`), causing TS2724 errors.

### Fix
| Action | Detail |
|---|---|
| Moved into `jobLifecycle.ts` | 6 job constants, 1 invoice flow map, 3 assertion functions |
| Updated import sites | `routes/jobs.ts`, `routes/invoices.ts`, `domain/scheduling.ts`, 2 sanity-check scripts |
| Deleted broken imports | `CLOSEABLE_STATES` (jobs.ts:623), `REOPENABLE_STATES` (jobs.ts:757) |
| Fixed duplicate type import | `scheduling.ts` had duplicate `import type { JobStatus }` |
| Deleted file | `server/statusRules.ts` |

### Proof of Single Authority
After this change, ALL lifecycle concerns route through `server/domain/jobLifecycle.ts`:
- Flow maps: `JOB_STATUS_FLOW`, `OPEN_SUB_STATUS_FLOW`, `INVOICE_STATUS_FLOW`
- Constants: `JOB_TERMINAL_STATUSES`, `CLOSEABLE_STATUSES`, `REOPENABLE_STATUSES`, `ACTIVE_STATUSES`
- Assertions: `assertJobStatusTransition`, `assertOpenSubStatusTransition`, `assertInvoiceStatusTransition`
- Engine: `applyLifecycleTransition()` (unchanged)
- RBAC: `assertLifecyclePermission()` (unchanged)

Zero imports of `statusRules` remain in the codebase.

### Not Changed
- `applyLifecycleTransition()` engine logic
- `jobLifecycleOrchestrator.ts` orchestration
- `transitionJobStatus()` storage writer
- Any lifecycle behavior or transition rules
- Invoice, visit, or UI code

---

## 2026-03-19: Dead Client Code Deletion Pass

### Problem
Forensic audit identified 15 client-side files with zero imports / zero route registrations. These files totaled ~5,000+ lines of dead UI code that created search noise and risked stale patterns being copy-pasted into new features.

### Action
Verified zero imports for all 15 candidates via codebase-wide grep, then deleted:

| Category | Files Deleted | Total Lines |
|---|---|---|
| Components | JobDetailDialog (1,131), ClientReportDialog (533), JobVisitsSection (571), LocationPMSection (532), RouteOptimizationDialog (353), PartsDialog (167), TechnicianLayout (68) | ~3,355 |
| Hooks | useCompanyRegionalSettings (85), useDispatchStream (128) | ~213 |
| Lib | dndPerformance (175), csrf (44), schedulingPermissions (34) | ~253 |
| Preview/Mock | PreviewOperationsQueue + 2 mock data files | ~1,000 |

Also removed 2 dead `QUERY_GROUPS` entries (`/api/calendar/all`, `/api/calendar/overdue`) from `useMutationWithToast.ts` — confirmed no matching server endpoints.

### Not Changed
- No server files modified
- No route registrations changed (App.tsx untouched)
- No import/index cleanup needed (all deleted files had zero consumers)
- No client behavior changes

### Verification
- Codebase-wide grep confirms zero remaining references to any deleted file
- TypeScript typecheck: same 7 pre-existing errors, zero new errors
- `/api/calendar/unscheduled` retained (verified active server endpoint)

---

## 2026-03-19: P3-05 — Jobs True Counts via includeCounts=true

### Problem
Jobs page derived filter-badge counts from the capped feed dataset (max 1000 rows). Once a company exceeded 1000 active jobs, the "All", "Open", "Completed", etc. badges showed truncated numbers. No mechanism existed to get true counts without fetching all rows.

### Fix
| Layer | Change |
|---|---|
| `server/storage/jobsFeed.ts` | Added `getJobCounts(ctx)` — single `COUNT(*) FILTER` aggregate query using canonical `activeJobFilter()`. Returns 4 lifecycle counts + 3 openSubStatus counts + total. No joins. |
| `server/routes/jobs.ts` | Parse `includeCounts=true` query param. When set, run `getJobsFeed()` and `getJobCounts()` in `Promise.all()`, merge `counts` into response. When absent, existing behavior unchanged. |
| `client/src/hooks/useJobsFeed.ts` | Added `includeCounts` to `JobFeedParams`, `buildJobsFeedUrl()`, `buildJobsFeedKey()`. Extended `JobsFeedResponse` with optional `counts`. Hook now returns `counts` alongside `jobs`. |
| `client/src/pages/Jobs.tsx` | Passes `includeCounts: true` in feed params. Replaced client-side `counts` useMemo (iterating enriched jobs) with server `counts` from response. "All" = `counts.total - counts.lifecycle.archived`. |

### Cache Safety
`includeCounts` is included in both the URL (`&includeCounts=true`) and the TanStack Query key array (12th position). Feed-only consumers (LocationDetailPage, ClientDetailPage) and feed+counts consumers (Jobs page) use different cache entries.

### Not Changed
- `getJobsFeed()` query logic, capping, or response shape
- History search mode
- `enrichedJobs` computation (overdue/backlog/scheduled flags — still needed for row display)
- `filteredAndSortedJobs` local filtering/sorting
- `JobFeedItem` / `JobHeaderDetail` types
- Sort behavior
- Other useJobsFeed consumers

---

## 2026-03-19: Universal Search — Legacy Short Job Number Matching

### Problem
Universal search numeric job-number branch for `< 6 digits` used range-based prefix matching to map inputs onto 6-digit job numbers (e.g., "1070" → `[107000, 107100)`). This correctly found modern 6-digit jobs but missed legacy short job numbers: "7002" computed range `[700200, 700300)`, which excludes literal `job_number = 7002`.

### Fix
Added `OR j.job_number = $parsedJobNum` to the existing range predicate in the `< 6 digits` branch. The SQL now matches both the 6-digit prefix range AND the exact literal integer.

| Input | Range Match | Literal Match | Combined |
|---|---|---|---|
| "7002" | `[700200, 700300)` — misses #7002 | `job_number = 7002` — hits | #7002 + any 7002xx jobs |
| "1070" | `[107000, 107100)` — hits #107000 etc. | `job_number = 1070` — hits if exists | #1070 + #107000 series |
| "107000" | N/A (takes `>= 6` branch) | N/A | exact match — unchanged |

### Not Changed
- `isNumericQuery()` gating (2–6 digits)
- `>= 6 digits` exact-match branch
- Invoice, customer, location, supplier, contact queries
- Job summary search (Query 7)
- `JOB_ACTIVE_SQL_J` filter
- Ranking logic
- Result caps / limits
- Route handler

---

## 2026-03-19: Hybrid Jobs Search — History Mode

### Problem
Jobs page fetched a capped 1000-row working set and filtered/searched locally. Users searching for historical or archived jobs beyond the cap would see no results with no way to search further. Server-side search already existed in `getJobsFeed()` but was not exposed to the Jobs page.

### Fix
| Layer | Change |
|---|---|
| `server/storage/jobsFeed.ts` | Added `ilike(clients.address, term)` and `ilike(clients.city, term)` to search `or()` clause — aligns server search with client-side fields |
| `server/routes/jobs.ts` | Parse `searchMode=history` param; when present: require search term (400 if missing), skip 1000-row override, honor client limit (default 50), search all statuses |
| `client/src/hooks/useJobsFeed.ts` | Added `searchMode?: "history"` to `JobFeedParams`; wired into URL builder and query key |
| `client/src/pages/Jobs.tsx` | Added `isHistoryMode` state, debounced history query, second `useJobsFeed` call for history mode, footer CTA, history results view replacing local list, "Back to recent jobs" exit |

### Not Changed
- Default 1000-row capped feed behavior
- Local filtering and search logic
- Tab counts
- `JobFeedItem` response shape
- Universal search
- `getJobsFeed()` query logic (beyond 2 added ILIKE fields)

---

## 2026-03-19: P3-04 — Remove Redundant Job Re-Query in Invoice Validation

### Problem
`createInvoiceFromJob()` fetches the job at line 1277 (`jobPreCheck`), then calls `validateJobForInvoice()` which fetches the identical job again at line 762 — same `jobId`, `companyId`, `activeJobFilter()`, `SELECT *`. No writes occur between the two reads.

### Fix
Added optional `preloadedJob` parameter to `validateJobForInvoice()`. When provided, the internal fetch is skipped via nullish coalescing: `const job = preloadedJob ?? (await db.select()...)[0]`. `createInvoiceFromJob()` passes `jobPreCheck` at the call site.

### Not Changed
- Validation rules, error messages, `InvoiceValidationResult` shape
- 3 sub-queries inside validator (jobParts, laborEntries, timeEntries)
- `skipValidation` path, transaction behavior, lock ordering
- No other callers (method is private, single call site confirmed)

---

## 2026-03-19: P3-03 — Invoice Detail Query Parallelization

### Problem
`GET /api/invoices/:id/details` ran 5 queries sequentially: getInvoice → getInvoiceLines → getClient → getCustomerCompany → getJob. Queries 2 (lines), 3 (client), and 5 (job) only depend on data from query 1 (invoice), not on each other.

### Fix
| Phase | Queries | Execution |
|---|---|---|
| Phase 1 | `getInvoice()` | Sequential (required for 404 guard + extracting locationId, jobId) |
| Phase 2 | `getInvoiceLines()`, `getClient()`, `getJob()` | `Promise.all()` — all three depend only on Phase 1 results |
| Phase 3 | `getCustomerCompany()` | Sequential (needs `location.parentCompanyId` from Phase 2) |

### Not Changed
- Storage function contracts (no modifications to getInvoice, getInvoiceLines, etc.)
- Response shape (`{ invoice, lines, location, customerCompany, job, billingAddress, serviceAddress, primaryContact }`)
- 404 guard (invoice not found), 400 guard (location not found)
- Conditional getJob (only if `invoice.jobId` truthy)
- Conditional getCustomerCompany (only if customerCompanyId resolves)
- Redundant getInvoice() inside getInvoiceLines() — left intentionally (separate optimization)

---

## 2026-03-19: P3-02 — Labor Invoice Line Batch INSERT + Excluded Entry Batch UPDATE

### Problem
`addLaborLinesFromTimeEntries()` performed N per-group INSERTs into `invoice_lines` (each with RETURNING), then M per-entry UPDATEs for included time entries, then K per-entry UPDATEs for excluded entries. For a typical job (3 groups, 8 included, 2 excluded): 13 write queries.

### Fix
| Phase | Before | After |
|---|---|---|
| Invoice line creation | N per-group INSERTs | 1 batch INSERT with RETURNING { id, lineNumber } |
| Included entry UPDATEs | M per-entry UPDATEs | M per-entry UPDATEs (unchanged — each has unique snapshot values) |
| Excluded entry UPDATEs | K per-entry UPDATEs | 1 batch UPDATE with `WHERE id IN (...)` |

`invoiceLineId` back-reference mapping preserved via `groupsByLineNumber` Map: each group is assigned a `lineNumber` before INSERT, then the RETURNING rows are keyed by `lineNumber` to recover the generated UUID.

### Not Changed
- Labor grouping logic (tech+type key)
- Invoice line values (description, quantity, unitPrice, etc.)
- Per-entry `billedMinutesSnapshot` / `billedRateSnapshot` semantics
- Phase 9 locking fields (`lockedAt`, `lockedByInvoiceId`, `lockReason`)
- `billingRulesHash` on all entries
- Transaction boundary (function runs inside caller's `tx`)
- Return value (`allLineValues.length` — count of created lines)

---

## 2026-03-19: P3-01 — Financial Dashboard Query Parallelization

### Problem
`getFinancialSummary()` executed 4 revenue queries in parallel, then 6 stats queries sequentially (trend, AR, past-due, sent-this-month, quotes, PM). All 10 queries are independent reads using only local constants (`companyId`, `UNPAID`, date ranges) — no inter-query data dependencies.

### Fix
Merged all 10 queries into a single `Promise.all()`. Post-query derivation logic (AR totals, quote conversion rate, etc.) unchanged — runs after all results resolve.

### Not Changed
- Query SQL, filters, grouping, aggregation semantics
- `FinancialSummary` response shape and field names
- `UNPAID` statuses constant
- Date window calculations
- Post-query derivation formulas
- Dashboard route handler

### Note
Concurrent dispatch via `Promise.all` — actual DB-level parallelism depends on the connection pool backing the `db` handle.

---

## 2026-03-19: PERF-08 — Dispatch Render Efficiency

### Problem
During drag operations, `setDragTick(t => t + 1)` fires on every pointer move (~60Hz), re-rendering `DispatchPreview` → `DispatchTimeline` → ALL `DispatchLaneRow` instances → ALL `DispatchVisitBlock` instances. Only the active drop-target lane needs re-rendering; all other lanes receive identical props.

### Fix
| File | Change |
|---|---|
| `DispatchTimeline.tsx` | Replaced `visitsByTech.get(t.id) \|\| []` / `tasksByTech?.get(t.id) \|\| []` with stable module-level `EMPTY_VISITS` / `EMPTY_TASKS` constants via `??`. Prevents new array references for empty lanes on every render. |
| `DispatchLaneRow.tsx` | Wrapped component export in `React.memo()` (default shallow comparison). Non-active lanes now skip re-rendering during drag because their props are referentially stable. |

### Not Changed
- `DispatchVisitBlock` — not memoized (unnecessary when parent lane is memoized)
- `DispatchTimeline` — not memoized (single instance, always receives changed props during drag)
- DnD behavior, drag preview, overlap detection, auto-scroll, resize, click scheduling, mutations, queries

### Impact
With N technician lanes, drag re-renders drop from N lanes × M visits per pointer move to ~1 lane.

---

## 2026-03-19: PERF-02 — Jobs Feed Payload Trimming (Option B)

### Problem
`getJobsFeed()` returned 11 fields in every feed row that no list consumer (Jobs.tsx, LocationDetailPage, ClientDetailPage) uses. Prior partial work trimmed `feedSelectFields` but left `mapFeedRow()` and `JobFeedItem` still emitting/declaring those fields — the payload was not actually reduced.

### Fix
| Layer | Change |
|---|---|
| `feedSelectFields` | Already trimmed (prior work) — no change |
| `detailSelectFields` | Already re-adds 11 fields (prior work) — no change |
| Server `JobFeedItem` type | Removed 11 fields |
| Server `mapFeedRow()` | Removed 11 field mappings |
| Server `JobHeaderDetail` type | Added 11 fields (no longer inherited from `JobFeedItem`) |
| Server `mapDetailRow()` | Added 11 field mappings |
| Client `JobFeedItem` type | Already optional (prior work) — no change |
| Client `JobHeaderDetail` type | Re-declared 11 fields as required |

### Fields Removed from Feed
`companyId`, `description`, `isActive`, `version`, `createdAt`, `updatedAt`, `holdReason`, `holdNotes`, `nextActionDate`, `invoiceId`, `closedAt`

### Consumer Verification
- **Jobs.tsx**: Uses none of the 11 fields. ✓
- **LocationDetailPage.tsx**: Uses none of the 11 fields. ✓
- **ClientDetailPage.tsx**: Imports useJobsFeed but does not call it. ✓
- **JobDetailPage.tsx**: Uses `useJobHeader` (detail endpoint) — all 11 fields still present. ✓

### Not Changed
- `getJobsFeed()` query logic, joins, WHERE, ORDER BY, limit
- `getJobHeader()` behavior
- Route handlers
- Client page logic, tab counts, filters, sorting

---

## 2026-03-19: Performance Pass 2

### Changes
1. **PERF-09**: `getNeedsAttentionJobs()` in `server/storage/dashboard.ts` — two independent queries wrapped in `Promise.all()`.
2. **PERF-01**: `universalSearch()` in `server/storage/search.ts` — queries 1-6 parallelized via `Promise.all()`. Query 7 remains sequential (depends on Query 2 result count).
3. **PERF-05**: `bulkCompleteVisitsInternal()` in `server/services/jobLifecycleOrchestrator.ts` — per-visit update loop wrapped in single `db.transaction()`. `syncJobToVisits()` unchanged.
4. **PERF-03**: `backgroundInvalidate()` in `useDispatchPreviewMutations.ts` — added optional `{ calendarOnly }` param. Used by `rescheduleVisit` and `resizeVisit` only. All other 10 callers unchanged.

### Rejected
- **PERF-07**: Job + visit creation already transactional (`jobs.ts:542`). No change needed.
- **PERF-04**: Global staleTime default already 5 minutes. No change needed.

---

## 2026-03-18: Centralize Inline Job Active Filters in Scheduling

### Problem
Three scheduling query methods in `server/storage/scheduling.ts` inlined `isNull(jobs.deletedAt), eq(jobs.isActive, true)` instead of using the canonical `activeJobFilter()` from `server/storage/jobFilters.ts`. Behavior was correct but fragile — any future change to the active-job rule would need to find and update these sites manually.

### Fix
| Method | Line(s) | Old | New |
|---|---|---|---|
| `getScheduledJobsInRange()` | ~299 | `j.deleted_at IS NULL AND j.is_active = true` (raw SQL) | `${sql.raw(JOB_ACTIVE_SQL_J)}` |
| `getUnscheduledJobs()` | ~533-534 | `isNull(jobs.deletedAt), eq(jobs.isActive, true)` | `activeJobFilter()` |
| `getJobById()` | ~762-763 | `isNull(jobs.deletedAt), eq(jobs.isActive, true)` | `activeJobFilter()` |

### Not Changed (Intentional)
Sanity-check queries (lines 1346-1469) use `isNull(jobs.deletedAt)` only (no `isActive` check). These are category D — intentionally broader scope for validation purposes.

---

## 2026-03-18: Visit Write SQL-Level Soft-Delete Guards

### Problem
Visit update methods (`updateJobVisit`, `updateJobVisitStatus`, `checkInJobVisit`) were protected by application-level prefetch via `getJobVisit()`, but the SQL UPDATE WHERE clauses did not themselves enforce `isActive = true AND archivedAt IS NULL`. A concurrent archive/inactivation between the prefetch read and the SQL write could allow mutation of an archived/inactive visit.

### Fix
Added canonical soft-delete guards (`eq(jobVisits.isActive, true)`, `isNull(jobVisits.archivedAt)`) to the SQL UPDATE WHERE clause in all three methods. The application-level prefetch guard was preserved (defense-in-depth, not replacement).

### Methods Hardened
| Method | File | Guard Added |
|---|---|---|
| `updateJobVisit()` | `server/storage/jobVisits.ts:673-678` | `isActive=true AND archivedAt IS NULL` in WHERE |
| `updateJobVisitStatus()` | `server/storage/jobVisits.ts:755-760` | `isActive=true AND archivedAt IS NULL` in WHERE |
| `checkInJobVisit()` | `server/storage/jobVisits.ts:794-799` | `isActive=true AND archivedAt IS NULL` in WHERE |

### Tests
9 behavioral tests in `tests/visit-write-softdelete-guard.test.ts`:
- Archived visits: update rejected for all 3 methods (3 tests)
- Inactive visits: update rejected for all 3 methods (3 tests)
- Active visits: update succeeds for all 3 methods (3 tests, positive control)

### Category Reclassification
Visit update methods moved from category B (application-level guard only) to category A (canonical SQL-level + application-level guard).

---

## 2026-03-18: Cross-System Soft-Delete Consistency Pass

### Audit Scope
Audited soft-delete semantics across jobs, job_visits, invoices, and cross-table joins.

### Runtime Contradictions Fixed (Category C)
1. **`scheduling.ts:getJobsNeedingFollowUp()`** — INNER JOIN to `job_visits` missing `archived_at IS NULL`. Archived visits could leak into follow-up list. Fixed by adding the predicate to the JOIN ON clause.
2. **`search.ts` invoice search** — No soft-delete filter on invoices in universal search. Fixed by adding `is_active = true AND deleted_at IS NULL`.

### Classified as Consistent (No Change)
- **Jobs**: `activeJobFilter()` used canonically in dashboard, attention rules. Inline equivalents in jobs.ts and scheduling.ts are correct (both checks present). Sanity-check queries intentionally use `deletedAt`-only for broader validation scope (category D).
- **Job visits**: `visitPredicates.ts` provides canonical predicates with `isActive + archivedAt`. All major query paths use canonical or inline-equivalent filters. Update methods use application-level `getJobVisit()` guard before SQL write (category B).
- **Invoices**: Already fully hardened in prior passes.

---

## 2026-03-18: Invoice DB Constraint + NULL isActive Cleanup

### Part A — DB Status Constraint
Added `invoices_status_check` CHECK constraint: `status IN ('draft', 'awaiting_payment', 'sent', 'partial_paid', 'paid', 'voided')`. Table was empty (zero rows) so no data conflict. All write paths already use canonical values.

### Part B — NULL isActive Compatibility Removed
10 sites across 3 files (`invoices.ts`, `invoicesFeed.ts`, `reports.ts`) changed from `or(eq(isActive, true), isNull(isActive))` to `eq(isActive, true)`. Live DB verified zero NULL isActive rows. The `2026_01_19_backfill_is_active.sql` migration had already set defaults.

### End State
- Invoice status vocabulary enforced at DB level (CHECK constraint)
- Invoice active filter is now canonical: `isActive = true AND deletedAt IS NULL`
- No NULL compatibility remains
- `sent` remains in the allowed set as a documented legacy value

---

## 2026-03-18: Invoice Overdue Predicate Alignment

### Problem
Three different overdue definitions existed:
- **Dashboard SQL:** `status IN ('awaiting_payment','sent','partial_paid')` — excludes draft
- **Server `computeIsPastDue()`:** included `"draft"` — contradicts dashboard
- **Client `getStatusBadge()`:** `status !== 'paid' && status !== 'voided'` — includes draft, contradicts dashboard

A draft invoice with past dueDate showed as "Past Due" on the invoices list but was NOT counted in the dashboard pastDueCount.

### Fix
- **Server:** Removed `"draft"` from `unpaidStatuses` in both `invoicesFeed.ts` and `invoices.ts` `computeIsPastDue()` methods. Now matches dashboard SQL exactly.
- **Client:** `getStatusBadge()` in `InvoicesListPage.tsx` now accepts server-computed `isPastDue` flag directly instead of recomputing with divergent logic.

### Canonical Rule
An invoice is overdue when ALL are true:
1. `status IN ('awaiting_payment', 'sent', 'partial_paid')` — payment-eligible
2. `balance > 0` — unpaid
3. `dueDate < today` — past due

---

## 2026-03-18: Invoice Status Contract Alignment

### Problem
`shared/schema.ts` defined `invoiceStatusEnum` as `["draft", "sent", "partial_paid", "paid", "voided"]` — missing `awaiting_payment`. The server writes `awaiting_payment` on send, the frontend reads it via string comparison, but the TypeScript type `InvoiceStatus` could not represent it. The PATCH endpoint's `updateInvoiceSchema` was hardcoded with the same outdated set.

### Fix
- Added `"awaiting_payment"` to `shared/schema.ts:invoiceStatusEnum` (now 6 values)
- Updated comment to document canonical lifecycle as `draft → awaiting_payment → partial_paid/paid`
- Replaced hardcoded `z.enum(["draft","sent",...])` in `routes/invoices.ts:updateInvoiceSchema` with `z.enum(invoiceStatusEnum)` reference
- `"sent"` preserved as explicit legacy value with documentation

### Also Fixed
- Added missing integration test proving invoice feed does not leak soft-deleted joined job data (identified as gap in prior pass's test coverage)

### Scope Boundary
- Invoice overdue predicate mismatch NOT fixed (tracked separately)
- No DB constraint added. No NULL isActive cleanup. No frontend behavior changes.

---

## 2026-03-18: Invoice Soft-Delete Integrity Fix

### Problem
Core invoice read methods (`getInvoices`, `getInvoice`, `getInvoiceByJobId`, `getInvoiceStats`) checked `isActive` but NOT `deletedAt IS NULL`. Soft-deleted invoices could be returned to users. `updateInvoice` had no soft-delete guard at all. Invoice feed LEFT JOIN to jobs had no active-job filter, leaking soft-deleted job data.

### Fix
- **Part A:** Added `isNull(invoices.deletedAt)` to all 4 read method WHERE clauses, matching `activeInvoiceFilter()` in `invoicesFeed.ts`.
- **Part B:** Added `or(eq(isActive, true), isNull(isActive)), isNull(deletedAt)` to both `updateInvoice` code paths.
- **Part C:** Changed invoicesFeed LEFT JOIN from `eq(invoices.jobId, jobs.id)` to `and(eq(invoices.jobId, jobs.id), isNull(jobs.deletedAt), eq(jobs.isActive, true))`.

### Scope Boundary
- NULL isActive compatibility preserved (legacy data may have NULL).
- No invoice status type changes. No overdue predicate changes. No frontend changes.

---

## 2026-03-18: Final Job Status Canonical Enforcement

### Part A — Compatibility Inputs Removed
The `statusUpdateSchema` in `server/routes/jobs.ts` previously accepted `in_progress` and `on_hold` as convenience aliases that mapped to `status=open + openSubStatus`. Grep verified zero first-party callers used these — all send canonical `{ status: "open", openSubStatus: "..." }` directly. Removed the aliases and associated normalization code.

### Part B — Duplicate DB Constraint Removed
Two identical CHECK constraints existed: `jobs_status_check` and `jobs_status_lifecycle_check`. Dropped `jobs_status_lifecycle_check` via migration. One canonical constraint remains.

### End State
- **Application layer:** only `open`, `completed`, `invoiced`, `archived` accepted as job status values
- **Database layer:** one CHECK constraint (`jobs_status_check`) enforces the same set
- **Zero legacy surfaces remain** in the job status vocabulary

---

## 2026-03-18: normalizeJobStatus() Removed

### Problem
`normalizeJobStatus()` mapped 10+ legacy status values to 4 canonical values. Live DB verification proved it was a guaranteed no-op: zero legacy rows exist, and a CHECK constraint (`jobs_status_check`) prevents any from being written.

### Evidence
- `SELECT status, COUNT(*) FROM jobs GROUP BY status` → only `archived` (714) and `open` (11)
- `SELECT COUNT(*) FROM jobs WHERE status NOT IN ('open','completed','invoiced','archived')` → 0
- `jobs_status_check` and `jobs_status_lifecycle_check` constraints confirmed via `pg_constraint`

### Fix
Deleted the function and all ~30 call sites. Each `normalizeJobStatus(x)` replaced with direct `x` or `x as JobStatus` assertion. No fallback logic added — the DB constraint is the source of truth.

### Scope Boundary
- Function removed. All imports cleaned. Zero remaining references in code.
- `deriveOpenSubStatus()` (adjacent function) left in place — still has legitimate consumers.

---

## 2026-03-18: Legacy Compatibility Cleanup

### Removed
1. **`jobVisits.service.ts`** — 109-line deprecated passthrough wrapper. Every function delegated to `jobVisitsRepository`. Two route consumers (`jobVisits.routes.ts`, `jobs.ts`) updated to import the repository directly.
2. **4 deprecated aliases** in `statusRules.ts`: `TERMINAL_STATUSES`, `CLOSEABLE_STATES`, `REOPENABLE_STATES`, `ACTIVE_STATES`. All consumers migrated to canonical names (`JOB_TERMINAL_STATUSES`, `CLOSEABLE_STATUSES`, `REOPENABLE_STATUSES`, `ACTIVE_STATUSES`).
3. **`legacyJobStatusEnum`** from `server/schemas.ts` (Zod enum, 14 values) and `shared/schema.ts` (const array, 10 legacy values). Zero consumers. Route validation narrowed to 6 accepted values.

### Narrowed
- **Job status update validation** (`server/routes/jobs.ts:statusUpdateSchema`): Narrowed from `legacyJobStatusEnum` (14 values including `assigned`, `unscheduled`, `requires_invoicing`, etc.) to 6 values: 4 canonical (`open`, `completed`, `invoiced`, `archived`) + 2 convenience aliases (`in_progress`, `on_hold` which map to `status=open` + `openSubStatus`). Existing normalization logic at lines 416-429 preserved for the 2 convenience aliases.

### Kept
- **`normalizeJobStatus()`** in `shared/schema.ts` — still handles any legacy DB values at runtime. This is the last line of defense for old data rows.

---

## 2026-03-18: Proof-Backed Safe Deletions

### Deleted
1. **`scheduleJobBypassWorkingHours()`** — `server/storage/scheduling.ts` (~105 lines). Zero callers verified via exhaustive grep. Dead bypass path that was never migrated to visit-centric scheduling.
2. **`updateJobStatusWithMultipleEvents()`** — `server/storage/jobs.ts` (~75 lines). Exported in `storage/index.ts` but zero callers. Close operations now use single-step `transitionJobStatus()` via the lifecycle engine.
3. **Duplicate `isTerminalStatus()`** — `server/domain/scheduling.ts` (4 lines). Identical to `server/domain/jobLifecycle.ts:162-166`. Deleted entirely. `scheduling.ts` now imports directly from `jobLifecycle.ts` for internal use. No re-export retained — grep confirmed zero external consumers importing this symbol from `scheduling.ts`.

### Verification
- All 74 hardening tests pass after deletions
- TypeScript compilation clean (zero new errors)
- Grep confirms no remaining callers for deleted functions

---

## 2026-03-18: Visit Status Display Label Centralization

### Problem
The same visit status `on_site` displayed as "On Site" on 6 surfaces (JobVisitsSection, JobDetailPage, TechHomePage, TechVisitDetailPage, TechSchedulePage) and "In Progress" on 3 surfaces (DispatchDetailPanel, EditVisitModal, dispatchPreviewUtils). 12 local `STATUS_LABELS` constants were maintained independently.

### Fix
Created `client/src/lib/visitStatusDisplay.ts` as canonical re-export wrapper around `dispatchPreviewUtils.ts`. Removed 6 local label maps and replaced with `visitStatusLabel()` imports. `TechSchedulePage` keeps a justified local override (`completed → "Done"` for compact mobile cards).

### Key Decisions
- `on_site → "In Progress"` is the canonical display label (dispatch preview already established this)
- Time entry type labels (`UnassignedTimePage`, `TimeAnalyticsPage`, `AddTimeEntryModal`, `EditTimeEntryModal`) use "On Site" correctly — different domain concept (time category, not visit workflow state)
- Component-specific color maps (dark mode variants, different palettes) kept local — only labels centralized

### Scope Boundary
- Display-only change. No backend/API status values changed.
- No visit predicate, effective-end, or dead code changes.

---

## 2026-03-18: Effective-End Computation Centralization

### Problem
`visitIntelligence.ts` computed effective end as `scheduledEnd ?? (scheduledStart + estimatedDurationMinutes)` with a hardcoded 60-minute default duration. The canonical computation in `isJobOverdue()` and `effectiveEndExpr` (SQL) uses a 3-tier priority: `scheduledEnd → scheduledStart + duration → scheduledStart`. The missing `scheduledStart`-only fallback meant a visit with no end time and no duration would get a fabricated 60-minute window in intelligence but be treated as point-in-time in overdue detection.

### Fix
Extracted `getEffectiveEnd()` in `shared/schema.ts` with the canonical 3-tier priority. Refactored `isJobOverdue()` to call it. Updated `visitIntelligence.ts` to call it instead of inline computation. Added documentation comment to `effectiveEndExpr` noting it is the SQL mirror.

### Scope Boundary
- Only JS-side computation centralized. SQL `effectiveEndExpr` unchanged.
- No visit predicate, label, or dead code changes.

---

## 2026-03-18: Visit Predicate Centralization

### Problem
Five consumer sites defined visit eligibility/actionability predicates inline, using three genuinely distinct business meanings that were not named or centralized. Future drift risk was high because changes to one predicate would not propagate to others.

### Fix
Created `server/lib/visitPredicates.ts` with three named predicate builders:
- `scheduleEligibleVisitFilter()` — requires `scheduledStart IS NOT NULL` (schedule sync)
- `reconciliationActionableVisitFilter()` — includes `scheduledStart OR checkedInAt` (auto-close gating)
- `uncompletedVisitFilter()` — all non-terminal regardless of scheduling (force-close)

Plus `TERMINAL_VISIT_STATUSES` constant (`["completed", "cancelled"]`).

### Consumers Updated
1. `jobVisits.ts:getCurrentEligibleVisit()` → `scheduleEligibleVisitFilter()`
2. `jobVisits.ts:syncJobScheduleFromVisits()` → `scheduleEligibleVisitFilter()`
3. `jobVisits.ts:getUncompletedVisits()` → `uncompletedVisitFilter()`
4. `orchestrator.ts:reconcileJobAfterVisitCompletion()` → `reconciliationActionableVisitFilter()`
5. `visitIntelligence.ts:fetchScheduledVisits()` → `TERMINAL_VISIT_STATUSES` (raw SQL, composed with date bounds)

### Scope Boundary
- Three predicates remain intentionally distinct — NOT collapsed into one.
- No effective-end centralization, label cleanup, or dead code deletion performed.

---

## 2026-03-18: BP-3/BP-4 — Tech-Field Visit Workflow Ownership Hardened

### Problem
`POST /api/tech/visits/:visitId/en-route` and `POST /api/tech/visits/:visitId/start` in `techField.ts` performed direct `db.update(jobVisits)` in route handlers. Validation, mutation, and schedule sync were all route-owned rather than centralized in the orchestrator.

### Fix
Created two new orchestrator methods in `jobLifecycleOrchestrator.ts`:
- `setVisitEnRoute()` — loads visit, validates non-terminal state, writes `status: "en_route"`, increments version, syncs job schedule.
- `startVisit()` — loads visit, validates non-terminal state, writes `status: "in_progress"` + `checkedInAt` (preserved if already set), increments version, syncs job schedule.

Routes now delegate to these methods and retain only: assignment auth, request parsing, and time-tracking side effects.

### Scope Boundary
- Only the two tech-field route handlers were changed.
- No visit predicate centralization performed.
- No label cleanup or dead code deletion.
- BP-1/BP-2 unchanged and all 11 existing tests still pass.

---

## 2026-03-18: BP-2 — Reconciliation Non-Terminal Version/Audit Bypasses Eliminated

### Problem
Rules 2, 3, 4 in `reconcileJobAfterVisitCompletion()` wrote workflow fields (`openSubStatus`, `holdReason`, etc.) directly via `db.update(jobs)` without incrementing `jobs.version` or creating audit events. This meant non-terminal reconciliation writes were invisible to optimistic locking and the status timeline.

### Inspection Result
`updateJobStatusWithEvent()` already supports same-status events (`open→open`). Four existing orchestrator methods (`placeJobOnHold`, `resumeJob`, `updateHoldMetadata`, `setJobSubstatus`) use this pattern. The `JobStatusTimeline` frontend component renders them correctly via `meta.action` and `note` fields. No downstream consumer assumes `fromStatus !== toStatus`.

### Fix
Replaced 3 direct `db.update(jobs)` calls with `jobRepository.updateJobStatusWithEvent()`:
- **Rule 2** (`reconcile_hold`): Last visit needs follow-up → place on hold
- **Rule 3** (`reconcile_hold_partial`): Visit needs follow-up, other visits remain → place on hold
- **Rule 4** (`reconcile_resume`): Subsequent visit completed → clear hold

### Scope Boundary
- Only Rules 2/3/4 changed. Rule 1 (BP-1) unchanged.
- No new helpers introduced — reused existing `updateJobStatusWithEvent()`.
- No BP-3/BP-4 or other work performed.

---

## 2026-03-18: BP-1 — Reconciliation Terminal Status Bypass Eliminated

### Problem
`reconcileJobAfterVisitCompletion()` Rule 1 wrote `status: "completed"` directly via `db.update(jobs)`, bypassing the canonical lifecycle engine. This produced structurally different "completed" jobs compared to the office close flow — missing `previousStatus`, `closedBy`, schedule clearing, version increment, audit events, and PM billing status.

### Root Cause
The reconciliation function was written as a direct DB update before the canonical lifecycle engine existed. When the lifecycle engine was built, existing reconciliation logic was not rerouted through it.

### Fix
Replaced the direct `db.update(jobs).set({status:"completed",...})` with `jobRepository.transitionJobStatus(companyId, jobId, job.version, {type:"CLOSE_JOB", mode:"invoice_later"}, actor)`. The completing user's ID is passed as `closedBy` via a `{role:"system"}` actor.

### Changes
1. **`server/services/jobLifecycleOrchestrator.ts`**: Expanded `reconcileJobAfterVisitCompletion` signature to accept `completedByUserId`. Rule 1 now calls `transitionJobStatus()` instead of direct SQL. Added graceful race handling (retry once on version mismatch, no-op if already terminal).
2. **`server/domain/jobLifecycle.ts`**: Added `"system"` to `LIFECYCLE_ROLES` for orchestrator-initiated transitions.
3. **Tests**: 7 integration tests + 5 domain tests proving all 8 restored fields, race safety, and non-terminal regression.

### Scope Boundary
- Only Rule 1 (terminal `status: "completed"`) was fixed.
- Rules 2/3/4 (non-terminal hold/resume) remain as direct writes (BP-2, tracked separately).
- No other bypasses (BP-3/BP-4 techField) were touched.

---

## 2026-03-18: CLOSE_JOB(mode=invoice_now) Terminal Metadata Harmonization

### Problem
`CLOSE_JOB(mode=invoice_now)` in `applyCloseTransition()` set `status: "invoiced"` but omitted `previousStatus`, `closedAt`, and `closedBy`. The other two close modes (`archive`, `invoice_later`) and `MARK_INVOICED` all set these fields correctly.

### Root Cause
Accidental omission in the `invoice_now` case — the patch was missing three fields that all other terminal-transition paths include.

### Fix
Added three fields to the `invoice_now` case in `server/domain/jobLifecycle.ts`:
- `previousStatus: currentStatus`
- `closedAt: new Date()`
- `closedBy: actor.userId`

### Impact
- `UNDO_CLOSE` now works after `invoice_now` (previously would fail with `NO_CLOSE_DATA`)
- `REOPEN_JOB` can restore `previousStatus` correctly
- Audit trail is complete for all close modes

### Intentional Remaining Differences
| Field | CLOSE_JOB(invoice_now) | MARK_INVOICED |
|---|---|---|
| Audit action | `close_and_invoice` | `mark_invoiced` |
| Source states | `open` only | `open` or `completed` |
| Idempotency | No | Yes |

These differences are by design — they represent different business workflows.

---

## 2026-03-18: MARK_INVOICED Tests + Canonicalization Audit

### Tests Added (7)
1. `transitions open job to invoiced` — verifies status, invoiceId, previousStatus, closedAt, field clearing
2. `transitions completed job to invoiced` — verifies completed→invoiced with correct previousStatus
3. `idempotent for already-invoiced job` — verifies empty patch, zero audit events
4. `rejects archived job` — verifies LifecycleTransitionError with INVALID_STATE
5. `RBAC: technician cannot mark invoiced` — verifies FORBIDDEN error
6. `sets pmBillingStatus for PM jobs` — verifies pmBillingStatus="invoiced"
7. `domain transition produces correct patch with all fields` — full field-by-field verification including hold clearing

### Canonicalization Audit: CLOSE_JOB mode=invoice_now vs MARK_INVOICED

**Both paths share:** Same domain engine (`applyLifecycleTransition`), same field clearing (`getScheduleClearingPatch` + `getOpenSubStatusClearingPatch`), same target status (`invoiced`), same `invoiceId` patch, same `pmBillingStatus` handling.

**Differences (by design):**
| Aspect | CLOSE_JOB invoice_now | MARK_INVOICED |
|---|---|---|
| Allowed source | `open` only (via `canClose`) | `open` or `completed` |
| Bundled behavior | Visit bulk-completion + invoice creation | None (standalone transition) |
| Idempotency | No (throws if not closeable) | Yes (no-op if already invoiced) |
| Implementation | `applyCloseTransition` case | `applyMarkInvoicedTransition` |

**Conclusion:** NOT duplicate authority. Different intents for different business contexts that converge via the same canonical engine.

---

## 2026-03-18: Canonical MARK_INVOICED Lifecycle Intent

### Problem
No canonical lifecycle intent existed for transitioning a job to "invoiced" status. The standalone invoice route (`POST /api/invoices/from-job/:jobId`) created and linked invoices but could not mark the job as invoiced through the canonical orchestrator. Only the close-job route with `mode=invoice_now` could reach "invoiced" status.

### Changes
1. **Domain engine** (`jobLifecycle.ts`): Added `MARK_INVOICED` intent type and `applyMarkInvoicedTransition()`. Allowed source states: open, completed. Idempotent for already-invoiced. Rejects archived. Clears schedule/substatus fields, sets invoiceId/closedAt/closedBy, emits audit event.
2. **Orchestrator** (`jobLifecycleOrchestrator.ts`): Added `MarkInvoicedIntent`, `MarkInvoicedResult`, and `markInvoiced()` function delegating to `transitionJobStatus`.
3. **Invoice route** (`invoices.ts`): When `markJobCompleted=true` in the request body, the route now calls `lifecycle.markInvoiced()` after invoice creation. When false (default), invoice creation remains lifecycle-neutral.
4. **Storage comments** (`invoices.ts`): Cleaned stale doc comments that claimed `createInvoiceFromJob` handles status transition.
5. **Close-job route** unchanged — `FORCE_CLOSE_JOB` with `mode=invoice_now` is a separate intent with different semantics (bundle close+invoice) that converges to the same state via the same domain engine.

### Transition Rules
- Allowed: open → invoiced, completed → invoiced
- Idempotent: invoiced → invoiced (no-op)
- Forbidden: archived → invoiced (must reopen first)
- Required: invoiceId
- Clears: openSubStatus, holdReason, holdNotes, onHoldAt, nextActionDate, scheduledStart/End
- Sets: previousStatus, closedAt, closedBy, pmBillingStatus (if PM job)

---

## 2026-03-18: Script Utility needs_review Write-Path Cleanup

### Problem
`schedulingSanityCheck.ts` still mapped legacy `action_required` status to the dead `needs_review` substatus. If this repair script were run against the live database, it would reintroduce `needs_review` rows that the runtime no longer supports.

### Changes
- `server/scripts/schedulingSanityCheck.ts` line 53: JS mapping `action_required → needs_review` changed to `action_required → on_hold`
- `server/scripts/schedulingSanityCheck.ts` line 176: SQL CASE `WHEN 'action_required' THEN 'needs_review'` changed to `THEN 'on_hold'`

### Verification
Zero remaining script/admin write paths can produce `needs_review`. Only remaining references are historical event queries in `reports.ts` Part B (reading `jobStatusEvents` table — legitimate history, not a write path).

---

## 2026-03-18: Transitional Legacy Residue Cleanup

### Problem
After all remediation passes, transitional compatibility residue remained: `needs_review` display mapping in `jobUtils.ts`, `needs_review` in the TypeScript type enum, stale comments describing dead semantics as current, and a `status-pill.tsx` case for a state that no longer exists.

### Changes
- Removed `needs_review` from `openSubStatusEnum` TypeScript type in `shared/schema.ts` (zero live rows, type safely narrowed).
- Removed transitional `needs_review → "On Hold"` mapping from `jobUtils.ts` (both `SUB_STATUS_INFO` and `getJobStatusDisplay`).
- Removed `needs_review` case from `status-pill.tsx`.
- Cleaned stale comments in 7 files that still described `needs_review` as a supported state.
- Updated reports.ts Part A comment from "needs_review" to "on_hold".

### Proof
- Database: `SELECT count(*) FROM jobs WHERE open_sub_status = 'needs_review'` → 0
- All migrations applied and verified
- TypeScript compiles clean after type narrowing

---

## 2026-03-18: Drop Deprecated actionRequired* Columns

### Problem
4 deprecated columns (`action_required_reason`, `action_required_notes`, `action_required_at`, `action_required_escalated_at`) remained physically in the jobs table after all runtime reads/writes were removed. Data was already migrated to canonical hold fields.

### Changes
- Created `migrations/2026_03_18_drop_deprecated_action_required_columns.sql` — `ALTER TABLE jobs DROP COLUMN IF EXISTS` for all 4 columns.
- Removed column definitions from `shared/schema.ts`.
- Updated `scripts/check-schema-drift.ts` expected column list.
- Cleaned residual comments in `server/schemas.ts` and `server/routes/jobs.ts`.

### previousStatus Decision
NOT dropped. It is actively used by:
- `server/domain/jobLifecycle.ts` — CLOSE and UNDO_CLOSE transitions
- `shared/schema.ts` — DB CHECK constraint (`closedAt IS NULL OR previousStatus IS NOT NULL`)
- `server/storage/jobsFeed.ts` — selected in job feed
- `tests/job-lifecycle.test.ts` — test assertions

---

## 2026-03-18: needs_review Data Migration to on_hold

### Problem
Prior pass removed `needs_review` from live UI/filter/query surfaces but did not migrate the actual data rows. Legacy jobs with `openSubStatus='needs_review'` are now excluded from operational queues (`getActionRequiredJobs`, reports Part A) because those queries use `on_hold` only.

### Changes
- Created `migrations/2026_03_18_migrate_needs_review_to_on_hold.sql`
- Step 1: Sets `holdReason='other'` where still NULL (required by DB CHECK constraint)
- Step 2: Sets `onHoldAt=updated_at` where still NULL (needed for aging display)
- Step 3: Updates `openSubStatus` from `needs_review` to `on_hold` for all `status='open'` rows
- Only targets live open jobs. Terminal jobs cannot have `openSubStatus` set (enforced by DB constraint).

### Legacy Display Mapping
`jobUtils.ts` still contains a transitional mapping `needs_review → "On Hold"` for safety during rollout. After migration is confirmed applied to all environments, this mapping can be removed in a future pass.

---

## 2026-03-18: needs_review Ghost-Surface Removal

### Problem
`needs_review` was a ghost sub-status: present in filter tabs, display logic, and query predicates but not producible by any live code path. No orchestrator intent, no writable Zod schema value, no route writes it. It existed only in legacy DB rows migrated from `action_required`.

### Determination
`needs_review` is NOT a live produced state. Evidence: zero references in orchestrator, removed from writable Zod enum, removed from status transition rules.

### Changes
1. **Jobs.tsx**: Removed from filter type union, sub-status labels, URL param validation, count initialization, filter tab, and SLA display condition.
2. **JobDetailPage.tsx**: Removed from attention banner condition.
3. **jobUtils.ts**: Historical `needs_review` rows now display as "On Hold" (mapped to same icon/variant).
4. **status-pill.tsx**: Annotated as historical-only (already mapped to same variant as on_hold).
5. **jobs.ts storage**: `getActionRequiredJobs` simplified to query only `on_hold`.
6. **reports.ts**: Part A (current jobs) now queries `on_hold` instead of `needs_review`. Part B (historical events) unchanged.
7. **shared/schema.ts**: `needs_review` kept in TypeScript enum (DB rows exist) but annotated as HISTORICAL ONLY.

### Legacy Row Handling
Historical rows with `openSubStatus = 'needs_review'` display as "On Hold" in the UI via `jobUtils.ts` mapping. They are included in the on_hold attention queue via the backfill migration. The value remains in the TypeScript type for DB read compatibility.

---

## 2026-03-18: Legacy Hold/Action-Required Truth Consolidation

### Problem
Dual truth: canonical hold fields (`onHoldAt`, `holdReason`, `holdNotes`) coexisted with deprecated `actionRequired*` columns. Runtime code read both via fallback chains (`onHoldAt || actionRequiredAt`). After migration, the lifecycle orchestrator only writes canonical fields, making deprecated reads return stale data for new jobs.

### Changes
1. **Migration** (`2026_03_18_backfill_canonical_hold_fields.sql`): Backfills `on_hold_at`, `hold_reason`, `hold_notes` from deprecated columns for on_hold/needs_review jobs where canonical fields are NULL.
2. **Jobs.tsx**: Removed `|| actionRequiredAt` fallback. Removed `actionRequiredEscalatedAt` escalation display (no canonical replacement — hardcoded to false).
3. **reports.ts**: PART A (current jobs) migrated from deprecated to canonical hold columns. PART B (historical events) untouched — reads from `jobStatusEvents` table, not deprecated job columns.
4. **jobsFeed.ts**: Removed 4 deprecated fields from interfaces, SELECT columns, and row mappers.
5. **jobs.ts storage**: Removed deprecated fields from `getJob()` and `getActionRequiredJobs()` SELECT lists.
6. **useJobsFeed.ts**: Removed 4 deprecated fields from client type definitions.
7. **schemas.ts**: Removed `actionRequiredReason`/`actionRequiredNotes` from writable Zod schema.
8. **Physical columns NOT dropped** — remain in `shared/schema.ts` table definition for DB schema compatibility. No runtime reads remain.

### actionRequiredEscalatedAt resolution
No canonical replacement exists. Escalation tracking was removed from the UI. The column has no runtime readers after this batch.

---

## 2026-03-18: Correction Pass — Hardening Defect Fixes

### Problem
5 defects from the prior hardening pass: incorrect forceCloseJob in invoice route, incomplete dispatch mutation gating, partial effectiveEnd centralization, misleading backfill timestamp, incorrect try/catch lifecycle fallback.

### Changes
1. Removed `forceCloseJob()` + try/catch fallback from `server/routes/invoices.ts`. Invoice creation does not mutate lifecycle.
2. Added `visit.kind !== "visit"` guards to all 8 dispatch mutation handlers in `DispatchPreview.tsx`.
3. `server/storage/maintenance.ts` now imports `effectiveEndExpr` from `queryHelpers.ts` — zero inline duplicates remain.
4. Migration backfill uses `COALESCE(checked_out_at, updated_at)` — `created_at` removed as fallback.
5. Lifecycle import removed from `invoices.ts`.

---

## 2026-03-18: Foundation Lifecycle Rewrite — Surgical Hardening Pass

### Problem
Multiple lifecycle authority leaks, invalid completed visit states, import path violations, synthetic dispatch type corruption, dead mutation paths, and query truth drift identified by two-pass forensic audit.

### Changes (7 tasks executed in strict order)

**Task 1 — Invoice lifecycle authority removal:** Removed `status: "invoiced"` write from `createInvoiceFromJob()`. Invoice creation now only sets `invoiceId`. Callers (invoice route) explicitly invoke the orchestrator for the lifecycle transition.

**Task 2 — Spawn-on-action completion fix:** Both `scheduleJob()` and `rescheduleVisit()` spawn-on-action paths now write `outcome: "completed"`, `completedAt`, `isFollowUpNeeded: false` when completing old visits. Previously created structurally invalid completed visits.

**Task 3 — DB invariant hardening:** Created migration `2026_03_18_visit_completion_constraints.sql` with backfill + 4 CHECK constraints on `job_visits`: completion requires outcome, completion requires completedAt, outcome=completed contradicts isFollowUpNeeded=true, scheduledEnd requires scheduledStart. Removed Phase A auto-default in `updateJobVisitStatus`.

**Task 4 — Import lifecycle correction:** Removed `closedAt` and `previousStatus` writes from job import. Fixed collision check to use `activeJobFilter()` (soft-deleted numbers can be reused).

**Task 5 — Dispatch type boundary correction:** Added `kind: "visit" | "backlog"` discriminant to `DispatchVisit` type. Mappers set `kind` appropriately. Defense-in-depth comments on mutation functions.

**Task 6 — Dead code deletion:** Removed `validateScheduleSafe()`, `verifyConflictSemantics()`, Phase A auto-default, `escalateMutation`, `updateActionRequiredMutation`, `handleEscalate`, `TERMINAL_STATES` alias, and all associated UI triggers.

**Task 7 — Query standardization:** Centralized `effectiveEndExpr` SQL into `queryHelpers.ts`. Aligned dashboard unscheduled count with canonical `isBacklogEligible()` by removing `isAllDay` exclusion.

### Files Changed
- `server/storage/invoices.ts`, `server/routes/invoices.ts`
- `server/storage/scheduling.ts`
- `migrations/2026_03_18_visit_completion_constraints.sql` (new)
- `server/storage/jobVisits.ts`
- `server/services/jobImport.ts`, `server/routes/jobImport.ts`
- `client/src/components/dispatch/dispatchPreviewTypes.ts`
- `client/src/components/dispatch/dispatchPreviewMappers.ts`
- `client/src/components/dispatch/dispatchPreviewMockData.ts`
- `client/src/components/dispatch/useDispatchPreviewMutations.ts`
- `server/services/calendarValidation.ts`
- `client/src/pages/Jobs.tsx`
- `server/statusRules.ts`
- `server/lib/queryHelpers.ts`
- `server/storage/dashboard.ts`
- `server/lib/attentionRules.ts`
- `server/storage/jobsFeed.ts`

---

## 2026-03-17: Universal Search — Company Truncation Fix + Contact Search

### Problem
1. **Company results truncated**: Searching "Moxie's" showed only 6 company matches (hardcoded `perTypeLimit = 6`), hiding valid later matches like "Moxie's (Toronto)". The per-type SQL `LIMIT` and interleaved overall cap (`limit = 20`) combined to permanently suppress matches beyond position 6.
2. **Contacts not searchable**: `client_contacts` table was never queried by universal search. No `SearchResultType`, no SQL query, no frontend rendering.

### Root Cause Analysis
- **Company truncation**: Backend-only. `server/storage/search.ts:116` set `perTypeLimit = 6`. Each entity type query used `LIMIT $5` with this value. The round-robin interleaver then spread across types and `slice(0, 20)` capped the total. A type with many matches got at most 6 results regardless of match quality.
- **Contacts missing**: No SQL query section existed for contacts. The `SearchResultType` union did not include `"contact"`. No frontend maps (icons, labels, routes) had a contact entry.

### Pattern Chosen: Global Ranking (preferred)
Replaced per-type hard cap + round-robin interleaving with global ranking:
1. Each entity type query uses a **generous SQL safety-valve cap** (`PER_TYPE_SQL_CAP = 25`) — high enough that same-name matches are never hidden, low enough to prevent unbounded result sets.
2. All results are **globally ranked** by `matchRank(title, query)`: 0 = exact match, 1 = prefix, 2 = substring. Within the same rank, sorted alphabetically.
3. Top 30 results returned regardless of type distribution.
4. Frontend re-groups by type for sectioned display (unchanged).

This eliminates the fragile dependency on per-type limits for obvious same-name matches. A search for "Moxie's" now returns all 8 companies and all 8 locations (16 total, well within the 30-item cap).

### Changes
| File | Change |
|------|--------|
| `server/storage/search.ts` | Removed `perTypeLimit` parameter. Added `PER_TYPE_SQL_CAP = 25` constant. Replaced `interleaveResults()` with `rankResults()` (global ranking by match quality). Added `matchRank()` function (exact=0, prefix=1, contains=2). Added `_rank` field to `SearchResult` (stripped before response). Added `"contact"` to `SearchResultType`. Added contact search SQL query (section 6). Default `limit`: 20 → 30. |
| `server/routes/search.ts` | Route limit max: 50 → 60. Default: 20 → 30. |
| `client/src/components/UniversalSearch.tsx` | Added `"contact"` to `SearchResultType`, `TYPE_ORDER`, `TYPE_ICONS` (UserCircle), `TYPE_LABELS` ("Contacts"), `TYPE_ROUTES` (→ `/clients/:id`). Updated `executeItem` to use `customerCompanyId` for contact navigation. Frontend fetch limit: 20 → 30. |

### Limits Before vs After
| Parameter | Before | After |
|-----------|--------|-------|
| Per-type SQL LIMIT | 6 (hard cap, only control) | 25 (safety valve only) |
| Ranking strategy | Round-robin interleave (no quality ranking) | Global: exact > prefix > contains, then alpha |
| Overall result cap (backend default) | 20 | 30 |
| Route max (API ceiling) | 50 | 60 |
| Frontend fetch `&limit=` | 20 | 30 |
| Entity types searched | 5 | 6 (+contact) |

### Validated Against Real Data
| Query | Companies | Locations | Contacts | Toronto present? |
|-------|-----------|-----------|----------|------------------|
| "Moxie's" | 8/8 | 8/8 | 0 | YES (position 7) |
| "YRCC" | 1 | 1 | 0 | n/a |
| "Tony" | 0 | 0 | 2 | n/a |

### Decision Notes
- **Contact navigation**: Routes to parent company page (`/clients/:customerCompanyId`). No standalone contact detail route exists. Subtitle shows company name for context. Documented as temporary — when/if a contact detail page is built, update `TYPE_ROUTES.contact`.
- **Performance**: Each additional query is a simple indexed `ILIKE` with `LIMIT 25`. No meaningful latency impact.
- **Round-robin removed**: The old interleaver ensured type diversity but hid relevant same-type matches. Global ranking prioritizes match quality instead. The frontend groups results by type for display, so users still see organized sections.

---

## 2026-03-17: Products & Services — Duration UI + Import Dedup Upgrade (V2)

### Duration Field Surfacing
- `estimatedDurationMinutes` now fully supported in Products & Services UI
- Added to: Part interface, ProductFormData, defaultFormData, create/edit dialog, table column, inline edit, sort
- Stored as integer in DB, displayed as compact "1h 30m" format in table
- Form field: "Duration (minutes)" with integer input, nullable, helper text
- No migration needed — column already exists from V1

### SKU-First Import Dedup
- Import dedup priority changed: SKU match first (if present), then name+type fallback
- SKU normalization: `normalizeForMatch()` (trim + collapse whitespace + lowercase)
- Within-CSV dedup also checks SKU before name+type
- Execute-time dedup also uses SKU-first strategy
- No false matches: SKU match is exact (after normalization), type-agnostic

### Type vs Category Semantics (Documentation Only)
- **type** = system enum ("product" | "service") — discriminator, maps to QBO Item.Type
- **category** = user-defined free-text grouping (e.g. "Belts", "Filters") — internal only, never sent to QBO
- These are already cleanly separated — no code change needed

### QBO Compatibility Confirmation
- `estimatedDurationMinutes` is NOT in `mapLocalItemToQBO()` — confirmed internal-only
- `trackInventory` is NOT in `mapLocalItemToQBO()` — confirmed internal-only
- QBO sync code untouched — zero risk to existing sync

### Future Update/Upsert Mode (Design Note — Not Implemented)
- Import currently uses create-only mode (skip duplicates)
- Future upsert could be added via a `mode` parameter on preview/execute endpoints: `"create" | "upsert"`
- Safe-to-update fields: description, unitPrice, cost, isTaxable, isActive, estimatedDurationMinutes, trackInventory, sku, category
- Unsafe fields (require user confirmation): name, type (type is immutable in QBO after sync)
- Preview would show "create" / "update" / "skip" action badges
- Extension point: `executeRow()` already resolves existing item — add update path when match found and mode=upsert
- No scaffolding needed now — the current architecture accommodates this cleanly

### Files Changed
| File | Change |
|------|--------|
| `client/src/components/products-services/types.ts` | Added duration to Part, ProductFormData, SortField, defaultFormData + formatDuration helper |
| `client/src/components/products-services/ProductServiceFormDialog.tsx` | Added duration input field |
| `client/src/components/products-services/ProductsServicesTable.tsx` | Added duration column with inline edit |
| `client/src/hooks/useProductsServices.ts` | Duration in save handler, sort logic, inline edit parsing |
| `client/src/components/ProductsServicesManager.tsx` | Duration in edit form population |
| `server/services/productImport.ts` | SKU-first dedup in validate, within-CSV classify, and execute |

---

## 2026-03-17: Products & Services CSV Import

### Schema Extension
- Added `estimated_duration_minutes` (integer, nullable) and `track_inventory` (boolean, default false) to `items` table
- Migration: `migrations/2026_03_17_items_add_duration_inventory.sql`
- These fields are future-proofing — not yet used in line items, invoices, or job logic

### Import Architecture
- Followed existing Client/Job import pattern: shared types → service (parse/normalize/validate/execute) → route → UI wizard
- **Dedup strategy**: `normalizeForMatch(name) + type` within tenant, create-only (skip duplicates)
- **Type normalization**: product/service/material/part/labor/labour all mapped to product or service
- **Boolean coercion**: true/false/yes/no/1/0/active/inactive
- **Numeric coercion**: Strips currency symbols ($€£), commas, whitespace before parsing

### Files Created
| File | Purpose |
|------|---------|
| `shared/productImportTypes.ts` | Shared types, field defs, header aliases |
| `server/services/productImport.ts` | Parse, normalize, validate, dedup, execute |
| `server/routes/productImport.ts` | Preview + execute endpoints |
| `client/src/pages/ProductImportPage.tsx` | 5-step import wizard UI |
| `migrations/2026_03_17_items_add_duration_inventory.sql` | Add new columns |

### Files Modified
| File | Change |
|------|--------|
| `shared/schema.ts` | Added 2 columns to items table |
| `server/routes/items.ts` | Added new fields to create/update validation |
| `server/routes/index.ts` | Registered productImport router |
| `client/src/App.tsx` | Added /settings/import-products route |
| `client/src/components/SettingsShell.tsx` | Added nav item |

### Compatibility
- No existing behavior changed — all new fields have safe defaults
- `track_inventory` defaults false, `estimated_duration_minutes` is nullable
- Existing items CRUD, line items, invoices, QBO sync unaffected
- Import supports both products and services in a single CSV file

---

## 2026-03-07: Phase 3 — Legacy Contact Surface Cleanup + Server Guardrails + Workspace Audit

### Part A: Legacy Contact Surface Cleanup
All remaining client/location create/edit surfaces that exposed legacy single-contact fields without disclaimers have been aligned to the canonical Contacts-tab model:

| Surface | Fix Applied |
|---------|------------|
| AddClientDialog | "Contact Details" → "Primary Site Contact (Summary)" + helper text |
| EditClientDialog | Added summary disclaimer above contact fields |
| NewAddClientDialog | "Contact Information" → "Primary Site Contact (Summary)" + helper text |
| QuickAddClientModal | Labels → "Site Contact Phone/Email" + summary disclaimer |
| QuickCreateDrawer | "Primary Contact (optional)" → "Primary Site Contact (summary)" |

Previously aligned (Phase 2): AddClientWithCompanyDialog, LocationFormModal, ClientDetailPage inline add-location.

### Part B: Server-Side Contact Scope Guardrails
- **Full replace path**: Scope change (company↔location) now rejected with 400 error. Existing scope derived from DB record.
- **Simple update path**: `locationId`, `association`, `existingContactIds` stripped from payload before `updateContact()` call.
- **Location ownership validation**: `validateLocationOwnership()` helper confirms locationIds belong to the target customerCompany within the tenant. Called in both POST and PATCH (full replace) contact routes. Prevents cross-company contact association.
- No "move contact" flow introduced — scope immutability enforced.

### Part C: Client Workspace Data Integrity Audit
Systematic audit of ClientDetailPage completed. **No issues found:**
- Header metrics correctly derive from company-scoped data maps
- Location list signals correctly derive from per-location maps
- Client tabs use `companyId`/`clientId`; location tabs use `locationId`
- `LocationDetailPane` uses `key={selectedLoc.id}` for clean re-mount
- All React Query keys are correctly scoped and collision-safe
- Activity, contacts, equipment, tags, PM parts all have proper ID scoping

### Files Changed
- `client/src/components/AddClientDialog.tsx` — legacy label
- `client/src/components/EditClientDialog.tsx` — legacy label
- `client/src/components/NewAddClientDialog.tsx` — legacy label
- `client/src/components/QuickAddClientModal.tsx` — legacy label
- `client/src/components/QuickCreateDrawer.tsx` — legacy label
- `server/routes/customer-companies.ts` — scope guardrails

### Not Changed (Intentional)
- Supplier location dialogs (`AddLocationDialog.tsx`, `EditLocationDialog.tsx`) — different domain, out of scope for client contact architecture
- `NewClientPage.tsx` — already implements full contact model, legacy fields only used as API bootstrap
- No "move contact" flow — scope immutability enforced, not relocatable

---

## 2026-03-07: Contact Architecture Hardening — Phase 2

### Architectural Rules Established
1. Client-level contacts are the source of truth for company-wide contacts.
2. Location-level contacts are the source of truth for site-specific contacts.
3. Company-wide contacts are read-only from the location Contacts tab.
4. Contact scope is immutable during edit (derived from `contact.locationId`, not tab context).
5. Legacy `contactName`/`contactPhone`/`contactEmail` on `client_locations` are bootstrap/summary fields only.

### Changes
- `ContactScope` type (`"company" | "location"`) introduced for type-safe scope handling.
- `STANDARD_CONTACT_ROLES` constant: 9 standard roles with structured multi-select UI.
- `normalizeContact()` produces consistent shape for rendering: `{id, displayName, email, phone, roles, scope, locationId, isPrimary}`.
- `ContactFormDialog` scope hardened: edits derive scope from contact's `locationId`, not from active tab. Custom/legacy roles preserved via fallback text input.
- Company contacts rendered read-only in `LocContactsTab` with explicit helper text.
- Legacy single-contact fields in `LocationFormModal`, `AddClientWithCompanyDialog`, and inline add-location form labeled as "Primary site contact summary" with pointer to Contacts tab.
- QBO sync TODO seam added to `PATCH /api/customer-companies/:companyId`.

### Files Changed
- `client/src/pages/ClientDetailPage.tsx` — core contact hardening
- `client/src/components/LocationFormModal.tsx` — legacy field labeling
- `client/src/components/AddClientWithCompanyDialog.tsx` — legacy field labeling
- `server/routes/customer-companies.ts` — QBO sync seam

### Not Changed (Intentional)
- QBO sync not activated — seam only. See TODO comment in `customer-companies.ts`.
- Legacy single-contact fields not removed — backward compat for existing data and external sync.
- No "move contact" flow (re-scope from company to location or vice versa) — out of scope.

---

## 2026-03-06: Real-Time Dispatch Freshness — Phase 1

### Architecture Decision: SSE Over WebSocket
SSE chosen because dispatch freshness is unidirectional (server→client). All mutations already go through REST with CSRF protection. SSE uses existing session cookies automatically, auto-reconnects via `EventSource`, and works through all HTTP proxies. WebSocket adds bidirectional overhead for no current benefit.

### Architecture Decision: Emit from Mutations, Not from logEvent()
Freshness signals are emitted from successful mutation handlers, not from `logEventAsync()`. This ensures:
- Signals fire only after DB writes succeed (not on failed mutations)
- No coupling between the event log feature and the real-time feature
- No risk of signal without data change (logEvent failures are swallowed)

### Event Flow
```
Mutation handler (e.g., reschedule visit)
  ├─► DB write (calendarRepository.rescheduleVisit)
  ├─► logEventAsync() ──► INSERT into events table (fire-and-forget)
  ├─► emitDispatch(tenantId, signal) ──► in-process EventEmitter
  │     └─► All SSE connections for that tenant receive signal
  │           └─► Client: invalidateForSignal() → TanStack refetches
  └─► res.json() to calling client
        └─► Local TanStack invalidation (existing behavior, unchanged)
```

### Invalidation Mapping
| SSE Signal | Client Query Keys Invalidated |
|---|---|
| Any `scope: "calendar"` | `/api/calendar` (broad), `/api/calendar/unscheduled`, `/api/calendar/needs-follow-up`, `/api/activity/dispatch/*` |
| `entityType: "task"` | Above + `/api/tasks` |

### Mutation Sites Emitting Signals
| Route | Handler | Signal |
|---|---|---|
| `POST /api/calendar/schedule` | Schedule job | `calendar, job, jobId` |
| `PATCH /api/calendar/schedule/:jobId` | Reschedule job | `calendar, job, jobId` |
| `POST /api/calendar/unschedule/:jobId` | Unschedule job | `calendar, job, jobId` |
| `PATCH /api/calendar/visit/:visitId/reschedule` | Reschedule visit | `calendar, visit, visitId` |
| `POST /api/calendar/visit/:visitId/unschedule` | Unschedule visit | `calendar, visit, visitId` |
| `POST /api/calendar/visit/:visitId/resize` | Resize visit | `calendar, visit, visitId` |
| `POST /api/tasks` | Create task | `calendar, task, taskId` |
| `PATCH /api/tasks/:id` | Update task | `calendar, task, taskId` |
| `POST /api/tasks/:id/close` | Close task | `calendar, task, taskId` |
| `DELETE /api/tasks/:id` | Delete task | `calendar, task, taskId` |

### Three Freshness Tiers
| Tier | Mechanism | Status |
|---|---|---|
| Local (same tab) | TanStack `invalidateQueries` in mutation `onSuccess` | Existing — unchanged |
| Cross-tab (same user) | `BroadcastChannel("dispatch-freshness")` | New — Phase 1 |
| Multi-user (different users) | SSE `GET /api/dispatch/stream` | New — Phase 1 |

### Phase 1 Limitations (Intentionally Deferred)
- **Single-instance only:** In-process EventEmitter does not sync across multiple server instances. Phase 2 replaces with Redis pub/sub.
- **No GPS streaming:** Technician live positions still use 15s polling. Sharing the SSE connection for GPS is a Phase 3 concern.
- **No notification push:** `/api/notifications` still poll-based. Can share SSE channel in future.
- **No presence/cursors:** Would require WebSocket (bidirectional). Phase 4 if needed.
- **Broad invalidation:** All signals invalidate the same set of calendar query keys. Fine-grained key targeting (e.g., only invalidate the specific date range) deferred.
- **No jitter on refetch:** Multiple connected clients all refetch simultaneously on signal. TanStack deduplicates in-flight requests per tab, but cross-client thundering herd is unmitigated. Acceptable at current scale (<20 concurrent dispatchers).

### Files
- `server/lib/dispatchBus.ts` — NEW: In-process pub/sub (EventEmitter, tenant-keyed)
- `server/routes/dispatch-stream.ts` — NEW: SSE endpoint with heartbeat
- `client/src/hooks/useDispatchStream.ts` — NEW: SSE + BroadcastChannel hook
- `server/routes/calendar.ts` — MODIFIED: 6 mutation handlers emit signals
- `server/routes/tasks.routes.ts` — MODIFIED: 4 mutation handlers emit signals
- `server/routes/index.ts` — MODIFIED: register dispatch stream route
- `client/src/pages/Calendar.tsx` — MODIFIED: mount `useDispatchStream()`

---

## 2026-03-06: Recent Activity Timeline in DispatchDetailPanel (Pass 6)

### Event Source Chosen
The canonical `events` table (append-only, tenant-scoped) was selected as the primary source. It already contains human-readable `summary` fields and covers all dispatch-relevant actions.

### Why `events` Over Other Sources
| Source | Verdict | Reason |
|---|---|---|
| `events` table | **Selected** | Already has API, human summaries, covers job + visit lifecycle |
| `job_schedule_audit` | Deferred | Raw JSONB diffs, no API, requires parsing to humanize |
| `technician_job_status_events` | Deferred | No API endpoint, overlaps with `visit.started`/`tech.arrived` events |
| `attention_items` | Deferred | Mutable alert queue, not point-in-time events |
| `company_audit_logs` | Excluded | Administrative, not dispatch-relevant |

### Event Types Shown in Panel
| eventType | Label | Source Entity |
|---|---|---|
| `job.created` | Job created | job |
| `job.scheduled` | Scheduled | job |
| `job.rescheduled` | Rescheduled | job |
| `job.assigned` | Tech assigned | job |
| `job.unassigned` | Tech unassigned | job |
| `job.unscheduled` | Unscheduled | job |
| `job.completed` | Job completed | job |
| `job.reopened` | Job reopened | job |
| `job.status_changed` | Status changed | job |
| `visit.started` | Visit started | visit |
| `visit.completed` | Visit completed | visit |
| `tech.arrived` | Tech arrived | visit |
| `tech.departed` | Tech departed | visit |

### New Endpoint
`GET /api/activity/dispatch/:jobId/:visitId?limit=6` — Combined timeline query using OR condition on `(entityType=job, entityId=jobId) OR (entityType=visit, entityId=visitId)`. Indexed via `events_tenant_entity_idx`. Max limit: 20.

### Panel Section Order (Final — Pass 6)
1. Header (company, job #, visit #, summary, status badges)
2. Location (address)
3. Schedule (editable)
4. Technician (editable)
5. Outcome Note (read-only, if present)
6. Visit Notes (editable)
7. **Recent Activity** (read-only, last 6 events)
8. Access / Site (read-only, if present)
9. Contact (read-only, if present)
10. Job Description (read-only, if present)
11. Job Context (status, type, priority)
12. Footer (actions)

### Intentionally Excluded
- Full event explorer / filters / search
- Pagination (load more / infinite scroll)
- WebSocket real-time push
- Actor display (who performed the action) — deferred, would add a user lookup
- Event summary display (the `summary` field exists but was omitted for compactness; labels are used instead)
- Inline links / deep links to related entities

### Files Modified
- `server/storage/events.ts` — `getDispatchTimeline()` combined query function
- `server/routes/activity.ts` — `GET /api/activity/dispatch/:jobId/:visitId` endpoint
- `client/src/components/calendar/DispatchDetailPanel.tsx` — Activity query, `ActivityEvent` type, `EVENT_TYPE_LABELS`, `relativeTime()`, timeline section with severity dots

---

## 2026-03-06: Access / Site Context in DispatchDetailPanel (Pass 5)

### Fields Added to Calendar DTO

| Field | Source Table | Column | Purpose |
|---|---|---|---|
| `accessInstructions` | `jobs` | `access_instructions` | Gate codes, roof access, key info |
| `contactName` | `client_locations` | `contact_name` | Site contact for dispatcher/tech |
| `contactPhone` | `client_locations` | `phone` | Clickable tel: link in panel |
| `locationNotes` | `client_locations` | `notes` | Site-specific arrival context |

### Panel Section Order (Final)
1. **Header** — Company, Job #, Visit #, summary, status badges
2. **Location** — Address line
3. **Schedule** — Date, time range, duration (editable)
4. **Technician** — Assigned tech (editable)
5. **Outcome Note** — Read-only, if present
6. **Visit Notes** — Editable dispatch notes
7. **Access / Site** — Access instructions + location notes (read-only)
8. **Contact** — Name + clickable phone (read-only)
9. **Job Description** — Read-only, 3-line clamp
10. **Job Context** — Status, type, priority metadata
11. **Footer** — Unschedule, Add Visit, Full Details, Visit History

### Files Modified
- `server/storage/calendar.ts` — SQL query adds `j.access_instructions`, `cl.contact_name`, `cl.phone`, `cl.notes`; row type + result mapping updated
- `server/routes/calendar.ts` — `transformToDto()` maps new fields
- `shared/types/calendar.ts` — `CalendarEventDto` gains 4 new optional fields
- `client/src/components/calendar/DispatchDetailPanel.tsx` — Two new read-only sections: Access/Site (KeyRound icon) and Contact (Phone icon with tel: link)

---

## 2026-03-06: Panel Dispatch Notes — Inline Visit Notes Editing

### Note Fields Audit

| Field | Table | Authoritative For | Panel Behavior |
|---|---|---|---|
| `visitNotes` | `job_visits` | Dispatcher/office operational notes | **Editable** inline in panel |
| `outcomeNote` | `job_visits` | Technician completion context | **Read-only** (set by technician on visit completion) |
| `description` | `jobs` | Job-level description | **Read-only** context (if present) |
| `summary` | `jobs` | Job title | Already shown in header |
| `job_notes` | `job_notes` (separate table) | Timestamped threaded notes | Not shown (deferred — full note thread is a future feature) |
| `billingNotes` | `jobs` | Billing context | Not shown (billing scope) |
| `accessInstructions` | `jobs` | Site access | **Read-only** in Access/Site section (Pass 5) |
| `holdNotes` | `jobs` | On-hold context | Not shown (on-hold scope) |

### Panel Notes Section Layout
1. **Outcome Note** (read-only) — if present, shown first with "OUTCOME NOTE" label
2. **Visit Notes** (editable) — "VISIT NOTES" section with:
   - Read mode: displays note text or "No notes" placeholder
   - Edit button → inline Textarea with Save/Cancel
   - Save uses `PATCH /api/calendar/visit/:visitId/reschedule` with `{ notes, version }`
3. **Job Description** (read-only) — if present, shown with 3-line clamp

### Save Path
- Endpoint: `PATCH /api/calendar/visit/:visitId/reschedule`
- Body: `{ notes: string | null, version: number }`
- Storage: `calendarRepository.rescheduleVisit()` → `jobVisitsRepository.updateJobVisit()` with `visitNotes` field
- Scope: Visit-centric — only updates the specific visit's `visitNotes`, not the parent job

### Server Changes
- `server/storage/calendar.ts` — Added `visit_notes`, `outcome_note`, `description` to calendar range query and `CalendarJobWithDetails` interface
- `server/routes/calendar.ts` — Added `visitNotes`, `outcomeNote`, `description` to calendar event DTO
- `shared/types/calendar.ts` — Added fields to `CalendarEventDto` interface

### Deferred
- **Threaded notes** (`job_notes` table): Full note thread with timestamps and user attribution — future feature
- **Access instructions**: Could show in panel for dispatch context — minor future addition
- **Mini timeline**: Activity history snippet — requires audit log query, deferred
- **Note on calendar cards**: Visit notes are only visible in panel, not on board cards (too compact)

### Files Changed
- `client/src/components/calendar/DispatchDetailPanel.tsx` — Added Visit Notes section with inline edit, Job Description section
- `server/storage/calendar.ts` — Added `visitNotes`, `outcomeNote`, `description` to query + interface
- `server/routes/calendar.ts` — Added fields to DTO transformation
- `shared/types/calendar.ts` — Added fields to `CalendarEventDto`

---

## 2026-03-06: Off-Hours Availability Overlays — Dispatch Board Readability

### Availability Source
- **Primary:** `company_business_hours` table — per day-of-week open/close with `startMinutes`/`endMinutes` (minutes from midnight)
- **Fallback:** 6:00 AM – 5:00 PM Mon-Fri (360–1020 minutes) when no business hours configured
- **Per-technician:** Not available. `users.useCustomSchedule` field exists but is unused. All technicians use company-wide business hours.

### Views with Off-Hours Overlays

| View | Shading Applied | Mechanism |
|---|---|---|
| **Day Columns** (CalendarGridDayJobber) | Hour slots + time rail | `isOutsideBusinessHours` check per hour cell. Time rail labels now also shaded. |
| **Day Rows** (CalendarGridDayRows) | Hour grid cells + time header | `businessOpen`/`businessStartMinutes`/`businessEndMinutes` passed to TechRow. Time header row also shaded. |
| **Week** (CalendarGridWeek) | Per-cell shading + hour labels | `businessHoursMap` lookup per day-of-week. Each cell independently checked — Saturday/Sunday columns shade differently than weekdays. Hour label shades when ALL 7 days are off-hours. |
| **Month** | Not applicable | Month view has no hourly time axis. |

### Visual Treatment
- **Off-hours background:** `bg-slate-200/70 dark:bg-slate-800/50` — subtle gray tint, matches existing DayJobber pattern
- **Off-hours time labels:** `bg-slate-200/50 dark:bg-slate-800/40 text-muted-foreground/60` — dimmed text
- **Business hours / on-hours:** `bg-background` (default, no tint)
- **Start hour emphasis:** `bg-primary/30 font-bold` (existing behavior, unchanged)
- All overlays use `pointer-events-none` or apply to background classes only — no drag/drop interference

### What the User Should Infer
- **White/clear background** = working hours, schedulable time
- **Gray tint** = off-hours, non-working time (scheduling still allowed, but visually discouraged)
- **Saturdays/Sundays** will show full gray tint if business is closed those days
- **Partial days** (e.g., 6AM-5PM) will shade early morning and evening hours

### Lane Header Capacity Summary
Already implemented in prior pass: `TechLaneHeader` component shows scheduled minutes, visit count, risk badges, and online presence per technician. No additional changes needed.

### Files Changed
- `client/src/components/calendar/CalendarGridDayJobber.tsx` — Added off-hours shading to TimeRail
- `client/src/components/calendar/CalendarGridDayRows.tsx` — Added off-hours shading to timeline grid + time header, computed business hours bounds
- `client/src/components/calendar/CalendarGridWeek.tsx` — Added `businessHours` prop, per-cell off-hours shading, hour label dimming
- `client/src/pages/Calendar.tsx` — Pass `businessHoursData?.hours` to CalendarGridWeek

### Future: Per-Technician Shift Modeling
Currently deferred. Would require:
1. A `technician_schedules` or `user_business_hours` table with per-user day-of-week hours
2. API endpoint to fetch per-tech availability
3. Client-side per-lane shading based on individual schedules rather than company-wide hours
4. The `users.useCustomSchedule` boolean already exists as a gate

---

## 2026-03-06: Visit Status Visual System — Board Card Readability Pass

### Status Visual Mapping

Shared config: `calendarUtils.ts` → `VISIT_STATUS_STYLES` / `VISIT_OUTCOME_STYLES`

| Visit Status | Card Signal | Panel Badge | Color Family |
|---|---|---|---|
| scheduled | No dot (default/implied) | Blue badge with dot | Blue |
| dispatched | Purple dot | Purple badge with dot | Purple |
| en_route | Indigo dot | Indigo badge with dot | Indigo |
| on_site | Green dot | Green badge with dot | Green |
| in_progress | Green dot | Green badge with dot | Green |
| on_hold | Orange dot | Orange badge with dot | Orange |
| completed | CheckCircle2 icon + opacity 60% + strikethrough | Emerald badge | Emerald |
| cancelled | Gray dot (if rendered) | Gray badge | Gray |

| Outcome | Card Signal | Panel Badge |
|---|---|---|
| needs_parts | Amber Package icon | Amber outline badge |
| needs_followup | Amber RotateCcw icon | Amber outline badge |

### Design Decisions
- **Left border = technician color** (unchanged). Primary visual lane identification.
- **Status dot = lifecycle status**. Small colored dot (2x2) before company name. Only shows for non-scheduled, non-completed statuses to avoid noise.
- **Completed = muted** (existing). Opacity 60% + strikethrough + CheckCircle2 icon.
- **Outcomes = amber icons** (existing). Package/RotateCcw icons on card, amber outline badges on panel.
- **Tasks untouched**. Violet border, ClipboardList icon badge. No visitStatus field exists on tasks.
- **Month view chips unchanged**. CalendarEventChip is too compact for status dots. Month is not a dispatch surface.
- **Panel badges now use shared config**. `DispatchDetailPanel` status badges reference `VISIT_STATUS_STYLES` for consistent colors/labels.

### Files Changed
- `client/src/components/calendar/calendarUtils.ts` — Added `VISIT_STATUS_STYLES`, `VISIT_OUTCOME_STYLES`, `getVisitStatus()`, `getVisitOutcome()`
- `client/src/components/calendar/DraggableClient.tsx` — Added status dot rendering, added `visitStatus`/`visitOutcome` to memo comparison
- `client/src/components/calendar/DispatchDetailPanel.tsx` — Replaced inline status labels/colors with shared config imports

### Intentionally Deferred
- Month view chips: No status dot (too compact)
- Day-rows all-day chips: No status dot (same CalendarEventChip)
- Card background tinting by status: Avoided to prevent color overload with technician colors

---

## 2026-03-06: Dispatch Board UI Refactor Pass 2 — Dispatch Detail Panel

### Current Board Behavior (Updated)

| Area | Current State |
|---|---|
| **Sidebar** | Split into "Needs First Visit" and "Needs Follow-Up" sections. Both draggable. Follow-up shows outcome context badges. |
| **Calendar grid** | Month / Week / Day views. Cards show company name, time range, job #, visit #, outcome icons. |
| **Event click** | **Visit events → DispatchDetailPanel** (right-side non-modal sheet). Tasks → TaskDialog. Unscheduled sidebar → JobDetailDialog. |
| **Dispatch panel** | Compact: header (company, job#, visit#, status badges), schedule section (read/edit), technician (read/edit), outcome note, job context. Footer: Unschedule, Add Visit, Full Details, Visit History. |
| **Full detail escape** | "Full Details" button in panel → transfers data to JobDetailDialog. "Visit History" → navigates to `/jobs/:id?section=visits`. |
| **Job detail link** | History icon on calendar card navigates to `/jobs/:id?section=visits` for full visit management. |
| **Drag scheduling** | First-visit: creates Visit #1 via `POST /api/calendar/schedule`. Follow-up: creates new visit via same endpoint (previous visit stays closed). |
| **Unschedule** | Visit-centric via `POST /api/calendar/visit/:visitId/unschedule`. Available in both panel and dialog. |
| **Resize** | Visit-centric via `POST /api/calendar/visit/:visitId/resize`. |
| **Quick create** | Click empty slot → QuickCreateSlotDialog (Job or Task). Prefills date/time/tech from slot. |

### Click Routing Matrix

| Source | Target Surface | Condition |
|---|---|---|
| Calendar event card (visit) | DispatchDetailPanel | Default click, `focusSchedule=false` |
| Calendar event card (task) | TaskDialog | `isTaskEvent()` check |
| Context menu "Reschedule" | JobDetailDialog | `focusSchedule=true` |
| Unscheduled sidebar item | JobDetailDialog | `focusSchedule=true` (scheduling flow) |
| Panel "Full Details" button | JobDetailDialog | Escape hatch |
| Panel "Visit History" link | `/jobs/:id?section=visits` | Navigation |

### Gap Analysis: Current vs ServiceTitan-style Dispatch Board

| Feature | ServiceTitan | Current | Priority |
|---|---|---|---|
| **Side detail panel** | Right-side flyout showing full visit + job context | **Implemented** — DispatchDetailPanel (non-modal Sheet) with visit + job context, inline reschedule, tech reassign, add visit | Done |
| **Lane headers (technicians as rows)** | Daily view has tech rows, drag between rows to reassign | Day Jobber view exists but separate from main day view | Low — tech rows already work |
| **Map overlay / route optimization** | Integrated map with drive time between stops | Route optimization exists on separate page | Low |
| **Availability / capacity bars** | Tech capacity shown per lane | Not implemented | Medium |
| **Conflict detection** | Visual overlap warning during drag | Version mismatch handling only | Low |
| **Real-time updates** | WebSocket push for multi-user dispatch | Polling-based refetch | Medium |
| **Empty slot quick-create** | Click empty slot → inline create form | **Implemented** — QuickCreateSlotDialog with Job/Task tabs | Done |
| **Recurring visit auto-generation** | Series visits auto-created from recurrence rules | Recurring jobs exist but visits are manual | Medium |
| **Visit progress indicators** | Live status (en route, on site, completed) on board | Status stored but not visually differentiated on board | Medium |

### Tech Reassignment Audit (2026-03-06)

Audit confirmed the entire technician reassignment flow from DispatchDetailPanel is **already fully visit-centric**. No code changes needed.

| Step | Component | Endpoint / Method | Visit-Centric? |
|---|---|---|---|
| 1 | `DispatchDetailPanel.handleTechSave()` | Calls `onAssignTechnicians(visitId, newTechIds)` | ✅ Uses visitId |
| 2 | `Calendar.tsx` callback | Calls `assignTechnicians.mutate({ assignmentId: visitId, ... })` | ✅ Passes visitId |
| 3 | `useCalendarDnD.ts` mutation | `PATCH /api/calendar/visit/${assignmentId}/reschedule` | ✅ Visit endpoint |
| 4 | `server/routes/calendar.ts:867` | Extracts `visitId` from params → `calendarRepository.rescheduleVisit()` | ✅ |
| 5 | `server/storage/calendar.ts:1437` | Updates only targeted visit's `assignedTechnicianId` | ✅ Visit-scoped |
| 6 | `server/storage/jobVisits.ts:672` | `syncJobScheduleFromVisits()` mirrors "next visit" to job | ✅ Mirror only |

**Multi-visit safety:** Changing tech on Visit #2 updates only Visit #2's row. Other visits retain their own `assignedTechnicianId`. The job-level `primaryTechnicianId` mirrors whichever visit is "next upcoming" — it is not a source of truth.

**Legacy endpoint:** `PATCH /api/calendar/schedule/:jobId` still exists on the server but is **not called** by any dispatch panel or calendar DnD path.

### Next UI Phase Would Need

1. ~~**Empty slot quick-create**~~ — **DONE** (2026-03-06): `QuickCreateSlotDialog` with Job/Task tabs. Wired to Week, Day Columns, and Day Rows grids via `onEmptySlotClick`. Uses `createJobWithSchedule()` for jobs, `POST /api/tasks` for tasks.

2. ~~**Side detail panel**~~ — **DONE** (2026-03-06): `DispatchDetailPanel` (non-modal Sheet). Visit events open panel by default. Shows visit schedule, technician, outcome, job context. Actions: inline reschedule, unschedule, add visit, tech reassign. Full dialog as escape hatch.

3. **Visit status indicators on board**: Color-code or badge calendar events by visit status (scheduled=default, en_route=blue, on_site=green, completed=gray, needs_followup=amber).

4. **Drag-to-reassign between technician lanes**: In day view with tech rows, dragging a visit from one tech lane to another should reassign the technician.

5. **Task panel variant**: Tasks still open TaskDialog. A compact task panel could reduce modality further.

6. **Panel notes/comments**: Add inline notes/comment entry to the dispatch panel for quick dispatcher annotations.

7. **Panel parts section**: Show required parts for the visit (currently only in full dialog).

---

## 2026-03-06: Phase A+B — Structured Visit Outcomes + Unscheduled Work Split

### Visit Lifecycle Model

| Visit Status | Visit Outcome | isFollowUpNeeded | Job Reaction | Where Office Sees It |
|---|---|---|---|---|
| `scheduled` | null | false | Job mirrored to this visit's schedule | Calendar grid |
| `in_progress` | null | false | Job mirrored | Calendar grid |
| `completed` | `completed` | false | syncJobToVisits clears schedule if no pending visits | Completed visits list |
| `completed` | `needs_parts` | true | syncJobToVisits clears schedule; job stays `open` | **Needs Follow-Up** sidebar section |
| `completed` | `needs_followup` | true | syncJobToVisits clears schedule; job stays `open` | **Needs Follow-Up** sidebar section |
| `cancelled` | null | false | syncJobToVisits skips; next eligible visit mirrors | Archive |

### Structured Outcome Fields (job_visits table)

| Column | Type | Written By | Purpose |
|---|---|---|---|
| `outcome` | text | Tech completion endpoint, office status update | "completed" / "needs_parts" / "needs_followup" |
| `outcome_note` | text | Tech completion endpoint | Free-text note explaining outcome |
| `completed_by_user_id` | varchar FK | Tech completion endpoint | Who completed the visit |
| `completed_at` | timestamp | Tech completion + office status update | When visit was completed |
| `is_follow_up_needed` | boolean | Computed from outcome | True for needs_parts, needs_followup |

### Unscheduled Work Split

**Needs First Visit** — computed by `getUnscheduledJobs()`:
- `jobs.status = 'open'`
- `jobs.scheduled_start IS NULL`
- `jobs.is_active = true`, `jobs.deleted_at IS NULL`
- `NOT EXISTS (completed visit with is_follow_up_needed = true)` — excludes follow-up jobs

**Needs Follow-Up** — computed by `getJobsNeedingFollowUp()`:
- `jobs.status = 'open'`, active, not deleted
- `EXISTS (completed visit with is_follow_up_needed = true)`
- `NOT EXISTS (pending visit — status not in completed/cancelled, with scheduled_start)`

### Follow-Up Scheduling Decision

**Approach chosen:** Follow-up items use the same drag-to-schedule flow as first-visit items.
- Dragging creates a new visit via `POST /api/calendar/schedule` (jobId-based)
- Previous completed visit stays permanently closed
- Once a pending visit exists, item disappears from Needs Follow-Up section
- Office controls when/if to create the next visit — no auto-creation

**Why this approach:**
- Zero new client mutation code required
- Uses existing visit creation infrastructure
- Previous visit's outcome data preserved indefinitely
- Matches "office controls dispatch" philosophy

### Attention Items

Follow-up signals are visible via:
1. **Sidebar "Needs Follow-Up" section** — with outcome context badge
2. **`GET /api/calendar/needs-follow-up`** — queryable endpoint with outcome metadata
3. **`isFollowUpNeeded` column** — directly queryable on job_visits table

---

## 2026-03-05: Phase C — Pre-deploy P0 Performance + Scale Fixes

### Task 1: DB Index
| Item | Detail |
|---|---|
| Index | `idx_job_visits_company_active_start` on `(company_id, is_active, scheduled_start)` |
| Migration | `migrations/2026_03_05_job_visits_schedule_index.sql` |
| Queries covered | `map.ts` (2 queries), `calendar.ts` range query, eligible-visit lookup |
| Why compound | Existing single-column indexes require bitmap AND; compound index → single range scan |

### Task 2: ImpersonationBanner Polling
| Item | Detail |
|---|---|
| File | `client/src/components/ImpersonationBanner.tsx` |
| Before | `refetchInterval: 5000` (unconditional), `staleTime: 0` — 12 req/min for ALL users |
| After | `refetchInterval: (query) => query.state.data?.isImpersonating ? 5000 : false`, `staleTime: 30_000` |
| Impact | Non-impersonating users: 1 request total instead of 12/min |

### Task 3: getEventsForTech Memoization
| Item | Detail |
|---|---|
| Files | `CalendarGridDayJobber.tsx`, `CalendarGridDayRows.tsx` |
| Before | Plain function re-created every render; DayJobber called it 4× for null + 1× per tech; new arrays defeated memo |
| After | `useMemo` builds `Map<techId, CalendarEvent[]>` once per `dayEvents` change; getter returns stable references |
| Impact | N techs → from 4N+4 filter passes to 1 Map build; `MemoizedTechColumn`/`MemoizedTechRow` memo now effective |

---

## 2026-03-05: Phase B Dead Code Cleanup

### Batch 1 — Dead Server Files (305 lines)
| File | Lines | Reason |
|---|---|---|
| `server/services/qboGuards.ts` | 10 | Exported `assertInvoiceSyncAllowed()` — never imported |
| `server/services/calendarService.ts` | 20 | Exported `resizeJobTime()` — never imported |
| `server/stripe/stripeClient.ts` | 69 | Only referenced by other stripe files; no route mount |
| `server/stripe/stripeService.ts` | 79 | Only referenced by other stripe files; no route mount |
| `server/stripe/webhookHandlers.ts` | 127 | Only referenced by other stripe files; no route mount |

### Batch 2 — Dead Schema Exports
Removed from `shared/schema.ts` (exports only, no table definitions altered):
- `identityProviderEnum` / `IdentityProvider` — never imported
- `invitationStatusEnum` / `InvitationStatus` — never imported
- `insertPasswordResetTokenSchema` / `InsertPasswordResetToken` / `PasswordResetToken` — never imported
- `ScheduleJobInput` / `UpdateJobScheduleInput` / `UnscheduleJobInput` — type aliases never imported (underlying Zod schemas still used by `routes/calendar.ts`)

### Batch 3A — Duplicate Migration
- Deleted `migrations/006-fix-money-types.sql` (original, lacked `::text` casts)
- Kept `migrations/006-fix-money-types-FIXED.sql` (corrected version with `::text` casts for NUMERIC columns)

### Batch 3B — Unreferenced Assets
- Moved 178 files (8.4 MB) from `attached_assets/` to `attached_assets/_archive/`
- No source file imports from `@assets` alias — confirmed via grep

### Batch 3C — Unused npm Dependencies (14 packages)
Removed: `react-icons`, `react-resizable-panels`, `recharts`, `framer-motion`, `vaul`, `embla-carousel-react`, `tw-animate-css`, `next-themes`, `input-otp`, `memorystore`, `stripe`, `stripe-replit-sync`, `@stripe/react-stripe-js`, `@stripe/stripe-js`

### Build Verification
- TypeScript: Only pre-existing `adminTimesheets.ts:376` errors (unrelated)
- Vite build: Passed all 3 batches. CSS 122.67 KB, JS 2,204.56 KB (unchanged)
- No new errors introduced

---

## 2026-02-02: Step 2.4 - Job Visits → Jobs Schedule Mirroring

### Summary
Implemented `syncJobScheduleFromVisits()` in `server/storage/jobVisits.ts` to maintain backwards compatibility while transitioning from job-based to visit-based scheduling.

### Invariants (Model A Compatibility Bridge)

- **Eligible visits**: `is_active = true` AND `scheduled_start IS NOT NULL` AND `status NOT IN ('cancelled', 'completed')`
- **Visit selection priority**:
  1. Earliest future visit (scheduled_start >= now)
  2. Most recent past visit (latest scheduled_start)
  3. Fallback to first in list (should not occur)
- **Mirrored fields** (job ← visit):
  - `jobs.scheduled_start` ← `visit.scheduled_start`
  - `jobs.scheduled_end` ← `visit.scheduled_end`
  - `jobs.is_all_day` ← `visit.is_all_day`
  - `jobs.duration_minutes` ← computed from start/end (NULL for all-day)
  - `jobs.primary_technician_id` ← `visit.assigned_technician_id`
  - `jobs.assigned_technician_ids` ← `visit.assigned_technician_ids` (or array of single tech)
- **Unschedule behavior**: When NO eligible visits exist, ALL mirrored fields are cleared (including technicians) because the job's schedule fields are a mirror, not independent data
- **Version bump**: `jobs.version` incremented on every sync to support optimistic locking
- **Call sites**: createJobVisit, updateJobVisit, deleteJobVisit, updateJobVisitStatus, checkInJobVisit, checkOutJobVisit

### Transitional Note
This mirroring is temporary until the calendar UI reads directly from `job_visits` (Model B migration). At that point, `syncJobScheduleFromVisits()` can be removed.

---

## 2026-01-26: MODEL A - Canonical Scheduling (Phase 1 Steps 2 & 2.5)

### Summary
Implemented **MODEL A (Timestamp Canonical)** - the single source of truth for scheduling state.

### The Problem
Previously, all-day events had `scheduledStart = NULL` which caused:
1. **All-day events invisible in calendar range queries** - `WHERE scheduledStart BETWEEN ? AND ?` filtered them out
2. **Inconsistent scheduling predicate** - Some code checked `scheduledStart != null`, others checked `scheduledStart != null OR isAllDay = true`
3. **Confusing invariants** - `isAllDay = true` implied "scheduled" but `scheduledStart = NULL` implied "unscheduled"

### MODEL A Solution

```
CANONICAL SCHEDULING PREDICATE:
isJobScheduled(job) = job.scheduledStart IS NOT NULL

TIMESTAMP RULES:
├── Timed events:    scheduledStart = actual time,   scheduledEnd = actual time
├── All-day events:  scheduledStart = midnight,      scheduledEnd = 23:59:59
└── Unscheduled:     scheduledStart = NULL,          scheduledEnd = NULL

isAllDay FLAG:
├── TRUE  = Display in all-day lane (but still has midnight timestamps!)
└── FALSE = Display in timed grid at scheduledStart hour

INVARIANTS:
├── isAllDay=true → scheduledStart MUST be midnight (00:00:00 UTC)
├── isAllDay=true → scheduledEnd MUST be 23:59:59 or next-day 00:00:00
├── isAllDay=false + scheduled → scheduledEnd > scheduledStart
└── scheduledStart=NULL ↔ unscheduled job
```

### Files Changed

**Server Storage** (`server/storage/calendar.ts`):
- `createAssignment()` - Sets midnight timestamps for all-day
- `updateAssignment()` - Sets midnight timestamps for all-day
- `createAssignmentBypassWorkingHours()` - Fixed: now sets midnight, not null
- `updateAssignmentBypassWorkingHours()` - Fixed: now sets midnight, not null

**Server Routes** (`server/routes/calendar.ts`):
- `transformToDto()` - Now returns actual timestamps for all-day (not null)
- POST/PATCH handlers - Updated comments to document Model A

**Server Domain** (`server/domain/scheduling.ts`):
- Added `assertAllDayTimestampInvariant()` helper
- Updated all scheduling invariant checks

**Shared Schema** (`shared/schema.ts`):
- `isJobScheduled()` - Simplified to just check `scheduledStart != null`

**Shared Types** (`shared/types/calendar.ts`):
- Updated CalendarAssignmentDto documentation for Model A

**Client Utilities**:
- `client/src/lib/calendarDiagnostics.ts` - Fixed invariant check (now flags all-day WITH null)
- `client/src/components/calendar/calendarUtils.ts` - Updated normalization docs

### Verification
```bash
# These greps should return zero hits for code setting null for all-day:
grep -rn "scheduledStart = null" --include="*.ts" | grep -i allday  # Should be 0
grep -rn "finalStart = null" --include="*.ts" | grep -i allday      # Should be 0
```

---

## 2026-01-26: Calendar Scheduling & Job Management Fixes

### Session Summary
Fixed multiple interconnected issues with calendar drag-and-drop scheduling, job detail modal UX, and data synchronization between calendar and jobs list views.

---

### 1. VERSION_MISMATCH (409) Root Cause & Fix

**Problem:**
Dragging jobs from the unscheduled sidebar to the calendar resulted in 409 VERSION_MISMATCH errors. Diagnostics showed `sentVersion=0` while server expected `version=1`.

**Root Cause Analysis:**
1. Server route `/api/calendar/unscheduled` was fetching `version` from database but **stripping it during response transformation**
2. Client was using `version ?? 0` fallback (14 occurrences!), which sent 0 when version was undefined
3. Server's optimistic locking correctly rejected the stale version

**Files Changed:**
- `server/routes/calendar.ts` (line ~968)
  ```typescript
  // BEFORE: version field was missing from transformation
  const transformedJobs = unscheduled.map((job) => ({
    id: job.id,
    // ... other fields
    // version: job.version  <- WAS MISSING
  }));

  // AFTER: Explicit jobVersion field for clarity
  const transformedJobs = unscheduled.map((job) => ({
    id: job.id,
    // ... other fields
    jobVersion: job.version,  // Use for POST /api/calendar/assignments
    version: job.version,     // DEPRECATED: kept for backward compatibility
  }));
  ```

- `client/src/pages/Calendar.tsx`
  - **Eliminated ALL 14 occurrences of `version ?? 0`**
  - Added `requireJobVersion()` guard for creating assignments (POST)
  - Added `requireAssignmentVersion()` guard for updating assignments (PATCH)
  - Guards validate version is a finite number, refetch if missing
  - Updated `handleRemove()` to validate version before delete

- `client/src/hooks/useCalendarDnD.ts`
  - Added `fetchFreshJobVersion()` helper function
  - Added auto-retry logic in `onError` handlers
  - Added `_isRetry` field to params interfaces

- `client/src/lib/calendarDiagnostics.ts`
  - Added `logVersionMismatch()` for detailed diagnostics

**Design Decision:**
Rather than just fixing the server response, we also added client-side auto-retry logic as a defense-in-depth measure. If a 409 occurs (e.g., from concurrent edits), the client:
1. Logs detailed diagnostics
2. Fetches fresh version from server
3. Retries once with correct version
4. Shows user-friendly error if retry fails

---

### 2. Job Detail Modal Schedule UX Simplification

**Problem:**
- Modal had split view/edit modes requiring extra clicks
- Header "Reschedule" popover conflicted with schedule section picker (both competed for focus)
- All-day toggle could disable Save button unexpectedly

**Refactoring Approach:**
Eliminated complexity by removing the split UI entirely:

```
BEFORE:
┌─────────────────────────────────────┐
│ Header: [Reschedule btn w/ popover] │
├─────────────────────────────────────┤
│ Schedule Section:                   │
│   Display Mode: "Jan 15, 9:00 AM"   │
│   [Edit button] -> toggles to...    │
│   Edit Mode: [date picker] [time]   │
└─────────────────────────────────────┘

AFTER:
┌─────────────────────────────────────┐
│ Header: [Mark Complete] [Unschedule]│
├─────────────────────────────────────┤
│ Schedule Section:                   │
│   [Date picker] [All-day toggle]    │
│   [Time selects] [Duration]         │
│   [Save] [Reset]                    │
└─────────────────────────────────────┘
```

**Removed State:**
- `isEditingSchedule` - always show editor
- `reschedulePickerOpen` - removed header popover
- `handleDateSelect` - was used by removed popover

**Files Changed:**
- `client/src/components/JobDetailDialog.tsx`

---

### 3. Delete Job Endpoint Fix

**Problem:**
"Delete Job" button was calling `DELETE /api/calendar/assignments/:id` which only unscheduled the job. The job remained in the jobs list.

**Fix:**
Changed to call `DELETE /api/jobs/:jobId` which performs soft delete (`isActive: false`).

```typescript
// BEFORE (wrong - deletes calendar assignment)
return await apiRequest(`/api/calendar/assignments/${assignment.id}?version=...`, {
  method: "DELETE",
});

// AFTER (correct - deletes job record)
const jobId = assignment.jobId || assignment.id;
return await apiRequest(`/api/jobs/${jobId}`, {
  method: "DELETE",
});
```

**Query Invalidation:**
Also added "jobs" group to invalidation for all scheduling mutations to keep calendar and jobs list synchronized.

---

### 4. All-Day Row Overlap Fix (Week View)

**Problem:**
When there were 4+ all-day events on the same day, they overflowed the fixed 84px row height and overlapped the timed slots below.

**Solution:**
Created new `AllDayRow` component with dynamic height calculation:

```typescript
// Constants
const ALLDAY_EVENT_HEIGHT = 28;  // px per event
const ALLDAY_MIN_HEIGHT = 64;    // minimum row height
const ALLDAY_MAX_VISIBLE = 3;    // events before "show more"
const ALLDAY_MAX_HEIGHT = 200;   // cap to prevent excessive height

// Dynamic calculation
const calculatedHeight = useMemo(() => {
  const visibleCount = anyExpanded
    ? maxAllDayCount
    : Math.min(maxAllDayCount, ALLDAY_MAX_VISIBLE);

  const buttonSpace = maxAllDayCount > ALLDAY_MAX_VISIBLE ? 24 : 0;
  const contentHeight = visibleCount * ALLDAY_EVENT_HEIGHT + 16 + buttonSpace;

  return Math.max(ALLDAY_MIN_HEIGHT, Math.min(contentHeight, ALLDAY_MAX_HEIGHT));
}, [maxAllDayCount, anyExpanded]);
```

**Files Changed:**
- `client/src/components/calendar/CalendarGridWeek.tsx`
  - Extracted `AllDayRow` component
  - Removed inline all-day rendering logic from main component

---

### Code Quality Notes

**Patterns Established:**
1. **Auto-retry for optimistic locking failures** - Don't just show error; try to recover automatically
2. **Comprehensive query invalidation** - When data changes, invalidate all affected query groups
3. **Diagnostics logging** - Log detailed context for debugging production issues
4. **Defense in depth** - Fix root cause AND add client-side resilience

**Technical Debt Addressed:**
- Removed dead state variables (`isEditingSchedule`, `reschedulePickerOpen`)
- Removed unused function (`handleDateSelect`)
- Simplified component structure (single schedule editor vs split view/edit)
- **Eliminated ALL `version ?? 0` fallbacks** - replaced with proper guard functions

**Technical Debt Remaining:**
- Calendar components are large - consider further decomposition
- Type safety could be improved (many `any` types in calendar code)
- Consider adding TypeScript interface for unscheduled API response with `jobVersion`

---

## 2026-01-26: Job Status Model Normalization

### Session Summary
Refactored the job status system from 12+ values to exactly 4 lifecycle values, with derived states for scheduling/assignment and a new `openSubStatus` column for workflow states.

---

### 1. 4-Value Lifecycle Model

**Problem:**
The job status field had 12+ values mixing lifecycle stages (open, completed, invoiced), derived states (assigned, scheduled), workflow states (in_progress, on_hold), and legacy aliases (unscheduled, cancelled). This caused:
- Confusing queries: "Is this job scheduled?" required checking `status IN ('scheduled', 'in_progress', ...)`
- Redundant data: `status='scheduled'` duplicated information already in `scheduledStart`
- Unclear invariants: What happens when you set `scheduledStart=null` but `status='scheduled'`?

**Root Cause:**
Status was conflating three orthogonal concepts:
1. **Lifecycle stage** - Where is this job in its journey? (open → completed → invoiced → archived)
2. **Scheduling state** - Is this job on the calendar? (derived from `scheduledStart` and `isAllDay`)
3. **Workflow state** - What's happening right now? (in_progress, on_hold, on_route)

**Solution:**
Separated these into:

```
LIFECYCLE (jobs.status) - 4 values only:
├── open       # Active job that can be worked on
├── completed  # Work finished (may need invoicing)
├── invoiced   # Invoice created (locked for billing)
└── archived   # Historical archive (includes canceled)

DERIVED STATES (computed from fields, NOT stored):
├── isJobScheduled(job) = scheduledStart != null  # MODEL A: all-day has midnight timestamps
└── isJobAssigned(job) = primaryTechnicianId != null || assignedTechnicianIds.length > 0

WORKFLOW (jobs.openSubStatus) - only when status='open':
├── null           # Default, no special state
├── in_progress    # Work actively being performed
├── on_hold        # Job is blocked (requires holdReason)
├── on_route       # Technician traveling to site
└── needs_review   # Needs supervisor review

INVARIANT: openSubStatus must be NULL when status !== 'open'
```

**Files Changed:**
- `shared/schema.ts`
  - Added `jobStatusEnum` with 4 values (lines 1105-1111)
  - Added `openSubStatusEnum` with 4 values (lines 1114-1120)
  - Added `normalizeJobStatus()` function to map legacy values
  - Added `deriveOpenSubStatus()` for migration
  - Added `isJobScheduled()` and `isJobAssigned()` helpers
  - Added `openSubStatus` column to jobs table
  - Updated CHECK constraints

- `server/schemas.ts`
  - Updated `jobStatusEnum` Zod schema to 4 values
  - Added `openSubStatusEnum` Zod schema
  - Added `legacyJobStatusEnum` for migration acceptance
  - Updated `jobUpdateStatusSchema` with openSubStatus validation

- `server/statusRules.ts`
  - Simplified `JOB_STATUS_FLOW` to 4-value transitions
  - Added `OPEN_SUB_STATUS_FLOW` for workflow transitions
  - Updated all helper functions to use `normalizeJobStatus()`

- `server/domain/scheduling.ts`
  - Updated to use new status model
  - Added `isBacklogJob()` and `isCalendarJob()` helpers
  - Added `openSubStatus` to `JobLike` interface

- `server/domain/jobLifecycle.ts`
  - Updated lifecycle transitions for 4-value model
  - Added `getOpenSubStatusClearingPatch()` for terminal transitions
  - Updated sanity check utilities

---

### 2. Database Migration

**Migration Strategy:**
The migration normalizes existing data while preserving workflow intent.

```sql
-- Step 1: Add openSubStatus column
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS open_sub_status TEXT;

-- Step 2: Preserve workflow state before normalizing status
UPDATE jobs SET open_sub_status = 'in_progress' WHERE status = 'in_progress';
UPDATE jobs SET open_sub_status = 'on_hold' WHERE status = 'on_hold';

-- Step 3: Normalize status to 4 values
UPDATE jobs SET status = 'open'
WHERE status IN ('assigned', 'unscheduled', 'scheduled', 'in_progress', 'on_hold');

UPDATE jobs SET status = 'completed' WHERE status = 'requires_invoicing';

UPDATE jobs SET status = 'archived'
WHERE status IN ('closed', 'canceled', 'cancelled');

-- Step 4: Add CHECK constraints
ALTER TABLE jobs ADD CONSTRAINT jobs_hold_reason_check
CHECK (open_sub_status <> 'on_hold' OR hold_reason IS NOT NULL);

ALTER TABLE jobs ADD CONSTRAINT jobs_open_sub_status_invariant_check
CHECK (status = 'open' OR open_sub_status IS NULL);
```

**Migration File:**
- `migrations/2026_01_26_normalize_job_status.sql`

---

### 3. Query Pattern Changes

**BEFORE (checking multiple status values):**
```typescript
// Calendar query - jobs on calendar
WHERE status IN ('scheduled', 'in_progress', 'on_hold')

// Backlog query - unscheduled jobs
WHERE status IN ('open', 'assigned', 'unscheduled', 'on_hold')

// "Is job active?"
WHERE status NOT IN ('completed', 'invoiced', 'archived', 'canceled', 'cancelled', 'closed')
```

**AFTER (clean field-based queries):**
```typescript
// Calendar query - scheduled jobs with status='open'
WHERE status = 'open' AND (scheduled_start IS NOT NULL OR is_all_day = true)

// Backlog query - unscheduled jobs with status='open'
WHERE status = 'open' AND scheduled_start IS NULL AND is_all_day = false

// "Is job active?"
WHERE status = 'open'
```

---

### Design Decisions

**Why 4 values exactly?**
These represent the true lifecycle stages a job passes through:
1. **open** - Job exists and can be worked on (backlog or calendar)
2. **completed** - Work is done, may need billing
3. **invoiced** - Billing done, locked for accounting
4. **archived** - Historical, rarely accessed

Everything else is either:
- **Derived**: scheduled/assigned come from fields
- **Workflow**: openSubStatus tracks what's happening NOW

**Why not keep `canceled` separate from `archived`?**
Canceled is just one reason a job ends up in the archive. The audit log captures the cancel action, so we don't need it in status. This follows the principle: "status = lifecycle stage, audit = why."

**Why `openSubStatus` instead of a general `subStatus`?**
The invariant `openSubStatus is NULL when status !== 'open'` enforces that workflow states only make sense for active jobs. A completed job can't be "on_hold" - that's a contradiction. Naming it `openSubStatus` makes the constraint obvious at the type level.

---

### Technical Debt Addressed

- Eliminated 12+ status values causing query complexity
- Removed redundant data (scheduled state was stored in both status AND scheduledStart)
- Clarified invariants with database CHECK constraints
- Unified normalization logic in `normalizeJobStatus()`

### Technical Debt Remaining

- Client components may still reference legacy status values (need audit)
- Some API responses may need updating to expose openSubStatus
- UI filters/dropdowns may need updating for new model

---

## 2026-01-26: Phase 1 Step 1 - Legacy Status Removal

### Session Summary
Comprehensive removal of all legacy job status values from active code paths. Hard-locked the status column to exactly 4 lifecycle values with a fail-fast runtime guard.

---

### 1. Runtime Status Guard

**Problem:**
Legacy status values (`scheduled`, `assigned`, `in_progress` as status, `action_required`, `closed`, `canceled`) could still be set in code, causing data inconsistencies.

**Solution:**
Added `assertNormalizedJobStatus()` function to `server/schemas.ts`:

```typescript
export function assertNormalizedJobStatus(status: string, context?: string): asserts status is JobStatus {
  if (!VALID_JOB_STATUSES.includes(status as JobStatus)) {
    throw new Error(
      `INVALID_JOB_STATUS${ctx}: "${status}" is not a valid lifecycle status. ` +
      `Only ${VALID_JOB_STATUSES.join(", ")} are allowed.`
    );
  }
}
```

Use this guard in any code path that persists or transforms job status.

---

### 2. Server-Side Removals

**Files Changed:**

- **`server/storage/jobs.ts`**
  - Removed: `status === "in_progress"` check for setting `actualStart`
  - Removed: `status === "requires_invoicing" || status === "closed"` checks
  - Added: Only `status === "completed"` sets `actualEnd` timestamp

- **`server/storage/dashboard.ts`**
  - Removed: `REQUIRES_INVOICING_STATUSES = ["requires_invoicing", "completed"]`
  - Removed: `CLOSED_STATUSES = ["archived", "canceled", "closed", "invoiced", ...]`
  - Added: `NEEDS_INVOICING_STATUS = "completed"`
  - Added: `TERMINAL_STATUSES = ["invoiced", "archived"]`
  - Updated: `getNeedsAttentionJobs()` to check `openSubStatus = 'on_hold'`

- **`server/storage/admin.ts`**
  - Removed: `status = 'action_required'` query
  - Added: `status = 'open' AND open_sub_status = 'on_hold'` query
  - Renamed: `actionRequiredCount` → `onHoldCount`

- **`server/storage/calendar.ts`**
  - Removed: `status = hasSchedule ? 'scheduled' : (data.technicianUserId ? 'assigned' : 'open')`
  - Added: `status = 'open'` (scheduling/assignment are derived states)

- **`server/storage/customerCompanies.ts`**
  - Removed: `closedJobStatuses = ["completed", "requires_invoicing", "invoiced", "closed", ...]`
  - Added: `j.status === "open"` filter for open jobs count

- **`server/routes/admin.ts`**
  - Removed: Scheduling health checks A-C with legacy status values
  - Added: Check A for legacy status values needing migration
  - Added: Check B for terminal jobs with schedule fields
  - Added: Check C for invalid openSubStatus

- **`server/routes/reports.ts`**
  - Removed: `status = 'action_required'` query
  - Added: `status = 'open' AND openSubStatus = 'needs_review'` query
  - Updated: Historical queries to include both legacy and new values for backward compatibility

- **`server/routes/clients.ts`**
  - Removed: `closedJobStatuses` array with legacy values
  - Added: `j.status === "open"` filter

- **`server/scripts/schedulingSanityCheck.ts`** (complete rewrite)
  - Removed: Checks A-C referencing legacy statuses
  - Added: Check A for legacy status values
  - Added: Check G for terminal jobs with schedule fields
  - Updated: All repair queries to normalize to `open` status

---

### 3. Client-Side Removals

**Files Changed:**

- **`client/src/components/job/jobUtils.ts`** (complete rewrite)
  - Removed: `STATUS_TRANSITIONS` with legacy values
  - Removed: `JOB_STATUS_FLOW` with legacy values
  - Added: `VALID_JOB_STATUSES = ["open", "completed", "invoiced", "archived"]`
  - Added: `TERMINAL_STATUSES = ["invoiced", "archived"]`
  - Added: `SUB_STATUS_INFO` for openSubStatus display
  - Updated: `getJobStatusDisplay()` to use normalized statuses + derived states

- **`client/src/pages/Jobs.tsx`**
  - Removed: `JobStatusFilter` with legacy values (draft, scheduled, in_progress, etc.)
  - Added: New filter type with normalized values + derived states
  - Updated: `getJobStatusDisplay()` to accept `openSubStatus` parameter

- **`client/src/lib/jobScheduling.ts`**
  - Removed: `status = isScheduled ? "scheduled" : "open"`
  - Added: `status = "open"` (scheduling is now a derived state)
  - Added: `hasSchedule` variable for schedule detection

---

### 4. Legacy Status Migration Map

| Legacy Status | Normalized To | Notes |
|---------------|---------------|-------|
| `scheduled` | `open` | Derived from `scheduledStart`/`isAllDay` |
| `assigned` | `open` | Derived from `assignedTechnicianIds` |
| `unscheduled` | `open` | Default state |
| `in_progress` | `open` + `openSubStatus='in_progress'` | Workflow state |
| `on_hold` | `open` + `openSubStatus='on_hold'` | Workflow state |
| `action_required` | `open` + `openSubStatus='needs_review'` | Workflow state |
| `requires_invoicing` | `completed` | Work done, needs billing |
| `draft` | `open` | Active job |
| `needs_parts` | `open` + `openSubStatus='on_hold'` | Blocked state |
| `closed` | `archived` | Terminal state |
| `canceled`/`cancelled` | `archived` | Terminal state |

---

### 5. Intentionally NOT Modified

1. **`shared/schema.ts`** - Contains `normalizeJobStatus()` for backward compatibility with historical data
2. **`server/storage/jobVisits.ts`** - Uses `status = "scheduled"` for `job_visits` table (separate domain)
3. **`server/storage/maintenance.ts`** - Uses 'scheduled' in CASE expression for display only
4. **Test files** - Reference legacy statuses to test normalization logic

---

### Technical Debt Addressed

- Removed all legacy status value assignments from active code
- Unified status model across server and client
- Added fail-fast runtime guard for invalid values
- Simplified queries from multi-value IN clauses to single status checks
- Eliminated redundant derived state storage

### Technical Debt Remaining

- Run database migration to normalize existing data
- Historical data queries still need to handle legacy values
- Some display logic may need UI updates for new model

---

## Template for Future Entries

```markdown
## YYYY-MM-DD: [Brief Title]

### Session Summary
[1-2 sentence overview]

### 1. [Change Title]

**Problem:**
[What was wrong]

**Root Cause:**
[Why it was wrong]

**Solution:**
[How it was fixed]

**Files Changed:**
- `path/to/file.ts` - [what changed]

**Design Decision:**
[Why this approach was chosen over alternatives]
```
