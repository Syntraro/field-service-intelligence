# Recurring Jobs Architecture Audit

**Date:** 2026-03-31  
**Scope:** PM recurrence engine analysis for recurring job integration  
**Status:** Audit only — no implementation

---

## Section A: Files Inspected (Read-Only)

| File | Purpose |
|------|---------|
| `shared/schema.ts` | Schema source of truth — tables, enums, relations |
| `server/domain/recurrence.ts` | Core recurrence engine — occurrence computation, instance generation, job creation |
| `server/services/pmAutoGeneration.ts` | Background scheduler (6h interval + startup) |
| `server/services/pmBillingService.ts` | PM contract billing event engine |
| `server/services/pmJobParts.ts` | PM parts copy (location templates → job_parts) |
| `server/routes/recurringJobs.ts` | CRUD routes for recurring templates + generation triggers |
| `server/routes/pmBilling.ts` | PM billing event routes |
| `server/routes/pmTemplates.ts` | PM content template routes |
| `server/storage/recurringJobs.ts` | Repository layer for recurring_job_templates |
| `server/index.ts` | Startup hook for PM auto-generation |
| `client/src/pages/PMWizardPage.tsx` | PM create wizard (5-step) |
| `client/src/pages/PMEditPage.tsx` | PM edit page |
| `client/src/pages/PMDetailPage.tsx` | PM detail/actions page |
| `client/src/pages/PMWorkspacePage.tsx` | PM Hub (5 tabs) |
| `client/src/pages/RecurringJobsPage.tsx` | General recurring template management |
| `client/src/components/QuickAddJobDialog.tsx` | Job create/edit dialog |
| `client/src/components/pm/PmMonthPicker.tsx` | Reusable month selector |
| `client/src/components/pm/PmGenerationModeSelector.tsx` | Generation mode radio group |
| `client/src/components/pm/PmServiceWindowInputs.tsx` | Service window inputs |
| `client/src/components/pm/PmBillingFields.tsx` | PM billing config fields |

---

## Section B: Findings

### B1. Current Data Model

**Tables powering PM recurrence:**

| Table | Role |
|-------|------|
| `recurring_job_templates` | The recurrence template — contains schedule rules, PM billing config, job defaults. Despite the name, this is the PM "contract" record. |
| `recurring_job_instances` | Instance tracker — one row per scheduled occurrence date. Status lifecycle: pending → claiming → generated/skipped/canceled. |
| `pm_templates` | Content blueprints — reusable PM presets (default months, generation mode, parts). Prefills recurring_job_templates fields on create. Not a recurrence engine. |
| `pm_billing_events` | Contract billing periods — for monthly_fixed/annual_prepaid contracts only. |
| `location_pm_plans` | Legacy — per-location month booleans (pmJan..pmDec). Not used by the new recurrence engine. |
| `recurring_job_series` / `recurring_job_phases` | Legacy Phase 0 — multi-phase series. Still in schema, recurringSeriesId FK on jobs exists, but superseded by recurrenceTemplateId. |
| `jobs` | Generated output — linked back via recurrenceTemplateId + recurrenceInstanceDate |

**Key recurrence fields on `recurring_job_templates`:**

| Field | Purpose |
|-------|---------|
| `recurrenceKind` | `weekly` or `monthly` |
| `interval` | Every N weeks/months |
| `daysOfWeek` | `[0-6]` for weekly |
| `dayOfMonth` | `1-31` for monthly |
| `monthsOfYear` | `[1-12]` — restrict to specific months |
| `generationMode` | `phase` / `period_start` / `day_of_month` |
| `generationDayOfMonth` | Day for `day_of_month` mode |
| `startDate` / `endDate` | Series bounds |
| `serviceWindowDaysBefore/After` | Lead time / scheduling window |
| `isActive` | Active/inactive toggle |
| `timezone` | IANA timezone for occurrence computation |

**Linkage from generated job back to template:**

- `jobs.recurrenceTemplateId` → `recurring_job_templates.id`
- `jobs.recurrenceInstanceDate` → matches `recurring_job_instances.instanceDate`
- `recurring_job_instances.generatedJobId` → `jobs.id` (reverse link)

**Generation sequence:** Template → Instances (pending) → Jobs (dispatcher-triggered). Jobs are created first, visits are NOT auto-created — dispatchers schedule visits separately.

**PM-specific fields baked into `recurring_job_templates`:**

- `pmBillingModel`, `pmBillingLabel`, `pmContractAmount`
- `includeLocationPmParts`
- `generationMode` (period_start/day_of_month are PM-specific; phase is general)

**Critical insight:** The table is named `recurring_job_templates`, NOT `pm_contracts`. It already has general recurrence fields (`recurrenceKind`, `interval`, `daysOfWeek`, `dayOfMonth`) alongside PM-specific fields. **The generalization is half-done in the schema already.**

### B2. Current Write Paths

**1. Creating a PM contract:**

`POST /api/recurring-templates` → `recurringJobsRepository.createTemplate()` → inserts into `recurring_job_templates` → if active + has locationId, auto-generates initial instances via `generateForSingleTemplate()`

**2. Generating instances (not jobs yet):**

- **Automatic:** `pmAutoGeneration.ts` runs every 6 hours + 30s after startup. Calls `generateInstances()` for every company. Creates `recurring_job_instances` rows in "pending" status. Idempotent via unique `(templateId, instanceDate)` + `onConflictDoNothing()`.
- **Manual:** `POST /api/recurring-templates/generate` or `POST /api/recurring-templates/:id/generate`

**3. Generating jobs from instances (dispatcher action):**

`POST /api/recurring-templates/generate-selected` with `instanceIds[]` → `generateFromInstances()` → for each instance: atomic claim → `jobRepository.createJob()` → optional `copyLocationPMPartsToJob()` → mark instance "generated"

**4. Canonical owner:** `server/domain/recurrence.ts` owns all generation logic. Routes call into it. The scheduler calls into it. Single source of truth for occurrence computation and job creation.

**5. Recurrence logic location:** Centralized in `server/domain/recurrence.ts`. Not split across routes or storage. Routes are thin wrappers.

### B3. Scheduler Behavior

| Question | Answer |
|----------|--------|
| Trigger | `setInterval` (6h) + `setTimeout` (30s startup delay) in `pmAutoGeneration.ts`, started from `server/index.ts` |
| Frequency | Every 6 hours |
| Generation timing | 45 days ahead (DEFAULT_WINDOW_DAYS) — generates instances, not jobs |
| Lead time | `serviceWindowDaysBefore/After` on template — configurable per template |
| Idempotency | Unique constraint `(templateId, instanceDate)` + `onConflictDoNothing()` for instances. Atomic `UPDATE WHERE status='pending'` claim for job creation. |
| Missed runs | Next run catches up — 45-day window means a missed 6h cycle has no impact. Stale claims auto-recovered after 10 minutes. |

### B4. UI / Create Flows

**PM creation:** 5-step wizard (`PMWizardPage.tsx`) → Location → Setup type → PM basics (months, generation mode, service window, billing) → Parts options → Review & Create

**Recurrence config UI exists as reusable components:**

- `PmMonthPicker` — month multi-select with presets
- `PmGenerationModeSelector` — period_start vs day_of_month radio
- `PmServiceWindowInputs` — before/after day inputs
- `PmBillingFields` — billing model/label/amount

**Job creation:** `QuickAddJobDialog.tsx` — no recurring toggle, no series concept, no template linkage. Creates one-off jobs only.

**Reusability assessment:** The PM recurrence components are modular and accept generic props. `PmBillingFields` is clearly PM-specific. `PmMonthPicker`, `PmGenerationModeSelector`, and `PmServiceWindowInputs` could be reused for general recurring jobs, but their prop names and labels contain PM-specific language.

### B5. Domain Semantics

| Concept | Current implementation |
|---------|----------------------|
| One-time job | `jobs` row with `recurrenceTemplateId = NULL` |
| PM contract | `recurring_job_templates` row with PM billing fields populated |
| Generated PM instance | `recurring_job_instances` row → eventually links to a `jobs` row |
| Visit | `job_visits` row — always a child of a job, no PM-specific fields |

**PM is currently treated as:** A mix of contract + template + schedule. The `recurring_job_templates` table serves triple duty. The billing fields make it a contract. The job defaults make it a template. The recurrence rules make it a schedule.

**If we added "Recurring" to job creation today:** The `recurring_job_templates` table would semantically fit for non-PM recurring jobs — the billing fields are all nullable. A recurring repair job would simply be a `recurring_job_templates` row with `pmBillingModel = NULL`, `includeLocationPmParts = false`, and `generationMode = "phase"` (weekly/monthly). The `recurrenceKind` + `interval` + `daysOfWeek`/`dayOfMonth` fields already support this.

---

## Section C: Risks / Constraints

### PM-specific assumptions currently baked in

**Schema:**

- `recurring_job_templates.pmBillingModel/Label/Amount` — PM billing columns on the template table. Nullable, so non-PM templates can leave them NULL. **Low risk.**
- `jobs.pmBillingModel/Disposition/Status/Label` — PM billing snapshot columns on every job. Also nullable. **Low risk** for non-PM generated jobs (they'll simply be NULL).
- `pm_billing_events.pmContractId` references `recurring_job_templates.id` — naming implies PM-only. **Naming concern only**, not a functional blocker.

**Services:**

- `pmAutoGeneration.ts` processes ALL active `recurring_job_templates`, not just PM ones. **Already general** — it will auto-generate instances for any active template regardless of jobType.
- `pmBillingService.ts` filters by `pmBillingModel IN ('monthly_fixed', 'annual_prepaid')` — naturally skips non-PM templates. **No risk.**
- `copyLocationPMPartsToJob()` only runs when `template.includeLocationPmParts = true`. **No risk** for non-PM templates.

**UI:**

- PM Workspace (`/pm`) shows all templates filtered to PM context. Need separate or shared UI for non-PM recurring templates.
- `RecurringJobsPage.tsx` already exists as a general recurring template management page — partially implemented.
- PM components use PM-specific labels ("months of service", "PM parts", "billing model"). **Naming concern** for reuse.

**Generation logic:**

- `computeOccurrenceDates()` already handles both PM modes (period_start, day_of_month) AND general modes (phase → weekly/monthly). **Already general.**
- `generateFromInstances()` creates jobs with PM billing snapshots. For non-PM templates, these would be NULL. **No risk.**

### What would cause duplicate truth / parallel logic

1. **Creating a second `recurring_job_templates`-like table** for non-PM recurring jobs. This is the primary anti-pattern to avoid.
2. **Creating a second generation engine** separate from `recurrence.ts`.
3. **Creating a second scheduler** separate from `pmAutoGeneration.ts`.
4. **Creating a second instance tracking table** separate from `recurring_job_instances`.
5. **Adding recurrence fields directly to the `jobs` table** instead of using the template→instance→job pipeline.

### What makes reuse safe

- The existing engine is **already generalized** at the domain/service layer
- PM-specific fields are **all nullable**
- The scheduler picks up **all active templates**, not just PM
- Instance idempotency and job generation are **template-agnostic**
- The only PM coupling is in billing (which is naturally skipped for non-PM)

---

## Section D: Recommendation

### Recommended path: Option 1 — Reuse PM engine directly with minimal extension

The architecture is already 90% general. The `recurring_job_templates` table supports weekly/monthly recurrence with no PM-specific requirements. The generation engine processes all active templates regardless of jobType. The scheduler already picks them up. PM billing naturally no-ops for non-PM templates.

**Why this is safest:**

- Zero new tables, zero new services, zero new schedulers
- The existing engine is battle-tested with idempotency, concurrency safety, stale claim recovery
- PM billing fields are all nullable — non-PM templates simply leave them NULL
- `computeOccurrenceDates()` already handles weekly and monthly without PM generation modes
- `generateFromInstances()` already handles non-PM job creation (billing snapshot will be NULL)

**Canonical owner remains:** `server/domain/recurrence.ts` — single source of truth for all recurrence computation and job generation.

**Single source of truth:** `recurring_job_templates` table — one table for all recurring work, whether PM or not.

### Should Create Job → Recurring create a template or a normal job?

**A recurrence template that later generates jobs.** This matches the current architecture exactly:

1. The current pipeline is: Template → Instances (pending) → Jobs (dispatcher-generated)
2. A "recurring job" is not a job — it's a **schedule that produces jobs**
3. If you created a normal job + recurrence metadata, you'd need a second generation path to produce future jobs from it. That's a duplicate engine.
4. The template model gives you: instance tracking, skip/cancel per occurrence, idempotency, clean separation between "the schedule" and "the work"

**First instance:** Should be created by the scheduler, not immediately. Reasons:

- Consistent behavior — all instances go through the same pipeline
- Idempotency guaranteed — the unique constraint prevents duplicates
- The scheduler runs within 30 seconds of server start AND every 6 hours
- If the user needs a job *now*, they create a normal one-off job. Recurring is for *future* automation.
- However: current behavior for PM is that `generateForSingleTemplate()` is called on template create. This creates pending instances immediately. The same should apply to recurring jobs — instances created immediately, but jobs still require dispatcher action.

**Generated jobs link back via:** `jobs.recurrenceTemplateId` + `jobs.recurrenceInstanceDate` — already exists, no schema changes needed for linkage.

---

## Section E: Proposed Implementation Plan

### Schema Impact: Minimal

1. **No new tables.** Recurring jobs use `recurring_job_templates` + `recurring_job_instances` as-is.
2. **No new columns on `recurring_job_templates`** — `recurrenceKind`, `interval`, `daysOfWeek`, `dayOfMonth`, `startDate`, `endDate`, `monthsOfYear` already exist.
3. **Optional:** Add a `templateCategory` discriminator column (`"pm"` | `"recurring"` | null) if UI needs to distinguish PM contracts from general recurring jobs in queries. This is a UX convenience, not an architectural requirement — could also filter by `pmBillingModel IS NOT NULL` to identify PM templates.
4. **Migration:** One optional column add if `templateCategory` is added. No data migration needed.

### Backend Impact: Minimal

1. **`recurrence.ts`** — No changes. Already handles weekly/monthly recurrence generically.
2. **`pmAutoGeneration.ts`** — No changes. Already processes all active templates.
3. **Routes:** `POST /api/recurring-templates` already accepts all needed fields. The only addition would be ensuring the create route doesn't enforce PM-specific validation (monthsOfYear required, etc.) when creating non-PM templates. Check and relax if needed.
4. **PM billing service** — No changes. Naturally skips templates with `pmBillingModel = NULL`.

### Frontend Impact: Moderate

1. **QuickAddJobDialog or new modal:** Add a "Make Recurring" toggle/section that:
   - Shows recurrence config (kind: weekly/monthly, interval, daysOfWeek/dayOfMonth)
   - Shows start date, optional end date
   - Does NOT show PM billing fields
   - On submit: calls `POST /api/recurring-templates` (not `POST /api/jobs`)
   - After create: auto-generates initial instances (existing behavior)
2. **Reusable components:** Extract or reuse week-day picker, interval input from existing PM or RecurringJobsPage UI. `PmMonthPicker` can be reused if labels are generalized. `PmGenerationModeSelector` is PM-specific and NOT needed for general recurring (use `phase` mode).
3. **Recurring Jobs list/management:** `RecurringJobsPage.tsx` already exists. May need polish.
4. **Job detail:** When viewing a generated job, show "Part of recurring series: {template.title}" with link — `recurrenceTemplateId` already on the job.

### Migration/Compatibility Impact: None to Minimal

- Existing PM contracts continue working unchanged
- Existing generated jobs retain their linkage
- No data migration unless `templateCategory` column added (one ALTER TABLE, backfill PM templates)
- Backward compatible — all existing routes and queries continue functioning

### Idempotency Safeguards: Already In Place

- Instance creation: `UNIQUE(templateId, instanceDate)` + `onConflictDoNothing()`
- Job creation: Atomic `UPDATE SET status='claiming' WHERE status='pending'`
- Stale claim recovery: 10-minute threshold auto-revert
- No additional safeguards needed

### Edit Behavior: Template vs Generated Job

| Action | Target | Behavior |
|--------|--------|----------|
| Edit template | `recurring_job_templates` | Changes future instances only. Already-generated jobs unchanged. |
| Edit generated job | `jobs` | Normal job edit. No back-propagation to template. |
| Pause template | `recurring_job_templates.isActive = false` | Stops future instance generation. Existing pending instances remain. |
| Delete template | Soft delete | Existing jobs preserved (FK is SET NULL). |
| Skip instance | `recurring_job_instances.status = 'skipped'` | No job generated for that date. |

### Verification Checklist

- [ ] Non-PM recurring template created via `POST /api/recurring-templates` with `pmBillingModel = NULL`
- [ ] Scheduler picks up new template and generates instances within 6h (or on manual trigger)
- [ ] `generateFromInstances()` creates jobs with NULL PM billing fields
- [ ] PM billing service skips non-PM templates (no billing events created)
- [ ] PM parts copy skipped when `includeLocationPmParts = false`
- [ ] Generated job has `recurrenceTemplateId` set correctly
- [ ] Generated job has `recurrenceInstanceDate` set correctly
- [ ] Instance deduplication works (same templateId + instanceDate = no duplicate)
- [ ] Existing PM contracts continue generating correctly (no regression)
- [ ] Existing PM billing continues correctly (no regression)
- [ ] Skip/cancel instance works for non-PM templates
- [ ] Pause/resume template works for non-PM templates
- [ ] Weekly recurrence (daysOfWeek) generates correct occurrence dates
- [ ] Monthly recurrence (dayOfMonth) generates correct occurrence dates
- [ ] No TypeScript errors
- [ ] No new tables created
- [ ] No new schedulers/services created
- [ ] No duplicate generation logic

---

## Section F: Open Questions Before Coding

1. **Discriminator column:** Do we want `templateCategory` (`"pm"` | `"recurring"`) on `recurring_job_templates` to cleanly separate PM contracts from general recurring jobs in queries/UI, or rely on `pmBillingModel IS NOT NULL` as the PM indicator?

2. **UI entry point:** Should "Make Recurring" live inside QuickAddJobDialog (inline toggle that switches the submit target from `POST /api/jobs` to `POST /api/recurring-templates`), or should it be a separate "Create Recurring Job" flow (new modal/page)?

3. **Location requirement:** PM templates require `locationId` (can't generate jobs without a location). Should general recurring jobs also require a location, or allow company-wide unassigned recurring work?

4. **Month restriction:** PM uses `monthsOfYear` to restrict generation to specific months. Should general recurring jobs support this (useful for seasonal work like furnace checks), or always generate every month?

5. **Generation mode:** PM has `period_start` and `day_of_month` modes. General recurring jobs would use `phase` mode (weekly/monthly). Should we expose the PM-specific generation modes to recurring jobs, or lock them to `phase` only?

6. **First instance timing:** Current PM behavior: instances are created immediately on template create (via `generateForSingleTemplate()`), but remain in "pending" status until a dispatcher generates jobs. Should we also auto-create the first job for recurring (skip the pending step), or keep the same dispatcher-mediated flow?

7. **jobType for non-PM:** PM templates default to `jobType = "maintenance"`. What should the default be for general recurring jobs? Should the user pick from the existing enum (`maintenance`, `repair`, `inspection`, `installation`, `emergency`)?

8. **RecurringJobsPage.tsx reuse:** This page already exists but appears to be a PM-adjacent management view. Is it the right home for general recurring job management, or should recurring jobs be accessible from the main Jobs page?

9. **Template editing:** When a user edits a recurring job template, should already-generated pending instances be regenerated (deleted and recreated with new dates), or should only future instances reflect the change?

---

## Appendix: Detailed Schema Reference

### Enum Definitions

| Enum | Values | Used By |
|------|--------|---------|
| `jobTypeEnum` | maintenance, repair, inspection, installation, emergency | jobs, recurring_job_templates |
| `recurrenceFrequencyEnum` | daily, weekly, monthly, quarterly, yearly | recurring_job_phases (legacy) |
| `recurrenceKindEnum` | weekly, monthly | recurring_job_templates |
| `generationModeEnum` | phase, period_start, day_of_month | recurring_job_templates |
| `recurringInstanceStatusEnum` | pending, claiming, generated, skipped, canceled | recurring_job_instances |
| `pmBillingModelEnum` | per_visit, monthly_fixed, annual_prepaid, do_not_bill | recurring_job_templates |
| `pmBillingDispositionEnum` | invoice_on_completion, covered_by_contract, archive_no_invoice | jobs |
| `pmBillingStatusEnum` | pending_invoice, invoiced, no_invoice_expected, billing_exception | jobs |
| `pmBillingEventStatusEnum` | pending, invoiced, skipped, canceled, billing_exception | pm_billing_events |
| `jobStatusEnum` | open, completed, invoiced, archived | jobs |
| `jobVisitStatusEnum` | scheduled, dispatched, en_route, on_site, in_progress, on_hold, completed, cancelled | job_visits |

### Recurrence Field Map

| Field | Table(s) | Type | Purpose |
|-------|----------|------|---------|
| `recurrenceKind` | recurring_job_templates | text enum | weekly or monthly |
| `interval` | recurring_job_templates, recurring_job_phases | integer | Every N frequency units |
| `daysOfWeek` | recurring_job_templates | integer[] | 0=Sun..6=Sat |
| `dayOfMonth` | recurring_job_templates | integer | 1..31 |
| `monthsOfYear` | recurring_job_templates, pm_templates | integer[] | 1..12 |
| `startDate` | recurring_job_templates, recurring_job_series | date | Recurrence start |
| `endDate` | recurring_job_templates | date | Recurrence end |
| `timezone` | recurring_job_templates, recurring_job_series | text | IANA timezone |
| `generationMode` | recurring_job_templates, pm_templates | text enum | phase, period_start, day_of_month |
| `generationDayOfMonth` | recurring_job_templates, pm_templates | integer | 1..31 |
| `serviceWindowDaysBefore` | recurring_job_templates, pm_templates | integer | Lead-time (days) |
| `serviceWindowDaysAfter` | recurring_job_templates, pm_templates | integer | Window after ideal date |
| `instanceDate` | recurring_job_instances | date | Scheduled generation date |
| `recurrenceInstanceDate` | jobs | date | Date job was generated for |
| `recurrenceTemplateId` | jobs | varchar FK | Links job to template |
| `generatedJobId` | recurring_job_instances | varchar FK | Backlink to created job |

### Generation Flow Diagram

```
recurring_job_templates (active)
        │
        ▼ (scheduler: every 6h / startup + 30s)
   computeOccurrenceDates()
        │
        ▼ (idempotent: UNIQUE templateId + instanceDate)
recurring_job_instances (status: "pending")
        │
        ▼ (dispatcher action: POST /generate-selected)
   claimInstanceForJobCreation() — atomic UPDATE WHERE status='pending'
        │
        ▼
   jobRepository.createJob() — with recurrenceTemplateId + billing snapshot
        │
        ├──▶ copyLocationPMPartsToJob() (if includeLocationPmParts=true)
        │
        ▼
   recurring_job_instances (status: "generated", generatedJobId set)
        │
        ▼
   jobs table — unscheduled, awaiting dispatcher assignment
```

### PM Billing Disposition Logic

```
pmBillingModel          →  pmBillingDisposition          →  pmBillingStatus
─────────────────────────────────────────────────────────────────────────────
per_visit               →  invoice_on_completion         →  pending_invoice
monthly_fixed           →  covered_by_contract           →  no_invoice_expected
annual_prepaid          →  covered_by_contract           →  no_invoice_expected
do_not_bill             →  archive_no_invoice            →  no_invoice_expected
NULL (non-PM)           →  invoice_on_completion         →  pending_invoice
```
