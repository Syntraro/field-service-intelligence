# Architecture Lock Audit — 2026-02-16

Phase 6.2 baseline. Drift check + extension coverage. Not a refactor audit.

---

## PRE-FLIGHT FIX: Invoice Query Key Namespace

**Status: COMPLETED**

### Before/After Key Map

| Location | Before | After |
|----------|--------|-------|
| InvoiceDetailPage: detail query | `["invoice", invoiceId, "details"]` | `["invoices", "detail", invoiceId]` |
| InvoiceDetailPage: payments query | `["invoice", invoiceId, "payments"]` | `["invoices", "detail", invoiceId, "payments"]` |
| InvoiceDetailPage: 8 invalidation calls | `["invoice", invoiceId]` | `["invoices", "detail", invoiceId]` |
| InvoiceDetailPage: toggle-sent invalidation | `["invoice", invoiceId, "details"]` | `["invoices", "detail", invoiceId]` |
| JobDetailPage: by-job query | `["invoices", "by-job", jobId]` | `["invoices", "byJob", jobId]` |
| InvoicesListPage: feed query | `["invoices", "feed", {...}]` | *(no change — already correct)* |
| InvoicesListPage: stats query | `["invoices", "stats"]` | *(no change — already correct)* |
| Dashboard: widget query | `["invoices", "dashboard"]` | *(no change — already correct)* |

**Locked canonical namespace:**

```
["invoices"]                              ← family root (invalidate to refresh all)
["invoices", "feed", params]              ← paginated list
["invoices", "stats"]                     ← aggregate statistics
["invoices", "detail", id]               ← single invoice (matches detail + payments)
["invoices", "detail", id, "payments"]   ← invoice payment history
["invoices", "dashboard"]                 ← dashboard widget subset
["invoices", "byJob", jobId]             ← cross-link from job
```

**Files changed:** `client/src/pages/InvoiceDetailPage.tsx`, `client/src/pages/JobDetailPage.tsx`

---

## PASS 1 — Drift + Extensions

### Section A — Drift Check

Only new drift since Phase 6.2 baseline. Allowed exceptions are NOT flagged.

| File | Query Key / Pattern | Reason | Compliant | Action |
|------|-------------------|--------|-----------|--------|
| `InvoicesListPage.tsx:118` | `["invoices", "stats"]` — no `queryFn` | Stats query registered but default queryFn will try to fetch URL `"invoices"` — **dead query** | **NO** | Add explicit queryFn or extract to hook |
| `Dashboard.tsx:436` | `["/api/tasks?offset=0&limit=50"]` — URL-as-key | Works via default queryFn but can't be invalidated by family prefix `["tasks"]` | **NO** | Key works for fetching but blocks future task family invalidation. Note for future fix. |
| `Dashboard.tsx:469` | Predicate invalidation: `q.queryKey[0].startsWith('/api/tasks')` | Workaround for URL-as-key. Fragile but functional. | **NO** | Couples invalidation to URL format. Note for future fix. |

**All other pages**: No new drift detected. Jobs page uses `useJobsFeed` (compliant). Invoice pages use `["invoices", ...]` family (compliant after pre-flight fix). Dashboard uses `["dashboard", ...]` (compliant). Settings pages use direct `useQuery` (allowed exception).

### Section B — Re-validate Phase 6.2 Exceptions

| Exception | Still Justified? | Isolated? | Not Duplicated? | Invalidation Compliant? | Status |
|-----------|-----------------|-----------|-----------------|------------------------|--------|
| **InvoiceDetailPage** | YES — unique detail+payments queries | YES — `["invoices", "detail", id]` scoped | YES — no overlap with feed/stats | YES — invalidates `["invoices"]` family on mutations | **VALID** |
| **Calendar.tsx** | YES — specialized DnD + range queries | YES — own hook system (`useCalendarApi`, `useCalendarDnD`) | YES — separate projection from visit feed | YES — uses own `["/api/calendar"]` family | **VALID** |
| **Settings pages** | YES — low-traffic admin config | YES — `["/api/company-settings"]` isolated | YES — no overlap | N/A (not invoice-related) | **VALID** |
| **TasksPanel** | YES — embedded in Dashboard | PARTIALLY — URL-as-key format breaks family invalidation | YES — no other task consumers | NO — uses predicate invalidation instead of family key | **NEEDS ADJUSTMENT** |
| **ClientDetailPage** | YES — multi-resource detail view | YES — `["/api/clients", id]` scoped | YES — uses `useJobsFeed` for jobs (no duplication) | N/A (not invoice-related) | **VALID** |
| **LocationDetailPage** | YES — multi-resource detail view | YES — `["/api/clients", locationId]` scoped | YES — uses `useJobsFeed` for jobs | N/A (not invoice-related) | **VALID** |

### Section C — Payload Composition Classification

| Page | Type | Parallel ATF Queries | Sequential Dependencies | Verdict |
|------|------|---------------------|------------------------|---------|
| **Dashboard.tsx** | TYPE 2 | 3 (workflow, needs-attention, invoices) | None — all independent | **PASS** |
| **Calendar.tsx** | TYPE 2 | 2 (range + optional unscheduled) | None — unscheduled is user-triggered | **PASS** |
| **InvoicesListPage.tsx** | TYPE 2 | 2 (feed + stats) | None — both independent | **PASS** |
| **InvoiceDetailPage.tsx** | TYPE 2 | 3 parallel (details, payments, settings) + 1 conditional | details → jobId → jobNotes (shallow, non-blocking) | **CONDITIONAL PASS** |
| **JobDetailPage.tsx** | TYPE 2 | 1 primary (job header) + lazy sub-queries | jobId → time/visits/invoice (all lazy/collapsible) | **PASS** |
| **Jobs.tsx** | TYPE 2 | 2 (jobs feed + technicians) | None | **PASS** |
| **ClientDetailPage.tsx** | TYPE 2 | 1 primary + 4-5 conditional | clientId → jobs, contacts, tags (all parallel after parent) | **CONDITIONAL PASS** |
| **LocationDetailPage.tsx** | TYPE 2 | 1 primary + 6 conditional | locationId → equipment, tags, contacts, pm-parts, jobs (all parallel) | **CONDITIONAL PASS** |
| **ClientsPage.tsx** | TYPE 2 | 3 (clients + tags + assignments) | None | **PASS** |
| **Quotes.tsx** | TYPE 1 | 1 (quotes feed) | None | **PASS** |
| **AccountsReceivablePage.tsx** | TYPE 1 | 1 (AR aging report) | None | **PASS** |

**No critical sequential waterfalls detected.** Detail page conditional queries (gated by `enabled: !!parentId`) are acceptable — they fire in parallel once the parent resolves, not in chains.

### Section D — List Scalability Invariants

| Endpoint | Paged | Filtered | Sorted | Bounded | Status |
|----------|-------|----------|--------|---------|--------|
| `GET /api/invoices/list` | offset/limit | status | implicit | MAX_LIMIT=200 | **PASS** |
| `GET /api/invoices/stats` | N/A (aggregate) | tenant-scoped | N/A | single record | **PASS** |
| `GET /api/invoices/dashboard` | hardcoded limit=20 | statuses | dueDate | sliced to 10 | **PASS** |
| `GET /api/jobs` (feed) | offset/limit | status, tech, location, search, date | configurable | MAX_LIMIT=200 | **PASS** |
| `GET /api/jobs/action-required` | **NONE** | implicit (status filter) | actionRequiredAt | **UNBOUNDED** | **FAIL** |
| `GET /api/calendar` | range-based (start/end) | date range | query-based | date-bounded | **PASS** |
| `GET /api/calendar/unscheduled` | server limit | status filter | implicit | bounded | **PASS** |
| `GET /api/tasks` | offset/limit | status, assignee, type, jobId | implicit | MAX_LIMIT=200 | **PASS** |
| `GET /api/quotes/list` | offset/limit | status | implicit | MAX_LIMIT=200 | **PASS** |
| `GET /api/clients` | page/limit | search, sort, inactive | sortBy/sortOrder | limit=100 max | **PASS** |
| `GET /api/reports/ar-aging` | **NONE** | tenant-scoped | aggregation | **UNBOUNDED** | **FAIL** |
| `GET /api/dashboard/workflow` | N/A (aggregate) | N/A | N/A | single record | **PASS** |
| `GET /api/dashboard/needs-attention` | limit param (default 5) | date | attention type | respects limit | **PASS** |

**2 FAIL conditions:**
1. `/api/jobs/action-required` — no pagination. Could return unbounded results for large tenants.
2. `/api/reports/ar-aging` — no pagination on invoice array within report.

### Section E — Mutation/Form Pattern Audit

**Total mutations scanned:** ~250 `useMutation` + 14 `useMutationWithToast` = ~264 total

**Dominant pattern (94%):** Raw `useMutation` with manual `onSuccess`/`onError`:

```typescript
const mutation = useMutation({
  mutationFn: async (data) => apiRequest(url, { method, body: JSON.stringify(data) }),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ["<family>"] });
    toast({ title: "Success" });
  },
  onError: (error: Error) => {
    toast({ title: "Error", description: error.message, variant: "destructive" });
  },
});
```

**This IS the standard.** Document it, don't change it.

**useMutationWithToast** (14 instances, 5.6%): Used in portal pages, EditClientDialog, useProductsServices. NOT dead code but NOT the dominant pattern. Keep as an option for future code but do not mandate migration.

| Page | Mutations | Compliance | Notes |
|------|-----------|-----------|-------|
| InvoiceDetailPage | 13 | **COMPLIANT** | Uses standard pattern + structured QBO error handling |
| JobDetailPage | 7 | **COMPLIANT** | Uses standard pattern + 409 conflict detection |
| JobHeaderCard | 4 | **COMPLIANT** | Uses standard pattern + undo flow |
| Dashboard | 2 | **COMPLIANT** | Standard pattern |
| Calendar hooks | 8 | **OUTLIER (justified)** | Optimistic updates + snapshot rollback + auto-retry — complexity warranted by DnD UX |
| Admin pages | 8 | **COMPLIANT** | Standard pattern |
| Portal pages | 4 | **COMPLIANT** | Uses useMutationWithToast (also acceptable) |
| All other pages | ~218 | **COMPLIANT** | Standard pattern |

**Conclusion:** No standardization work needed. The raw `useMutation` pattern IS the standard (94%). Calendar hooks are a justified outlier. useMutationWithToast is an optional convenience wrapper, not required.

### Section F — Summary FAIL List

Issues that would force future architectural rewrites if not addressed:

| # | Issue | Severity | Location | Impact |
|---|-------|----------|----------|--------|
| **F1** | `InvoicesListPage` stats query has no `queryFn` — dead query | HIGH | `InvoicesListPage.tsx:116-119` | Stats cards always show 0. Default queryFn tries to fetch URL `"invoices"` which fails. |
| **F2** | `/api/jobs/action-required` unbounded response | MEDIUM | `server/routes/jobs.ts` | Large tenants could receive unbounded arrays. No immediate OOM risk but violates scalability invariant. |
| **F3** | `/api/reports/ar-aging` unbounded invoice array | MEDIUM | `server/routes/reports.ts` | Large tenants with thousands of outstanding invoices could receive multi-MB responses. |

**Items explicitly NOT on the FAIL list** (observed but not architecture-breaking):
- TasksPanel URL-as-key: works via default queryFn, invalidation uses predicate workaround. Ugly but functional.
- Calendar `["/api/calendar"]` legacy prefix: works, changing it would be a large unnecessary refactor.
- useMutationWithToast low adoption: dominant pattern is equally functional, no forced migration needed.
- Client/Location pages with 5+ conditional queries: all parallel after parent load, no waterfall.

---

## PASS 2 — Flow Audit

### Journey 1: Login → Dashboard → Job Detail → Edit → Save → Navigation

| Step | Route | Mechanism | RBAC | Tenant | Cache | Loading | Notes |
|------|-------|-----------|------|--------|-------|---------|-------|
| Login | `/login` | Unprotected page | N/A | N/A | Sets user data | Spinner on button | Redirects to `/` on success |
| Dashboard | `/` | `ProtectedRoute requireAdmin` | Owner/Admin only | Server-scoped | 3 parallel queries, 60s stale | Skeletons | Good |
| Job click | `/jobs/:id` | `setLocation()` | `ProtectedRoute requireAdmin` | Server-scoped | `useJobHeader` hook | Spinner | Good |
| Inline edit | Same page | Form state + mutation | Mutation validates server-side | companyId in request | Invalidates `["jobs"]` family | `isPending` on button | No navigation |
| Create invoice | Navigates to `/invoices/:id` | `setLocation()` | Mutation validates server-side | companyId in request | Invalidates `["invoices"]`, `["jobs"]`, `["dashboard"]` | Dialog shows loading | **Navigates to new resource** |
| Delete job | Navigates to `/jobs` | `setLocation()` | Mutation validates server-side | companyId in request | Invalidates `["dashboard"]`, `["/api/recurring-templates"]`, `["/api/clients"]` | Confirm dialog | **Navigates to list** |

### Journey 2: Dashboard → Invoice Detail → Send → Back

| Step | Route | Notes |
|------|-------|-------|
| Dashboard invoice click | → `/invoices/:id` | `setLocation()` |
| Invoice detail load | `["invoices", "detail", id]` | Canonical key (post pre-flight fix) |
| Send mutation | Stays on page | Invalidates `["invoices", "detail", id]` + `["invoices"]` |
| Browser back | → `/` (Dashboard) | Dashboard `["invoices", "dashboard"]` refetches (staleTime 60s) |

### Journey 3: Jobs List → Job Detail → Create Invoice → Invoice Detail

| Step | Route | Notes |
|------|-------|-------|
| Jobs list | `/jobs` | `useJobsFeed` canonical hook |
| Job click | → `/jobs/:id` | `useJobHeader` canonical hook |
| Create invoice dialog | Modal on job page | User chooses "Create" or "Close & Create" |
| Invoice created | → `/invoices/:newId` | `setLocation()` after mutation success |
| Browser back | → `/jobs/:id` | Job data may be stale (5min default staleTime). After "Close & Create", job status change not visible until refetch. |

### Flow Findings

| Finding | Severity | Notes |
|---------|----------|-------|
| **Post-login redirect always goes to `/`** | LOW | If user was on `/invoices/123` and session expired, login sends them to `/` not back to the invoice. Common SPA limitation. |
| **Browser back after create-invoice shows stale job** | LOW | Job status ("invoiced") not visible until cache expires (5min). Family invalidation `["jobs"]` fires at create time but user navigates away before data arrives. |
| **Consistent post-save navigation** | PASS | All detail page edits stay on page. All resource creation navigates to new resource. All deletes navigate to list. Pattern is consistent. |
| **RBAC enforcement** | PASS | All routes wrapped in `ProtectedRoute`. Server middleware enforces `requireAuth` + `requireRole`. |
| **Tenant isolation** | PASS | `ensureTenantContext` middleware attaches `req.companyId`. All queries scope by companyId. |
| **Loading/error states** | PASS | All pages show skeletons/spinners. All mutations show isPending. Error toasts on failure. |
| **Browser history** | PASS | Wouter uses `window.pushState()` correctly. Back button works. No history corruption. |

**No blockers found.** Two LOW-severity notes for future improvement (post-login redirect, stale-on-back).

---

## Deliverables Summary

### Changes Made

1. **PRE-FLIGHT FIX** — Invoice query key namespace unified under `["invoices", ...]`
   - `client/src/pages/InvoiceDetailPage.tsx` — 10 key changes (2 queries + 8 invalidations)
   - `client/src/pages/JobDetailPage.tsx` — 1 key change (`by-job` → `byJob`)

2. **ARCHITECTURE.md update** — `docs/ARCHITECTURE.md`
   - Added invoice canonical key namespace table
   - Added "Architecture Lock Rules" section with 5 hard rules
   - Added allowed direct useQuery exception list

3. **CHANGELOG.md** — Updated with invoice namespace fix entry

4. **This audit report** — `docs/AUDIT_2026_02_16_ARCHITECTURE_LOCK.md`

### FAIL List (Fix Before Features)

| # | Fix | Effort | Files |
|---|-----|--------|-------|
| **F1** | Add `queryFn` to InvoicesListPage stats query | 5 min | `InvoicesListPage.tsx` |
| **F2** | Add pagination to `/api/jobs/action-required` | 30 min | `server/routes/jobs.ts`, storage function |
| **F3** | Add pagination/limit to `/api/reports/ar-aging` | 30 min | `server/routes/reports.ts`, storage function |

### Architecture: LOCKED

No further refactors authorized. Feature work may proceed under the rules documented in `docs/ARCHITECTURE.md` § "Architecture Lock Rules".
