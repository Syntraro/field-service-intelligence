# Application Architecture Guide

Last updated: 2026-02-13

---

## Overview

HVAC/R preventive maintenance scheduling SaaS for contractors. Manages client contracts, automates maintenance scheduling, tracks equipment and parts inventory, handles job dispatching, invoicing, and integrates with QuickBooks Online.

**Tech stack:** React/TypeScript frontend (Vite, TanStack Query, shadcn/ui), Express/Node.js backend (ESM), PostgreSQL via Drizzle ORM. Multi-tenant by company. See `CLAUDE.md` for full stack details and coding standards.

---

## Canonical Query System

### Why It Exists

The codebase originally had duplicated queries across pages: each page built its own SQL joins, applied its own filters, and defined its own TypeScript interfaces. This caused inconsistent data (one page showed a location name differently than another), stale UIs after mutations (updating a job on the calendar didn't refresh the dashboard), and divergent logic for the same concepts (soft-delete checks in some queries but not others). The canonical query system ensures every surface reads from one source of truth per data family.

### Core Principles

1. **One canonical module per data family** — all reads for a domain go through one server-side module (`jobsFeed.ts`, `invoicesFeed.ts`, `visits.ts`, `dashboard.ts`).
2. **QueryCtx for every query** — tenant scoping and RBAC are mandatory, never optional. Every query function takes a `QueryCtx` that bundles `tenantId`, `userId`, `role`, and `db`.
3. **Composable filters** — one filter interface per family (e.g., `JobFeedFilters`), not per-page filter logic. Consumers pass the subset of filters they need.
4. **Family-based query keys** — all React Query keys start with the family prefix (`["jobs", ...]`, `["visits", ...]`) for grouped invalidation.
5. **Mutations invalidate by family** — `queryClient.invalidateQueries({ queryKey: ["jobs"] })` matches all job queries regardless of filters. Never invalidate by specific endpoint path.
6. **API types reflect JSON reality** — timestamps are `string | null` (ISO strings), not `Date`. Mapper functions at the server boundary handle conversion.

---

## Canonical Modules

### Visits — `server/storage/visits.ts`

Single source of truth for all visit reads (tech field app, calendar, admin views).

**Exported query functions:**

| Function | Signature | Used By |
|----------|-----------|---------|
| `getVisitFeed` | `(ctx: QueryCtx, filters?: VisitFeedFilters) → Promise<VisitFeedItem[]>` | `GET /api/visits` endpoint |
| `getVisitsForUserInRange` | `(tenantId, userId, start, end) → Promise<EnrichedVisit[]>` | Tech field routes |
| `getUnscheduledVisitsForUser` | `(tenantId, userId) → Promise<EnrichedVisit[]>` | Tech backlog view |
| `getVisitByIdForUser` | `(tenantId, userId, visitId) → Promise<EnrichedVisit \| null>` | Tech visit detail |
| `getVisitsForTenantInRange` | `(tenantId, start, end, options?) → Promise<EnrichedVisit[]>` | Calendar, admin views |

**Exported types:** `VisitFeedFilters`, `VisitFeedItem`, `EnrichedVisit`, `VisitJobInfo`, `VisitLocationInfo`, `TenantVisitRangeOptions`

**Query key family:** `["visits"]` (exported as `VISIT_FEED_FAMILY_KEY` from `client/src/hooks/useVisitFeed.ts`)

**Client consumers:** `TechHomePage`, `TechSchedulePage`, `TechVisitDetailPage` (via `useVisitFeed` hook)

**Key behaviors:**
- All functions apply `activeJobFilter()` — visits for soft-deleted/inactive jobs are excluded.
- Location names use `COALESCE(customerCompanies.name, clientLocations.companyName)`.
- `getVisitFeed` enforces RBAC: technicians see only their own visits.

### Jobs — `server/storage/jobsFeed.ts`

Single source of truth for job list and job detail queries.

**Exported query functions:**

| Function | Signature | Used By |
|----------|-----------|---------|
| `getJobsFeed` | `(ctx: QueryCtx, filters?: JobFeedFilters) → Promise<{items: JobFeedItem[]; total: number}>` | `GET /api/jobs` endpoint |
| `getJobHeader` | `(ctx: QueryCtx, jobId: string) → Promise<JobHeaderDetail \| null>` | `GET /api/jobs/:id` endpoint |

**Exported types:** `JobFeedFilters`, `JobFeedItem`, `JobHeaderDetail`

**Query key family:** `["jobs"]` (exported as `JOBS_FEED_FAMILY_KEY` from `client/src/hooks/useJobsFeed.ts`)

**Client consumers:** `Jobs` page, `LocationDetailPage`, `ClientJobsTab` (via `useJobsFeed`); `JobHeaderCard` (via `useJobHeader`)

**Key behaviors:**
- `JobFeedFilters` supports: status, statuses, excludeStatuses, locationId, technicianId, jobType, priority, search, scheduledOnly, unscheduledOnly, overdue, dateRange, sort, pagination.
- Both functions join `customerCompanies` for COALESCE location name.
- Both apply `activeJobFilter()` by default.

### Invoices — `server/storage/invoicesFeed.ts`

Single source of truth for invoice list and stats queries. Read-only module; mutations remain in `server/storage/invoices.ts`.

**Exported query functions:**

| Function | Signature | Used By |
|----------|-----------|---------|
| `getInvoicesFeed` | `(ctx: QueryCtx, filters?: InvoiceFeedFilters) → Promise<{items: InvoiceFeedItem[]; total?: number}>` | `GET /api/invoices/list` |
| `getInvoiceStats` | `(ctx: QueryCtx) → Promise<InvoiceStatsResult>` | `GET /api/invoices/stats` |
| `activeInvoiceFilter` | `() → SQL` | Used by dashboard, reports |
| `computeIsPastDue` | `(status, dueDate, balance) → boolean` | Used by feed mapper |

**Exported types:** `InvoiceFeedFilters`, `InvoiceFeedItem`, `InvoiceStatsResult`

**Query key family:** `["invoices"]` (exported as `INVOICES_FEED_FAMILY_KEY` from `client/src/hooks/useInvoicesFeed.ts`)

**Client hooks:** `useInvoicesFeed`, `useInvoiceStats` (defined in `client/src/hooks/useInvoicesFeed.ts`, staleTime: 30s). Note: these hooks are created but not yet integrated into all invoice pages — some pages still use direct `useQuery` calls.

### Dashboard — `server/storage/dashboard.ts`

Workflow summary counts and needs-attention job list.

**Exported query functions:**

| Function | Signature | Used By |
|----------|-----------|---------|
| `getWorkflowSummary` | `(ctx: QueryCtx) → Promise<WorkflowSummary>` | `GET /api/dashboard/workflow` |
| `getNeedsAttentionJobs` | `(ctx: QueryCtx, todayDate: string, limit?: number) → Promise<DashboardJobItem[]>` | `GET /api/dashboard/needs-attention` |

**Exported types:** `WorkflowSummary`, `DashboardJobItem` (includes `attentionType: "overdue" | "on_hold" | "requires_invoicing" | "other"`)

**Query key family:** `["dashboard"]`

**Key behaviors:**
- Uses `activeJobFilter()` and `activeInvoiceFilter()` guards.
- `attentionType` is presentation logic kept separate from the core `JobFeedItem` type (Option B from spec).
- Legacy `dashboardRepository` adapter kept for backward compatibility.

### Calendar — `server/storage/calendar.ts`

Calendar is a **separate projection family** from the visit feed. See the architecture note at the top of the file for details.

**Key differences from visit feed:**
- Uses CTE-based query with `ROW_NUMBER` windowing (one visit per job).
- Technician profile enrichment (colors, display names).
- All-day event normalization + backlog logic.
- Does NOT import from `visits.ts` or `jobsFeed.ts`.

**Query key families:** `["/api/calendar", ...]`, `["/api/calendar/range", ...]`, `["/api/calendar/unscheduled"]`

**Shared helpers consumed:** `bulkResolveTechnicians()`, `bulkResolveCustomerCompanies()` from `server/lib/queryHelpers.ts`.

### Equipment — `locationEquipment` table

Single table. Legacy `equipment` table renamed to `equipment_legacy_deprecated`.

- **Endpoints:** `GET/POST/PATCH/DELETE /api/clients/:locationId/equipment`
- **Query key:** `["/api/clients", locationId, "equipment"]`
- **Components:** `LocationEquipmentSection.tsx`, `JobEquipmentSection.tsx`, `LocationDetailPage.tsx`
- **See:** `docs/EQUIPMENT_MIGRATION.md` for migration history.

---

## Shared Infrastructure

### QueryCtx — `server/lib/queryCtx.ts`

Context bundle for every tenant-scoped query.

```typescript
interface QueryCtx {
  db: NeonDatabase<any>;   // Drizzle ORM instance
  tenantId: string;         // Company ID (multi-tenant isolation)
  userId: string;           // Authenticated user ID
  role: string;             // User role (for RBAC)
}

function getQueryCtx(req: AuthedRequest): QueryCtx
```

Usage: call `getQueryCtx(req)` in route handlers after `requireAuth` middleware.

### Query Helpers — `server/lib/queryHelpers.ts`

Shared building blocks for canonical query modules and calendar:

| Export | Purpose |
|--------|---------|
| `locationDisplayNameExpr` | SQL: `COALESCE(customerCompanies.name, clientLocations.companyName)` |
| `bulkResolveTechnicians(db, userIds)` | Batch user+profile lookup → `Map<id, {name, color}>` |
| `bulkResolveCustomerCompanies(db, companyIds)` | Batch company name lookup → `Map<id, name>` |

### Technician Name Resolution — `server/lib/resolveTechnicianName.ts`

Canonical fallback chain (replaces 6 divergent patterns):

| Function | Returns | Fallback chain |
|----------|---------|----------------|
| `resolveTechnicianName(user)` | `string` | `fullName` → `firstName + lastName` → `firstName` → `lastName` → `email` → `"Unknown"` |
| `resolveTechnicianDisplay(user, profile?)` | `{name, color}` | Name from above + `profile.color` or `#6B7280` |

Input type: `UserNameFields { fullName?, firstName?, lastName?, email? }`

### Job Filters — `server/storage/jobFilters.ts`

Composable Drizzle ORM filters for soft-delete/active checks:

| Function | SQL Equivalent |
|----------|---------------|
| `activeJobFilter()` | `deleted_at IS NULL AND is_active = true` |
| `activeWorkJobFilter()` | `deleted_at IS NULL AND is_active = true AND status = 'open'` |

Raw SQL constants also exported: `JOB_ACTIVE_SQL_J`, `JOB_ACTIVE_SQL`, `JOB_ACTIVE_WORK_SQL_J`, `JOB_ACTIVE_WORK_SQL` (for CTE/raw queries where Drizzle composable functions can't be used).

---

## Client-Side Hooks

| Hook | File | Query Key Pattern | Family | staleTime |
|------|------|-------------------|--------|-----------|
| `useVisitFeed(params, options?)` | `client/src/hooks/useVisitFeed.ts` | `["visits", from, to, techId, status, ...]` | `["visits"]` | default |
| `useJobsFeed(params?, options?)` | `client/src/hooks/useJobsFeed.ts` | `["jobs", "feed", status, techId, ...]` | `["jobs"]` | default |
| `useJobHeader(jobId)` | `client/src/hooks/useJobsFeed.ts` | `["jobs", "detail", jobId]` | `["jobs"]` | default |
| `useInvoicesFeed(filters?, options?)` | `client/src/hooks/useInvoicesFeed.ts` | `["invoices", "feed", status, ...]` | `["invoices"]` | 30s |
| `useInvoiceStats(options?)` | `client/src/hooks/useInvoicesFeed.ts` | `["invoices", "stats"]` | `["invoices"]` | 30s |

Family key constants are exported from each hook file (e.g., `VISIT_FEED_FAMILY_KEY`, `JOBS_FEED_FAMILY_KEY`, `INVOICES_FEED_FAMILY_KEY`).

---

## Cache Invalidation Strategy

Mutations invalidate entire query families so all surfaces update:

```typescript
// Example: closing a job affects jobs, visits, dashboard
onSuccess: () => {
  queryClient.invalidateQueries({ queryKey: ["jobs"] });
  queryClient.invalidateQueries({ queryKey: ["visits"] });
  queryClient.invalidateQueries({ queryKey: ["dashboard"] });
}
```

**Why family-based?** `queryClient.invalidateQueries({ queryKey: ["jobs"] })` matches ALL keys that start with `["jobs"]` — including `["jobs", "feed", {status: "open"}]`, `["jobs", "detail", "abc123"]`, etc. No need to enumerate specific queries.

Full mutation-to-family matrix: `docs/INVALIDATION_MAP.md`

---

## Location Name Resolution

Every module uses `COALESCE(customerCompanies.name, clientLocations.companyName)` for location display names. This ensures a location under a parent `customerCompany` always shows the parent company name across all surfaces.

- **Server:** Use `locationDisplayNameExpr` from `server/lib/queryHelpers.ts`, or inline the COALESCE in your SELECT.
- **Requires:** LEFT JOIN on `customerCompanies` via `eq(clientLocations.parentCompanyId, customerCompanies.id)`.
- **Client-side field:** Typically `locationDisplayName: string | null` or mapped into `location.companyName`.

Modules using this pattern: `jobsFeed.ts`, `invoicesFeed.ts`, `dashboard.ts`, `visits.ts`, `calendar.ts` (via bulk lookup).

---

## Soft-Delete and Active Filtering

Every query touching the `jobs` table must apply:
- `isNull(jobs.deletedAt)` — exclude soft-deleted jobs
- `eq(jobs.isActive, true)` — exclude deactivated jobs

**Always use the helper:** `activeJobFilter()` from `server/storage/jobFilters.ts`. Never inline these checks.

Visit queries additionally check `eq(jobVisits.isActive, true)`.

Invoice queries use `activeInvoiceFilter()` from `server/storage/invoicesFeed.ts`, which handles legacy NULL `isActive` values: `(isActive = true OR isActive IS NULL) AND deletedAt IS NULL`.

---

## How to Add a New Feature

### Adding a New Page That Reads Existing Data

1. Import the appropriate canonical hook (e.g., `useJobsFeed` from `client/src/hooks/useJobsFeed.ts`).
2. Pass filters for your page's specific view.
3. Use the canonical type (e.g., `JobFeedItem`) — do NOT create a local interface.
4. The query key is handled by the hook — you get family-based invalidation for free.

### Adding a New Canonical Module (New Data Family)

1. Create `server/storage/[entity]Feed.ts`.
2. Define the filter interface: `[Entity]FeedFilters`.
3. Build the query function: `get[Entity]Feed(ctx: QueryCtx, filters: [Entity]FeedFilters)`.
   - Always scope by `ctx.tenantId`.
   - Always apply soft-delete/active filters via a shared helper.
   - Join `customerCompanies` for location name if relevant.
   - Use `resolveTechnicianName()` for tech names.
4. Define a mapper that normalizes to API types (timestamps as ISO strings).
5. Export the return type: `[Entity]FeedItem`.
6. Create the endpoint in the routes file, using `getQueryCtx(req)` to extract context.
7. Create the client hook: `use[Entity]Feed(filters)` with query key `["[entity]", ...]`.
8. Export a family key constant: `[ENTITY]_FEED_FAMILY_KEY = ["[entity]"] as const`.
9. Update `docs/INVALIDATION_MAP.md` with the new family.

### Adding a New Mutation

1. Create the server-side handler.
2. Create the client-side mutation (via `useMutation`).
3. In `onSuccess`, invalidate ALL affected query families.
4. Consult `docs/INVALIDATION_MAP.md` Cross-Reference table to determine which families are affected.
5. Add the new mutation to the appropriate section of `docs/INVALIDATION_MAP.md`.
6. See the "How to Add a New Mutation" section in `INVALIDATION_MAP.md` for the step-by-step checklist.

### Adding a Field to an Existing Canonical Type

1. Add the column/join to the canonical query builder in the server module.
2. Add the field to the mapper function.
3. Add the field to the exported type (e.g., `JobFeedItem`).
4. All consumers automatically get the new field — no per-page changes needed.

---

## Key Files Reference

| Purpose | File |
|---------|------|
| QueryCtx type + extractor | `server/lib/queryCtx.ts` |
| Shared query helpers | `server/lib/queryHelpers.ts` |
| Technician name resolution | `server/lib/resolveTechnicianName.ts` |
| Job active filter | `server/storage/jobFilters.ts` |
| Canonical visits | `server/storage/visits.ts` |
| Canonical jobs | `server/storage/jobsFeed.ts` |
| Canonical invoices | `server/storage/invoicesFeed.ts` |
| Dashboard queries | `server/storage/dashboard.ts` |
| Calendar projection | `server/storage/calendar.ts` |
| Visit feed hook | `client/src/hooks/useVisitFeed.ts` |
| Jobs feed hook | `client/src/hooks/useJobsFeed.ts` |
| Invoices feed hook | `client/src/hooks/useInvoicesFeed.ts` |
| Mutation invalidation groups | `client/src/hooks/useMutationWithToast.ts` |
| Invalidation map | `docs/INVALIDATION_MAP.md` |
| Equipment migration | `docs/EQUIPMENT_MIGRATION.md` |
| This document | `docs/ARCHITECTURE.md` |
