# Frontend Architectural Dependency Audit

**Date:** 2026-03-08
**Scope:** All client-side pages, components, hooks, and providers
**Methodology:** Exhaustive trace of every `useQuery`, `useMutation`, `invalidateQueries`, and cross-section import across all frontend modules

---

## Executive Summary

Audited **60+ files** across **8 app sections**. Found **4 critical cross-section dependencies** that violate domain boundaries and risk cascading failures (e.g., Admin page breaking because it touches calendar queries). The most impactful issue is in `App.tsx` itself — a global `/api/calendar/unscheduled` query fires on **every authenticated page load**, creating unnecessary server load and tight coupling between the app shell and the dispatch domain.

| Severity | Count | Description |
|----------|-------|-------------|
| 🔴 CRITICAL | 4 | Cross-section queries/invalidations that cause failures or unnecessary load |
| 🟡 WARNING | 3 | Redundant queries or uncontrolled polling |
| 🟢 CLEAN | 6 sections | Proper domain isolation confirmed |

---

## Section-by-Section Analysis

### 1. Admin Section

**Entry:** `/admin` route → `Admin.tsx`
**Layout:** Standalone admin layout with sidebar tabs

| Hook / Query Key | Endpoint | Appropriate? |
|-----------------|----------|-------------|
| `useQuery(["/api/admin/users"])` | GET /api/admin/users | ✅ |
| `useQuery(["/api/admin/companies"])` | GET /api/admin/companies | ✅ |
| `useQuery(["/api/admin/timesheets/..."])` | GET /api/admin/timesheets/* | ✅ |
| `useQuery(["/api/admin/audit-logs"])` | GET /api/admin/audit-logs | ✅ |
| `useQuery(["/api/items?limit=200"])` | GET /api/items | ⚠️ Minor — via `NewAddClientDialog` import |

**Verdict:** ✅ Clean. No calendar/dispatch/scheduling cross-wiring. The `NewAddClientDialog` import brings in an `/api/items` query but it only fires when the dialog is opened, not on page load.

---

### 2. Dispatch + Map Section

**Entry:** `/dispatch` → `DispatchPreview.tsx`, `/map` → `LiveMapPage.tsx`
**Layout:** Full-width dispatch board / map canvas

| Hook / Query Key | Endpoint | Appropriate? |
|-----------------|----------|-------------|
| `useQuery(["/api/calendar", ...])` | GET /api/calendar | ✅ Core domain |
| `useQuery(["/api/calendar/unscheduled"])` | GET /api/calendar/unscheduled | ✅ Core domain |
| `useQuery(["/api/tasks", ...])` | GET /api/tasks | ✅ Tasks shown in lanes |
| `useQuery(["/api/team/technicians"])` | GET /api/team/technicians | ✅ Lane headers |
| `useQuery(["/api/team/technicians/working-hours"])` | GET /api/team/technicians/working-hours | ✅ Hour overlays |
| `useQuery(["/api/map/day"])` | GET /api/map/day | ✅ Map visualization |
| SSE: `/api/dispatch/stream` | EventSource | ✅ Real-time sync |

**Key hooks:** `useDispatchPreviewMutations`, `useSchedulingApi`, `useDispatchStream`, `useTechnicianWorkingHours`

**Verdict:** ✅ Clean. All queries are domain-appropriate. The map page's use of `/api/calendar/unscheduled` is justified (shows unscheduled sidebar).

---

### 3. Jobs + Invoices Section

**Entry:** `/jobs/:id` → `JobDetailPage.tsx`, `/invoices/:id` → `InvoiceDetailPage.tsx`
**Layout:** Detail pages with tabs

| Hook / Query Key | Endpoint | Appropriate? |
|-----------------|----------|-------------|
| `useQuery(["/api/jobs", jobId])` | GET /api/jobs/:id | ✅ |
| `useQuery(["/api/jobs", jobId, "visits"])` | GET /api/jobs/:id/visits | ✅ |
| `useQuery(["/api/jobs", jobId, "notes"])` | GET /api/jobs/:id/notes | ✅ |
| `useQuery(["/api/invoices", invoiceId])` | GET /api/invoices/:id | ✅ |
| `useQuery(["/api/invoices", invoiceId, "payments"])` | GET /api/invoices/:id/payments | ✅ |
| `useQuery(["/api/quotes/list", ...])` | GET /api/quotes/list | ✅ Quote→Job conversion |

**Cross-references:** Job detail shows linked invoice status; invoice detail shows job notes. Both are **read-only** cross-domain references and are justified for the UX flow (job→invoice lifecycle).

**Verdict:** ✅ Clean. All cross-domain reads are justified and read-only.

---

### 4. Clients + Settings Section

**Entry:** `/clients` → `Clients.tsx`, `/clients/:id` → `ClientDetailPage.tsx`, `/settings/*` → various

#### Client Pages

| Hook / Query Key | Endpoint | Appropriate? |
|-----------------|----------|-------------|
| `useQuery(["/api/clients", ...])` | GET /api/clients | ✅ |
| `useQuery(["/api/customer-companies", ...])` | GET /api/customer-companies | ✅ |
| `useQuery(["/api/tags"])` | GET /api/tags | ✅ |
| `useQuery(["/api/clients", id, "equipment"])` | GET /api/clients/:id/equipment | ✅ |
| `useQuery(["/api/locations", id, "pm-parts"])` | GET /api/locations/:id/pm-parts | ✅ |
| `useQuery(["/api/quotes/list", ...])` | GET /api/quotes/list | ⚠️ Read-only cross-domain (acceptable) |

#### Settings Pages

| Page | Query Keys | Status |
|------|-----------|--------|
| CompanySettingsPage | `/api/company-settings`, `/api/settings/numbering` | ✅ |
| RegionalSettingsPage | `/api/company-settings` | ✅ |
| BusinessHoursSettingsPage | `/api/company/business-hours` | ✅ |
| TimeAlertSettingsPage | `/api/time-alerts/settings` | ✅ |
| TagsSettingsPage | `/api/tags` | ✅ |
| SubscriptionSettings | Subscription endpoints | ✅ |

#### 🔴 CRITICAL: AddClientPage.tsx Cross-Section Invalidations

`AddClientPage.tsx` invalidates **5 unrelated query keys** on every client create/update mutation:

```typescript
// Lines 61-63, 108-110, 151-157 — WRONG
queryClient.invalidateQueries({ queryKey: ["/api/calendar"], exact: false });
queryClient.invalidateQueries({ queryKey: ["/api/reports/parts"] });
queryClient.invalidateQueries({ queryKey: ["/api/reports/schedule"] });
queryClient.invalidateQueries({ queryKey: ["/api/maintenance/recently-completed"] });
queryClient.invalidateQueries({ queryKey: ["/api/maintenance/statuses"] });
```

**Impact:** Creating or editing a client triggers refetches of calendar data, reports, and maintenance queries — none of which depend on client data. This wastes bandwidth and creates coupling that can cause failures if those endpoints are temporarily unavailable.

#### 🟡 WARNING: CompanySettingsPage.tsx Dead Query

```typescript
// Line 96-98 — dead code
useQuery(["/api/clients"]) // loaded but never used
```

---

### 5. Dashboard

**Entry:** `/` → `Dashboard.tsx`
**Layout:** Grid of summary cards

| Hook / Query Key | Endpoint | Appropriate? |
|-----------------|----------|-------------|
| `useQuery(["/api/dashboard/stats"])` | GET /api/dashboard/stats | ✅ |
| `useQuery(["/api/dashboard/upcoming"])` | GET /api/dashboard/upcoming | ✅ |
| `useQuery(["/api/dashboard/revenue"])` | GET /api/dashboard/revenue | ✅ |
| `useQuery(["/api/maintenance/statuses"])` | GET /api/maintenance/statuses | ✅ Summary card |
| `useQuery(["/api/attention-items"])` | GET /api/attention-items | ✅ Alert card |

**Verdict:** ✅ Clean. Dashboard is intentionally a multi-domain summary surface. All queries are read-only aggregation endpoints designed for this purpose.

---

### 6. Portal (Client-Facing)

**Entry:** `/portal/*`
**Layout:** Isolated portal layout (no sidebar)

**Verdict:** ✅ Clean. Fully isolated from internal app queries. Uses its own `/api/portal/*` endpoints.

---

### 7. Time Tracking

**Entry:** `/timesheets`, `/time-tracking`
**Layout:** Standard page with sidebar

| Hook / Query Key | Endpoint | Appropriate? |
|-----------------|----------|-------------|
| `useQuery(["/api/timesheets/..."])` | GET /api/timesheets/* | ✅ |
| `useQuery(["/api/team/technicians"])` | GET /api/team/technicians | ✅ Technician filter |

**Verdict:** ✅ Clean. Properly scoped to time-tracking domain.

---

### 8. Reports

**Entry:** `/reports/*`
**Layout:** Standard page with sidebar

**Verdict:** ✅ Clean. Uses `/api/reports/*` endpoints exclusively.

---

## Global Providers Analysis

### App.tsx — AppContent Component (Lines 450-500)

This is the **most critical finding**. `AppContent` wraps every authenticated route and runs these queries on **every page load**:

#### 🔴 CRITICAL: Global `/api/calendar/unscheduled` Query

```typescript
// App.tsx lines 474-477
const { data: unscheduledCount } = useQuery({
  queryKey: ["/api/calendar/unscheduled"],
  // ... fires on EVERY authenticated page
});
```

**Impact:** Every page load (clients, settings, invoices, admin — ALL of them) triggers a fetch to the calendar/unscheduled endpoint. This:
- Creates **unnecessary server load** (N users × M page navigations per session)
- Creates **tight coupling** — if `/api/calendar/unscheduled` is slow or errors, it affects sidebar badge rendering on every page
- Violates **domain isolation** — the calendar domain leaks into the app shell

**Fix:** Move this query into the dispatch section only, or into the sidebar badge component with `staleTime: 5 * 60 * 1000` and `refetchOnWindowFocus: false`.

#### 🟡 WARNING: Triple-Fetched `/api/company-settings`

`/api/company-settings` is fetched independently by **4 components** that can all be mounted simultaneously:

1. `AppContent` (App.tsx) — timezone detection
2. `AppSidebar` — subscription tier display
3. `TimezoneSetupBanner` — timezone prompt
4. `TimezoneSetupDialog` — timezone setup form

While TanStack Query deduplicates concurrent requests, each component creates its own observer, and **`TimezoneSetupDialog` invalidates `/api/calendar`** when saving timezone — even when the user is not on the calendar page.

**Fix:** Extract into a single `useCompanySettings()` hook with appropriate `staleTime`. Remove the `/api/calendar` invalidation from `TimezoneSetupDialog` (or gate it behind a route check).

#### 🟡 WARNING: SubscriptionBanner Uncontrolled Polling

`SubscriptionBanner` uses `useQuery` with **no `staleTime` or `refetchInterval`** configuration, causing it to refetch on every window focus and mount cycle across all pages.

---

## Dependency Matrix

| Source Section | Target Query Domain | Direction | Severity | Justified? |
|---------------|-------------------|-----------|----------|-----------|
| **App.tsx (global)** | `/api/calendar/unscheduled` | Read | 🔴 CRITICAL | ❌ No — sidebar badge doesn't need global scope |
| **App.tsx (global)** | `/api/company-settings` ×4 | Read | 🟡 WARNING | Partially — consolidate to 1 hook |
| **TimezoneSetupDialog** | `/api/calendar` invalidation | Write | 🟡 WARNING | ❌ No — shouldn't invalidate dispatch from settings |
| **AddClientPage** | `/api/calendar` invalidation | Write | 🔴 CRITICAL | ❌ No — client CRUD doesn't affect calendar |
| **AddClientPage** | `/api/reports/*` invalidation | Write | 🔴 CRITICAL | ❌ No — client CRUD doesn't affect reports |
| **AddClientPage** | `/api/maintenance/*` invalidation | Write | 🔴 CRITICAL | ❌ No — client CRUD doesn't affect maintenance |
| **ClientDetailPage** | `/api/quotes/list` | Read | 🟢 OK | ✅ Display-only, justified for client profile |
| **JobDetailPage** | `/api/invoices/:id` | Read | 🟢 OK | ✅ Job→Invoice lifecycle display |
| **Dashboard** | Multiple domains | Read | 🟢 OK | ✅ Intentional aggregation surface |
| **CompanySettingsPage** | `/api/clients` (unused) | Read | 🟡 WARNING | ❌ Dead code — remove |

---

## Recommended Removals

### Priority 1 — Fix Now (Causes Real Bugs / Unnecessary Load)

1. **App.tsx: Remove global `/api/calendar/unscheduled` query**
   - Move to `AppSidebar` badge component only
   - Add `staleTime: 5 * 60_000` and `refetchOnWindowFocus: false`
   - Or conditionally enable only on dispatch/map routes

2. **AddClientPage.tsx: Remove 5 cross-section invalidations**
   - Delete lines invalidating `/api/calendar`, `/api/reports/*`, `/api/maintenance/*`
   - Keep only `/api/clients` and `/api/customer-companies` invalidations

### Priority 2 — Fix Soon (Performance / Code Quality)

3. **TimezoneSetupDialog: Remove `/api/calendar` invalidation**
   - Timezone changes don't require immediate calendar refetch
   - Calendar will pick up timezone on next natural refetch

4. **CompanySettingsPage: Remove dead `/api/clients` query**
   - Unused data fetch on settings page

5. **App.tsx: Consolidate `/api/company-settings` into shared hook**
   - Create `useCompanySettings()` with `staleTime: 10 * 60_000`
   - Replace 4 independent `useQuery` calls

6. **SubscriptionBanner: Add `staleTime` to prevent uncontrolled refetching**
   - Add `staleTime: 30 * 60_000` (subscription status doesn't change often)

### Priority 3 — Monitor (Acceptable but Worth Tracking)

7. **ClientDetailPage / LocationDetailPage**: `/api/quotes/list` cross-domain read
   - Currently justified (display-only)
   - If quotes endpoint becomes expensive, consider a dedicated client-scoped endpoint

---

## Architecture Principle: Domain Query Ownership

To prevent future cross-wiring, adopt this rule:

> **A section may READ from other domains (useQuery), but must NEVER WRITE to other domains (invalidateQueries, useMutation targeting foreign endpoints).**

Invalidation should flow **downstream** from the source of truth:
- Client CRUD → invalidate `/api/clients`, `/api/customer-companies` only
- Job CRUD → invalidate `/api/jobs`, `/api/calendar` (jobs affect calendar)
- Calendar mutations → invalidate `/api/calendar`, `/api/calendar/unscheduled`
- Settings changes → invalidate `/api/company-settings` only

Cross-domain invalidation (e.g., "client change → refresh calendar") should be handled by **event-driven mechanisms** (SSE, WebSocket, or shared invalidation bus), not by hardcoding foreign query keys in unrelated mutation handlers.

---

*Report generated 2026-03-08. Audit covers all files in `client/src/pages/`, `client/src/components/`, `client/src/hooks/`, and `client/src/App.tsx`.*
