# Canonical Query Audit Report

**Date:** 2026-02-12
**Scope:** Full codebase — server storage/routes/services + client pages/components/hooks

---

## CANONICAL CANDIDATE 1: "Job Visit Feed" (CRITICAL — highest duplication)

### SERVER-SIDE DUPLICATES

| # | File:Line | Tables Joined | Filters | Computed Fields | Response Shape |
|---|-----------|--------------|---------|-----------------|---------------|
| A | `server/storage/jobVisits.ts:218` | jobVisits INNER JOIN jobs LEFT JOIN clientLocations | companyId, isActive=true, scheduledStart range, assignedToUser(userId) | EnrichedVisit mapper (spread visit + nested job/location) | `EnrichedVisit[]` |
| B | `server/storage/visits.ts:109` | jobVisits INNER JOIN jobs LEFT JOIN clientLocations | **Identical to A** | **Identical to A** (uses shared ENRICHED_VISIT_SELECT) | `EnrichedVisit[]` |
| C | `server/storage/visits.ts:210` | jobVisits INNER JOIN jobs LEFT JOIN clientLocations | companyId, isActive, range, **optional** userId, **optional** excludeStatuses | Same mapper | `EnrichedVisit[]` |
| D | `server/storage/calendar.ts:186` (raw SQL CTE) | job_visits JOIN jobs LEFT JOIN client_locations + bulk users/technicianProfiles + bulk customerCompanies | companyId, isActive, scheduledStart IS NOT NULL, status NOT IN (cancelled,completed), ROW_NUMBER per job, date range, j.deleted_at IS NULL | durationMinutes from start/end diff, technician name/color, customerCompanyName | `CalendarJobWithDetails[]` |
| E | `server/storage/calendar.ts:460` | jobs LEFT JOIN clientLocations + bulk users/technicianProfiles + bulk customerCompanies | companyId, deletedAt IS NULL, isActive, scheduledStart IS NULL, status='open' | Same tech enrichment as D | `CalendarJobWithDetails[]` |
| F | `server/routes/adminTimesheets.ts:284` | jobVisits INNER JOIN jobs LEFT JOIN clientLocations | companyId, isActive, scheduledStart window, optional ILIKE search | `label` (concatenated display), `sameDay` (boolean) | `{visitId, visitNumber, scheduledStart, status, jobId, jobNumber, jobSummary, locationName, label, sameDay}` |

### LOGIC DIVERGENCES

1. **Query A and B are identical code** — `jobVisits.ts:218` and `visits.ts:109` both export `getVisitsForUserInRange` with the same logic. A is on the repository class, B is a standalone function. The tech route imports B; nothing currently imports A. **A is dead code.**

2. **Visit selection semantics differ fundamentally:**
   - Queries A/B/C/F return **all matching visits** (flat list)
   - Query D returns **one visit per job** (the "current eligible visit" via ROW_NUMBER window function)
   - These are different data models — cannot be trivially unified

3. **Location name resolution differs:**
   - A/B/C/F use `clientLocations.companyName` directly
   - D/E use `clientLocations.companyName` then resolve `customerCompanies.name` via a separate batch query
   - Result: the same location shows different names on calendar vs. tech schedule

4. **Technician enrichment differs:**
   - A/B/C/F return no technician name/color (raw assignedTechnicianId/Ids only)
   - D/E do bulk lookup on `users LEFT JOIN technicianProfiles` for name + color

5. **Missing `syncJobScheduleFromVisits` in tech routes:** `techField.ts` lines 169-177 (en-route), 215-224 (start), 282-299 (complete) perform direct `db.update(jobVisits)` **without** calling `syncJobScheduleFromVisits`. Every mutation in `jobVisitsRepository` calls sync. This means tech mobile status transitions (en_route, in_progress, completed) do NOT mirror to the `jobs` table.

### CLIENT-SIDE CONSUMERS

| # | File:Component | Endpoint | Query Key | Type Used | Post-fetch Transform |
|---|---------------|----------|-----------|-----------|---------------------|
| 1 | `TechSchedulePage.tsx:TechSchedulePage` | GET /api/tech/visits/today | `["/api/tech/visits/today"]` | Local `ScheduleVisit` (line 26) — 7 fields | `groupByDate()` sorts into day buckets |
| 2 | `TechHomePage.tsx:TechHomePage` | GET /api/tech/visits/today | `["/api/tech/visits/today"]` | Local `ScheduleVisit` (line 30) — 8 fields | Filters to `status !== 'completed'`, takes first as "next visit" |
| 3 | `TechVisitDetailPage.tsx:TechVisitDetailPage` | GET /api/tech/visits/:id | `["/api/tech/visits", visitId]` | Local `VisitDetail` (line 72) — nested visit/job/location/notes | None |
| 4 | `hooks/useJobVisits.ts:useJobVisits` | GET /api/jobs/:id/visits?all=true | `["/api/jobs", jobId, "visits", "all"]` | `JobVisit` from shared schema | Splits into currentEligible, upcoming, history via memoized computation |
| 5 | `Calendar.tsx:Calendar` | GET /api/calendar?year&month | `["/api/calendar", view, year, month, timestamp]` | `CalendarRangeResponseDto` from shared types | Maps to calendar event objects |
| 6 | `hooks/useCalendarApi.ts:useCalendarRange` | GET /api/calendar?start&end | `["/api/calendar/range", startISO, endISO]` | `CalendarRangeResponseDto` | None |

**Duplicate interfaces for visit sub-entities** — `VisitJob` defined 3 times:
- `TechSchedulePage.tsx:12` — `{ id, jobNumber, summary, jobType }`
- `TechHomePage.tsx:13` — `{ id, jobNumber, summary, jobType, description? }`
- `TechVisitDetailPage.tsx:46` — `{ id, jobNumber, summary, jobType, description?, priority? }`

**Duplicate interfaces for visit location** — `VisitLocation` defined 3 times:
- `TechSchedulePage.tsx:19` — `{ id, companyName, address?, city? }`
- `TechHomePage.tsx:21` — `{ id, companyName, location?, address?, city?, province? }`
- `TechVisitDetailPage.tsx:55` — `{ id, companyName, location?, address?, city?, province?, postalCode?, phone? }`

### MUTATIONS THAT AFFECT THIS FAMILY

| # | File:Line | Action | Currently Invalidates | Triggered From |
|---|-----------|--------|----------------------|---------------|
| 1 | `techField.ts:169` | PATCH visit status → en_route | Nothing (direct db.update, no invalidation) | Tech app en-route button |
| 2 | `techField.ts:215` | PATCH visit status → in_progress | Nothing | Tech app start button |
| 3 | `techField.ts:282` | PATCH visit status → completed | Nothing | Tech app complete button |
| 4 | `useCalendarApi.ts:359` | POST /api/calendar/schedule | calendar, unscheduled, jobs | Calendar DnD / schedule modal |
| 5 | `useCalendarApi.ts:378` | PATCH /api/calendar/schedule/:id | calendar, jobs (NOT unscheduled) | Calendar DnD reschedule |
| 6 | `useCalendarApi.ts:398` | POST /api/calendar/unschedule/:id | calendar, unscheduled, jobs, visits | Calendar unschedule action |
| 7 | `jobScheduling.ts:258` | (invalidation helper) | `["/api/calendar"]`, `["/api/jobs"]` | QuickAddJobDialog |
| 8 | `JobHeaderCard.tsx:146` | POST /api/jobs/:id/close | jobs, visits | Job close button |

### MISSING INVALIDATIONS

- **Tech mutations (1-3):** Status changes to visits (en_route, in_progress, completed) don't invalidate any React Query cache. The tech schedule auto-refetches every 60s but calendar/job detail views won't reflect changes until stale.
- **Calendar reschedule (5):** Does NOT invalidate `["/api/calendar/unscheduled"]` — if a scheduled job is rescheduled to a time that makes it appear in backlog, the sidebar won't update.
- **`jobScheduling.ts` (7):** Does NOT invalidate `["/api/calendar/unscheduled"]` or `["/api/calendar/range"]`.
- **`useCompleteJob` in useCalendarApi.ts (line 420):** Does NOT invalidate `["/api/dashboard"]`.

---

## CANONICAL CANDIDATE 2: "Job List / Detail" (HIGH — 5 divergent queries)

### SERVER-SIDE DUPLICATES

| # | File:Line | Tables Joined | Key Differences |
|---|-----------|--------------|-----------------|
| A | `jobs.ts:168` getJobs | jobs LEFT JOIN clients LEFT JOIN customerCompanies | COALESCE(cc.name, cl.companyName), full field set |
| B | `jobs.ts:306` getJob | jobs LEFT JOIN clients **only** (NO customerCompanies) | Missing parent company COALESCE — name diverges from list |
| C | `jobs.ts:1332` getActionRequiredJobs | jobs LEFT JOIN clients LEFT JOIN customerCompanies | COALESCE pattern, subset of fields |
| D | `dashboard.ts:191` getNeedsAttentionJobs | jobs LEFT JOIN clients LEFT JOIN customerCompanies (x2 queries) | COALESCE pattern, adds `attentionType` computed field, overdue CASE |
| E | `search.ts:186` searchJobs | jobs LEFT JOIN client_locations (raw SQL) | `cl.company_name` only — no customerCompanies join |
| F | `maintenance.ts:15` getRecentlyCompleted | jobs INNER JOIN clientLocations | INNER JOIN excludes jobs without locations; SELECT * (entire rows) |

### LOGIC DIVERGENCES

1. **Location name — 3 patterns:**
   - `COALESCE(customerCompanies.name, clientLocations.companyName)` → jobs.ts getJobs, dashboard.ts, jobs.ts getActionRequired (CORRECT)
   - `clientLocations.companyName` only → search.ts, calendar.ts, visits.ts, adminTimesheets.ts (INCOMPLETE)
   - No join at all → calendar.ts getJobById, some admin.ts queries

2. **Soft-delete filter inconsistencies (BUGS):**
   - `calendar.ts:617` `getJobById()` — **missing both `deletedAt IS NULL` AND `isActive = true`**
   - `admin.ts:363-398` `getTenantDetail()` — **missing `isActive = true`** in all 3 sub-queries
   - `adminTimesheets.ts:438` job validation — **missing both soft-delete filters**

3. **`activeJobFilter()` exists in `jobFilters.ts` but most files inline the filter** instead of using it. Only `customerCompanies.ts` and `search.ts` use the canonical helpers.

4. **Overdue `effectiveEnd` CASE expression duplicated in 4 files:**
   - `dashboard.ts:224` — correct (`jobs.durationMinutes`)
   - `maintenance.ts:50` — correct (`jobs.durationMinutes`)
   - `admin.ts:183` — **BUG: uses `estimated_duration_minutes`** (wrong column, belongs to `job_visits`)
   - `admin.ts:392` — correct (`jobs.durationMinutes`)

5. **`TERMINAL_STATUSES` defined 3 times:**
   - `statusRules.ts:93` — `["invoiced", "archived"]` (canonical)
   - `domain/scheduling.ts:53` — `["invoiced", "archived"]` (duplicate)
   - `dashboard.ts:35` — `["invoiced", "archived"]` (local copy, should import)

### CLIENT-SIDE CONSUMERS

| # | File:Component | Endpoint | Query Key | Local Type? |
|---|---------------|----------|-----------|------------|
| 1 | `Jobs.tsx:Jobs` | GET /api/jobs?offset=0&limit=200 | `["/api/jobs", { offset: 0, limit: 200 }]` | Uses shared `Job` type |
| 2 | `JobDetailPage.tsx:JobDetailPage` | GET /api/jobs/:id | `["/api/jobs", jobId]` | `JobDetailResponse extends Job` (line 553) |
| 3 | `LocationDetailPage.tsx:LocationDetailPage` | GET /api/jobs?offset=0&limit=200 | `["/api/jobs", { offset: 0, limit: 200 }]` | Same query key — **fetches ALL jobs, filters client-side** |
| 4 | `ClientJobsTab.tsx:ClientJobsTab` | GET /api/jobs?offset=0&limit=200 | `["/api/jobs", { locationIds, offset: 0, limit: 200 }]` | Same — **fetches ALL, filters with `select`** |
| 5 | `Dashboard.tsx:Dashboard` | GET /api/dashboard/needs-attention | `["/api/dashboard/needs-attention"]` | Local `Job` interface (line 38, 8 fields only) |
| 6 | `TaskDialog.tsx:TaskDialog` | GET /api/jobs | `["/api/jobs"]` | Local `Job` interface (line 54, 7 fields) |
| 7 | `ScheduleJobModal.tsx` | GET /api/jobs?status=... | `["/api/jobs", { status }]` | `any[]` (untyped) |

**Duplicate local `Job` interfaces:**
- `Dashboard.tsx:38` — `{ id, jobNumber, summary, status, scheduledStart, locationName?, location? }`
- `TaskDialog.tsx:54` — `{ id, jobNumber, summary, status, scheduledStart, jobType?, location? }`
- All other pages use the shared schema `Job` type

### MUTATIONS THAT AFFECT THIS FAMILY

| # | File:Line | Action | Currently Invalidates |
|---|-----------|--------|----------------------|
| 1 | `Jobs.tsx:268` escalateMutation | POST /api/jobs/:id/mark-action-required-escalated | `["/api/jobs"]` only — **missing `["/api/jobs", jobId]`** |
| 2 | `Jobs.tsx:289` updateActionRequired | PATCH /api/jobs/:id/action-required | `["/api/jobs"]` only — **missing `["/api/jobs", jobId]`** |
| 3 | `JobHeaderCard.tsx:213` reopenJob | POST /api/jobs/:id/reopen | jobs only — **missing calendar, dashboard** |
| 4 | `JobDetailPage.tsx:1162` updateStatus | POST /api/jobs/:id/status | jobs + time-summary — **missing calendar, dashboard** |
| 5 | `JobDetailPage.tsx:1219` deleteJob | DELETE /api/jobs/:id | jobs, calendar, maintenance, dashboard, recurring, clients (GOOD) |

### MISSING INVALIDATIONS

- Escalate/updateActionRequired (1-2): Don't invalidate the specific job detail cache — opening the job after escalation shows stale data until the 5-minute staleTime expires.
- Reopen job (3): Doesn't invalidate calendar or dashboard — a reopened job won't appear on calendar or attention lists until cache refreshes.
- Update status (4): Doesn't invalidate calendar or dashboard.

---

## CANONICAL CANDIDATE 3: "Technician Name/Color Resolution" (MEDIUM — 4 divergent patterns)

### SERVER-SIDE DUPLICATES

| # | File:Line | Join Pattern | Name Fallback Chain |
|---|-----------|-------------|---------------------|
| A | `calendar.ts:315` | users LEFT JOIN technicianProfiles | `fullName || (firstName+" "+lastName) || firstName || "Unknown"` |
| B | `calendar.ts:537` | users LEFT JOIN technicianProfiles | **Identical to A** (duplicated within same file) |
| C | `timeTracking.ts:~738` | timeEntries LEFT JOIN users | `fullName` only — **null if not set** |
| D | `jobNotes.ts:14` | jobNotes LEFT JOIN users | `firstName, lastName` separately — **client concatenates** |
| E | `admin.ts:~2409` | users INNER JOIN technicianProfiles | `(firstName+" "+lastName) || firstName || lastName || email` — **no fullName check** |
| F | `jobs.ts:~1390` | jobScheduleAudit LEFT JOIN users | `fullName` only — **null if not set** |

### LOGIC DIVERGENCES

- No single canonical `resolveTechnicianName()` function exists
- Calendar (A/B) is the most robust with "Unknown" default
- Time tracking (C) and schedule history (F) return null when `fullName` is unset
- Admin analytics (E) doesn't check `fullName` at all — different fallback chain
- Job notes (D) pushes concatenation to the client

### CLIENT-SIDE CONSUMERS

- `hooks/useTechnicians.ts` — centralized hook returning `TeamMember[]` with `fullName` field. Used widely (Calendar, Jobs, JobDetail, Dashboard). This is a good pattern.
- Tech pages build technician names from the visit's nested `job` object, not from a separate technician lookup.

---

## CANONICAL CANDIDATE 4: "Invoice List/Stats" (MEDIUM — missing cross-invalidation)

### SERVER-SIDE DUPLICATES

| # | File:Line | Endpoint | Key Difference |
|---|-----------|----------|----------------|
| A | `invoices.ts:83` getInvoices | GET /api/invoices/list | LEFT JOIN clients — no customerCompanies |
| B | `invoices.ts:614` getDashboardInvoices | GET /api/invoices/dashboard | `clients.companyName` labeled as `customerCompanyName` (**misleading**) |
| C | `search.ts:140` searchInvoices | Raw SQL search | LEFT JOIN client_locations LEFT JOIN customer_companies — COALESCE pattern |
| D | `reports.ts:49` getARAgingReport | Aging report | **INNER JOIN** clientLocations (**excludes invoices with missing locations**) |

### CLIENT-SIDE CONSUMERS

| # | File:Component | Query Key | Local Type? |
|---|---------------|-----------|------------|
| 1 | `InvoicesListPage.tsx` | `["/api/invoices/list", ...]` | `EnrichedInvoice extends Invoice` |
| 2 | `InvoicesListPage.tsx` | `["/api/invoices/stats"]` | Local `InvoiceStats` (line 42) |
| 3 | `Dashboard.tsx` | `["/api/invoices/dashboard"]` | Local `Invoice` (line 48, 8 fields) |
| 4 | `JobDetailPage.tsx` | `["/api/invoices/by-job", jobId]` | Shared `Invoice` type |

### MUTATIONS MISSING INVALIDATIONS

- `InvoiceDetailPage.tsx` — **send invoice** (line 307), **record payment** (line 333), **void invoice** (line 430), **delete line** (line 546): All invalidate `["/api/invoices/list"]` but **NOT `["/api/invoices/stats"]`**. Stats (outstanding count, overdue count, draft count, paid this month) will be stale after these operations.
- `JobHeaderCard.tsx:97` — **create invoice from job**: Invalidates `["/api/invoices"]` and `["/api/invoices/list"]` but **NOT `["/api/invoices/stats"]`** or `["/api/invoices/dashboard"]`.

---

## CANONICAL CANDIDATE 5: "Equipment" (MEDIUM — two table systems)

### SERVER-SIDE DUPLICATES

| # | File:Line | Table | API Path |
|---|-----------|-------|----------|
| A | `clients.ts:588` getClientEquipment | `equipment` (LEGACY) | GET /api/clients/:id/equipment |
| B | `clients.ts:633` getLocationEquipment | `locationEquipment` (NEW) | GET /api/locations/:id/equipment |
| C | `jobs.ts:973` getLocationEquipmentItem | `locationEquipment` (NEW) | (internal validation) |

### LOGIC DIVERGENCES

- **Two separate equipment tables coexist**: Legacy `equipment` (no soft-delete, created via import) and new `locationEquipment` (has `isActive` soft-delete).
- The bulk import route creates records in the legacy table; the location detail CRUD uses the new table.
- A location can have equipment in BOTH tables that is never shown together.
- The job equipment linking system only validates against `locationEquipment` — legacy equipment cannot be linked to jobs.

### CLIENT-SIDE CONSUMERS

| # | File:Component | Query Key | Endpoint |
|---|---------------|-----------|----------|
| 1 | `LocationDetailPage.tsx` | `["/api/clients", locationId, "equipment"]` | GET /api/clients/:id/equipment (LEGACY) |
| 2 | `LocationEquipmentSection.tsx` | `["/api/locations", locationId, "equipment"]` | GET /api/locations/:id/equipment (NEW) |
| 3 | `JobEquipmentSection.tsx` | `["/api/jobs", jobId, "equipment"]` | GET /api/jobs/:id/equipment |
| 4 | `EquipmentDialog.tsx` | `["/api/clients", clientId, "equipment"]` | Default queryFn (LEGACY) |

### MISSING INVALIDATIONS

- `LocationDetailPage.tsx` creates equipment via `POST /api/clients/:id/equipment` and invalidates `["/api/clients", locationId, "equipment"]`, but `LocationEquipmentSection` queries `["/api/locations", locationId, "equipment"]` — **these are different cache keys**. Creating equipment via LocationDetailPage won't show in LocationEquipmentSection until cache expires.

**Duplicate local `Equipment` interfaces:**
- `EquipmentDialog.tsx:11` — `{ id, clientId, name, modelNumber?, serialNumber?, notes? }`
- `EquipmentList.tsx:12` — `{ id, name, type?, location?, modelNumber?, serialNumber?, notes? }` — different fields, no `clientId`

---

## CANONICAL CANDIDATE 6: "Client/Location" (LOW — mostly correct)

### CLIENT-SIDE CONSUMERS

**Duplicate local `Client` interfaces in 5+ files:**
- `JobDetailDialog.tsx:62` — `{ id, companyName, location?, address?, city?, province?, postalCode?, contactName?, email?, phone? }`
- `TechnicianDashboard.tsx:15` — `{ id, companyName, location?, address?, city?, province?, postalCode?, contactName?, email?, phone?, notes? }`
- `RouteOptimizationDialog.tsx:14` — similar subset
- `RouteMap.tsx:7` — similar subset
- `EquipmentList.tsx:22` — minimal subset

All other files correctly use the shared schema `Client` type. These local types should be replaced with the canonical type or a shared subset.

---

## BUGS DISCOVERED DURING AUDIT

| # | Severity | File:Line | Description |
|---|----------|-----------|-------------|
| 1 | **HIGH** | `admin.ts:183` | Raw SQL uses `estimated_duration_minutes` on `jobs` table — column doesn't exist (belongs to `job_visits`). Should be `duration_minutes`. Overdue count is always 0. |
| 2 | **HIGH** | `techField.ts:169,215,282` | Visit status mutations (en_route, start, complete) bypass `syncJobScheduleFromVisits` — jobs table not updated when tech changes visit status from mobile. |
| 3 | **HIGH** | `TechnicianDashboard.tsx:90` | Uses `getMonth()` (0-indexed) for calendar API that expects 1-indexed months. Fetches wrong month data. |
| 4 | **MEDIUM** | `calendar.ts:617` | `getJobById()` missing `deletedAt IS NULL` and `isActive = true` — can return soft-deleted jobs. |
| 5 | **MEDIUM** | `admin.ts:363-398` | `getTenantDetail()` missing `isActive = true` in all 3 count queries — counts include deactivated jobs. |
| 6 | **MEDIUM** | `adminTimesheets.ts:438` | Job validation for time entry creation missing soft-delete check — can create time entries against deleted jobs. |
| 7 | **MEDIUM** | `invoices.ts:660` | `getDashboardInvoices` labels `clientLocations.companyName` as `customerCompanyName` — semantically incorrect field name. |
| 8 | **LOW** | `reports.ts:49` | AR aging report uses INNER JOIN on clientLocations — silently excludes invoices with missing locations from financial reporting. |

---

## MIGRATION PRIORITY

### Tier 1 — Fix Bugs (immediate, no architecture change needed)

1. **admin.ts column name bug** — change `estimated_duration_minutes` to `duration_minutes` in raw SQL
2. **techField.ts missing sync** — add `syncJobScheduleFromVisits` calls after en-route/start/complete mutations
3. **TechnicianDashboard.tsx month index** — add `+ 1` to `getMonth()` call
4. **calendar.ts getJobById** — add soft-delete filters
5. **admin.ts getTenantDetail** — add `isActive = true` filter
6. **adminTimesheets.ts job validation** — add soft-delete filters

### Tier 2 — Eliminate Duplicate Types (low risk, high clarity)

7. **Create shared `VisitJob` / `VisitLocation` types** — extract from tech pages into `shared/types/visits.ts`, import everywhere
8. **Remove duplicate local `Job`, `Client`, `Invoice`, `Equipment` interfaces** — replace with shared schema types or shared subset types
9. **Remove duplicate `ScheduleJobPayload`** in `jobScheduling.ts` — use the one from `useCalendarApi.ts`
10. **Import `TERMINAL_STATUSES` from `statusRules.ts`** in `dashboard.ts` — delete local copy

### Tier 3 — Standardize Server Queries (medium risk, high DRY value)

11. **Extract `effectiveEnd` SQL CASE** into a shared function in `jobFilters.ts` — used by 4 files
12. **Standardize location name resolution** — create `jobWithLocationName()` helper that always does the customerCompanies COALESCE join. Fix `jobs.ts:getJob()` to use it.
13. **Create `resolveTechnicianName()` utility** — single fallback chain used by all 6 files that resolve tech names
14. **Use `activeJobFilter()` from `jobFilters.ts` everywhere** — replace 10+ inlined filter conditions
15. **Remove dead `getVisitsForUserInRange` from `jobVisitsRepository`** — `visits.ts` is the canonical module; the repository method is unused

### Tier 4 — Fix Invalidation Gaps (medium risk, improves data freshness)

16. **Add dashboard invalidation to job status mutations** — `useCompleteJob`, `updateStatusMutation`, `reopenJobMutation`
17. **Add `["/api/invoices/stats"]` invalidation** to invoice send/payment/void mutations
18. **Add specific job cache invalidation** to escalate/updateActionRequired mutations
19. **Resolve equipment endpoint split** — standardize on `/api/locations/:id/equipment` and remove legacy `/api/clients/:id/equipment` path
20. **Add `syncJobScheduleFromVisits`** to tech field visit mutations (also listed as bug fix #2)

### Tier 5 — Architecture Improvements (higher risk, longer term)

21. **Consolidate visit query module** — deprecate `jobVisitsRepository` read methods in favor of `visits.ts` canonical functions
22. **Server-side location filtering for job lists** — `LocationDetailPage.tsx` and `ClientJobsTab.tsx` fetch ALL jobs then filter client-side. Add `locationId` query param support to the jobs API.
23. **Unify calendar query patterns** — `Calendar.tsx` uses `?year&month` while `useCalendarApi.ts` uses `?start&end`. Standardize on one.
24. **Merge legacy `equipment` table into `locationEquipment`** with data migration
