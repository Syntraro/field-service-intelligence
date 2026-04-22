# Visit Mutation Architecture — Implementation Plan
## Syntraro, 2026-04-21. Audit + planning only. Read-only. No code.

---

## 1. Executive Decision

**Chosen model: Model B.**

**Canonical visit write engine:** `server/services/jobLifecycleOrchestrator.ts`.
It owns every operational mutation on `job_visits` — schedule, crew, status transitions, completion, reopen, spawn-on-actioned. One narrow direct PATCH route is retained for exactly two lightweight metadata fields: `visitNotes` and `equipmentIds`.

Why Model B over Model A:

- The orchestrator **already owns** `completeVisit`, `reopenVisit`, `rescheduleVisit` (with actioned-visit spawn protection), `setVisitEnRoute`, `startVisit`, `pauseVisit`, `resumeVisit`, `cancelVisitRoute`, `cancelVisitStart`, `cancelVisit`, `bulkCompleteVisits`. Moving the remaining operational writes into it is incremental, not a rewrite.
- `visitNotes` changes have **no lifecycle side effects**: no spawn, no time entries, no job reconciliation, no schedule sync, no single-active-visit guard. Routing them through an orchestrator intent would add ceremony with zero benefit.
- `equipmentIds` on `job_visits` is a **presentational/scoping field** (which equipment to pre-load into the mobile tech view for this visit). It does not gate any lifecycle transition. Same reasoning as notes.
- The existing non-terminal status route (`POST /api/jobs/:jobId/visits/:visitId/status`) does contradict Model B (status is operational) and must be redirected to the orchestrator.
- Crew updates (today split across three endpoints) are operational — crew carries schedule implications and single-active-visit implications — so they must become orchestrator-owned.
- PATCH `/api/jobs/:jobId/visits/:visitId` today accepts a **wide payload** (schedule + crew + equipment + notes + duration). This is the core source of the duplicate-write-path problem: it is the one route that can bypass orchestrator protection for schedule and crew changes. Narrowing it resolves the Critical finding from the prior audit.
- The orchestrator's actioned-visit spawn logic is implemented **inline** in `rescheduleVisit` (file:1870, guard `isVisitActioned` at `server/storage/jobVisits.ts:1008`). Any write path that touches schedule fields outside this method silently skips that protection. Narrowing the direct route eliminates that class of bug by construction.
- Tech-app operational endpoints (`/api/tech/visits/:id/{en-route|start|pause|resume|complete|...}`) are already orchestrator-backed. Nothing to change there; the tech app is already compliant with Model B.

**Non-goal clarification:** Model B does NOT mean "keep two endpoints for every field." It means: one canonical operational route per operation, plus ONE narrow PATCH for two explicitly named metadata fields. If Model B is violated later (e.g., someone adds `scheduledStart` back to the narrow PATCH), the architecture is broken.

---

## 2. Visit Mutation Surface Map

| # | Surface | File / function | Route called | Backend owner | Fields touched | Side effects | Safety | Disposition |
|---|---|---|---|---|---|---|---|---|
| 1 | `EditVisitModal.editMutation` (metadata fallback path) | `client/src/components/visits/EditVisitModal.tsx:254-258, 378-383` | `PATCH /api/jobs/:jobId/visits/:visitId` | `jobVisitsRepository.updateJobVisit` (direct storage) | `scheduledStart, scheduledEnd, isAllDay, estimatedDurationMinutes, assignedTechnicianIds, visitNotes` | toast + cache invalidation | **Unsafe** — sends schedule + crew to non-orchestrator route. Triggered whenever the launcher is mounted without dispatch callbacks (Dashboard). | **Narrow** — payload reduced to `{visitNotes, equipmentIds, version}` only |
| 2 | `EditVisitModal.completeMutation` | `client/src/components/visits/EditVisitModal.tsx:291-295` | `POST /api/jobs/:jobId/visits/:visitId/complete` | `lifecycle.completeVisit` | status, outcome, timestamps; reconciliation | dispatch SSE, reconciliation, time-entry cleanup, job note | **Safe** | **Redirect** — consume `completeVisitWithOutcome` from `useDispatchPreviewMutations` for consistent optimistic patching |
| 3 | `EditVisitModal.deleteMutation` | `client/src/components/visits/EditVisitModal.tsx:260-289` | `DELETE /api/jobs/:jobId/visits/:visitId` | `jobVisitsRepository.deleteJobVisit` + route-level `lifecycle.placeJobOnHold` if last visit | soft delete (`isActive=false`); may place job on_hold | calendar/unscheduled cache patching | **Partial** — hybrid route calls orchestrator for parent-job side effect; the delete itself is direct storage. Acceptable. | **Keep** as-is |
| 4 | `EditVisitModal.handleSave` dispatch-callback path | `client/src/components/visits/EditVisitModal.tsx:347-377` | Forwards to `onDispatchSchedule` / `onDispatchReschedule` | `useDispatchPreviewMutations.scheduleVisit` / `rescheduleVisit` → `POST /api/calendar/schedule` or `PATCH /api/calendar/visit/:id/reschedule` → `lifecycle.rescheduleVisit` | schedule + crew + notes | spawn-on-actioned, dispatch SSE, event log | **Safe** when callbacks are provided. **Unsafe** when callbacks are absent (Dashboard mount) — falls back to Surface #1. | **Keep**, but make callbacks mandatory for schedule/crew changes (see Section 5) |
| 5 | `EditVisitModal` equipment state | `client/src/components/visits/EditVisitModal.tsx:184, 234-245, 510-516` | — | — | `selectedEquipmentIds` tracked locally; **never written** | none (ephemeral) | **Broken** — user can select equipment in the modal and it is silently discarded on save. See Section 7. | **Redirect** — include `equipmentIds` in the narrow PATCH payload |
| 6 | `EditVisitModal.addLineItemMutation` | `client/src/components/visits/EditVisitModal.tsx:307-315` | `POST /api/jobs/:jobId/parts` | job parts repository | job parts (not visit scope) | line-item cache invalidation | **Safe** — operates on job, not visit. Out of this plan's scope. | **Keep** |
| 7 | `useDispatchPreviewMutations.scheduleVisit` | `client/src/components/dispatch/useDispatchPreviewMutations.ts:733-799` | `POST /api/calendar/schedule` | `schedulingRepository.scheduleJob` (storage, NOT orchestrator) | schedule + crew for create-or-update-placeholder | dispatch SSE, notifications | **Partial** — direct storage path. Safe because no spawn logic needed on create (no actioned visit). | **Keep**; document why it is storage-direct |
| 8 | `useDispatchPreviewMutations.rescheduleVisit` | `client/src/components/dispatch/useDispatchPreviewMutations.ts:802-866` | `PATCH /api/calendar/visit/:id/reschedule` | `lifecycle.rescheduleVisit` | schedule + crew + notes | spawn, dispatch SSE | **Safe** | **Canonical** — this is the target for all schedule + crew edits |
| 9 | `useDispatchPreviewMutations.unscheduleVisit` | `client/src/components/dispatch/useDispatchPreviewMutations.ts:~887` | `POST /api/calendar/visit/:id/unschedule` | `schedulingRepository.unscheduleVisit` (storage) | clears `scheduledStart, scheduledEnd, isAllDay` | dispatch SSE, event log | **Partial** — storage-direct, but unschedule has no actioned-visit implication because the server rejects unscheduling an actioned visit today (verify). | **Keep**; confirm route rejects actioned visits |
| 10 | `useDispatchPreviewMutations.resizeVisit` | `client/src/components/dispatch/useDispatchPreviewMutations.ts:~939` | `POST /api/calendar/visit/:id/resize` | `schedulingRepository` (storage) | `scheduledEnd` only | dispatch SSE | **Partial** — storage-direct. Same spawn-risk as reschedule if visit is actioned. | **Redirect** — route resize through `lifecycle.rescheduleVisit(mode: "replace")` or add an equivalent intent method |
| 11 | `useDispatchPreviewMutations.updateVisitCrew` | `client/src/components/dispatch/useDispatchPreviewMutations.ts:1002-1031` | `PATCH /api/calendar/visit/:id/assign-crew` | `schedulingRepository.updateVisitCrew` (storage, NOT orchestrator) | `assignedTechnicianIds` only | dispatch SSE, event log | **Unsafe** — crew change on an actioned visit can bypass single-active-visit invariants. | **Redirect** — handler becomes thin delegator to a new `lifecycle.assignVisitCrew` intent. See Section 9. |
| 12 | `useDispatchPreviewMutations.updateVisitStatus` | `client/src/components/dispatch/useDispatchPreviewMutations.ts:1035-1051` | `POST /api/jobs/:jobId/visits/:visitId/status` | `jobVisitsRepository.updateJobVisitStatus` (direct storage) | `status` only | dispatch SSE, event log for visit.started | **Unsafe** — sets `on_hold`, `paused`, etc. directly without enforcing invariants (e.g., no time-entry cleanup, no single-active-visit guard). | **Redirect** — route handler becomes thin delegator to the correct orchestrator method per target status. See Section 10. |
| 13 | `useDispatchPreviewMutations.completeVisitWithOutcome` | `client/src/components/dispatch/useDispatchPreviewMutations.ts:1058-1116` | `POST /api/jobs/:jobId/visits/:visitId/complete` | `lifecycle.completeVisit` | terminal state | reconciliation, time-entry cleanup, job note | **Safe** | **Canonical** — EditVisitModal's own `completeMutation` should migrate to this |
| 14 | `useDispatchPreviewMutations.reopenVisit` | `client/src/components/dispatch/useDispatchPreviewMutations.ts:1123-1151` | `POST /api/jobs/:jobId/visits/:visitId/reopen` | `lifecycle.reopenVisit` | reset to scheduled; may reopen parent job | reconciliation, dispatch SSE | **Safe** | **Canonical** |
| 15 | `useDispatchPreviewMutations.deleteVisit` | `client/src/components/dispatch/useDispatchPreviewMutations.ts` | `DELETE /api/jobs/:jobId/visits/:visitId` | same as Surface #3 | same | same | **Partial** | **Keep** (duplicate of Surface #3 in function, but both legitimately route through the same server handler) |
| 16 | `DispatchPreview.handleUpdateVisitNotes` (shadow inline apiRequest) | `client/src/pages/DispatchPreview.tsx:972-985` | `PATCH /api/jobs/:jobId/visits/:visitId` (inline `apiRequest`) | direct storage | `visitNotes` only | partial invalidation (only `["/api/calendar"]`) | **Dead code** — DispatchDetailPanel is never mounted for visits (confirmed at DispatchPreview.tsx:1405-1406). The handler is unreachable. | **Remove** the function and any references. Do not migrate. |
| 17 | `AddVisitDialog` custom mutation | `client/src/components/AddVisitDialog.tsx:87-91,123` | `POST /api/calendar/schedule` (same route, bespoke payload shape) | same as Surface #7 | schedule + crew (create path) | same | **Partial** — safe but duplicates payload assembly. | **Redirect** — consume `useDispatchPreviewMutations.scheduleVisit` |
| 18 | Tech app `useTechVisitDetail.*` — every lifecycle mutation | `client/src/tech-app/hooks/useTechVisitDetail.ts` | `POST /api/tech/visits/:visitId/{en-route,start,pause,resume,complete,cancel-route,cancel-start}` | orchestrator (confirmed) | per-op | per-op | **Safe** | **Keep** |
| 19 | Tech app notes / parts / equipment mutations | `client/src/tech-app/hooks/useTechVisitDetail.ts` (addNote, addPart, addEquipment, etc.) | `/api/tech/visits/:visitId/{notes, parts, equipment, location-equipment}` | storage (jobNotesRepository / jobRepository.createJobEquipment / createLocationEquipment) | notes / `job_equipment` join / `location_equipment` | dispatch SSE | **Safe** — tech endpoints write to different tables than the office metadata (`job_visits.equipmentIds`). See Section 7. | **Keep** |
| 20 | `PATCH /api/jobs/:id` with lifecycle fields | `server/routes/jobs.ts:261` | route itself | storage (non-lifecycle) / orchestrator (lifecycle fields rejected at schema per `updateJobSchema`) | non-lifecycle job fields | dispatch SSE on scheduling change | **Safe** — confirmed lifecycle fields rejected at schema (2026-03-18 baseline). | **Keep** |

---

## 3. Visit Field Ownership Matrix

| Field / operation | Current mutation paths | Recommended owner | Why | Migration notes |
|---|---|---|---|---|
| `scheduledStart`, `scheduledEnd`, `isAllDay` | (a) PATCH `/api/jobs/:jobId/visits/:visitId` direct; (b) PATCH `/api/calendar/visit/:id/reschedule` orchestrator; (c) POST `/api/calendar/visit/:id/resize` direct | **Orchestrator** (`lifecycle.rescheduleVisit`) | Actioned-visit spawn protection is implemented only here; any other write path silently skips it. | Remove schedule fields from the narrow PATCH schema. Route `resize` through `lifecycle.rescheduleVisit(mode:"replace")` or an explicit `lifecycle.resizeVisit` intent. |
| `estimatedDurationMinutes` | Same wide PATCH | **Orchestrator** (`lifecycle.rescheduleVisit`) — bundled with endAt change | Duration is a derived property of `scheduledEnd - scheduledStart`; treating it as an independent field caused drift. | Remove from narrow PATCH schema. Client computes `endAt` from `startAt + duration` before calling reschedule. |
| `assignedTechnicianIds` (office) | (a) PATCH visit (wide payload, `assignedTechnicianIds`); (b) PATCH reschedule (`assignedTechnicianIds`, nullable-optional tri-state); (c) PATCH assign-crew (`technicianUserIds`, required min 1) | **Orchestrator** — single method `lifecycle.assignVisitCrew`, single field name `assignedTechnicianIds` | Crew change must respect single-active-visit guard, actioned-visit implications, and schedule implications. | Rename `technicianUserIds` → `assignedTechnicianIds` in `assignCrewSchema`. Remove crew from narrow PATCH and from reschedule's overloaded signature (reschedule keeps crew bundling only when schedule is also changing). See Section 9. |
| `assignedTechnicianIds` (tech) | N/A (tech app has no crew-mutation endpoint; crew is office-controlled) | Unchanged | Tech never reassigns crew. | No change. |
| `status` (non-terminal: scheduled / dispatched / en_route / on_site / in_progress / paused / on_hold) | (a) POST `/api/jobs/:jobId/visits/:visitId/status` direct storage (office); (b) POST `/api/tech/visits/:id/{en-route,start,pause,resume,cancel-route,cancel-start}` orchestrator (tech) | **Orchestrator** — office route becomes thin delegator to the correct lifecycle method per target status | Tech path is already compliant. Office path bypasses time-entry cleanup, single-active-visit guard, schedule sync. | The existing direct route must map target status to orchestrator method (see Section 10). |
| `status=completed` | POST `/api/jobs/:jobId/visits/:visitId/complete` → `lifecycle.completeVisit` | **Orchestrator** (already) | Cannot be changed. | No migration needed. |
| `status=cancelled` | `lifecycle.cancelVisit` exists; no direct UI-triggered route today beyond `/status` with direct storage | **Orchestrator** (`lifecycle.cancelVisit`) | Cancel triggers time-entry cleanup + potential reconciliation. | Make sure any cancel UI call routes through the orchestrator method via the redirected `/status` endpoint. |
| `outcome`, `outcomeNote`, `completedAt`, `completedByUserId`, `previousStatus`, `checkedInAt`, `checkedOutAt`, `isFollowUpNeeded` | `lifecycle.completeVisit`, `lifecycle.reopenVisit`, `lifecycle.startVisit`, etc. | **Orchestrator** (already, fully) | These are all operational lifecycle fields only the orchestrator writes. | Confirm no client surface writes these directly. |
| `visitNotes` | (a) PATCH visit wide payload (client today, via EditVisitModal editMutation and reschedule-via-dispatch); (b) `PATCH /api/calendar/visit/:id/reschedule` `notes` field (via orchestrator spawn); (c) `DispatchPreview.handleUpdateVisitNotes` inline (dead) | **Narrow direct route** (`PATCH /api/jobs/:jobId/visits/:visitId`, restricted to `{visitNotes, equipmentIds, version}`) | No lifecycle side effects; no spawn; no reconciliation; no time entries. | Field name stays `visitNotes` on the narrow route. Reschedule keeps accepting `notes` as a bundled pass-through into the orchestrator (already converted internally). |
| `equipmentIds` (on `job_visits` array column) | PATCH visit wide payload accepts it server-side; **EditVisitModal never sends it** (ephemeral today) | **Narrow direct route** (same narrow PATCH) | Visit-scoped equipment selection is a pre-filter for the mobile tech view, not a lifecycle fact. | EditVisitModal's `handleSave` must include `equipmentIds: selectedEquipmentIds` in the narrow payload. See Section 7. |
| Hold fields on visit (none) | — | N/A | Visit has no hold fields. Hold lives on the parent job (`jobs.holdReason`, `jobs.holdNotes`, `jobs.nextActionDate`, `jobs.onHoldAt`, `jobs.openSubStatus="on_hold"`). | Out of scope for this plan (job-level, already orchestrator-owned). |
| Follow-up / spawn | `lifecycle.rescheduleVisit` (inline spawn); completion with `outcome=needs_parts` or `needs_followup` places job on hold but does NOT spawn a new visit | **Orchestrator** (already) | No fixes needed architecturally. | Confirmed: orchestrator does not auto-spawn follow-up visits on completion-with-hold-reason; that is user-driven. |
| `isActive` (soft-delete flag) | `jobVisitsRepository.deleteJobVisit` (direct) + route-level `lifecycle.placeJobOnHold` if last visit | **Hybrid** — direct storage for the delete itself, orchestrator for the parent-job side effect (unchanged) | Delete has its own dedicated route that already composes correctly. | Keep. |
| `archivedAt`, `archivedByUserId`, `archivedReason` | POST `/api/jobs/:jobId/visits/:visitId/archive` | **Direct storage** via dedicated endpoint | Archive is intentionally distinct from soft-delete. | Out of scope for narrowing. Keep. |
| `version` | Sent on every orchestrator/direct call; managed server-side via optimistic locking | N/A | Version is not a user-mutable field. | Keep. |

---

## 4. Route Ownership Plan

| Route | Current state | Target state |
|---|---|---|
| `POST /api/jobs/:jobId/visits` (create visit on job) | Direct storage | **Keep as-is.** Visit creation does not need spawn protection (no actioned visit exists yet). |
| `PATCH /api/jobs/:jobId/visits/:visitId` | Wide direct-storage PATCH (schedule + crew + equipment + notes + duration) | **Narrow direct route.** Schema reduced to `{visitNotes?: string \| null, equipmentIds?: string[] \| null, version: number}`. All other fields rejected by schema. Direct storage is acceptable for these two fields. |
| `DELETE /api/jobs/:jobId/visits/:visitId` | Direct storage + conditional `lifecycle.placeJobOnHold` | **Keep.** Already composes correctly. |
| `POST /api/jobs/:jobId/visits/:visitId/status` | Direct storage (`jobVisitsRepository.updateJobVisitStatus`) | **Wrapper/delegator.** Handler maps target status to the correct orchestrator method: `scheduled`→special-case (revert from completed is `reopen`, else no-op), `dispatched`→no orchestrator method needed, `en_route`→`setVisitEnRoute`, `on_site`/`in_progress`→`startVisit`, `paused`→`pauseVisit`, `on_hold`→reject (hold is job-level), `cancelled`→`cancelVisit`. See Section 10. |
| `POST /api/jobs/:jobId/visits/:visitId/complete` | Orchestrator (`lifecycle.completeVisit`) | **Canonical.** Keep. |
| `POST /api/jobs/:jobId/visits/:visitId/reopen` | Orchestrator (`lifecycle.reopenVisit`) | **Canonical.** Keep. |
| `POST /api/jobs/:jobId/visits/:visitId/archive` | Direct storage | **Keep.** |
| `POST /api/jobs/:jobId/visits/:visitId/arrived` | Event log only (no mutation) | **Keep.** |
| `POST /api/jobs/:jobId/visits/:visitId/departed` | Event log only | **Keep.** |
| `POST /api/calendar/schedule` | Storage (`schedulingRepository.scheduleJob`) — create or update placeholder | **Keep.** Not a reschedule of an actioned visit; spawn protection is not needed for placeholder promotion. |
| `PATCH /api/calendar/visit/:visitId/reschedule` | Orchestrator (`lifecycle.rescheduleVisit`, spawn-on-actioned) | **Canonical.** Keep. Field-name vocabulary: `startAt` / `endAt` / `allDay` / `notes` / `assignedTechnicianIds` / `version` / `mode`. This is the canonical vocabulary for reschedule operations. |
| `POST /api/calendar/visit/:visitId/unschedule` | Storage (`schedulingRepository.unscheduleVisit`) | **Narrow direct route.** Unschedule on an actioned visit must be rejected server-side; verify today's handler does so (open risk if not). If not, route through a new `lifecycle.unscheduleVisit` intent. |
| `POST /api/calendar/visit/:visitId/resize` | Storage | **Wrapper/delegator.** Handler calls `lifecycle.rescheduleVisit(mode:"replace")` with the computed `startAt`/`endAt`. This closes the actioned-visit gap for drag-resize. |
| `PATCH /api/calendar/visit/:visitId/assign-crew` | Storage (`schedulingRepository.updateVisitCrew`) | **Wrapper/delegator to new `lifecycle.assignVisitCrew`.** Field rename: `technicianUserIds` → `assignedTechnicianIds`. See Section 9. |
| `POST /api/calendar/bulk-unschedule` | Storage (iterates unschedule) | **Keep** unless unschedule gains lifecycle semantics. Aligned with the individual unschedule endpoint. |
| `POST /api/tech/visits/:visitId/en-route` | Orchestrator (`setVisitEnRoute`) | **Canonical, tech-only.** Keep. |
| `POST /api/tech/visits/:visitId/start` | Orchestrator (`startVisit`) | **Canonical, tech-only.** Keep. |
| `POST /api/tech/visits/:visitId/pause` | Orchestrator (`pauseVisit`) | **Canonical, tech-only.** Keep. |
| `POST /api/tech/visits/:visitId/resume` | Orchestrator (`resumeVisit`) | **Canonical, tech-only.** Keep. |
| `POST /api/tech/visits/:visitId/cancel-route` | Orchestrator (`cancelVisitRoute`) | **Canonical, tech-only.** Keep. |
| `POST /api/tech/visits/:visitId/cancel-start` | Orchestrator (`cancelVisitStart`) | **Canonical, tech-only.** Keep. |
| `POST /api/tech/visits/:visitId/complete` | Orchestrator (`completeVisit`) | **Canonical, tech-only.** Keep. |
| `PATCH /api/tech/visits/:visitId` | Storage no-op (only version) | **Keep** or remove; not actively used. Optional cleanup outside this plan. |
| `POST /api/tech/visits/:visitId/notes` | Storage (`jobNotesRepository`) | **Keep.** Note write on a visit, lightweight metadata. |
| `POST /api/tech/visits/:visitId/equipment` | Storage (`jobRepository.createJobEquipment` — `job_equipment` join table) | **Keep.** Different table than the office metadata path. |
| `POST /api/tech/visits/:visitId/location-equipment` | Storage (creates `location_equipment` + `job_equipment`) | **Keep.** |

**Net route changes:** zero removals, three wrappers added (status, resize, assign-crew), one schema narrowed (PATCH visit). No new endpoints.

---

## 5. Client Hook / UI Migration Plan

| Client surface | Current mutation path | Target mutation path | Exact hook/helper | Remove inline? | Behavior change |
|---|---|---|---|---|---|
| `EditVisitModal.editMutation` (schedule/crew fallback) | Direct PATCH wide payload | **None** — cannot save schedule/crew this way anymore | Route schedule/crew through `useDispatchPreviewMutations.scheduleVisit` / `rescheduleVisit` always (see next row) | Yes — restrict this mutation to metadata-only | Modal save uses `editMutation` only for metadata (notes, equipment); schedule/crew always routes through dispatch callbacks |
| `EditVisitModal` → VisitEditorLauncher dispatch callbacks | Optional props (absent on Dashboard) | **Required** props, always wired to `useDispatchPreviewMutations.scheduleVisit` / `rescheduleVisit` / `assignVisitCrew` | `useDispatchPreviewMutations` | No inline mutation change, but props must become required | Dashboard launcher mount must pass the callbacks. This is how the "Dashboard edit → direct unsafe path" bug (the Critical finding) closes. |
| `EditVisitModal.handleSave` schedule-with-crew branches | `onDispatchSchedule` / `onDispatchReschedule` | Same, but always available (callbacks mandatory) | Same | — | Unschedule (clearing schedule) should route through a dedicated unschedule mutation, not through the metadata PATCH. |
| `EditVisitModal.handleUnschedule` | `editMutation.mutate({scheduledStart:null, scheduledEnd:null})` (currently hits narrow PATCH post-migration — will break) | `useDispatchPreviewMutations.unscheduleVisit({visitId, version})` | `useDispatchPreviewMutations.unscheduleVisit` | Yes | Modal's unschedule button fires a separate mutation from save |
| `EditVisitModal` equipment selection | Ephemeral (not saved) | Included in narrow PATCH payload `{equipmentIds: selectedEquipmentIds}` | `editMutation` (post-narrowing) | — | Equipment selection now persists |
| `EditVisitModal.completeMutation` | Inline `useMutation` in modal | `useDispatchPreviewMutations.completeVisitWithOutcome` | Hook method | Yes — delete the inline mutation | Modal complete gets optimistic patching parity with dispatch |
| `EditVisitModal.deleteMutation` | Inline `useMutation` in modal | `useDispatchPreviewMutations.deleteVisit` | Hook method | Yes | Consistent invalidation; custom cache patching in the inline mutation migrates into the hook if the hook doesn't already do it. |
| `AddVisitDialog` create-visit mutation | Bespoke inline `apiRequest` with custom payload | `useDispatchPreviewMutations.scheduleVisit` | Hook method | Yes | Same endpoint, canonical payload shape |
| `DispatchPreview.handleUpdateVisitNotes` | Shadow inline `apiRequest` | **Remove** (dead code) | — | Yes | Callback unreachable; verify no other file wires `onUpdateVisitNotes` on DispatchDetailPanel |
| `DispatchDetailPanel` visit callback props (`onUpdateCrew`, `onUpdateStatus`, `onUpdateVisitNotes`, `onReschedule`, `onResize`) | Dead (panel is task-only for visits) | **Remove from interface** or mark explicitly task-only | — | Yes, remove the unused prop definitions and their internal wiring inside VisitDetail | Cleans dead wiring so future developers don't reintroduce shadow paths |
| `useDispatchPreviewMutations.updateVisitStatus` | POST `/visits/:id/status` direct-storage route | Same route, but route is now a wrapper/delegator (server-side change) | Unchanged on client | No | Client code unchanged; server change tightens safety |
| `useDispatchPreviewMutations.resizeVisit` | POST `/visits/:id/resize` direct storage | Same route, now wraps `lifecycle.rescheduleVisit(mode:"replace")` server-side | Unchanged on client | No | Client unchanged; server change closes spawn gap |
| `useDispatchPreviewMutations.updateVisitCrew` | PATCH `/visit/:id/assign-crew` direct storage, field `technicianUserIds` | Same route, wraps `lifecycle.assignVisitCrew`; field renamed `assignedTechnicianIds` | Update the hook's payload shape | No | Field rename only; behavior identical client-side |
| Tech app hooks | Orchestrator-backed | Unchanged | — | — | No change |

**Key point:** The Dashboard bug is fixed **not** by changing Dashboard code, but by making VisitEditorLauncher's dispatch callbacks mandatory (or by moving the wiring into the launcher itself). Dashboard.tsx:381-388 only needs to be updated to pass the hook's callbacks.

---

## 6. Schema Contract Normalization Plan

| Inconsistency | Current names | Target canonical name | Files impacted | Migration risk |
|---|---|---|---|---|
| Crew field name | `technicianUserIds` (assign-crew route), `assignedTechnicianIds` (everywhere else) | `assignedTechnicianIds` | `server/routes/scheduling.ts` (`assignCrewSchema`), `client/src/components/dispatch/useDispatchPreviewMutations.ts` (UpdateCrewParams), any test payloads | Low — one route, one client hook, field rename in lockstep. Confirm no external consumers. |
| Time field names | Reschedule uses `startAt` / `endAt` / `allDay`; narrow PATCH currently uses `scheduledStart` / `scheduledEnd` / `isAllDay`; storage column names are `scheduledStart` / `scheduledEnd` / `isAllDay` | Schedule fields are **removed** from narrow PATCH (Section 3), so vocabulary difference no longer matters on the wire. Reschedule keeps `startAt` / `endAt` / `allDay` as operational vocabulary. Internal storage keeps its column names. | `server/routes/jobVisits.routes.ts` (remove fields from `updateVisitSchema`), `client/src/components/visits/EditVisitModal.tsx` (remove fields from payload) | Zero wire change on reschedule. Low risk. |
| Notes field name | Reschedule schema accepts `notes`; narrow PATCH and storage use `visitNotes` | Reschedule's `notes` is a convenience alias that the orchestrator writes to `visit_notes` — confirm this is documented; keep the reschedule alias (it's ergonomic for the dispatch hook). Narrow PATCH uses `visitNotes`. | No change; document the alias | Zero |
| Visit outcome enum | Canonical at `shared/schema.ts:2834`; redefined inline at `server/routes/techField.ts` | Import from shared | `server/routes/techField.ts` | Low — pure schema import change |
| Hold reason / status enum duplication | `server/schemas.ts:32,41,49,64` parallel Zod enums vs `shared/schema.ts` arrays | Derive server Zod enums from shared arrays | `server/schemas.ts`, any route that imports from it | Low — one compile-time verification away |
| `updateVisitSchema` (PATCH visit) payload | Accepts 7 fields: `scheduledDate, scheduledStart, scheduledEnd, isAllDay, estimatedDurationMinutes, assignedTechnicianIds, equipmentIds, visitNotes` | Accepts 2 fields: `visitNotes, equipmentIds` + `version` | `server/routes/jobVisits.routes.ts` | Medium — the narrowing is the core of this plan; any caller still sending rejected fields gets a 400, so all callers must be migrated first |

---

## 7. Equipment Resolution

**Investigation finding (definitive):**

`EditVisitModal.tsx:184, 234-245, 510-516` tracks `selectedEquipmentIds` in local state via `EquipmentPicker`'s `onChange`. The save flow at lines 347-384 builds a payload that includes `visitNotes`, `scheduledStart`, `scheduledEnd`, `isAllDay`, `estimatedDurationMinutes`, `assignedTechnicianIds` — **but not `equipmentIds`**. The modal's own comment at line 361 states "Equipment mutations go through canonical job_equipment routes, NOT the visit PATCH", yet no such mutation call exists in the file. Equipment selection made in EditVisitModal is silently discarded on save.

Meanwhile:
- `server/routes/jobVisits.routes.ts:131` schema DOES accept `equipmentIds: z.array(z.string()).nullable().optional()` and writes it to `job_visits.equipmentIds` via `jobVisitsRepository.updateJobVisit`.
- `server/routes/techField.ts:1049` accepts POST equipment on a tech visit and writes to the **`job_equipment` join table** (job-scoped, not visit-scoped).
- `client/src/components/EquipmentPicker.tsx` only creates equipment and reports back via `onChange` — it does not itself persist the visit-level selection.

So the two persistence paths target different tables:
- `job_equipment` (join table, job-scoped) — tech-app adds equipment from the field.
- `job_visits.equipmentIds` (array column, visit-scoped) — office selects which subset of job equipment should be pre-loaded for a specific visit. This column is **writable server-side but no client actually writes to it today.**

**Recommendation (definitive):**

Equipment on a visit is **metadata**, not a lifecycle operation. No spawn, no time entries, no reconciliation. It is a pre-filter for the tech's mobile view. Therefore:

1. **Keep `equipmentIds` on the narrow direct PATCH route** (`PATCH /api/jobs/:jobId/visits/:visitId`, schema `{visitNotes?, equipmentIds?, version}`).
2. **Fix the silent-discard bug** in EditVisitModal by including `equipmentIds: selectedEquipmentIds` in the save payload. This resurrects a feature the UI claims to offer.
3. **Do NOT make equipment orchestrator-aware.** There is no invariant that requires it.
4. **Tech-app `/api/tech/visits/:id/equipment` stays as-is** — it writes to a different table (`job_equipment`), serves a different purpose (job-scope add-equipment-from-field), and is already correct.

Confidence: High. The bug is visible in EditVisitModal.tsx lines 347-384 (no `equipmentIds` in payload assembly) and the route schema demonstrably accepts the field (server/routes/jobVisits.routes.ts:131).

---

## 8. Notes Resolution

**Recommendation (definitive):**

Visit notes are **metadata** and belong on the **narrow direct PATCH route** (`PATCH /api/jobs/:jobId/visits/:visitId`, field `visitNotes`).

Reasons:
- No lifecycle side effects.
- Reschedule already accepts `notes` as an ergonomic bundle when the user is rescheduling anyway; keep that alias but it is **not the canonical notes-only mutation** — it is an ergonomic optimization inside the reschedule call.
- The dead `DispatchPreview.handleUpdateVisitNotes` is removed (Section 2, Surface #16), so the shadow mutation goes away entirely without a migration.
- EditVisitModal's `editMutation` (post-narrowing) is the single notes-save path.

On the client, a `useDispatchPreviewMutations.updateVisitNotes` hook method may optionally be added as a convenience wrapper over the narrow PATCH, with consistent invalidation keys `["visit-detail", visitId]`, `["visits"]`, `["jobs"]`, `["/api/calendar"]`, `["/api/calendar/unscheduled"]`, `["dashboard"]`. This is optional — EditVisitModal's current `editMutation` already invalidates the correct keys (file:249).

Confidence: High.

---

## 9. Crew Resolution

**Recommendation (definitive):**

One contract: `lifecycle.assignVisitCrew({visitId, assignedTechnicianIds, version})`. Route: `PATCH /api/calendar/visit/:visitId/assign-crew`, renamed payload field `assignedTechnicianIds` (was `technicianUserIds`). The existing `PATCH /api/calendar/visit/:id/reschedule` keeps its optional `assignedTechnicianIds` field as an ergonomic bundle when both schedule and crew are changing in the same user action — the orchestrator internally delegates the crew portion to the same invariants as `assignVisitCrew`.

Rationale:
- Crew change must respect the single-active-visit guard the orchestrator enforces on `setVisitEnRoute` / `startVisit` / `resumeVisit`.
- Crew change on an actioned visit is a policy question the orchestrator should own (reject? spawn? just update?). Direct-storage bypasses that decision.
- The wide PATCH visit route **must stop accepting crew** (Section 3, 4, 6) — this removes the "three crew paths" problem at the source.
- The orchestrator method `assignVisitCrew` does NOT need to exist today; it is a new thin method that wraps the existing `schedulingRepository.updateVisitCrew` plus the invariants check. Given the orchestrator already has similar guard patterns (ACTIVE_VISIT_CONFLICT in `setVisitEnRoute` etc.), this is a small addition.
- Field-name normalization to `assignedTechnicianIds` across all visit endpoints is a prerequisite for Model B consistency.

Confidence: High.

**Rejected alternatives:**
- **Crew-only fold into reschedule:** Rejected because dispatchers change crew without changing schedule (e.g., swap techs on the same visit), so a dedicated endpoint is ergonomically correct.
- **Keep three endpoints:** Rejected — that is the current broken state.

---

## 10. Status Resolution

**Recommendation (definitive):**

All visit status transitions go through the orchestrator. The office route `POST /api/jobs/:jobId/visits/:visitId/status` becomes a **thin wrapper/delegator** that maps target status to the correct orchestrator method:

| Target status | Handler action |
|---|---|
| `scheduled` | If current status is terminal → route to `lifecycle.reopenVisit`. If current is `en_route` → route to `lifecycle.cancelVisitRoute`. If current is `in_progress` → route to `lifecycle.cancelVisitStart`. Else: 400 (no-op or illegal). |
| `dispatched` | No orchestrator method needed today — this is a display-only soft-assignment. Retain direct-storage write here OR remove the status entirely if unused (verify via grep). Likely removable. |
| `en_route` | Route to `lifecycle.setVisitEnRoute`. |
| `on_site` / `in_progress` | Route to `lifecycle.startVisit`. |
| `paused` | Route to `lifecycle.pauseVisit`. |
| `cancelled` | Route to `lifecycle.cancelVisit`. |
| `completed` | **Reject with 400.** Force callers to use `/complete` (which already delegates to `lifecycle.completeVisit`). Matches today's behavior. |
| `on_hold` | **Reject with 400.** Hold is a job-level concept, not a visit-level concept. |

Tech-app status transitions already go through orchestrator methods via dedicated endpoints (`/api/tech/visits/:id/{en-route,start,pause,...}`). The `POST /status` office route is for dispatcher-side status manipulation (e.g., "manually set en_route without the tech's app") and must mirror the same orchestrator methods.

Direct storage writes to `job_visits.status` outside the orchestrator are prohibited after this migration. `jobVisitsRepository.updateJobVisitStatus` becomes an internal helper called only by the orchestrator (or removed).

Confidence: High.

---

## 11. DispatchDetailPanel vs EditVisitModal Decision

**Rule (definitive):**

**EditVisitModal is the only visit-editing surface in the office app.** `DispatchDetailPanel` is NOT an editing surface for visits and must not become one.

This is not a new rule — it is the **existing state** of the code (DispatchPreview.tsx:1405-1406: "Floating panel is now only used for tasks. Real visits open EditVisitModal directly"). The prior audit's Shadow Finding #S4 overstated this: the dead callback props in `DispatchDetailPanel` (onUpdateCrew, onUpdateStatus, onUpdateVisitNotes, onReschedule, onResize) are unreachable. No duplicate editing surface exists in practice.

**Actions:**
- **Remove** `onUpdateCrew`, `onUpdateStatus`, `onUpdateVisitNotes`, `onReschedule`, `onResize` from `DispatchDetailPanel`'s visit prop interface.
- **Remove** the inline note textarea and crew picker inside VisitDetail in DispatchDetailPanel (they only render if the unused callbacks are wired, which they are not — confirm by grep; dead UI trees still compile but should not exist).
- **Remove** `DispatchPreview.handleUpdateVisitNotes` and every import it chains (shadow mutation).
- **Keep** `onUnschedule`, `onScheduleFromPanel`, and `onOpenVisitEditor` — these are task-scope or backlog-scope callbacks that legitimately exist. Verify.
- **Document at the top of `DispatchDetailPanel.tsx`**: "This component is visit-read-only. Visit edits go through EditVisitModal via VisitEditorLauncher. Do not add visit-write callbacks."

Drag operations on the dispatch grid (resize, reschedule, assign-crew by dropping into a new lane) continue to call `useDispatchPreviewMutations.{resizeVisit, rescheduleVisit, updateVisitCrew}` directly. Those are **not** editing-surface mutations — they are dispatch-grid operations, they remain. Their safety is handled by the server-side wrapper/delegator conversions in Section 4.

Why this rule is correct:
- Performance: drag operations need optimistic patching, which `useDispatchPreviewMutations` provides. EditVisitModal does not need that performance profile.
- Duplication minimization: one editing UI, period.
- Already the current state: we are codifying existing intent, not changing behavior.

Confidence: High.

---

## 12. Required Tests Before Implementation

Vitest is configured (`vitest.config.ts`) with 10+ existing visit-mutation test files under `tests/`. Step 0 is "build on these," NOT "create from scratch."

### Scenarios that must be green before migration begins:

- [ ] **Existing BP-3/BP-4 suite still passes** (`tests/bp3-bp4-visit-workflow-ownership.test.ts`) — baseline en-route/start coverage.
- [ ] **Existing tech workflow controls suite still passes** (`tests/tech-visit-workflow-controls.test.ts`) — cancel-route, cancel-start, pause, resume, bulk-complete.
- [ ] **Existing crew authority suite still passes** (`tests/job-assignment-visit-authority.test.ts`) — `updateVisitCrew`, deriveJobCrew, visit-list crew.
- [ ] **Existing visit selection invariants still pass** (`tests/visit-selection-invariants.test.ts`) — spawn-on-action rule.
- [ ] **Existing scheduling smoke still passes** (`tests/scheduling.smoke.test.ts`) — version conflict, RBAC.
- [ ] **Existing soft-delete guard still passes** (`tests/visit-write-softdelete-guard.test.ts`) — SQL-level inactive-visit protection.

### New scenarios to add BEFORE any server or client change:

- [ ] **T1 — Actioned-visit drag-reschedule protection.** Seed a visit, start it (labor entries exist), drag-reschedule via `useDispatchPreviewMutations.rescheduleVisit` path → asserts new visit spawned, old visit marked `isActive=false` or `status=completed` (per spawn mode).
- [ ] **T2 — Actioned-visit modal-save protection.** Same seed, call the target narrow PATCH route with schedule fields present → asserts **400 rejection** (schedule fields not allowed on narrow route). This locks in the narrowing.
- [ ] **T3 — Untouched-visit modal-save metadata-only.** Visit is scheduled but not started. PATCH narrow route with `{visitNotes, equipmentIds, version}` → asserts both persist, version increments, no status change, no spawn.
- [ ] **T4 — Equipment persistence regression.** PATCH narrow route with `{equipmentIds: [uuid1, uuid2], version}` → read back, assert `job_visits.equipmentIds` equals `[uuid1, uuid2]`. (This test will also flag the silent-discard bug if anyone reintroduces it in the client.)
- [ ] **T5 — Crew-only change on scheduled visit.** Call `PATCH /api/calendar/visit/:id/assign-crew` with renamed field `assignedTechnicianIds` → asserts crew persists, schedule unchanged, version increments, `job.assigned` event logged.
- [ ] **T6 — Crew-only change on actioned visit.** Call assign-crew on an in-progress visit → asserts orchestrator policy (accept with invariant check, or reject with a documented error). Decision recorded in the test.
- [ ] **T7 — Crew field rename acceptance.** Assert the route accepts `assignedTechnicianIds` and rejects `technicianUserIds` (post-migration). Before migration, inverse.
- [ ] **T8 — Status transition matrix via office route.** For each transition (`scheduled→en_route`, `en_route→in_progress`, `in_progress→paused`, `paused→in_progress`, `en_route→scheduled`, `in_progress→scheduled`, `→cancelled`), call `POST /api/jobs/:jobId/visits/:visitId/status` → assert routes to the correct orchestrator method and side effects fire (time entries, single-active-visit guard where applicable).
- [ ] **T9 — Status rejection matrix.** Call office route with `status=completed` → 400. Call with `status=on_hold` → 400.
- [ ] **T10 — Drag-resize on actioned visit.** Call `POST /api/calendar/visit/:id/resize` on an in-progress visit → asserts spawn (wrapper routes through `lifecycle.rescheduleVisit(mode:"replace")` or spawn fallback per orchestrator rules).
- [ ] **T11 — Unschedule on actioned visit.** Call `POST /api/calendar/visit/:id/unschedule` on an in-progress visit → asserts server behavior (reject with a documented error is the expected outcome; verify and pin in test).
- [ ] **T12 — Complete visit from modal vs dispatch parity.** Call `POST /api/jobs/:jobId/visits/:visitId/complete` from both code paths (modal's completeMutation, dispatch hook's completeVisitWithOutcome post-migration both use the same server route) → assert identical end state (visit.status=completed, outcome, timestamps, reconciliation).
- [ ] **T13 — Reopen parent job when reopening terminal visit.** Complete the only visit on a job, then reopen → assert parent job status reopens.
- [ ] **T14 — Dashboard-mount parity.** After VisitEditorLauncher callbacks are wired on Dashboard, a schedule change made from Dashboard hits `/api/calendar/visit/:id/reschedule` (orchestrator), not the narrow PATCH. This is the regression test for the specific bug this plan fixes. (Can be an integration test that asserts the outbound endpoint URL, or a unit test on the modal's save flow given callbacks are present.)
- [ ] **T15 — Notes invalidation coverage.** Update `visitNotes` via narrow PATCH → assert `["visit-detail"]`, `["visits"]`, `["jobs"]`, `["/api/calendar"]`, `["dashboard"]` invalidations fire (client test). Captures the prior audit's shadow-mutation risk for good.

### Tests NOT required because the surface is removed:

- DispatchDetailPanel visit-callback invocation tests — callbacks are removed (Section 11).
- `DispatchPreview.handleUpdateVisitNotes` tests — handler is removed.

### Action before implementation

Update `CLAUDE.md` to reflect that Vitest + tests/ exist (the file currently says "No automated test suite currently configured" — that is stale).

---

## 13. Safe Implementation Order

Each step has: files touched, why now, verification, rollback risk.

### Step 0 — Test baseline and gap-fill
- **Files:** `tests/*.test.ts` (additions only, no existing test modifications), `CLAUDE.md` (stale note fix)
- **Why now:** Locks in current behavior before changes. Adds the missing tests from Section 12 (T1–T15).
- **Verify:** `npm test` is green. All existing + new tests pass against unchanged code (some new tests are expected to FAIL initially — mark them as `test.fails` / `test.todo` with explicit pinning to expected post-migration behavior, so the migration steps turn them green).
- **Rollback risk:** None.

### Step 1 — Server: status route becomes orchestrator delegator
- **Files:** `server/routes/jobVisits.routes.ts` (POST `/status` handler), possibly add a helper in `server/services/jobLifecycleOrchestrator.ts` (e.g., `setVisitStatus(visitId, targetStatus)` that routes to the correct existing method, OR inline the mapping in the route handler).
- **Why now:** Smallest orchestrator consolidation, fully internal change, no client change, completes Finding #4.
- **Verify:** T8, T9 pass. Existing tests pass. Manual: dispatch detail actions that change status still work.
- **Rollback risk:** Low — single handler swap; revertible as one file diff.

### Step 2 — Server: resize route becomes orchestrator delegator
- **Files:** `server/routes/scheduling.ts` (POST `/resize` handler)
- **Why now:** Closes actioned-visit spawn gap on drag-resize. Isolated single-route change.
- **Verify:** T10 passes. Existing drag-resize tests pass.
- **Rollback risk:** Low.

### Step 3 — Server: assign-crew route rename + orchestrator delegator
- **Files:** `server/routes/scheduling.ts` (PATCH `/assign-crew` handler, rename `technicianUserIds` → `assignedTechnicianIds` in `assignCrewSchema`), `server/services/jobLifecycleOrchestrator.ts` (add `assignVisitCrew` intent method that wraps `schedulingRepository.updateVisitCrew` + invariants). Client: `client/src/components/dispatch/useDispatchPreviewMutations.ts` (update `UpdateCrewParams` body shape to `assignedTechnicianIds`).
- **Why now:** After the server-side wrapper pattern is proven in Steps 1 and 2. Field rename is in lockstep with the hook change.
- **Verify:** T5, T6, T7 pass. Existing crew authority tests pass.
- **Rollback risk:** Low-Medium — field rename is visible to the wire. Ship server + client together.

### Step 4 — Server: narrow PATCH `/api/jobs/:jobId/visits/:visitId` schema
- **Files:** `server/routes/jobVisits.routes.ts` (`updateVisitSchema` — remove `scheduledDate`, `scheduledStart`, `scheduledEnd`, `isAllDay`, `estimatedDurationMinutes`, `assignedTechnicianIds` fields; keep `visitNotes`, `equipmentIds`, `version`).
- **Why now:** This is THE source-of-truth change. All prior steps (status delegator, resize delegator, assign-crew delegator) have already absorbed every field this PATCH used to accept, EXCEPT `visitNotes` and `equipmentIds`. Every client surface that sent the now-rejected fields must be migrated in the same PR (Step 5 below). Must ship as an atomic pair.
- **Verify:** T2, T3, T4 pass. Any client still sending wide payloads returns 400 — this is caught by the client migration in Step 5.
- **Rollback risk:** Medium-High — narrowing a schema is a breaking change for any unmigrated caller. Ship with Step 5.

### Step 5 — Client: migrate EditVisitModal to the new contract
- **Files:**
  - `client/src/components/visits/EditVisitModal.tsx` — `handleSave` split:
    - Schedule/crew change → always via `onDispatchReschedule` / `onDispatchSchedule`; if not provided, surface must fail loudly (not fall back to direct PATCH).
    - Unschedule → call a new path that uses `useDispatchPreviewMutations.unscheduleVisit`.
    - Metadata save (notes, equipment) → `editMutation` with narrowed payload `{visitNotes, equipmentIds, version}`.
    - `completeMutation`, `deleteMutation` → consume from `useDispatchPreviewMutations`.
  - `client/src/components/dispatch/VisitEditorLauncher.tsx` — make the three dispatch callbacks **required** (or wire them internally to `useDispatchPreviewMutations` so callers don't need to pass them).
  - `client/src/pages/Dashboard.tsx` — update VisitEditorLauncher mount to satisfy the new required-callbacks contract (or rely on the internal wiring if you pick that approach).
  - `client/src/pages/DispatchPreview.tsx` — drop `handleUpdateVisitNotes` function entirely; remove any JSX that references dead visit callbacks on DispatchDetailPanel.
  - `client/src/components/AddVisitDialog.tsx` — consume `useDispatchPreviewMutations.scheduleVisit`; drop bespoke `apiRequest`.
- **Why now:** Atomic with Step 4. The narrow schema breaks without this.
- **Verify:** T14 passes (Dashboard edit now routes to orchestrator). T3, T4 persistence tests pass. Manual: edit from Dashboard, edit from Dispatch, add visit from JobDetailPage — all exercise the expected endpoints. Equipment selection in EditVisitModal now persists.
- **Rollback risk:** Medium — multiple files touched in a single PR, but all pointing at a single contract change. Feature-flag not needed; revert as a unit.

### Step 6 — Client: clean DispatchDetailPanel dead visit surface
- **Files:** `client/src/components/dispatch/DispatchDetailPanel.tsx` — remove `onUpdateCrew`, `onUpdateStatus`, `onUpdateVisitNotes`, `onReschedule`, `onResize` from visit props; remove the dead inline notes textarea + crew picker in VisitDetail that depended on those callbacks; add the header comment mandated in Section 11.
- **Why now:** After Step 5 completes and we have confirmed nothing new depends on those callbacks. Purely dead-code cleanup.
- **Verify:** No compilation errors; existing task-flow tests still pass; manual: dispatch detail panel on tasks still works.
- **Rollback risk:** Low — code is unreachable today, this removes it formally.

### Step 7 — Schema hygiene: visitOutcomeEnum + server/schemas.ts duplicates
- **Files:** `server/routes/techField.ts` (import `visitOutcomeEnum` from shared), `server/schemas.ts` (derive Zod enums from shared string arrays).
- **Why now:** Independent of the visit-mutation consolidation; already called out in prior audit. Zero behavior change. Can ship anytime after Step 0 but grouped here to tie off the consolidation PR series.
- **Verify:** `npm run check` green; existing tests pass.
- **Rollback risk:** None.

### Step 8 — Document the canonical vocabulary
- **Files:** `CLAUDE.md` (add a new section under "Performance Regression Guardrail" style, "Visit Mutation Canonical Paths — 2026-04-21 Baseline"), listing:
  - The two valid PATCH visit fields.
  - The canonical reschedule route.
  - The canonical assign-crew route and field name.
  - The rule: office status changes go through orchestrator delegator.
  - The rule: DispatchDetailPanel is visit-read-only.
- **Why now:** Lock the architecture in CLAUDE.md so future contributors don't reintroduce the patterns.
- **Rollback risk:** None.

**Ordering rationale summary:**
- Steps 1–3 build the server-side orchestrator coverage that Step 4's narrowing depends on.
- Step 4+5 ship as a single logical unit (schema narrowing + client migration). The two PRs can be sequenced back-to-back, or combined if preferred, but not reversed.
- Steps 6–8 are cleanup and documentation that can ship anytime after Step 5.

---

## 14. Non-Goals

This plan does NOT touch:

- Invoice mutations, quote mutations, lead mutations — out of scope (separate prior-audit findings).
- Template editor consolidation (JobTemplateModal / QuoteTemplateModal) — out of scope.
- `NewInvoicePage` vs `NewInvoiceModal` — out of scope.
- CreateLeadModal client-create reuse — out of scope.
- Generic hook extraction (`useInvoiceActions`, `useQuoteActions`) — out of scope.
- Tech-app parts / equipment / notes endpoint consolidation with office endpoints — out of scope; that is a separate cross-app decision. Tech endpoints on visits are orchestrator-backed where it matters (lifecycle) and distinct-table (equipment, notes) where it does not.
- `ImpersonationBanner` polling flag — out of scope (separate finding).
- `formatDuration` duplication — out of scope.
- `CreateOrSelectField` / NewQuoteModal inline-create-client parity — out of scope.
- New UI launchers — launchers are already correctly thin (`VisitEditorLauncher`, `SlotQuickCreateLauncher`). Do not touch them beyond wiring the dispatch callbacks inside VisitEditorLauncher if that route is chosen in Step 5.
- Visit create on `POST /api/jobs/:jobId/visits` — already direct storage and that is acceptable (no actioned visit exists yet at create time).
- Visit archive endpoint — intentionally distinct from soft-delete; stays.

---

## 15. Open Risks

1. **Unschedule on an actioned visit — server behavior unverified.**
   The current `POST /api/calendar/visit/:id/unschedule` handler at `server/routes/scheduling.ts:798` calls `schedulingRepository.unscheduleVisit` (storage-direct). Whether it rejects actioned visits is not confirmed by this investigation — the handler body needs a targeted read. If it does not reject, test T11 will fail and Step 2 must be expanded to also wrap the unschedule route through an orchestrator intent.
   **Resolution:** Read `schedulingRepository.unscheduleVisit` and its tests in `tests/scheduling.smoke.test.ts` as part of Step 0.

2. **`scheduleJob` (POST /api/calendar/schedule) also writes schedule fields for placeholder promotion.**
   This route is storage-direct (Section 2, Surface #7). It is safe by construction only if it can never be called on an already-actioned visit (because a placeholder visit has `status=scheduled` and no actioned signals). Confirm this invariant server-side; if a client or support tool can call `scheduleJob` on a non-placeholder visit that is already actioned, the wide-payload PATCH narrowing does NOT close the gap.
   **Resolution:** Audit `scheduleJob` callers + the target-visit-is-placeholder check as part of Step 1 planning.

3. **Dashboard VisitEditorLauncher wiring approach — decision pending.**
   Two options in Step 5:
   - (a) Make dispatch callbacks **required** on the launcher interface; every page (Dashboard, DispatchPreview) wires them from `useDispatchPreviewMutations`.
   - (b) Move the hook call **inside** the launcher itself, so pages only need to mount `<VisitEditorLauncher state=... onClose=... />` without thinking about callbacks.
   Option (b) is simpler for callers and matches the launcher's "thin consolidated" design philosophy. Option (a) is more explicit. The plan must pick one before Step 5; this is a product/API decision, not a technical one.
   **Resolution:** Recommend option (b) for ergonomic parity with `SlotQuickCreateLauncher`; confirm with maintainer before Step 5.

4. **`scheduleJob` vs `lifecycle.rescheduleVisit` for "promote unscheduled placeholder to scheduled."**
   Today, promoting an unscheduled placeholder visit goes through `POST /api/calendar/schedule` (storage), NOT through `lifecycle.rescheduleVisit` (orchestrator). This is intentional — there's nothing to spawn, no actioned visit. But it means two routes can create-or-update visit schedule, depending on the source. The plan keeps both by Section 4 design. Confirm there is no reachable user path where a placeholder gets actioned (e.g., tech marks `en_route` before it gets a schedule) that would make `scheduleJob` unsafe.
   **Resolution:** Grep for any test or handler that asserts "actioned placeholder is possible." If impossible, open risk collapses.

5. **`bulkCompleteVisits` is called by `forceCloseJob`.**
   `forceCloseJob` (orchestrator) bulk-completes all open visits with `outcome=completed` — this writes to visit state outside the per-visit `POST /complete` route. Confirmed safe (same orchestrator owns both), but callers must be aware: if a visit has a "needs_parts" outcome in progress and a dispatcher force-closes the job, the per-visit context is lost. This is existing behavior, not a consolidation question, but flagged here because it interacts with Step 7's visitOutcomeEnum import cleanup.
   **Resolution:** No action in this plan. Documented for awareness.

No other open risks remain. The equipment question, the notes question, the UI-panel question, and the test-infrastructure question are all resolved in Sections 7, 8, 11, and 12 respectively.
