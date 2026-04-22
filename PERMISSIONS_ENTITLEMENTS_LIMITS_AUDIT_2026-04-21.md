# Permissions, Feature Access, and Plan-Limit System — Deep Audit
## Syntraro, 2026-04-21. Audit only. Read-only. No code modified.

---

## 1. Executive Summary

1. **Two permission systems exist side-by-side; only one is enforced.** The code-based role catalog (`MANAGER_ROLES`, `RESTRICTED_MANAGER_ROLES`, `ADMIN_ROLES`, `TECH_ROLES` in `server/auth/roles.ts`) applied via `requireRole()` is actively enforced on 50+ routes. The DB-based permission system (`roles`, `permissions`, `rolePermissions`, `userPermissionOverrides` tables with 36 permission keys) is seeded on demand, but **`requirePermission()` middleware is never called in any route**. One single call site uses `userHasPermission(..., "schedule.all.view")` directly — the entire "granular permissions" system is effectively aspirational.

2. **Two feature-entitlement systems exist; only the legacy one is enforced.** The legacy `tenantFeatures` table (9 boolean columns) is actively read by `requireFeature()` on 5 routes. The new system (`subscriptionFeatures` + `subscriptionPlanFeatures` + `tenantFeatureOverrides` with 40+ catalog entries, plus `entitlementService` and `entitlementEnforcement`) has **zero runtime readers** — it is admin-UI-only metadata. `entitlementService.getTenantEntitlements()` and `entitlementEnforcement.assertFeatureCapacity()` exist but are never called. The admin Platform Features Catalog UI saves to rows that nothing reads.

3. **Only one limitable entity — client locations — is actually enforced at runtime.** `canAddLocation()` blocks at `POST /api/clients`, `POST /api/clients/full-create`, and `POST /api/client-import/execute`. Every other limitable entity — PM contracts, technician users, office users, total users, equipment — has counting code in `usageMetricsService.ts` but **no enforcement at the create path**. The routes that create them insert without consulting any limit.

4. **Feature-key vocabulary mismatch between the two entitlement systems.** Legacy uses camelCase (`quotesEnabled`, `calendarEnabled`); new catalog uses snake_case (`quotes`, `scheduling_calendar`). The systems cannot cross-reference by key; admin edits in one do not flow to the other. Some legacy keys (`routeOptimizationEnabled`, `liveMapEnabled`, `customerPortalPaymentsEnabled`, `multiTechEnabled`) do not exist in the new catalog at all.

5. **Two subscription-state columns with no synchronization.** `companies.subscriptionStatus` (runtime gate) and `tenantSubscriptions.status` (billing-cycle audit) are written by different code paths and can diverge. Admin PATCH of one does not update the other. Runtime access gates (`computeEntitlement`, `canAddLocation`) read only `companies.*`. `tenantSubscriptions` is shown in UI but not used for access control.

6. **Stripe webhook does not update subscription state.** `stripeWebhook.ts` handles `payment_intent.succeeded`, `charge.refunded`, and `payment_intent.payment_failed` as ledger entries. Neither `companies.subscriptionStatus` nor `tenantSubscriptions.status` is written by the webhook. Subscription states `past_due`, `paused`, `active` are reachable only via admin PATCH — the system is not a real Stripe subscription integration.

7. **Trial expiration is computed at request time, not recorded.** `computeEntitlement()` checks `trialEndsAt < now` on every call. No database event, no state column update, no audit row. `subscriptionWorker` handles annual renewals only — it does NOT fire trial expiration events. A tenant whose trial expired remains `subscriptionStatus = "trial"` forever.

8. **`requireFeature` middleware fails open on error.** Its `catch` block calls `next()` if the feature lookup throws. A DB outage or repository bug silently allows access instead of denying.

9. **`subscriptionPlan` is a string reference with no FK constraint.** `computeEntitlement()` requires `subscriptionPlan = "trial"` to exist in the `subscriptionPlans` table for new signups to be entitled. A 2026-04-19 migration was required to backfill. If the plan name is wrong or missing, new tenants silently get `NO_PLAN` and are fully blocked.

10. **Platform admin bypasses all feature gates.** `requireFeature()` short-circuits when `isPlatformRole(user.role)`. Intentional for support, but platform admins see gated features as enabled while tenant users don't. No comparable bypass consideration for limit checks.

11. **Tech app boundary is schedulability-based, not role-based.** Office routes use `requireRole(MANAGER_ROLES)`; tech routes use `requireSchedulable()` (reads `user.isSchedulable`). Users with any role and `isSchedulable=true` can access tech routes. No confusion detected — the two boundaries are disjoint — but this is non-obvious.

12. **`userPermissionOverrides` is fully dead.** Table exists, repository reads it, but there is NO code path that writes to it (no admin UI, no API endpoint). Reading code is pure ceremony.

13. **Multi-source counting for locations.** `subscriptionRepository.canAddLocation()` has its own COUNT query and does NOT call `usageMetricsService.countClients()`. Two parallel counters for the same entity — drift is theoretical but possible (e.g., filter predicates get out of sync).

14. **Bulk import limit check is upfront-only.** `client-import/execute` checks `canAddLocation()` once before the loop; no per-row check inside. Under concurrent writes from another session, the batch can overshoot the cap.

15. **Admin tenant-feature write path works; admin entitlement write path does not.** `PATCH /api/admin/tenants/:companyId/features` and `PATCH /api/platform/tenants/:tenantId/features` both update the legacy `tenantFeatures` table (runtime-effective). `PUT /api/tenants/:tenantId/overrides/:featureKey` writes to `tenantFeatureOverrides` (runtime-ignored).

16. **Read-only support sessions have proper defense-in-depth.** HTTP middleware `enforceReadOnlySupport` blocks mutating methods; `assertWritableSupportContext()` is called at 28+ service entry points as a belt-and-braces guard; denials are audit-logged. Reviewed clean.

---

## 2. Current Canonical Enforcement Inventory

### Roles / Permissions

| Item | Source of truth | Where enforced | Confidence |
|---|---|---|---|
| `MANAGER_ROLES`, `RESTRICTED_MANAGER_ROLES`, `ADMIN_ROLES`, `OWNER_ONLY`, `TECH_ROLES` | `server/auth/roles.ts:16-35` (TypeScript constants) | `requireRole()` middleware on 50+ routes (`server/auth/requireRole.ts:10-22`) | High |
| Platform roles (`platform_admin`, `platform_support`, `platform_billing`, `platform_readonly_audit`) | `server/auth/roles.ts:52` + client mirror `client/src/lib/platformRoles.ts:10-21` | `requirePlatformRole()` on every `/api/platform/*` route (`server/auth/requirePlatformRole.ts:26-60`); `ensureTenantContext` blocks platform roles on tenant routes absent a support session (`server/auth/tenantIsolation.ts:98-113`) | High |
| Tech-app access gate | `users.isSchedulable` column | `requireSchedulable()` middleware in `server/routes/techField.ts:52-62` | High |
| Resource-level ownership/authorization | `server/guards/ownershipGuards.ts`, `schedulingPermissions.ts`, `visitAssignmentGuards.ts` | Called inline after `requireRole` in specific handlers | High |
| Support read-only enforcement | `support_sessions.accessMode = 'read_only'` | HTTP layer: `server/middleware/enforceReadOnlySupport.ts:23-54`; service layer: `assertWritableSupportContext` at 28+ mutation entry points | High |
| DB permission system (36 permissions, `rolePermissions`, overrides) | `shared/schema.ts:2966-3034`, seeded by `server/routes/roles.ts:181-247` | **Not enforced.** `requirePermission()` defined at `server/permissions.ts:19-49` has zero callers. Only `userHasPermission(..., "schedule.all.view")` is called (from `techField.ts` cross-tech scope check). | High (drift) |

### Feature Entitlements

| Item | Source of truth | Where enforced | Confidence |
|---|---|---|---|
| Tenant-feature flags (legacy, 9 features) | `tenantFeatures` table (`shared/schema.ts:3923-3985`) | `requireFeature()` at `server/auth/requireFeature.ts:17-70`; applied to `/api/invoices`, `/api/quotes`, `/api/calendar/*`, `/api/calendar/crew/assign`, `/api/qbo/*` | High |
| Feature catalog (new, 40 features) | `subscriptionFeatures` table (`shared/schema.ts:1151-1194`) | **Admin data only.** Read by platform UI pages and `entitlementService.getTenantEntitlements()` (which has no callers). | High |
| Plan-to-feature mapping | `subscriptionPlanFeatures` table (`shared/schema.ts:1195-1216`) | Read only by `entitlementService.getTenantEntitlements()` (unused). | High |
| Per-tenant feature overrides | `tenantFeatureOverrides` table (`shared/schema.ts:1218-1249`) | Read only by `entitlementService.getTenantEntitlements()` (unused). Admin can write via `PUT /api/tenants/:tenantId/overrides/:featureKey`. **No runtime effect.** | High |
| Client feature hook | `client/src/hooks/useTenantFeatures.ts:24-35` reading `GET /api/company-settings/features` | Reads `tenantFeatures` row; 5-min client cache; consumed by InvoiceDetailPage and ClientBillingTab | High |

### Plan / Trial State

| Item | Source of truth | Where enforced | Confidence |
|---|---|---|---|
| Runtime subscription state | `companies.subscriptionStatus` + `companies.trialEndsAt` + `companies.subscriptionPlan` | `computeEntitlement()` at `server/storage/subscriptions.ts:47-74`; called from `canAddLocation()` and `GET /api/subscriptions/usage` | High |
| Billing-cycle state | `tenantSubscriptions.status` | Read-only from UI (`GET /api/subscriptions/me`). **Not read by any access gate.** | High |
| Trial duration | `TRIAL_DAYS = 14` hardcoded in `server/services/onboardingService.ts:31` | Set on signup; not reconfigurable | High |
| Annual renewal lifecycle | `tenantSubscriptions` + `subscriptionEvents` | `subscriptionWorker` at `server/services/subscriptionWorker.ts` — daily cron | High |
| Trial expiration | Compute-on-read from `trialEndsAt` | No event, no worker, no state change | High |

### Limits / Quotas

| Item | Source of truth | Where enforced | Confidence |
|---|---|---|---|
| Client-location limit | `subscriptionPlans.locationLimit` (legacy column) | `canAddLocation()` called at `POST /api/clients`, `POST /api/clients/full-create`, `POST /api/client-import/execute` | High |
| Every other limit (users, technicians, PM contracts, equipment) | `subscriptionPlanFeatures.limitValue` + `tenantFeatureOverrides.limitValue` | **Not enforced.** Counting exists in `usageMetricsService`; `entitlementEnforcement.assertFeatureCapacity()` exists; **zero callers**. | High |

---

## 3. Findings

### Finding #1: Permission system is a dual-reality — code-based enforcement vs DB-based aspiration
- **Severity**: High
- **Category**: Permission / Dead System
- **Files/routes/components involved**:
  - `server/auth/requireRole.ts:10-22` (enforced)
  - `server/permissions.ts:19-49` (`requirePermission` exported, never imported)
  - `server/storage/permissions.ts:84-130` (`getUserEffectivePermissions`, runs but only one caller)
  - `server/routes/roles.ts:181-247` (on-demand seeding)
  - `shared/schema.ts:2966-3034` (`roles`, `permissions`, `rolePermissions`, `userPermissionOverrides` tables)
- **What currently exists**: Full relational permission model — 5 default roles, 36 permission keys across 8 groups, role-permission mapping, per-user override table, an `ensureRolesAndPermissionsSeeded()` function, a `requirePermission(key)` middleware factory, a `userHasPermission()` helper, and `getUserEffectivePermissions()` with caching.
- **What is actually enforced**: 50+ routes use `requireRole(MANAGER_ROLES)` style role gates. Exactly one call site in the codebase invokes the granular permission system at runtime: `userHasPermission(user.id, "schedule.all.view")` inside `GET /api/tech/visits/today` to decide cross-tech visibility scope.
- **What is duplicated / missing / drifting**: The entire DB-permission system is infrastructure without gates. The `requirePermission` middleware is dead. User overrides are fully dead — there is no write path.
- **Real risk**: Every "admin grant/revoke a permission" UI intention (the Manage Roles page exists at `client/src/pages/ManageRoles.tsx`) produces rows that have no runtime effect except on the one tech-visit scope check. Platform maintainers might assume fine-grained permissions work; they don't.
- **Recommended direction**: Decide whether to (a) retire the DB permission system and delete the unused tables + middleware + Manage Roles UI, or (b) wire `requirePermission()` into the canonical routes it was designed for. Do not leave both alive unenforced.
- **Confidence**: High

### Finding #2: Two feature entitlement systems; only legacy is live
- **Severity**: Critical
- **Category**: Entitlement / Dead System
- **Files/routes/components involved**:
  - Legacy (live): `server/storage/tenantFeatures.ts`, `server/auth/requireFeature.ts`, `shared/schema.ts:3923-3985`, `client/src/hooks/useTenantFeatures.ts`, `PATCH /api/admin/tenants/:id/features`, `PATCH /api/platform/tenants/:id/features`
  - New (dead): `server/services/entitlementService.ts`, `server/services/entitlementEnforcement.ts`, `server/storage/entitlements.ts`, `server/routes/platformEntitlements.ts`, `shared/schema.ts:1151-1249`, `client/src/pages/platform/PlatformFeaturesCatalog.tsx`, `PlatformFeatureDetail.tsx`
- **What currently exists**: Legacy `tenantFeatures` table with 9 boolean columns + `requireFeature()` middleware + `useTenantFeatures` hook — wired end-to-end. New system has 40+ catalog entries, plan-to-feature mapping, per-tenant overrides, and admin UI pages that save/delete against those tables; plus `entitlementService.getTenantEntitlements()` with precedence logic (override → plan → core → deny) and `entitlementEnforcement.assertFeatureAccess()` / `assertFeatureCapacity()`.
- **What is actually enforced**: Legacy middleware reads the legacy table and blocks routes. The new system is not read anywhere — `entitlementService` and `entitlementEnforcement` have zero callers.
- **What is duplicated / missing / drifting**: `quotes` appears in both systems under different keys (`quotesEnabled` legacy vs `quotes` new); `invoices`/`invoicesEnabled`, `scheduling_calendar`/`calendarEnabled`, `quickbooks_online`/`qboEnabled`, `customer_portal`/`customerPortalEnabled` — same story. The new catalog has 35+ features (`pm_contracts`, `gps_status`, `payroll_reports`, `branches`, `api_access`, etc.) that have no runtime gate anywhere. Legacy keys `routeOptimizationEnabled`, `liveMapEnabled`, `customerPortalPaymentsEnabled` have no counterpart in the new catalog.
- **Real risk**: An admin disables "pm_contracts" in the new Features Catalog. Nothing happens — tenant keeps full PM access. An admin enables "calendarEnabled" in the legacy tenant-features table. Calendar works. The two admin UIs exist in the same platform console; admins cannot tell which one is load-bearing.
- **Recommended direction**: Decide which system is canonical. If the new one, migrate the 9 legacy keys into the new catalog under canonical names, rewrite `requireFeature` to consult `entitlementService`, and remove the legacy table. If the legacy one, delete the unused entitlement service, storage, and admin pages. Do not ship both to production.
- **Confidence**: High

### Finding #3: Limit enforcement is missing for every entity except client locations
- **Severity**: Critical
- **Category**: Limit / Dead System
- **Files/routes/components involved**:
  - Enforced: `server/storage/subscriptions.ts:173-252` (`canAddLocation`), `server/routes/clients.ts:298-302, 394-397`, `server/routes/clientImport.ts:231-234`
  - Not enforced: `server/routes/team.ts:190` (user/technician create), `server/routes/recurringJobs.ts:193` (PM templates), `server/routes/invitations.ts` (user accept), equipment create routes
  - Dead: `server/services/entitlementEnforcement.ts` (`assertFeatureCapacity`, `assertFeatureCapacityAuto` exported, zero callers)
  - Dead: `server/services/usageMetricsService.ts` (`countOfficeUsers`, `countTechnicianUsers`, `countTotalUsers`, `countPmContracts`, `countEquipment` — all counters exist, only `countClients` is invoked)
- **What currently exists**: `usageMetricsService.ts` exposes counters for 6 entities with 1-minute caching; `entitlementEnforcement.assertFeatureCapacity()` compares usage to plan/override limits; `subscriptionPlanFeatures.limitValue` + `tenantFeatureOverrides.limitValue` store per-feature caps.
- **What is actually enforced**: `POST /api/clients` and `POST /api/clients/full-create` call `canAddLocation()`; bulk import checks once upfront. Every other limitable create path inserts without consulting any limit.
- **What is duplicated / missing / drifting**: The location limit uses the LEGACY `subscriptionPlans.locationLimit` column and its own COUNT query inside `canAddLocation()` — it does NOT use `usageMetricsService.countClients()` or the new per-feature limit system. Two counting systems for the same entity. All other "limitable" entities have counting infrastructure and limit storage but zero enforcement wiring.
- **Real risk**: A tenant on a plan with "technician_users = 5" can create unlimited technicians. Bulk import of clients can overshoot the cap under concurrent writes (upfront-only check). The admin UI lets admins set limits that have no effect.
- **Recommended direction**: Route every limitable-create through the existing `assertFeatureCapacity` helper, then unify location enforcement onto the same path (retiring `subscriptionPlans.locationLimit` and the duplicate COUNT query). Decide whether bulk-import should re-check per-row or use a transactional reservation.
- **Confidence**: High

### Finding #4: Two subscription-state columns with no synchronization
- **Severity**: High
- **Category**: Plan / Frontend-Backend Drift
- **Files/routes/components involved**:
  - `companies.subscriptionStatus`, `companies.trialEndsAt`, `companies.subscriptionPlan` (runtime gate)
  - `tenantSubscriptions.status`, `tenantSubscriptions.billingCycle`, `tenantSubscriptions.endDate` (billing audit)
  - Writers on `companies.*`: `server/services/onboardingService.ts:76`, `server/routes/admin.ts:662`
  - Writers on `tenantSubscriptions.*`: `server/storage/subscriptionBilling.ts:132-285` (signup, cancel, setAutoRenew), `server/services/subscriptionWorker.ts:256-301` (renew/revert)
  - Reader (runtime): `server/storage/subscriptions.ts:47-74` (`computeEntitlement`) reads only `companies.*`
  - Reader (UI-only): `GET /api/subscriptions/me` reads `tenantSubscriptions`
- **What currently exists**: Two distinct lifecycles — a coarse "runtime access state" on the companies row and a fine-grained billing-cycle row in `tenantSubscriptions`.
- **What is actually enforced**: Runtime gates consult `companies.subscriptionStatus` + `trialEndsAt` only. `tenantSubscriptions.status` drives worker-based annual renewal and is displayed in UI, but nothing reads it for access control.
- **What is duplicated / missing / drifting**: No code enforces consistency between the two. An admin cancelling via `tenantSubscriptions.cancel()` does not flip `companies.subscriptionStatus`. An admin setting `companies.subscriptionStatus="active"` does not create a `tenantSubscriptions` row. A trial tenant has no `tenantSubscriptions` row at all.
- **Real risk**: Admin panels and billing logic show one status while runtime enforcement shows another. A tenant whose `tenantSubscriptions.status="cancelled"` may still have runtime access because `companies.subscriptionStatus="trial"`.
- **Recommended direction**: Pick one source of truth. Either (a) drive `companies.subscriptionStatus` from `tenantSubscriptions` transitions (add webhooks/worker logic + a backfill), or (b) stop writing `tenantSubscriptions.status` and treat the table as a pure billing-cycle ledger keyed off `companies.subscriptionStatus`.
- **Confidence**: High

### Finding #5: Stripe webhook does not update subscription state
- **Severity**: High
- **Category**: Plan
- **Files/routes/components involved**:
  - `server/routes/stripeWebhook.ts:293-368`
  - States mentioned in `computeEntitlement()` but never written: `past_due`, `paused`, `active` (via Stripe path)
- **What currently exists**: Webhook handles `payment_intent.succeeded`, `charge.refunded`, `payment_intent.payment_failed` — all as ledger entries on the invoice-payment layer.
- **What is actually enforced**: Nothing touches `companies.subscriptionStatus` or `tenantSubscriptions.status` from the webhook.
- **What is duplicated / missing / drifting**: The entire "subscription lifecycle driven by Stripe" path is missing. `computeEntitlement()` recognizes `past_due` and `paused`, but those values are unreachable except via admin PATCH.
- **Real risk**: A tenant whose Stripe subscription fails → Stripe marks the subscription past-due → Syntraro runtime has no signal. The tenant continues to enjoy full access until an admin manually PATCHes `companies.subscriptionStatus`. This is a revenue-integrity gap — the system behaves as if it were Stripe-integrated but is not.
- **Recommended direction**: Decide whether Stripe is the source of truth for subscription state. If yes, extend the webhook to update `companies.subscriptionStatus` on `customer.subscription.*` events. If no, document that subscription state is admin-managed and remove the dead `past_due`/`paused` branches from `computeEntitlement()`.
- **Confidence**: High

### Finding #6: Trial expiration is compute-on-read with no event or state change
- **Severity**: Medium
- **Category**: Trial / Plan
- **Files/routes/components involved**:
  - `server/storage/subscriptions.ts:47-74` (`computeEntitlement` does the `trialEndsAt < now` check at every request)
  - `server/services/subscriptionWorker.ts:372-407` (worker processes `tenantSubscriptions` only — not companies trial)
- **What currently exists**: Trial expiration is detected at request time; no state column is updated; no row is written to `subscriptionEvents`; no notification is sent.
- **What is actually enforced**: The entitlement check blocks access silently at the moment of the next API call after `trialEndsAt` passes.
- **What is duplicated / missing / drifting**: No expiration email, no dashboard notice other than the client-side `SubscriptionBanner` (which computes its own `daysRemaining` from the same compute-on-read model), no audit trail of when a tenant transitioned from trial-active → trial-expired.
- **Real risk**: Tenants who let the trial lapse get a cold 403 on their next write without any warning ≤7 days in-app and no email. Support cannot easily answer "when did this tenant's trial expire" without reconstructing timestamps.
- **Recommended direction**: Either (a) add a daily job that fires `trial.expired` on `subscriptionEvents` + an email on `trialEndsAt` crossing, or (b) keep compute-on-read but persist the transition on first detection so it shows up in audit and history.
- **Confidence**: High

### Finding #7: `requireFeature` fails open on error
- **Severity**: High
- **Category**: Entitlement
- **Files/routes/components involved**:
  - `server/auth/requireFeature.ts:17-70`
- **What currently exists**: The middleware wraps the lookup in try/catch and falls through to `next()` on any thrown error.
- **What is actually enforced**: The middleware denies when the lookup returns false. It allows when the lookup throws.
- **What is duplicated / missing / drifting**: Fail-open is the wrong default for a security gate. A transient DB error becomes a bypass.
- **Real risk**: DB outage or repository bug silently enables gated features. Low-probability but high-impact; also hides intermittent regressions.
- **Recommended direction**: Change to fail-closed (default deny on error), with explicit logging. Exempt idempotent read-only endpoints only if there is a documented reason.
- **Confidence**: High

### Finding #8: `subscriptionPlan` is a string reference without a foreign key
- **Severity**: Medium
- **Category**: Plan
- **Files/routes/components involved**:
  - `companies.subscriptionPlan` (text column, no FK)
  - `server/storage/subscriptions.ts` (resolution)
  - `subscriptionPlans.name` (target table)
- **What currently exists**: Runtime resolves plan via `SELECT ... FROM subscriptionPlans WHERE name = companies.subscriptionPlan`. If the plan string doesn't match any row, `plan` returns null and `computeEntitlement` returns `NO_PLAN` (blocked).
- **What is actually enforced**: Correct name → entitlement resolves. Wrong name → silent block.
- **What is duplicated / missing / drifting**: A 2026-04-19 migration was required to backfill `subscriptionPlan = "trial"` on existing signups; the fix is still a naked string reference. New signups are fine going forward, but any admin-written plan name (typo, renamed plan) breaks entitlement silently.
- **Real risk**: Renaming a plan in `subscriptionPlans.name` orphans every tenant referencing it. No FK enforces the relationship.
- **Recommended direction**: Either (a) migrate to FK to `subscriptionPlans.id` (breaking but clean), or (b) add a validation guard that rejects admin writes to `companies.subscriptionPlan` where no matching row exists.
- **Confidence**: High

### Finding #9: `userPermissionOverrides` is write-less dead code
- **Severity**: Medium
- **Category**: Permission / Dead System
- **Files/routes/components involved**:
  - `shared/schema.ts:3018-3034` (table)
  - `server/storage/permissions.ts:62-78` (getter; merges into `getUserEffectivePermissions`)
- **What currently exists**: Table, type, repository getter, merge logic in effective-permission computation.
- **What is actually enforced**: Read path works. But there is no admin UI, no API endpoint, and no service method to create an override.
- **What is duplicated / missing / drifting**: The "user-level permission override" feature described in CLAUDE.md is aspirational. Rows can only appear via direct DB edit.
- **Real risk**: Platform maintainers assume per-user permission tuning works. It doesn't. Any UI element that implies "override this user's permissions" is nonfunctional today.
- **Recommended direction**: Either build the write path (API + admin UI) or delete the table, repository reads, and merge logic.
- **Confidence**: High

### Finding #10: Platform admin silently bypasses feature gates
- **Severity**: Medium
- **Category**: Admin / Frontend-Backend Drift
- **Files/routes/components involved**:
  - `server/auth/requireFeature.ts:17-35` (early-return on `isPlatformRole`)
- **What currently exists**: Any user whose role is in `PLATFORM_ROLES` passes `requireFeature` unconditionally, even when impersonating.
- **What is actually enforced**: Platform admins see gated features as enabled when acting on a tenant; tenant users hit 403 on the same feature.
- **What is duplicated / missing / drifting**: Intentional for support, but not consistently applied — `canAddLocation()` does NOT have a parallel bypass, and neither do the in-route inline feature checks (`server/routes/portal.ts` portal-enabled branches). So platform admins can use features but not always create entities within them.
- **Real risk**: Support agent reproduces a user issue by impersonating; cannot reproduce a feature-gate denial because the gate doesn't fire. Support tickets mis-diagnosed.
- **Recommended direction**: Either (a) make the bypass explicit across all entitlement/limit checks (consistent), or (b) drop it and require support to flip the feature manually via admin PATCH when diagnosing. Document whichever choice is made.
- **Confidence**: High

### Finding #11: Frontend feature cache is eventually consistent, not transactionally consistent
- **Severity**: Low
- **Category**: Frontend-Backend Drift
- **Files/routes/components involved**:
  - `client/src/hooks/useTenantFeatures.ts:32` (`staleTime: 5 * 60_000`)
  - `server/storage/tenantFeatures.ts` (server cache — 15 min)
- **What currently exists**: Client caches `tenantFeatures` for 5 minutes; server caches for 15 minutes.
- **What is actually enforced**: Backend `requireFeature` reads through server cache; client sees stale data until the client cache expires or an invalidation is triggered.
- **What is duplicated / missing / drifting**: Admin disables a feature; UI still shows it enabled for up to 5 minutes. User clicks; backend returns 403 `FEATURE_DISABLED`. Small confusion window; eventual consistency.
- **Real risk**: Low. Cosmetic confusion on admin-initiated feature toggles.
- **Recommended direction**: If the gap matters, emit an SSE/broadcast on feature change to invalidate client caches. Otherwise document and accept.
- **Confidence**: High

### Finding #12: Subscription state enum mismatch
- **Severity**: Medium
- **Category**: Plan
- **Files/routes/components involved**:
  - `shared/schema.ts:4076` (`subscriptionStatusEnum = ["active", "pending_renewal", "cancelled"]` — strictly typed, applies to `tenantSubscriptions.status`)
  - `companies.subscriptionStatus` (text column, not enum) — actually receives `"trial"`, `"trialing"`, `"active"`, `"past_due"`, `"paused"`, `"cancelled"`, `"internal"`
- **What currently exists**: The new table has a strict Zod enum. The legacy column on `companies` is free-form text, and the code handles at least 7 values.
- **What is actually enforced**: Nothing prevents an admin from writing an unknown string into `companies.subscriptionStatus`.
- **What is duplicated / missing / drifting**: `"trial"` vs `"trialing"` — both appear in code (the latter as a runtime recognition fallback). If they drift, entitlement computation diverges.
- **Real risk**: Inconsistent normalization. Hard to reason about exhaustiveness of status checks in `computeEntitlement`.
- **Recommended direction**: Introduce a single shared enum for runtime subscription states and enforce it at the schema level. Consolidate `trial` vs `trialing`.
- **Confidence**: High

### Finding #13: Bulk import limit check is upfront-only and not transactional
- **Severity**: Medium
- **Category**: Limit
- **Files/routes/components involved**:
  - `server/routes/clientImport.ts:231-247` (upfront check, then unguarded per-row loop)
- **What currently exists**: Import calls `canAddLocation()` once before iterating.
- **What is actually enforced**: The upfront check covers the batch size intent, but another session creating clients concurrently can push the tenant past the cap before the import finishes.
- **What is duplicated / missing / drifting**: No per-row recheck, no transactional reservation.
- **Real risk**: Low probability per import (depends on concurrency), but real — the cap is not actually a hard cap under load.
- **Recommended direction**: Either re-check within the per-row transaction or use a single `SELECT ... FOR UPDATE` + `INSERT ... WHERE` pattern that atomically reserves the slot.
- **Confidence**: High

### Finding #14: `locationLimit` legacy column vs new limit system — two sources for one entity
- **Severity**: Medium
- **Category**: Limit
- **Files/routes/components involved**:
  - `subscriptionPlans.locationLimit` (legacy column, live)
  - `subscriptionPlanFeatures.limitValue` for feature `locations` (new system, unused)
  - `server/storage/subscriptions.ts:canAddLocation()` (reads legacy column + own COUNT query)
  - `server/services/usageMetricsService.ts:countClients()` (counter, not called by canAddLocation)
- **What currently exists**: One entity, two independent limit-storage locations and two independent counting implementations.
- **What is actually enforced**: The legacy column drives today's behavior.
- **What is duplicated / missing / drifting**: If admins start setting limits in the new system's locations feature, nothing happens. If the two COUNT queries diverge (e.g., filters change), numbers reported to UI vs enforced at create time will disagree.
- **Real risk**: Maintenance trap. Inconsistent counts possible.
- **Recommended direction**: Unify onto one limit storage and one counter. Most logical target is the new per-feature system (aligns with the direction of Finding #2 and #3).
- **Confidence**: High

### Finding #15: `multiTechEnabled`, `routeOptimizationEnabled`, `liveMapEnabled` — configurable but near-dead
- **Severity**: Low
- **Category**: Entitlement / Dead System
- **Files/routes/components involved**:
  - `tenantFeatures` columns (exist, admin-configurable)
  - `requireFeature.ts:57-70` (display-name lookup includes them)
  - Only caller of `multiTechEnabled`: `server/routes/scheduling.ts:1068` (one endpoint)
  - `routeOptimizationEnabled`, `liveMapEnabled`: no callers
- **What currently exists**: Admin UI lets you toggle; tenant_features row stores the values.
- **What is actually enforced**: `multiTechEnabled` gates exactly one endpoint (crew assignment). `routeOptimizationEnabled` and `liveMapEnabled` gate nothing.
- **What is duplicated / missing / drifting**: Admin can disable "Live Map" for a tenant — tenant still sees it work.
- **Real risk**: Misleading admin UX. Support cannot toggle these off effectively.
- **Recommended direction**: Either wire the gates into the routes they claim to govern (route optimization service, live map endpoints, all multi-tech surfaces), or remove the flags.
- **Confidence**: High

### Finding #16: `UserSubscriptionDialog` may be legacy / disconnected
- **Severity**: Low
- **Category**: Dead System
- **Files/routes/components involved**:
  - `client/src/components/UserSubscriptionDialog.tsx` writes to `PATCH /api/admin/users/:id/subscription`
  - Server-side handler: not located in this audit
- **What currently exists**: An admin dialog allowing per-user subscription plan assignment.
- **What is actually enforced**: Unknown — the target endpoint was not found in the audit.
- **What is duplicated / missing / drifting**: "Subscription on a user" is not a concept that matches either of the two real subscription systems (both are tenant-scoped). Likely leftover from an earlier data model.
- **Real risk**: Admin interaction lands on a possibly-missing endpoint.
- **Recommended direction**: Verify the endpoint exists; if it does, inspect what it writes. If not, remove the dialog.
- **Confidence**: Low (depends on unaudited route)

---

## 4. Limit Enforcement Matrix

| Entity / feature | Limit exists? | Stored where | Counted where | Enforced where | Backend enforced? | UI enforced? | Bypass risk | Notes |
|---|---|---|---|---|---|---|---|---|
| Client locations | Yes | `subscriptionPlans.locationLimit` (legacy) | `canAddLocation()` inline COUNT + `usageMetricsService.countClients()` (unused) | `POST /api/clients`, `POST /api/clients/full-create`, `POST /api/client-import/execute` | Yes | Unknown | Bulk import upfront-only (concurrent overshoot possible); two parallel counters | Finding #14 |
| Office users | Yes (catalog) | `subscriptionPlanFeatures.limitValue` | `usageMetricsService.countOfficeUsers()` | **Nowhere** | **No** | Unknown | Unlimited office users regardless of plan | |
| Technician users | Yes (catalog) | `subscriptionPlanFeatures.limitValue` | `usageMetricsService.countTechnicianUsers()` | **Nowhere** | **No** | Unknown | Unlimited technicians regardless of plan | `POST /api/team` skips limit check |
| Total users | Yes (catalog) | `subscriptionPlanFeatures.limitValue` | `usageMetricsService.countTotalUsers()` | **Nowhere** | **No** | Unknown | Invitation accept flow does not check | |
| PM contracts | Yes (catalog) | `subscriptionPlanFeatures.limitValue` for `pm_contracts` | `usageMetricsService.countPmContracts()` | **Nowhere** | **No** | Unknown | `POST /api/recurring-templates` skips limit check | |
| Equipment | Yes (catalog) | `subscriptionPlanFeatures.limitValue` | `usageMetricsService.countEquipment()` | **Nowhere** | **No** | Unknown | Equipment create route never consults limit | |
| Jobs / invoices / quotes / clients (counts) | No | — | — | Feature-enabled gate only (boolean) | No | No | N/A | Unlimited by design? Or missing limit? Undocumented. |
| Integrations (QBO) | Boolean only | `tenantFeatures.qboEnabled` | N/A | `requireFeature("qboEnabled")` + inline check in `maybeSyncPayment.ts:87` | Yes (boolean) | Yes (hook) | None | Fully enforced |

---

## 5. Permission Enforcement Matrix

| Action / surface | Who should be allowed | What currently enforces it | Backend enforced? | UI enforced? | Drift / duplicate notes |
|---|---|---|---|---|---|
| Office mutations (`POST/PATCH/PUT/DELETE /api/<resource>/*`) | `MANAGER_ROLES` | `requireRole(MANAGER_ROLES)` | Yes | Yes (client role mirror) | Clean |
| Team member CRUD | `RESTRICTED_MANAGER_ROLES` + owner-protection guards | `requireRole(RESTRICTED_MANAGER_ROLES)` + `assertLastOwnerProtection()` + `assertNoSelfLockout()` | Yes | Partial | Clean |
| Scheduling mutations | `MANAGER_ROLES` + `assertCanEditSchedule` | `requireRole(MANAGER_ROLES)` + `assertCanEditSchedule(req.user)` | Yes | Partial | Clean |
| Tech field app (`/api/tech/*`) | Any role with `isSchedulable=true` | `requireSchedulable()` | Yes | Yes (tech-app scope) | Boundary is schedulability, not role |
| Tech cross-tech visibility (`GET /api/tech/visits/today?scope=all`) | Permission `schedule.all.view` | `userHasPermission(userId, "schedule.all.view")` | Yes | Unknown | Only live use of DB permission system |
| Platform admin (`/api/platform/*`) | `PLATFORM_ROLES` | `requirePlatformRole()` | Yes | Yes | Clean |
| Tenant-route access from platform roles | Forbidden unless support session | `ensureTenantContext` denial + audit log | Yes | N/A | Clean |
| Support read-only session mutations | Forbidden | `enforceReadOnlySupport` HTTP + `assertWritableSupportContext` service layer | Yes (defense-in-depth) | N/A | Clean |
| Granular permissions (24 keys) via `requirePermission()` | Permission assigned in DB | **Not enforced — middleware never called** | **No** | Manage Roles page implies yes | Data-only system |
| User permission overrides | Per-user grant/revoke | **Not enforced — no writer exists** | **No** | None | Full dead code |
| Office feature gating (e.g., invoices, quotes, calendar, QBO) | Tenant with feature = true | `requireFeature()` legacy | Yes (4-5 features) | `useTenantFeatures` hook | Only 4-5 of 40 catalog features enforced |
| New entitlement check (`entitlementEnforcement.assertFeatureAccess`) | Tenant entitled per plan+override | **Not called** | **No** | Admin UI implies yes | Dead path |
| Role management (create/edit role+permissions) | `ADMIN_ROLES` | `requireRole(ADMIN_ROLES)` | Yes | Yes | Writes to a system that is not enforced |

---

## 6. Trial / Plan Runtime Matrix

| Tenant state | Expected access | Current runtime behavior | Where enforced | Drift / risk |
|---|---|---|---|---|
| `subscriptionStatus="trial"`, `trialEndsAt` in future | Full access (trial) | `computeEntitlement → TRIAL_ACTIVE, entitled=true`. Legacy features enabled. Location limit from plan (usually "trial" plan). | `computeEntitlement` + `canAddLocation` + `requireFeature` (legacy) | `tenantSubscriptions` row absent; banner shows if ≤7 days |
| `subscriptionStatus="trial"`, `trialEndsAt` in past | Blocked | `computeEntitlement → TRIAL_EXPIRED, entitled=false`. `canAddLocation` blocks with "Your free trial has expired." | `canAddLocation` + `computeEntitlement` | **No state transition recorded**; admin must manually flip to "active" or "cancelled" |
| `subscriptionStatus="active"` | Full access (paid) | `computeEntitlement → PAID_ACTIVE, entitled=true`. Ignores `trialEndsAt`. Plan features enabled. | `computeEntitlement` | Only written by admin PATCH or signup — never by Stripe |
| `subscriptionStatus="cancelled"` | Blocked | `computeEntitlement → SUBSCRIPTION_INACTIVE, entitled=false`. Location creates blocked. | `canAddLocation` | Annual subs should continue to endDate per docstring, but status flips immediately to cancelled — UI/logic may contradict |
| `subscriptionStatus="past_due"` | Blocked (intended) | `computeEntitlement → SUBSCRIPTION_INACTIVE`. **But nothing writes this value** — Stripe webhook does not. | `computeEntitlement` (dead branch) | Dead state — unreachable by automation |
| `subscriptionStatus="paused"` | Blocked | Same as past_due — dead branch | `computeEntitlement` (dead branch) | Dead state |
| `subscriptionStatus="internal"` | Full (platform tenant) | Not matched by `computeEntitlement` — unclear result | Filtering in platform tenant search | Dead state for entitlement purposes |
| `subscriptionPlan=null` | Blocked | `computeEntitlement → NO_PLAN, entitled=false`. All access blocked. | `computeEntitlement` | Silent config footgun — typo in plan name = tenant locked out |
| `tenantSubscriptions.status="pending_renewal"` (annual) | Full access | Not read by any access gate; UI-only | — | Drift possible with `companies.subscriptionStatus` |
| `tenantSubscriptions.status="cancelled"` (annual, access through endDate) | Full access until endDate | Not read by any access gate; UI-only | — | If `companies.subscriptionStatus` was also flipped, gates block. If not, nothing changes. |
| Platform admin impersonating tenant | Tenant's access (by design) | Entitlement reads impersonated companyId; `requireFeature` short-circuits for platform role | `tenantIsolation` + `requireFeature` bypass | Inconsistent: feature gate bypassed, limit gate not bypassed |

---

## 7. Admin-to-Runtime Mapping

| Admin setting / feature / limit | Where it is configured | Where runtime reads it | Actually live? | State |
|---|---|---|---|---|
| Tenant feature flags (9, legacy) | `PATCH /api/admin/tenants/:id/features`, `PATCH /api/platform/tenants/:id/features` → `tenantFeatures` row | `requireFeature()` + `useTenantFeatures` hook | Yes (for the 4-5 features that gate routes) | Complete for gated features; admin-data-only for `routeOptimizationEnabled` / `liveMapEnabled` |
| Feature catalog (40 new features) | `POST/PATCH /api/platform/features` → `subscriptionFeatures` row | **Nothing reads it at runtime** | No | Dead |
| Plan-to-feature assignment | `PUT /api/platform/plans/:planId/features/:featureId` → `subscriptionPlanFeatures` row | Only `entitlementService.getTenantEntitlements()` (unused) | No | Dead |
| Per-tenant feature override | `PUT /api/tenants/:tenantId/overrides/:featureKey` → `tenantFeatureOverrides` row | Only `entitlementService.getTenantEntitlements()` (unused) | No | Dead |
| Per-tenant limit override | Same override endpoint with `limitValue` | Only `entitlementEnforcement.assertFeatureCapacity()` (unused) | No | Dead |
| Tenant subscription status / plan | `PATCH /api/admin/tenants/:id/billing`, `PATCH /api/platform/tenants/:id/subscription` → `companies.subscriptionStatus/Plan/trialEndsAt` | `computeEntitlement` + `canAddLocation` | Yes | Complete |
| Plan definitions (name, locationLimit, etc.) | `subscriptionPlans` table (admin tooling) | `canAddLocation` | Yes (for `locationLimit`); partial otherwise | Partial |
| Roles (DB-based) | `POST/PUT/DELETE /api/roles` | Only `userHasPermission(..., "schedule.all.view")` (one caller) | Barely | Near-dead |
| Permissions catalog (36) | Seeded on `GET /api/roles` | Only via `getUserEffectivePermissions` — consumer is `requirePermission` which is unused | No | Dead |
| User permission overrides | No admin UI / API | Read by `getUserEffectivePermissions` | Partially (no write path) | Dead |
| Company subscription plan name | `PATCH /api/platform/tenants/:id/subscription` writes string | `companies.subscriptionPlan` looked up in `subscriptionPlans.name` | Yes | Load-bearing text reference (no FK) |
| Stripe customer/subscription IDs | `companies.stripeCustomerId/stripeSubscriptionId` | Referenced but webhook does not update status | Partial | Present but not load-bearing for state |

---

## 8. Dead / Partial Systems

**Fully dead:**
- `server/permissions.ts:requirePermission()` — middleware defined; zero callers.
- `server/services/entitlementService.ts:getTenantEntitlements()` and companions — resolver built 2026-04-19; zero runtime callers.
- `server/services/entitlementEnforcement.ts:assertFeatureAccess/assertFeatureCapacity/assertFeatureCapacityAuto` — zero callers.
- `userPermissionOverrides` table — read path exists; no write path anywhere.
- `subscriptionStatus` values `past_due`, `paused`, `internal` — branches exist in `computeEntitlement`; never written.
- Per-entity counters in `usageMetricsService` for `office_users`, `technician_users`, `total_users`, `pm_contracts`, `equipment` — counters exported; only `countClients` has a caller.

**Partial:**
- New entitlement system (`subscriptionFeatures` + `subscriptionPlanFeatures` + `tenantFeatureOverrides`): storage + admin UI + service layer exist, but no consumer.
- `tenantSubscriptions` lifecycle: worker + storage + audit write; not read by runtime gates.
- Stripe integration: webhook handles payment events only; no subscription-state synchronization.
- Limit system: infrastructure complete; only `canAddLocation` actually enforces.
- DB permission system: seeded, stored, partially merged; only `schedule.all.view` consulted.

**Misleading:**
- `PlatformFeaturesCatalog.tsx` / `PlatformFeatureDetail.tsx` — UIs that save to rows that nothing reads. Appears to configure runtime behavior; doesn't.
- `ManageRoles.tsx` (`/api/roles` endpoints) — UI lets admins assign permissions; no runtime effect except on one tech-visit scope check.
- `UserSubscriptionDialog.tsx` — writes to `/api/admin/users/:id/subscription`; target endpoint not located by audit; likely legacy.
- `tenantFeatures` display-name lookup in `requireFeature.ts:57-70` — includes `routeOptimizationEnabled` and `liveMapEnabled` which are never checked.

---

## 9. Top Remediation Priorities

Ranked by architectural leverage and drift risk, not by implementation size.

1. **Collapse the dual feature-entitlement systems.** Pick one (legacy or new) and route every feature decision through it. Until then, every admin toggle in the wrong UI is silently inert. (Findings #2, #15)
2. **Wire limit enforcement for every counted entity.** The `assertFeatureCapacity` helper exists. The counters exist. Routes that create technicians, users, PM contracts, and equipment need to call one of the two. (Finding #3)
3. **Resolve the subscription-state duality.** Either drive `companies.subscriptionStatus` from `tenantSubscriptions` transitions, or drop `tenantSubscriptions` from UI display and treat it as pure ledger. The current "two columns, no sync" is a drift trap. (Findings #4, #12)
4. **Close the Stripe integration gap.** If Stripe is the billing provider, its webhook must update subscription state. Otherwise, document that subscription state is admin-managed and remove the dead `past_due`/`paused` branches. (Finding #5)
5. **Eliminate the dual permission systems.** Either retire the DB permission system + Manage Roles UI, or wire `requirePermission` into routes and build the user-override write path. Do not leave both alive. (Findings #1, #9)
6. **Make `requireFeature` fail closed.** Change the `catch → next()` to `catch → deny` (Finding #7).
7. **Record trial-expired transitions.** Replace compute-on-read with a worker + event. Improves audit, notifications, and UI correctness. (Finding #6)
8. **Fix the location-limit duplicate counting.** Unify `canAddLocation()` onto `usageMetricsService.countClients()` and onto whichever limit-storage survives consolidation. (Finding #14)
9. **Add the bulk-import per-row or transactional limit check.** Current upfront-only check is a soft cap. (Finding #13)
10. **Enforce `subscriptionPlan` → `subscriptionPlans.name` integrity.** Either FK or validation guard; the current naked text reference is a silent lockout waiting to happen. (Finding #8)

---

## 10. Open Questions

1. **Is there a real Stripe subscription integration on a branch we haven't audited?** The codebase has `stripeCustomerId`, `stripeSubscriptionId` columns but no `customer.subscription.*` webhook handling. It is unclear whether this is in-progress work, abandoned, or the payment-ledger pattern is the intended design. Needs product-owner clarification.

2. **Target endpoint of `UserSubscriptionDialog`.** The dialog writes to `PATCH /api/admin/users/:id/subscription`; no such route was located. Is the endpoint mounted elsewhere, or is the dialog dead?

3. **Intended access for `subscriptionStatus = "internal"`.** One tenant row uses this value (platform internal); `computeEntitlement` does not have an explicit branch for it. What access do internal tenants get at runtime today?

4. **Intended behavior of `tenantSubscriptions.status="cancelled"` for annual subs.** Docstring says access continues to `endDate`; the status column is flipped immediately. Which one is the intended behavior — and where is it enforced?

5. **Plan-vs-entitlement in admin UX.** `PlatformTenantDetail` exposes both legacy feature toggles (live) and per-feature entitlement overrides (dead). From a platform admin's mental model, are these intended to be the same thing with two UIs, or two different levels of control? Product intent will shape which dies.

6. **Tech-app cross-tech visibility permission.** The one live permission check (`userHasPermission(userId, "schedule.all.view")`) is a single, narrow use of a large system. Was this permission intended to be the seed of a broader rollout, or a one-off expedient?

7. **PM contract limit semantics.** `countPmContracts()` counts `recurring_job_templates` including archived/inactive. Is that the intended billable metric, or should it filter by status? The new system's `limitValue` has no documented semantics here.
