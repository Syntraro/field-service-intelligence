# Canonical Entitlement & Subscription Architecture

## Entitlement Resolver

**Entry point:** `entitlementService.getTenantEntitlements(companyId)`

Returns: `{ companyId, planId, planName, entitlements: [{ featureKey, enabled, isCore, isUnlimited, limitValue, source, ... }] }`

**Precedence:** `tenant_override` → `plan_feature` → `isCore` → deny.

Do NOT read from `tenant_features` columns directly — the legacy table is kept alive as a compat surface only; reads diverge from override state.

## Server Middleware

- `requireFeature(key)` — translates legacy camelCase via `LEGACY_TO_CANONICAL_KEY` → canonical snake_case → resolver. **Fail-closed:** resolver errors return HTTP 500. If you write a new gate, fail closed.
- `assertFeatureCapacity(companyId, featureKey, currentCount, 1)` — use on create paths.
- `assertFeatureCapacityAuto(...)` — auto-counts via `usageMetricsService`.

## Client Foundation

- `GET /api/me/entitlements` + `useEntitlements` hook.
- `GET /api/me/permissions` + `useEffectivePermissions` hook.

## Permission Model

Two-layer gate — both required on every protected route:

1. **Coarse role gate** (`requireRole(ADMIN_ROLES)`) — code-based, fast, no DB read. Role string on `users.role`.
2. **Fine permission gate** (`requirePermission("permissions.manage")`) — DB-backed. Sits BEHIND the coarse gate. Role permissions + per-user `user_permission_overrides` merged into an effective set. Overrides support `grant`, `revoke`, `inherit`. Admin cannot edit their own overrides (anti-lockout).

New fine-gates MUST be added BEHIND (not replacing) the coarse gate. Never drop `requireRole(...)`.

## Subscription Writer

`subscriptionLifecycleService.transition({ companyId, to, trialEndsAt, source, reason, actorUserId })` is the SOLE writer of `companies.subscriptionStatus` + `companies.trialEndsAt`.

It:
1. Validates the transition against `ALLOWED_TRANSITIONS`.
2. Writes the new status.
3. Appends a `subscription_events` audit row (`type='status_changed'`).
4. Invalidates the resolver cache.

Every path that changes subscription status (admin PATCH, platform PATCH, trial-expire worker) must route through it. The only carve-out is `onboardingService.createCompanyWithOwner` for birth-state seeding.

## Plan-Name Guard

`PATCH /api/platform/tenants/:id/subscription` rejects unknown `subscriptionPlan` at HTTP 400. This prevents orphan plan strings on `companies.subscription_plan`.

## Trial Expiration

Compute-on-read at the entitlement gate. `trialExpireWorker` emits a one-shot `trial_expired` audit event per tenant but does NOT mutate `subscriptionStatus`.

## What NOT To Do

- Do NOT write `companies.subscriptionStatus` or `companies.trialEndsAt` directly.
- Do NOT read feature state from `tenant_features` columns.
- Do NOT drop `requireRole(...)` when adding `requirePermission(...)`.
- Do NOT silently pass on resolver errors — fail closed.
