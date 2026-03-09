# Frontend Architectural Cleanup & Consistency Report

**Date:** 2026-03-08
**Scope:** Cross-domain decoupling, admin consistency, query/invalidation boundaries

---

## SECTION 1 — FRONTEND ISSUES FIXED

### Track 1: Cross-Domain Decoupling

| # | Issue | File | Fix |
|---|-------|------|-----|
| 1 | Global `/api/calendar/unscheduled` query in app shell | `App.tsx` | Removed query, state, computation, and overdue alert UI |
| 2 | Unused lucide imports (`AlertTriangle`, `X`, `ChevronRight`) | `App.tsx` | Removed imports |
| 3 | `createClientWithCompanyMutation` invalidates `/api/reports/*`, `/api/calendar` | `AddClientPage.tsx` | Removed — client CRUD stays in client domain |
| 4 | `createClientMutation` invalidates `/api/reports/*`, `/api/calendar` | `AddClientPage.tsx` | Removed — client CRUD stays in client domain |
| 5 | `updateClientMutation` invalidates `/api/reports/*`, `/api/calendar`, `/api/maintenance/*` | `AddClientPage.tsx` | Removed — client CRUD stays in client domain |
| 6 | Timezone save invalidates `/api/calendar` | `TimezoneSetupDialog.tsx` | Removed — timezone is settings domain |
| 7 | Dead `/api/clients` query (fetched, never used) | `CompanySettingsPage.tsx` | Removed query entirely |
| 8 | Missing `staleTime` on subscription usage query | `SubscriptionBanner.tsx` | Added `staleTime: 30 * 60_000` |

### Track 2: Admin Consistency Pass

| # | Check | Result |
|---|-------|--------|
| 1 | `AdminTenants.tsx` — no jobs/calendar/scheduling/visits/tasks references | ✅ CLEAN |
| 2 | `AdminTenants.tsx` — `TenantAccount` type matches backend `TenantAccountSummary` | ✅ MATCHES |
| 3 | `AdminTenants.tsx` — no `Briefcase`/`Calendar` icons | ✅ CLEAN |
| 4 | `AdminTenantDetail.tsx` — no jobs/calendar/scheduling data queries | ✅ CLEAN |
| 5 | `AdminTenantDetail.tsx` — `TenantDetail` type matches backend `TenantAccountDetail` | ✅ MATCHES |
| 6 | `AdminTenantDetail.tsx` — feature toggles (`calendarEnabled`, etc.) | ✅ ACCEPTABLE — account config, not operational data |

### Track 3: Architecture Guardrails

| # | File | Guardrail Added |
|---|------|-----------------|
| 1 | `App.tsx:473` | `// Architecture rule: app shell must NOT fetch dispatch/calendar/scheduling data.` |
| 2 | `AddClientPage.tsx` (3 mutations) | `// Domain boundary: client CRUD only invalidates client-domain caches` |
| 3 | `TimezoneSetupDialog.tsx` | `// Domain boundary: timezone change does not invalidate calendar/scheduling caches` |

---

## SECTION 2 — FILES CHANGED

| File | Change Type | Lines Changed |
|------|-------------|---------------|
| `client/src/App.tsx` | Removed global calendar query, overdue alert UI, unused imports | −40 |
| `client/src/pages/AddClientPage.tsx` | Removed 8 cross-domain invalidation calls across 3 mutations | −10 |
| `client/src/components/TimezoneSetupDialog.tsx` | Removed calendar invalidation | −1, +1 |
| `client/src/pages/CompanySettingsPage.tsx` | Removed dead `/api/clients` query | −4 |
| `client/src/components/SubscriptionBanner.tsx` | Added staleTime | +1 |
| `CHANGELOG.md` | Added cleanup entry | +15 |

---

## SECTION 3 — REMAINING QUERY / INVALIDATION BOUNDARIES

### Legitimate Cross-Domain Invalidations (NOT violations)

These are intentional couplings where the mutation genuinely affects both domains:

| Pattern | Files | Justification |
|---------|-------|---------------|
| Job complete/delete → calendar invalidation | `JobDetailPage.tsx`, `JobHeaderCard.tsx` | Completing/deleting a job removes it from calendar. Same domain boundary. |
| Job delete → `/api/clients` | `JobDetailPage.tsx` | Client detail shows job counts; deletion changes the count |
| Job → invoice creation → `["invoices"]` | `JobDetailPage.tsx`, `JobHeaderCard.tsx` | Operation creates an invoice — must invalidate invoice cache |
| Visit edit → calendar | `EditVisitModal.tsx` | Visit scheduling IS calendar data |
| Scheduling utilities → calendar | `jobScheduling.ts`, `useSchedulingApi.ts` | Scheduling and calendar are the same domain |
| Dispatch SSE → map | `useDispatchStream.ts` | Real-time convergence — documented in Phase 1 Map Convergence |
| Recurring job generation → unscheduled | `RecurringJobsPage.tsx` | Generated jobs appear in backlog |
| Dispatch mutations → calendar + tasks | `useDispatchPreviewMutations.ts` | Dispatch IS the calendar/tasks domain |

### True Boundaries (Enforced)

| Domain | Invalidates ONLY | Does NOT invalidate |
|--------|-------------------|---------------------|
| App shell | Account-level queries only | ~~calendar~~, ~~scheduling~~, ~~dispatch~~ |
| Client CRUD | `/api/clients`, `/api/customer-companies` | ~~reports~~, ~~calendar~~, ~~maintenance~~ |
| Company settings | `/api/company-settings` | ~~calendar~~, ~~scheduling~~ |
| Admin pages | `/api/admin/*`, `/api/subscriptions/*` | No operational data at all |

---

## SECTION 4 — ADMIN CONTRACT CONSISTENCY

### Backend Contract (after decoupling)

```
GET /api/admin/tenants → TenantAccountSummary[]
  { company, owner, users: { total, lastLoginAt }, qbo }

GET /api/admin/tenants/:id → TenantAccountDetail
  { company, owner, users: { total, lastLoginAt },
    qbo, recentSyncErrors, recentUsers }
```

### Frontend ↔ Backend Alignment

| Frontend Type | Backend Type | Match |
|---------------|-------------|-------|
| `TenantAccount` (AdminTenants.tsx) | `TenantAccountSummary` | ✅ |
| `TenantDetail` (AdminTenantDetail.tsx) | `TenantAccountDetail` | ✅ |

### Operational Data in Admin: None

- No `jobs` field in any admin type
- No `calendar` field in any admin type
- No `visits`, `tasks`, `scheduling` references
- Feature toggles (`calendarEnabled`, `routeOptimizationEnabled`) are **account configuration** stored in `tenant_features` table — not operational data queries

---

## SECTION 5 — VERIFICATION

### TypeScript Compilation

```
$ npx tsc --noEmit --pretty
Found 2 errors in server/routes/adminTimesheets.ts:377
  → Property 'jobId' does not exist (PRE-EXISTING, unrelated)

No new errors introduced. ✅
```

### Removed Queries Summary

| Query Removed | Was In | Impact |
|---------------|--------|--------|
| `/api/calendar/unscheduled` | App shell (every page) | Eliminates unnecessary fetch on non-dispatch pages |
| `/api/clients` | CompanySettingsPage | Eliminates dead fetch (data never used) |

### Removed Invalidations Summary

| Invalidation Removed | Trigger | Impact |
|----------------------|---------|--------|
| `/api/reports/parts` | Client create/update | Reports refetch on their own page visit |
| `/api/reports/schedule` | Client create/update | Reports refetch on their own page visit |
| `/api/calendar` (exact: false) | Client create/update | Calendar refetches on dispatch page visit |
| `/api/maintenance/recently-completed` | Client update | Maintenance page refetches on visit |
| `/api/maintenance/statuses` | Client update | Maintenance page refetches on visit |
| `/api/calendar` | Timezone save | Calendar refetches on next dispatch visit |

**Key insight:** All removed invalidations are cosmetic — the target caches will naturally refresh via `staleTime` expiration or page-mount refetch. No user-visible staleness expected.

---

*Cleanup complete. 8 issues fixed, 6 files changed, 0 new TypeScript errors.*
