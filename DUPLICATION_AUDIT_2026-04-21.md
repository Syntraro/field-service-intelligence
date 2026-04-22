# HVAC App — Duplication & Shadow-Orchestration Audit
## Syntraro codebase, read-only pass, 2026-04-21

This audit is read-only. No files were modified. File paths and line numbers reflect the working tree at the time of the audit.

---

## 1. Executive Summary

1. **The two flows named in the brief (VisitEditorLauncher, SlotQuickCreateLauncher) are actually the correct canonical consolidation.** Both are thin, shared between Dashboard and DispatchPreview, and delegate to the canonical EditVisitModal / QuickAddJobDialog / TaskDialog without duplicating orchestration. `Dashboard.tsx:381-388` mounts them identically to `DispatchPreview.tsx`. The failure the brief describes has, on this branch, been remediated — but the same **class** of violation exists elsewhere in the codebase and is the core finding of this audit.

2. **Two distinct backend endpoints mutate `job_visits` for the same business operation with divergent field names and divergent safety behavior.** `PATCH /api/calendar/visit/:id/reschedule` (`scheduling.ts:701`, uses `lifecycle.rescheduleVisit` → labor-aware spawn) vs `PATCH /api/jobs/:jobId/visits/:visitId` (`jobVisits.routes.ts:130`, calls `jobVisitsRepository.updateJobVisit` directly, no orchestrator). The modal save-path uses the direct route and can silently overwrite an actioned (labor-bearing) visit. This is a **Critical source-of-truth violation**.

3. **Three different field-name conventions for the same data.** `scheduledStart/scheduledEnd/isAllDay/visitNotes/assignedTechnicianIds` (jobVisits.routes) vs `startAt/endAt/allDay/notes/assignedTechnicianIds` (scheduling reschedule) vs `technicianUserIds` (scheduling assign-crew). Payload shape diverges per endpoint.

4. **Shadow mutation in dispatch for visit notes.** `DispatchPreview.tsx:972-985` calls `apiRequest(...)` inline with its own toast + partial invalidation (only `["/api/calendar"]`, missing `["visits"]` and `["jobs"]`). Every other visit field flows through `useDispatchPreviewMutations`; notes do not.

5. **Non-terminal visit status transitions bypass the lifecycle orchestrator.** `POST /api/jobs/:jobId/visits/:visitId/status` (`jobVisits.routes.ts:242`) writes directly via `jobVisitsRepository.updateJobVisitStatus`. All terminal transitions (complete, reopen, close) go through `jobLifecycleOrchestrator`. The boundary between "status owned by orchestrator" and "status written directly by storage" is not enforced.

6. **Tech-app vs office-app duplicate the parts, equipment, and notes API surface.** `/api/tech/visits/:visitId/{parts,equipment,notes}` shadow `/api/jobs/:jobId/{parts,equipment,notes}` with identical DB writes and identical response shapes. Backend routes live in `server/routes/techField.ts` with their own handler code. Tech-app client maintains parallel mutation hooks.

7. **`visitOutcomeEnum` is redefined inline in `server/routes/techField.ts`** instead of imported from `shared/schema.ts:2834`. This is the exact canonical-drift pattern this audit is looking for.

8. **`server/schemas.ts` maintains a parallel set of Zod enums** for `jobStatusEnum`, `openSubStatusEnum`, `holdReasonEnum`, `invoiceStatusEnum`, duplicating the string arrays in `shared/schema.ts`.

9. **InvoiceDetailPage has 14 inline `useMutation` blocks; QuoteDetailPage has 13; LeadDetailPage has 9.** None use a canonical hook. `LeadDetailPage.tsx:176` issues `POST /api/quotes` inline without invalidating the quote list query. InvoiceDetailPage issues four separate `PATCH /api/invoices/:id` mutations (lines 803 / 820 / 843 / 861) that could be one hook.

10. **NewInvoicePage and NewInvoiceModal are two UI surfaces for the identical POST /api/invoices operation.** NewInvoiceModal is the canonical surface per its own top-of-file comment; NewInvoicePage is legacy but still routed at `/invoices/new` (`App.tsx:233-236`). Both surface CreateClientModal inline.

11. **CreateLeadModal reimplements client creation instead of mounting CreateClientModal.** It has its own inline form (companyName, phone, email, address, city) and its own POST `/api/clients/full-create` mutation (`CreateLeadModal.tsx:59-86`). CreateClientModal is the canonical surface.

12. **NewQuoteModal silently differs from NewInvoiceModal** — it reuses `CreateOrSelectField<LocationOption>` but does NOT supply `createLabel`/`onCreateNew`. Invoice flow lets users create a client inline; quote flow forces them back to the Clients page first.

13. **Three crew-update paths exist.** PATCH `/api/jobs/:jobId/visits/:visitId` (crew as part of wide payload), PATCH `/api/calendar/visit/:id/reschedule` (crew optional in reschedule), PATCH `/api/calendar/visit/:id/assign-crew` (crew-only, required min 1, different field name `technicianUserIds`).

14. **`formatDuration` is duplicated** with identical logic at `dispatch/dispatchPreviewUtils.ts:197` and `components/products-services/types.ts:87`. Tech-app `tech-app/utils/formatTime.ts` has its own variant `formatDurationMinutes`.

15. **`refetchIntervalInBackground: false` violation** in `ImpersonationBanner.tsx:36` — poll runs regardless of tab visibility; CLAUDE.md 2026-03-18 baseline allows the exception for security-critical polling and this may qualify, but it is not annotated as a documented exception.

---

## 2. Canonical Flow Inventory

| # | Workflow | Canonical Source | Expected Launch Pattern | Expected Backend Path |
|---|---|---|---|---|
| 1 | **Edit visit (office)** | `client/src/components/visits/EditVisitModal.tsx` (+ `VisitEditorLauncher`) | `<VisitEditorLauncher state={...} onClose={...} />` at page root, controlled `state` prop | `PATCH /api/jobs/:jobId/visits/:visitId` → `jobVisitsRepository.updateJobVisit` (⚠ bypasses orchestrator) |
| 2 | **Create job (scheduled or unscheduled)** | `client/src/components/QuickAddJobDialog.tsx` | Mounted globally at `App.tsx:988`; launched directly or via `SlotQuickCreateLauncher` (adds prefill) | `POST /api/jobs` → `jobRepository.createJob` (seeds initial visit inside same tx) |
| 3 | **Create visit (existing job)** | `client/src/components/AddVisitDialog.tsx` | Mounted on JobDetailPage; launched from "+ Add Visit" | `POST /api/calendar/schedule` → `schedulingRepository.scheduleJob` |
| 4 | **Quick-create chooser** | `client/src/components/dispatch/SlotQuickCreateLauncher.tsx` | Controlled `slot` prop from any page; chooser delegates to QuickAddJobDialog or TaskDialog | Downstream canonical endpoints |
| 5 | **Client selector / create-or-select** | `client/src/components/shared/CreateOrSelectField.tsx` (+ `CreateClientModal` for create) | Embedded inside modals; `createLabel`+`onCreateNew` to mount `CreateClientModal` | `GET /api/clients/search-locations` + `POST /api/clients/full-create` |
| 6 | **Technician assignment** | `client/src/components/TechnicianSelector.tsx` (picker) + `client/src/components/visits/VisitTeamAssignment.tsx` (chip list) | Popover; parent owns persistence | Varies — three endpoints today; no canonical |
| 7 | **Reschedule visit** | `client/src/components/dispatch/useDispatchPreviewMutations.ts` `rescheduleVisit()` | Drag-drop / resize on dispatch grid | `PATCH /api/calendar/visit/:id/reschedule` → `lifecycle.rescheduleVisit` |
| 8 | **Visit complete (office)** | `useDispatchPreviewMutations.completeVisitWithOutcome` AND `EditVisitModal.completeMutation` | Two parallel mountings | `POST /api/jobs/:jobId/visits/:visitId/complete` → `lifecycle.completeVisit` |
| 9 | **Visit complete (tech)** | `tech-app/hooks/useTechVisitDetail.completeMutation` | TechApp visit detail | `POST /api/tech/visits/:visitId/complete` → (tech wrapper → orchestrator) |
| 10 | **Job status change (hold/resume/close)** | `ActionRequiredModal.tsx` / JobDetailPage | Dashboard + job detail | `POST /api/jobs/:jobId/status` → `lifecycle.placeJobOnHold/resumeJob/forceCloseJob` |
| 11 | **Create invoice (standalone)** | `client/src/components/NewInvoiceModal.tsx` | Header dropdown, UniversalSearch, ClientDetailPage (nested) | `POST /api/invoices` → `storage.createStandaloneInvoice` |
| 12 | **Create invoice (from job)** | `client/src/components/InvoiceCompositionDialog.tsx` (mode=create) | JobDetailPage | `POST /api/invoices/from-job/:jobId` → `invoiceCreationService.createInvoiceFromJob` |
| 13 | **Create quote** | `client/src/components/NewQuoteModal.tsx` | Header dropdown, UniversalSearch, Quotes list (`?create=true`) | `POST /api/quotes` (+ optional `POST /api/quote-templates/:id/apply`) |
| 14 | **Create client (atomic company + location)** | `client/src/components/CreateClientModal.tsx` | Header "New Client", embedded in NewInvoiceModal, ClientDetailPage | `POST /api/clients/full-create` → `customerCompanyRepository.findOrCreateCustomerCompany` + `storage.createOrGetLocation` |
| 15 | **Create lead** | `client/src/components/CreateLeadModal.tsx` | LeadsPage | `POST /api/leads` (+ inline client create) |
| 16 | **Apply template (job / quote)** | `client/src/components/shared/ApplyTemplateModalBase.tsx` (base) + `ApplyTemplateModal.tsx` + `ApplyQuoteTemplateModal.tsx` (wrappers) | Job detail, quote detail | `POST /api/job-templates/apply-to-job` / `POST /api/quote-templates/:id/apply` |
| 17 | **Task create/edit** | `client/src/components/TaskDialog.tsx` | TasksPanel, DispatchBoard, SlotQuickCreateLauncher | `POST/PATCH /api/tasks` (+ supplier-visit detail endpoint) |
| 18 | **Notes (job)** | `client/src/components/JobNoteDialog.tsx` | `JobNotesSection` owns single dialog instance | `POST/PATCH/DELETE /api/jobs/:jobId/notes` |
| 19 | **Notes (client/location)** | `client/src/components/NotesPanel.tsx` | LocationDetailPage, CompanyDetailPage | `POST/PATCH/DELETE /api/locations/:id/notes` or `/api/customer-companies/:id/notes` |
| 20 | **Equipment create/edit** | `AddEquipmentDialog.tsx` + `EquipmentDetailModal.tsx` + `EquipmentPicker.tsx` | Picker opens AddEquipmentDialog; modal shows detail | `POST /api/clients/:locationId/equipment` |

---

## 3. Duplication Findings

### Finding #1: Two distinct backend routes write to `job_visits` with different field names and different safety behavior
- **Severity**: Critical
- **Category**: Route / Service / Cross-layer
- **Canonical flow affected**: Edit visit, Reschedule visit
- **Duplicate files/functions involved**:
  - `server/routes/jobVisits.routes.ts:130-190` — `PATCH /api/jobs/:jobId/visits/:visitId` → direct `jobVisitsRepository.updateJobVisit`
  - `server/routes/scheduling.ts:700-795` — `PATCH /api/calendar/visit/:visitId/reschedule` → `lifecycle.rescheduleVisit` (labor-aware spawn)
  - `server/services/jobLifecycleOrchestrator.ts:1870-1975` — `rescheduleVisit`
  - `server/storage/jobVisits.ts` — `updateJobVisit`
  - Client callers: `client/src/components/visits/EditVisitModal.tsx:254-258` (modal save → `/api/jobs/.../visits/:id`), `client/src/components/dispatch/useDispatchPreviewMutations.ts:802-866` (drag → `/api/calendar/visit/:id/reschedule`)
- **What is duplicated**: Two endpoints that write to the same DB row, accepting differently-named fields for the same concept (`scheduledStart`/`scheduledEnd`/`isAllDay`/`visitNotes`/`assignedTechnicianIds` vs `startAt`/`endAt`/`allDay`/`notes`/`assignedTechnicianIds`).
- **Why this is duplication instead of valid composition**: Both endpoints ultimately land in `jobVisitsRepository.updateJobVisit`, but one passes through the orchestrator's spawn-on-actioned logic and one does not. The modal path can silently overwrite an actioned visit; the dispatch drag path cannot.
- **Actual risk**: A user who edits a visit in EditVisitModal after labor entries exist (e.g., tech has started but manager wants to change time) will overwrite the actioned visit rather than spawn a follow-up. This contradicts the "no duplicate write path" architecture rule and creates latent data corruption risk.
- **Recommended consolidation direction**: Route EditVisitModal's save through the calendar/reschedule endpoint (via `useDispatchPreviewMutations.rescheduleVisit` or a thin new hook). Retain `/api/jobs/:jobId/visits/:visitId` only for fields the orchestrator does not own (equipment links, free-text notes, etc.).
- **Implementation caution**: Equipment, visitNotes, and duration are currently only writable via the jobs/visits route. Moving to calendar/reschedule requires exposing those fields in `rescheduleVisitSchema` and in `lifecycle.rescheduleVisit`.
- **Confidence**: High

### Finding #2: Visit notes saved from DispatchDetailPanel via shadow inline mutation
- **Severity**: High
- **Category**: Mutation / Hook
- **Canonical flow affected**: Edit visit (notes subset)
- **Duplicate files/functions involved**:
  - `client/src/pages/DispatchPreview.tsx:972-985` — `handleUpdateVisitNotes` is a bespoke `apiRequest` call with its own toast and one-key invalidation
  - `client/src/components/dispatch/DispatchDetailPanel.tsx:596-599,834-886` — invokes the callback via inline textarea
  - Compare with `client/src/components/dispatch/useDispatchPreviewMutations.ts` which centralizes every other visit mutation with optimistic patching, chaining, and debounced invalidation
- **What is duplicated**: Notes write bypasses the canonical mutation hook; implements its own toast, its own invalidation set (only `["/api/calendar"]`), and is not part of the optimistic cache patching system.
- **Why this is duplication instead of valid composition**: The mutation hook already exports a full set of visit mutations; adding `updateVisitNotes` there is the obvious extension point. Bypassing it duplicates the pattern and leaves notes out of the invalidation contract (`["visits"]`, `["jobs"]`, `["dashboard"]` are not invalidated when notes change).
- **Actual risk**: Visit-detail drawers or job-detail views reading `visit.visitNotes` from their own query cache become stale after a notes edit until window focus / SSE event arrives.
- **Recommended consolidation direction**: Add `updateVisitNotes` (or extend `rescheduleVisit` to accept notes-only) into `useDispatchPreviewMutations`; DispatchPreview consumes from the hook.
- **Implementation caution**: Ensure the new hook entry uses the same `freshVersion(visitId)` resolution pattern the other visit mutations use.
- **Confidence**: High

### Finding #3: Three distinct crew-update paths with three payload shapes
- **Severity**: High
- **Category**: Route / Schema
- **Canonical flow affected**: Technician assignment
- **Duplicate files/functions involved**:
  - `server/routes/jobVisits.routes.ts:130` — PATCH visit, crew as `assignedTechnicianIds` in wide payload, optional
  - `server/routes/scheduling.ts:700` — PATCH reschedule, crew as `assignedTechnicianIds`, nullable optional, undefined=no-change, null/[]=clear, [x]=replace
  - `server/routes/scheduling.ts:987` — PATCH assign-crew, crew as `technicianUserIds`, required min 1
- **What is duplicated**: Three endpoints, two field names, three nullability contracts for the same "set crew on a visit" operation.
- **Why this is duplication instead of valid composition**: All three ultimately normalize the crew array and persist to the same column. The field-name split (`technicianUserIds` vs `assignedTechnicianIds`) is gratuitous.
- **Actual risk**: Future hooks must choose between three endpoints and three serialization styles; easy to pick the wrong semantics (e.g., sending `null` to PATCH assign-crew is rejected, sending `null` to reschedule clears crew).
- **Recommended consolidation direction**: Keep one endpoint for crew-only change (prefer `/api/calendar/visit/:id/assign-crew` under the scheduling namespace, since that's the dispatch surface), rename its field to `assignedTechnicianIds`, and have the reschedule endpoint treat crew the same way. Remove crew from the PATCH visit wide payload entirely.
- **Implementation caution**: `EditVisitModal` currently sends crew via PATCH visit (in a wide payload). Migration requires splitting its save into two mutations (field save + crew save) OR moving to the reschedule endpoint.
- **Confidence**: High

### Finding #4: Non-terminal visit status transitions bypass the lifecycle orchestrator
- **Severity**: High
- **Category**: Route / Service / Storage
- **Canonical flow affected**: Visit status change
- **Duplicate files/functions involved**:
  - `server/routes/jobVisits.routes.ts:242-283` — `POST /api/jobs/:jobId/visits/:visitId/status` → direct `jobVisitsRepository.updateJobVisitStatus`
  - `server/services/jobLifecycleOrchestrator.ts` — owns `completeVisit`, `reopenVisit`, `forceCloseJob`, `placeJobOnHold`, `resumeJob`, `rescheduleVisit`; does NOT own non-terminal `dispatched / en_route / on_site / in_progress / paused / on_hold`
- **What is duplicated**: Status-transition logic is partially centralized in the orchestrator and partially direct-writes through storage. No single source of truth for "what transitions are legal, what side effects they have, and what events they log."
- **Why this is duplication instead of valid composition**: The existence of a lifecycle orchestrator implies one write path for status. The direct route contradicts that contract.
- **Actual risk**: Future business rules (e.g., hold-reason required when entering `on_hold`, event emission, notification) must be duplicated between the orchestrator path and the direct storage path or silently omitted on one side. The route already has a minimal guard (rejects `completed`, rejects reopen when job terminal) that partially replicates orchestrator logic.
- **Recommended consolidation direction**: Move non-terminal status transitions into the orchestrator (`lifecycle.setVisitStatus(status)`); the route handler becomes a thin dispatcher.
- **Implementation caution**: Tech-app has its own fine-grained transitions (`en_route`, `start`, `pause`, `resume`) via `/api/tech/visits/:id/{action}` that already appear to be orchestrator-backed. Consolidate both surfaces onto the same orchestrator method.
- **Confidence**: High

### Finding #5: Tech-app parts / equipment / notes endpoints shadow office endpoints
- **Severity**: High
- **Category**: Route / Cross-layer
- **Canonical flow affected**: Parts on visit, Equipment on visit, Job notes
- **Duplicate files/functions involved**:
  - `server/routes/techField.ts:609-751` (notes), `755-875` (time), `918-1049` (parts + equipment)
  - `server/routes/jobVisits.routes.ts` and `server/routes/jobs.ts` (office equivalents)
  - Client: `client/src/tech-app/hooks/useTechVisitDetail.ts:376-451` (addNote, updatePart, removeEquipment, etc.)
- **What is duplicated**: Two endpoint families (`/api/tech/visits/:visitId/{parts|equipment|notes}` vs `/api/jobs/:jobId/{parts|equipment|notes}`) with identical DB writes, identical response shapes, different auth middleware, different cache keys.
- **Why this is duplication instead of valid composition**: Auth-scope differences (`requireSchedulable` vs `requireRole(MANAGER_ROLES)`) could be handled by a single endpoint with role-gated branching. The separation is legacy, not necessary.
- **Actual risk**: Any future change to parts/equipment/notes semantics requires edits in two places. Drift has already happened in status-display labels (below).
- **Recommended consolidation direction**: Merge to a single route family keyed by `jobId` (already what the canonical office route uses); enforce both auth scopes in middleware; tech-app migrates its client calls.
- **Implementation caution**: The tech-app currently invalidates `["/api/tech/*"]` on its mutations; a migration must update the invalidation keys on both sides simultaneously, or cross-invalidation must be done server-side via SSE (which already exists via `dispatchBus.emitDispatch`).
- **Confidence**: High

### Finding #6: `visitOutcomeEnum` redefined inline in `server/routes/techField.ts`
- **Severity**: Critical
- **Category**: Schema
- **Canonical flow affected**: Visit complete (tech)
- **Duplicate files/functions involved**:
  - `shared/schema.ts:2834` — canonical `visitOutcomeEnum`
  - `server/routes/techField.ts` — inline `z.enum(["completed", "needs_parts", "needs_followup"])`
- **What is duplicated**: The enum values are defined once in shared and again inline in a server route.
- **Why this is duplication instead of valid composition**: `shared/schema.ts` is explicitly the source of truth per CLAUDE.md; the route already imports other shared schemas.
- **Actual risk**: If a new outcome (e.g., `rescheduled`, `abandoned`) is added to the shared enum, the tech route will reject it silently.
- **Recommended consolidation direction**: Import `visitOutcomeEnum` from shared and use `z.enum(visitOutcomeEnum)`.
- **Confidence**: High

### Finding #7: `server/schemas.ts` holds duplicate Zod enums shadowing `shared/schema.ts` string arrays
- **Severity**: Critical
- **Category**: Schema
- **Duplicate files/functions involved**:
  - `shared/schema.ts:1927` (`jobStatusEnum`), `:1936` (`openSubStatusEnum`), `:2200` (`holdReasonEnum`), `:1496` (`invoiceStatusEnum`)
  - `server/schemas.ts:32`, `:41`, `:49`, `:64` — parallel Zod enums
- **What is duplicated**: The same string arrays are re-declared as Zod enums server-side with no shared derivation.
- **Why this is duplication instead of valid composition**: `z.enum([...] as const)` can be derived from the shared arrays directly.
- **Actual risk**: Shared enum edits silently break server validation until `server/schemas.ts` is also updated.
- **Recommended consolidation direction**: `export const jobStatusZ = z.enum(jobStatusEnum);` importing from shared. Delete redundant definitions.
- **Confidence**: High

### Finding #8: Payload field-name drift across visit endpoints (`visitNotes` vs `notes`, `scheduledStart` vs `startAt`, `isAllDay` vs `allDay`, `estimatedDurationMinutes` vs none)
- **Severity**: High
- **Category**: Schema / Model
- **Duplicate files/functions involved**:
  - `server/routes/jobVisits.routes.ts` (updateVisitSchema)
  - `server/routes/scheduling.ts` (rescheduleVisitSchema, scheduleJobSchema)
  - Client: `client/src/components/visits/EditVisitModal.tsx`, `client/src/components/dispatch/useDispatchPreviewMutations.ts`, `client/src/components/AddVisitDialog.tsx`
- **What is duplicated**: The same conceptual fields have different names on the wire depending on which endpoint is called.
- **Recommended consolidation direction**: Normalize to DB column names (`scheduledStart`, `scheduledEnd`, `isAllDay`, `visitNotes`, `assignedTechnicianIds`) across all visit endpoints. Treat this as API-contract cleanup before touching the consolidation in Finding #1.
- **Confidence**: High

### Finding #9: NewInvoicePage duplicates NewInvoiceModal
- **Severity**: Medium
- **Category**: UI / Modal orchestration
- **Duplicate files/functions involved**:
  - `client/src/pages/NewInvoicePage.tsx` — routed at `/invoices/new`
  - `client/src/components/NewInvoiceModal.tsx` — mounted globally, the top-of-file comment states it "replaces the standalone NewInvoicePage"
- **What is duplicated**: Identical form: location search via `CreateOrSelectField`, optional workDescription, identical POST `/api/invoices`, identical success redirect.
- **Why this is duplication instead of valid composition**: Modal calls itself canonical; page is preserved for direct URL entry. The two surfaces duplicate the form schema, defaults, and mutation.
- **Actual risk**: Low today (identical behavior); real risk is future drift when one surface gets a new field.
- **Recommended consolidation direction**: Delete the page or replace it with a URL-driven trigger that opens the modal.
- **Confidence**: High

### Finding #10: CreateLeadModal reimplements client creation inline instead of mounting CreateClientModal
- **Severity**: High
- **Category**: UI / Modal orchestration / Mutation
- **Duplicate files/functions involved**:
  - `client/src/components/CreateLeadModal.tsx:42-46` (custom form fields), `:59-86` (inline POST `/api/clients/full-create`)
  - `client/src/components/CreateClientModal.tsx` (canonical surface for the same endpoint)
- **What is duplicated**: Client create form + mutation, different visual UI than CreateClientModal but identical endpoint.
- **Recommended consolidation direction**: Embed `CreateClientModal` (via `CreateOrSelectField createLabel={...} onCreateNew={...}`) the same way NewInvoiceModal does.
- **Confidence**: High

### Finding #11: NewQuoteModal omits inline client creation while NewInvoiceModal provides it
- **Severity**: Medium
- **Category**: UI / Modal orchestration
- **Duplicate files/functions involved**:
  - `client/src/components/NewQuoteModal.tsx` — uses `CreateOrSelectField<LocationOption>` with NO `createLabel` / `onCreateNew`
  - `client/src/components/NewInvoiceModal.tsx:145-160` — uses the same field with `createLabel="New Client"` + nested `CreateClientModal`
- **What is duplicated**: The selector is reused correctly but with inconsistent prop assembly. Users must break flow to create a client for a quote but not for an invoice.
- **Recommended consolidation direction**: Add `createLabel` + `onCreateNew` to NewQuoteModal; mount `CreateClientModal`.
- **Confidence**: High

### Finding #12: InvoiceDetailPage contains 14 inline mutations; no canonical hook
- **Severity**: High
- **Category**: Hook / Mutation
- **Duplicate files/functions involved**:
  - `client/src/pages/InvoiceDetailPage.tsx` — 14 `useMutation` blocks including four PATCH `/api/invoices/:id` variants (`updateDiscount` L803, `updatePaymentTerms` L820, `updateInvoiceNumber` L843, `updateInvoiceFields` L861), plus void, delete, refreshFromJob, createPayment, reorderLines, addLine, updateLine, deleteLine, applyTax
- **What is duplicated**: Four separate mutations issue PATCH to the same endpoint with different body slices and slightly different invalidation sets. Multiple line-item mutations reimplement the payload contract.
- **Actual risk**: Invalidation drift (each mutation invalidates `["invoices"]` but not always `["invoices","detail",id]`), payload-shape drift, duplicated error handling (`useQboOverride` hook partially mitigates but not consistently applied).
- **Recommended consolidation direction**: Extract `useInvoiceActions(invoiceId)` that exposes one PATCH mutation accepting partial updates, plus line-item operations.
- **Confidence**: High

### Finding #13: QuoteDetailPage mirrors the InvoiceDetailPage pattern (13 inline mutations, no canonical hook)
- **Severity**: High
- **Category**: Hook / Mutation
- **Recommended consolidation direction**: Extract `useQuoteActions(quoteId)` alongside `useInvoiceActions`; consider a shared factory for line-item CRUD since both entities use `canonicalLineItemInput`.
- **Confidence**: High

### Finding #14: LeadDetailPage issues `POST /api/quotes` inline, bypassing canonical quote-creation flow
- **Severity**: Medium
- **Category**: Mutation
- **Duplicate files/functions involved**:
  - `client/src/pages/LeadDetailPage.tsx:176` — `convertMutation` posts to `/api/quotes` directly, no invalidation of `["quotes"]` or `["quote-list"]`
- **What is duplicated**: Quote creation. NewQuoteModal is the canonical surface; this bypasses it.
- **Recommended consolidation direction**: Open `NewQuoteModal` with `leadId` prefilled instead of issuing the POST inline.
- **Confidence**: High

### Finding #15: `formatDuration` implemented twice with identical logic
- **Severity**: Medium
- **Category**: Helper / Utility
- **Duplicate files/functions involved**:
  - `client/src/components/dispatch/dispatchPreviewUtils.ts:197`
  - `client/src/components/products-services/types.ts:87`
  - (also `client/src/tech-app/utils/formatTime.ts` — `formatDurationMinutes`, divergent)
- **Recommended consolidation direction**: Extract to `client/src/lib/formatDuration.ts` (or `shared/` if server needs it) and import from all three sites.
- **Confidence**: High

### Finding #16: Tech-app and office-app duplicate visit status labels / colors
- **Severity**: Medium
- **Category**: Helper / Display
- **Duplicate files/functions involved**:
  - `client/src/tech-app/utils/visitDisplay.ts:17-33` — `STATUS_LABELS`, `STATUS_COLORS`
  - `client/src/components/dispatch/dispatchPreviewUtils.ts:51` (colors), `:129` (labels), re-exported by `client/src/lib/visitStatusDisplay.ts`
- **What is duplicated**: Label map duplicated; color palettes intentionally differ (bold mobile vs subtle dispatch).
- **Recommended consolidation direction**: Extract `visitStatusLabel()` to `shared/` (labels are behavior, not presentation). Leave color palettes local with documented comment explaining the split.
- **Confidence**: High

### Finding #17: `updateInvoiceLineSchema` reimplements fields instead of deriving from `canonicalLineItemInput`
- **Severity**: Medium
- **Category**: Schema
- **Duplicate files/functions involved**:
  - `shared/lineItem.ts:213` — `canonicalLineItemInput`
  - `server/routes/invoices.ts` — `updateInvoiceLineSchema` re-declares money fields
- **Recommended consolidation direction**: Use `canonicalLineItemInput.partial().extend({ overrideQboLock, overrideReason }).strict()`.
- **Confidence**: High

### Finding #18: JobTemplateModal and QuoteTemplateModal ~75% structurally identical
- **Severity**: Medium
- **Category**: UI
- **Duplicate files/functions involved**:
  - `client/src/components/JobTemplateModal.tsx` (828 LOC)
  - `client/src/components/QuoteTemplateModal.tsx` (699 LOC)
- **What is duplicated**: Header/footer, row structure, canonical `LineItemDraft` handling, quick-add nested dialog, `templateLineFromDraft` projection.
- **Why this is duplication instead of valid composition**: The `ApplyTemplateModalBase` pattern exists and is correctly used for template *application*. The template *editor* should follow the same base pattern.
- **Recommended consolidation direction**: Extract `TemplateEditorBase<T>` paralleling `ApplyTemplateModalBase`; subclasses supply entity-specific fields (`jobType`, `isDefault`).
- **Implementation caution**: Job templates have `jobType` + per-type default; quote templates have single default. Base must parameterize the default-scope field.
- **Confidence**: Medium

### Finding #19: `ImpersonationBanner.tsx` polls without `refetchIntervalInBackground: false`
- **Severity**: Low (functionality), Medium (baseline compliance)
- **Category**: Hook / Query
- **Duplicate files/functions involved**:
  - `client/src/components/ImpersonationBanner.tsx:36` — `refetchInterval: (q) => q.state.data?.isImpersonating ? 5000 : false`, no `refetchIntervalInBackground` override
- **What is duplicated**: Violates the 2026-03-18 polling baseline unless an explicit security exception is annotated.
- **Recommended consolidation direction**: Either add `refetchIntervalInBackground: false` (user may not need 5s background polling) or add a comment documenting the exception per CLAUDE.md exception rules.
- **Confidence**: High

### Finding #20: `AddVisitDialog` posts to `/api/calendar/schedule` with a different payload shape than `useDispatchPreviewMutations.scheduleVisit`
- **Severity**: Medium
- **Category**: Mutation / Schema
- **Duplicate files/functions involved**:
  - `client/src/components/AddVisitDialog.tsx:87-91,123` — custom payload (`targetVisitId` optional)
  - `client/src/components/dispatch/useDispatchPreviewMutations.ts:733-799` — `scheduleVisit` via canonical hook
- **What is duplicated**: Same endpoint, two client surfaces, two payload assembly paths.
- **Recommended consolidation direction**: Have `AddVisitDialog` consume `useScheduleJob` (from `useSchedulingApi.ts:316`) or `useDispatchPreviewMutations.scheduleVisit`.
- **Confidence**: High

---

## 4. Shadow Reuse Findings

### Shadow Finding #S1: Visit complete has two client-side orchestrations sharing one endpoint
- **Severity**: High
- **Category**: Modal orchestration / Mutation
- **Canonical flow affected**: Visit complete
- **Duplicate files/functions involved**:
  - `client/src/components/visits/EditVisitModal.tsx:291-295` — `completeMutation` is a plain `useMutation` with simple invalidation
  - `client/src/components/dispatch/useDispatchPreviewMutations.ts:1058-1116` — `completeVisitWithOutcome` has optimistic cache patching (`optimisticCompleteVisit`) + `forceRefresh` + immediate full invalidation
- **What is duplicated**: Both call `POST /api/jobs/:jobId/visits/:visitId/complete` with the same payload. Both do onSuccess refresh but with markedly different cache handling.
- **Why this is shadow reuse**: The same business operation is orchestrated twice, with inconsistent UX (dispatch feels instant; modal doesn't).
- **Actual risk**: User completes from dispatch → immediate UI update via optimistic patch. User completes from modal → brief flicker while refetch lands. Inconsistent behavior for the same action.
- **Recommended consolidation direction**: Expose `completeVisitWithOutcome` as a standalone hook; EditVisitModal consumes it.
- **Confidence**: High

### Shadow Finding #S2: `TodaysOperationsCard` on Dashboard assembles `QuickCreateSlot` + `VisitEditorState` inline
- **Severity**: Medium
- **Category**: Modal orchestration
- **Canonical flow affected**: Quick create, Edit visit
- **Duplicate files/functions involved**:
  - `client/src/pages/Dashboard.tsx:296-309` — inline `onEditVisit` and `onCreateInSlot` callbacks build `VisitEditorState` / `QuickCreateSlot` shapes
  - `client/src/components/TodaysOperationsCard.tsx` — (not fully read) accepts those callbacks
  - Compare with `client/src/pages/DispatchPreview.tsx` which assembles the same shapes from its own schedule rows
- **What is duplicated**: Each page builds the launcher's input shape from its own data model. If a new field is added to `VisitEditorState`, both surfaces must update.
- **Why this is still shadow reuse**: The launcher is correctly canonical (Finding #1 avoided); but the *mapper from page row → launcher state* is not. There is no single "openVisitEditorFromRow(visit)" helper.
- **Recommended consolidation direction**: Extract `visitToEditorState(visit)` and `rowToQuickCreateSlot(row)` helpers in `client/src/lib/launcherContext.ts` and have both pages consume them.
- **Confidence**: Medium

### Shadow Finding #S3: `VisitTeamAssignment` wraps `TechnicianSelector` with its own state while `EditVisitModal` also owns crew state separately
- **Severity**: Medium
- **Category**: UI / Modal orchestration
- **Duplicate files/functions involved**:
  - `client/src/components/visits/VisitTeamAssignment.tsx` — chip list + popover
  - `client/src/components/TechnicianSelector.tsx` — canonical selector
  - `client/src/components/visits/EditVisitModal.tsx` — owns `assignedTechnicianIds` state and passes to VisitTeamAssignment
- **What is duplicated**: State for "selected technician IDs" is tracked in modal, passed to VisitTeamAssignment, which in turn drives TechnicianSelector.
- **Why this is shadow reuse**: Multi-level prop drilling for the same state is acceptable; what is not acceptable is that `AddVisitDialog` does NOT use VisitTeamAssignment — it uses TechnicianSelector directly with its own chip rendering.
- **Recommended consolidation direction**: Use `VisitTeamAssignment` in both AddVisitDialog and EditVisitModal.
- **Confidence**: Medium

### Shadow Finding #S4: `DispatchDetailPanel` reimplements visit-field edit UI that `EditVisitModal` also provides
- **Severity**: High
- **Category**: UI / Modal orchestration
- **Duplicate files/functions involved**:
  - `client/src/components/dispatch/DispatchDetailPanel.tsx` — inline crew picker, notes textarea, status select, schedule form (for unscheduled), equipment read
  - `client/src/components/visits/EditVisitModal.tsx` — full edit form for same fields
- **What is duplicated**: Two surfaces edit the same visit fields via different UIs with different mutation paths.
- **Why this is shadow reuse**: Both reach the same DB rows but through different endpoints (Finding #1), different invalidation, and different UI patterns. Users have two mental models for the same operation.
- **Recommended consolidation direction**: Either DispatchDetailPanel becomes a dense summary that opens EditVisitModal for changes, OR EditVisitModal is retired and all edits happen in the detail panel. Pick one pattern.
- **Implementation caution**: The dispatch detail panel's optimistic patching is an explicit performance feature; retiring it would regress perceived responsiveness.
- **Confidence**: High

---

## 5. Backend Duplicate Path Findings

### Backend Finding #B1: Two routes write to `job_visits` (Finding #1 — backend summary)
See Finding #1 above.

### Backend Finding #B2: `visitOutcomeEnum` inline in techField.ts (Finding #6)
See Finding #6 above.

### Backend Finding #B3: `server/schemas.ts` parallel Zod enums (Finding #7)
See Finding #7 above.

### Backend Finding #B4: `jobs.ts` has multiple update paths that do not all route through the orchestrator
- **Severity**: Medium
- **Category**: Route / Service
- **Duplicate files/functions involved**:
  - `server/routes/jobs.ts` — PATCH /api/jobs/:id direct update
  - `server/services/jobLifecycleOrchestrator.ts` — owns status-related job mutations
- **What is duplicated**: Job updates that touch status, holdReason, holdNotes, nextActionDate, closedAt should be orchestrator-owned. `updateJobSchema` in `shared/schema.ts:2452` correctly excludes those fields, but the route still accepts broad PATCH payloads. Verify server-side that those excluded fields are rejected, not silently accepted.
- **Confidence**: Medium (requires read of jobs.ts PATCH handler to confirm)

### Backend Finding #B5: `/api/tech/visits/:id` PATCH vs `/api/jobs/:jobId/visits/:visitId` PATCH
- **Severity**: High
- **Category**: Route / Cross-layer
- **Duplicate files/functions involved**:
  - `server/routes/techField.ts` — tech PATCH visit endpoint
  - `server/routes/jobVisits.routes.ts:130` — office PATCH visit endpoint
- **What is duplicated**: Two PATCH endpoints for the same DB row with overlapping but not identical accepted fields.
- **Recommended consolidation direction**: Consolidate per Finding #5.
- **Confidence**: High

### Backend Finding #B6: Invoice creation has three documented sources guarded at storage layer
- **Severity**: Low (documented, enforced)
- **Category**: Storage
- **Duplicate files/functions involved**:
  - `server/storage/invoices.ts` — `INVOICE_CREATION_SOURCES` enum; runtime guard at line 1742-1748
  - Sources: `STANDALONE_ROUTE`, `INVOICE_ROUTE`, `JOB_CLOSE_ROUTE`, `PM_BILLING_SERVICE`
- **What is NOT duplicated**: This is actually a well-architected single-write-path pattern. Called out here as a contrast point — this is how Finding #1 should look for job_visits.
- **Confidence**: High

---

## 6. Modal / Launcher Matrix

| Workflow | Canonical modal/component | Entry points found | Canonical? | Notes |
|---|---|---|---|---|
| Edit visit | `EditVisitModal` via `VisitEditorLauncher` | Dashboard.tsx:381, DispatchPreview.tsx (via launcher), JobDetailPage.tsx (imports but launch not in audit window) | **Yes** (UI) / **No** (backend — see Finding #1) | Launcher is thin and correctly shared |
| Visit edits (partial) from dispatch | `DispatchDetailPanel` | DispatchPreview.tsx | **No** | Shadow-reimplements same field edits — Shadow Finding #S4 |
| Create job (scheduled/unscheduled/edit) | `QuickAddJobDialog` | App.tsx:988 (global), Jobs.tsx, ClientDetailPage, JobDetailPage (edit), PMWorkspacePage (recurring), RecurringJobsPage (recurring), SlotQuickCreateLauncher (prefilled) | **Yes** | Single modal, mode prop. Good |
| Quick create chooser | `SlotQuickCreateLauncher` | Dashboard.tsx, DispatchPreview.tsx | **Yes** | Thin orchestrator, delegates correctly |
| Add visit to existing job | `AddVisitDialog` | JobDetailPage | **Partial** | Uses non-canonical mutation path; see Finding #20 |
| Create invoice (standalone) | `NewInvoiceModal` | App.tsx:1001, UniversalSearch, ClientDetailPage, header "New" dropdown | **Mostly** | `NewInvoicePage` duplicates it — Finding #9 |
| Create invoice (from job) | `InvoiceCompositionDialog` mode=create | JobDetailPage | **Yes** | Unique surface, well-factored |
| Create quote | `NewQuoteModal` | App.tsx:997, UniversalSearch, Quotes.tsx, ClientDetailPage, header "New" | **Mostly** | Inline client create missing — Finding #11 |
| Create client | `CreateClientModal` | App.tsx:984 (global), NewInvoiceModal (nested), ClientDetailPage | **Mostly** | CreateLeadModal reimplements it — Finding #10 |
| Create lead | `CreateLeadModal` | LeadsPage | **No** | Uses custom inline form — Finding #10 |
| Technician selection | `TechnicianSelector` + `VisitTeamAssignment` | AddVisitDialog, EditVisitModal (via VisitTeamAssignment), DispatchDetailPanel (inline CrewPicker), various | **Partial** | Selector is reusable; chip-list wrapper `VisitTeamAssignment` only used in EditVisitModal — Shadow #S3 |
| Apply template (job/quote) | `ApplyTemplateModalBase` via `ApplyTemplateModal` + `ApplyQuoteTemplateModal` | JobDetailPage, QuoteDetailPage | **Yes** | Base pattern correctly used |
| Template editor (job/quote) | `JobTemplateModal` + `QuoteTemplateModal` | SettingsPage | **No** | ~75% structural duplication — Finding #18 |
| Task create/edit | `TaskDialog` | TasksPanel, DispatchBoard, SlotQuickCreateLauncher | **Yes** | Single dialog, entity-type prefill |
| Job notes | `JobNoteDialog` via `JobNotesSection` | JobDetailPage, InvoiceDetailPage (via `source` prop) | **Yes** | Replaces older AddJobNoteDialog per 2026-04-13 |
| Location/company notes | `NotesPanel` | LocationDetailPage, CompanyDetailPage | **Yes** | |
| Equipment create | `AddEquipmentDialog` | `EquipmentPicker` (nested) | **Yes** | Extracted for reuse |
| Equipment detail | `EquipmentDetailModal` | JobDetailPage, LocationDetailPage | **Yes** | Read + annotate |
| Location form | `LocationFormModal` | CompanyDetailPage | **Partial** | Possible overlap with CreateClientModal's address form (not verified) |
| Tag edit | `EditTagsModal` vs `BulkEditTagsModal` | Both used for different scopes | **Yes (intentional)** | Two-step vs single not a duplicate |
| Team-hub add vs invite | `AddMemberDialog` + `InviteMemberDialog` | TeamHubPage | **Yes** | Sync-add vs async-invite, legitimate split |
| Dashboard action drill-down | `DashboardActionModal` | Dashboard.tsx, TodaysOperationsCard (via callback) | **Yes** | One modal, mode prop |
| Job on-hold / action required | `ActionRequiredModal` | Dashboard drill-down | **Yes** | |

---

## 7. Hook / Mutation Matrix

| Business action | Canonical hook / mutation | Alternate hooks / mutations found | Risk | Recommended canonical |
|---|---|---|---|---|
| Fetch jobs feed | `useJobsFeed` (hooks/useJobsFeed.ts:204) | None | ✓ | keep |
| Fetch job header | `useJobHeader` (useJobsFeed.ts:237) | None | ✓ | keep |
| Fetch visits for job | `useJobVisits` (hooks/useJobVisits.ts:24) | Jobs.tsx uses inline `apiRequest("/api/visits?from=...&to=...")` | Low | migrate Jobs.tsx to useJobVisits |
| Fetch calendar range | `useCalendarRange` (useSchedulingApi.ts:284) | None | ✓ | keep |
| Schedule visit (create on job) | `useDispatchPreviewMutations.scheduleVisit` | `useScheduleJob` (useSchedulingApi.ts:316), `AddVisitDialog` inline | High | merge — one hook across all surfaces |
| Reschedule visit | `useDispatchPreviewMutations.rescheduleVisit` | None on client; but EditVisitModal's `editMutation` writes overlapping fields via different endpoint | Critical | see Finding #1 |
| Unschedule visit | `useDispatchPreviewMutations.unscheduleVisit` + `useUnscheduleVisit` (useSchedulingApi.ts:335) | Two hooks exist | Low | pick one (prefer dispatch version, has optimistic patching) |
| Resize visit | `useDispatchPreviewMutations.resizeVisit` | None | ✓ | keep |
| Update visit crew | `useDispatchPreviewMutations.updateVisitCrew` | EditVisitModal.editMutation (crew via wide payload) | High | keep dispatch hook; stop sending crew in editMutation |
| Update visit notes | None (canonical hook missing) | DispatchPreview.handleUpdateVisitNotes inline, EditVisitModal.editMutation | High | add `updateVisitNotes` to useDispatchPreviewMutations |
| Update visit status (non-terminal) | `useDispatchPreviewMutations.updateVisitStatus` | None on client | Medium | server-side should orchestrator-back (Finding #4) |
| Complete visit (office) | `useDispatchPreviewMutations.completeVisitWithOutcome` | EditVisitModal.completeMutation | High | extract from dispatch hook; EditVisitModal consumes it (Shadow #S1) |
| Complete visit (tech) | `useTechVisitDetail.completeMutation` | None | ✓ | keep (tech-scoped) |
| Reopen visit | `useDispatchPreviewMutations.reopenVisit` | None | ✓ | keep |
| Delete visit | `useDispatchPreviewMutations.deleteVisit` | EditVisitModal.deleteMutation | Medium | consolidate |
| Create job | Inline in QuickAddJobDialog.tsx:238 (`createJobMutation`) + `createJobWithSchedule` in lib/jobScheduling.ts | None | Low | acceptable (one source) |
| Update job | Inline in JobDetailPage.tsx:644, 675 (`updateDescriptionMutation`, `updateJobNumberMutation`) | QuickAddJobDialog (edit mode) | Medium | extract `useJobActions(jobId)` |
| Delete job | Inline in JobDetailPage.tsx:714 | None | Low | acceptable |
| Job status / hold / resume / close | Inline in ActionRequiredModal, JobDetailPage | None | Medium | extract `useJobLifecycle(jobId)` |
| Create invoice (standalone) | Inline in NewInvoiceModal | NewInvoicePage duplicate | Medium | Finding #9 |
| Create invoice (from job) | Inline in InvoiceCompositionDialog | None | ✓ | keep |
| Update invoice (any field) | 4 inline PATCH mutations in InvoiceDetailPage.tsx:803, 820, 843, 861 | — | High | extract `useInvoiceActions(invoiceId)` — Finding #12 |
| Invoice line CRUD | Inline in InvoiceDetailPage | None | Medium | extract shared line-CRUD factory |
| Send invoice | `useSendCommunicationModal.sendMutation` | None | ✓ | keep |
| Create quote | Inline in NewQuoteModal + LeadDetailPage.tsx:176 (inline bypass) | — | High | route lead→quote through NewQuoteModal — Finding #14 |
| Update quote | Inline in QuoteDetailPage (13 mutations) | — | High | extract `useQuoteActions(quoteId)` — Finding #13 |
| Create client/location (atomic) | Inline in CreateClientModal, CreateLeadModal (duplicate) | — | High | route lead modal through CreateClientModal — Finding #10 |
| Search locations | `useLocationSearch` | None | ✓ | keep |
| Fetch technicians directory | `useTechniciansDirectory` | None | ✓ | keep |
| Live technician states | `useLiveTechnicians` (15s poll, compliant) | None | ✓ | keep |
| Products / services CRUD | `useProductsServices` | None | ✓ | keep |
| Task CRUD | `useDispatchPreviewMutations.rescheduleTask/completeTask/reopenTask/deleteTask` + `useTechTasks` + inline in TaskDialog | Triple path | Medium | factor shared `useTaskActions` |
| Task timer start/stop | `useTechTasks` (tech-only) | None on office | ✓ | tech-only, keep |
| Tech visit mutations | `useTechVisitDetail` | None on office | (shadows office via duplicate endpoints — Finding #5) | consolidate backend (Finding #5) |
| Impersonation state | Inline in ImpersonationBanner | — | Medium | Finding #19 — missing background flag |

---

## 8. File-by-File Surgical Targets

1. **`server/routes/jobVisits.routes.ts`** (lines 130-190)
   - Why suspicious: PATCH handler performs visit mutation outside the lifecycle orchestrator; accepts wide payload including crew, schedule, equipment, notes.
   - Canonical flow touched: Edit visit, Crew assignment, Reschedule.
   - Source-of-truth or wrapper? **Source-of-truth today; needs to become a thin delegator to orchestrator** or be split into narrow endpoints.

2. **`server/routes/scheduling.ts`** (lines 700-795, 987-1026)
   - Why suspicious: Parallel endpoints for reschedule (orchestrator-backed) and assign-crew (direct storage). Field-name drift on the wire.
   - Canonical flow touched: Reschedule, Crew assignment.
   - Source-of-truth or wrapper? **Source-of-truth for dispatch mutations; `assignCrewSchema` field name is the drift point**.

3. **`server/services/jobLifecycleOrchestrator.ts`**
   - Why suspicious: Owns some transitions, not others. The boundary is not codified.
   - Canonical flow touched: All status transitions.
   - Source-of-truth or wrapper? **Source-of-truth (correct); needs to expand to cover non-terminal visit status + assignCrew**.

4. **`server/routes/techField.ts`** (lines 609-751, 918-1049, and `visitOutcomeEnum` inline)
   - Why suspicious: Shadow endpoint family for parts/equipment/notes; inline enum.
   - Canonical flow touched: Tech-app visit mutations, Visit outcome.
   - Source-of-truth or wrapper? **Duplicate wrapper for many operations; source-of-truth for time-tracking and tech-only lifecycle**.

5. **`server/schemas.ts`** (lines 32, 41, 49, 64)
   - Why suspicious: Parallel Zod enum definitions.
   - Source-of-truth or wrapper? **Duplicate; should derive from shared arrays**.

6. **`client/src/pages/DispatchPreview.tsx`** (lines 972-985)
   - Why suspicious: Inline shadow mutation `handleUpdateVisitNotes` bypasses canonical hook.
   - Canonical flow touched: Edit visit notes.
   - Source-of-truth or wrapper? **Shadow (move to hook)**.

7. **`client/src/components/visits/EditVisitModal.tsx`** (lines 254-315)
   - Why suspicious: Local `editMutation`, `deleteMutation`, `completeMutation` duplicate logic from `useDispatchPreviewMutations`. Uses non-orchestrator endpoint (Finding #1).
   - Canonical flow touched: Edit visit.
   - Source-of-truth or wrapper? **Source-of-truth for the modal UI, duplicate orchestration for the mutations**.

8. **`client/src/components/dispatch/DispatchDetailPanel.tsx`** (lines 48, 425, 596-599, 834-886, 972-985)
   - Why suspicious: Reimplements visit-field edit UI inline.
   - Canonical flow touched: Edit visit (shadow).
   - Source-of-truth or wrapper? **Shadow UI for same operation**.

9. **`client/src/components/AddVisitDialog.tsx`** (lines 87-91, 123)
   - Why suspicious: Custom payload shape for `/api/calendar/schedule`, doesn't use dispatch hook.
   - Canonical flow touched: Create visit.
   - Source-of-truth or wrapper? **Duplicate mutation; should use canonical hook**.

10. **`client/src/pages/NewInvoicePage.tsx`** (all ~98 LOC)
    - Why suspicious: Duplicates NewInvoiceModal functionality, same endpoint, same redirect.
    - Source-of-truth or wrapper? **Legacy duplicate; NewInvoiceModal is canonical per its own top-of-file comment**.

11. **`client/src/components/CreateLeadModal.tsx`** (lines 42-86)
    - Why suspicious: Inline client-create form duplicates CreateClientModal.
    - Source-of-truth or wrapper? **Duplicate inline form; should mount CreateClientModal**.

12. **`client/src/components/NewQuoteModal.tsx`** (vs NewInvoiceModal)
    - Why suspicious: Uses same `CreateOrSelectField` but omits inline client creation affordance.
    - Source-of-truth or wrapper? **Canonical modal; missing one prop to reach parity with NewInvoiceModal**.

13. **`client/src/pages/InvoiceDetailPage.tsx`** (14 mutations, lines 609, 637, 803, 820, 843, 861, etc.)
    - Why suspicious: No canonical hook; four separate PATCH mutations for same endpoint.
    - Source-of-truth or wrapper? **Source of truth by default; needs a `useInvoiceActions` extraction**.

14. **`client/src/pages/QuoteDetailPage.tsx`**
    - Why suspicious: 13 inline mutations mirroring InvoiceDetailPage pattern.
    - Source-of-truth or wrapper? **Source of truth by default; needs `useQuoteActions` extraction**.

15. **`client/src/pages/LeadDetailPage.tsx`** (line 176)
    - Why suspicious: `convertMutation` POSTs `/api/quotes` inline; bypasses NewQuoteModal and its invalidation logic.
    - Source-of-truth or wrapper? **Duplicate quote creation**.

16. **`client/src/components/JobTemplateModal.tsx`** and **`QuoteTemplateModal.tsx`**
    - Why suspicious: ~75% structural overlap.
    - Source-of-truth or wrapper? **Two sources of truth; extract shared base like `ApplyTemplateModalBase`**.

17. **`client/src/components/ImpersonationBanner.tsx`** (line 36)
    - Why suspicious: Polling without background guard; needs either the flag or a documented exception.
    - Source-of-truth or wrapper? **Source of truth; minor fix**.

18. **`client/src/components/dispatch/dispatchPreviewUtils.ts`** (line 197) and **`client/src/components/products-services/types.ts`** (line 87)
    - Why suspicious: Identical `formatDuration` implementations.
    - Source-of-truth or wrapper? **Duplicate; extract to `client/src/lib/formatDuration.ts`**.

19. **`client/src/tech-app/utils/visitDisplay.ts`** (lines 17-33)
    - Why suspicious: Label map duplicates `dispatchPreviewUtils.ts` label map.
    - Source-of-truth or wrapper? **Duplicate labels (colors intentionally differ)**.

20. **`server/routes/invoices.ts`** (`updateInvoiceLineSchema`)
    - Why suspicious: Re-declares `canonicalLineItemInput` fields instead of `.partial().extend()`.
    - Source-of-truth or wrapper? **Duplicate schema; should derive**.

---

## 9. Remediation Order (safest → riskiest)

This is sequenced so each step lands on a stable base, is verifiable in isolation, and does not depend on later steps. No code yet; this is the recommended order when you move from audit to implementation.

**Phase 1 — Zero-risk static cleanups (do first, they unblock later phases).**
1. Fix `visitOutcomeEnum` duplication (Finding #6). Import from shared.
2. Remove duplicate Zod enums in `server/schemas.ts` (Finding #7). Derive from shared string arrays.
3. Extract `formatDuration` (Finding #15).
4. Extract `visitStatusLabel` to shared (Finding #16 — labels only; keep color palettes local).
5. Refactor `updateInvoiceLineSchema` to derive from `canonicalLineItemInput` (Finding #17).
6. Decide on ImpersonationBanner polling (Finding #19) — add flag or document exception.

**Verify after Phase 1**: run `npm run check` (no runtime behavior change expected).

**Phase 2 — Client orchestration consolidation (UI only, no backend change).**
7. Make `NewQuoteModal` offer inline client creation (Finding #11).
8. Replace `CreateLeadModal`'s custom client form with nested `CreateClientModal` (Finding #10).
9. Migrate `NewInvoicePage` to either redirect to a modal-opening URL or be removed (Finding #9).
10. Route `LeadDetailPage.convertMutation` through NewQuoteModal (Finding #14).
11. Migrate `AddVisitDialog` to use `useScheduleJob` or `useDispatchPreviewMutations.scheduleVisit` (Finding #20).

**Verify after Phase 2**: manual click-through of each migrated entry point; same endpoint hit, same invalidation keys fired.

**Phase 3 — Hook extraction (client mutation consolidation).**
12. Extract `useInvoiceActions(invoiceId)` and migrate InvoiceDetailPage (Finding #12). Fold the four separate PATCH mutations into one partial-update mutation.
13. Extract `useQuoteActions(quoteId)` (Finding #13).
14. Extract `updateVisitNotes` into `useDispatchPreviewMutations`; migrate `DispatchPreview.handleUpdateVisitNotes` off the inline `apiRequest` (Finding #2, Shadow #S1 partial).
15. Extract `completeVisitWithOutcome` as a standalone hook; EditVisitModal consumes it (Shadow #S1).

**Freeze during Phase 3**: no new mutation added to InvoiceDetailPage / QuoteDetailPage / LeadDetailPage until consolidation is complete.

**Verify after Phase 3**: test each entity's detail page — edit, save, observe correct invalidation of list + detail keys.

**Phase 4 — Backend consolidation (highest risk; requires testing with real data).**
16. Move non-terminal visit status transitions into the orchestrator (Finding #4). Route handler becomes a thin dispatcher.
17. Unify visit-update endpoints (Finding #1). Decision: route EditVisitModal's field saves through `/api/calendar/visit/:id/reschedule` OR narrow `/api/jobs/:jobId/visits/:visitId` to non-schedule fields only. Either way, fix field-name drift (Finding #8) to a single vocabulary.
18. Unify crew-update paths (Finding #3). Rename `technicianUserIds` → `assignedTechnicianIds`.
19. Consolidate tech-app and office-app parts/equipment/notes endpoints (Finding #5). Keep `/api/tech/*` only for time-tracking and tech-specific lifecycle actions.

**Freeze during Phase 4**: no dispatch board / EditVisitModal feature work; no tech-app field-coverage expansion.

**Verify after each Phase-4 step**:
- Visit lifecycle matrix test: schedule → start → en-route → start → pause → resume → complete → reopen, from both tech and office surfaces.
- Actioned-visit protection: schedule visit, add labor, then try to reschedule from EditVisitModal AND from dispatch drag — confirm same spawn behavior.
- Crew change matrix: empty → single → multiple → empty, from AddVisitDialog, EditVisitModal, DispatchDetailPanel, and dispatch drag-to-other-lane.

**Phase 5 — UI double-surface decision (deferred).**
20. Decide on DispatchDetailPanel vs EditVisitModal (Shadow #S4). This is a product decision, not a code cleanup. Park until Phase 4 is complete.
21. Refactor Job/Quote template editors onto a shared base (Finding #18). Low-risk UI refactor; can happen anytime after Phase 1 but is not blocking.

---

## 10. Open Questions / Uncertain Areas

1. **`server/routes/jobs.ts` PATCH handler** — audit did not fully read the route body. Need to confirm that job lifecycle fields (status, holdReason, holdNotes, nextActionDate, closedAt) — correctly excluded from `updateJobSchema` in `shared/schema.ts:2452` — are server-side-rejected in the PATCH handler and not silently accepted. If not rejected, it is a secondary path into the orchestrator's owned surface. (Backend Finding #B4)

2. **Equipment save from EditVisitModal** — First audit agent noted `selectedEquipmentIds` is gathered in the modal but observed the mutation not in the read window. If equipment changes are saved via a separate endpoint mounted inside `EquipmentPicker`, that is a third hidden path; if equipment changes are included in the wide PATCH visit payload, the Finding #1 consolidation must preserve them. Needs a direct read of `EquipmentPicker.tsx` save flow + `EditVisitModal.tsx` submit assembly to resolve.

3. **`/api/tech/visits/:id/complete` orchestrator wiring** — Every audit agent described it as orchestrator-backed but none read the exact handler. Worth confirming before doing Phase 5 (Finding #4) that the tech route does delegate to `lifecycle.completeVisit` (and not duplicate the reconciliation logic).

4. **Quote tax application** — The 2026-03-18 `batchApplyLineTax` baseline is confirmed for invoices (storage/invoices.ts:758, route /api/invoices/:id/apply-tax). Whether quotes use the same canonical path or have their own tax recalculation was not verified. If quotes have a separate `batchApplyQuoteLineTax` (or worse, per-line updates), that is an additional Critical-severity finding parallel to Finding #17.

5. **LocationFormModal vs CreateClientModal address form** — Possible overlap of address-entry UI between these two modals was flagged but not confirmed by reading both files side-by-side. If the address form is duplicated, it is a low-severity UI finding parallel to Finding #18.

6. **DispatchDetailPanel inline mutations** — The audit confirmed `onUpdateVisitNotes` is a shadow inline mutation on DispatchPreview, but the panel's other callbacks (`onUpdateStatus`, `onScheduleFromPanel`, `onUpdateCrew`) were traced only to the dispatch hook. If any of those have their own per-page inline paths in any other mounting surface (e.g., month-grid vs day-grid), additional shadow mutations may exist. A direct grep for every use of `DispatchDetailPanel` callback props across the client would be needed to close this gap.

7. **`/api/calendar/visit/:id/unschedule`** — The orchestrator status (orchestrator-backed vs direct storage) was reported differently by two agents. Needs a direct read of `scheduling.ts:797-850` to confirm.
