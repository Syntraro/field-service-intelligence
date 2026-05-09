# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Change Tracking (MANDATORY)

Every code change MUST include:
1. **CHANGELOG.md** — Update `/CHANGELOG.md` under `## [Unreleased]`: what changed, files affected, migration files created, breaking changes.
2. **Migration file** — For database changes: create `migrations/DESCRIPTION.sql` with run instructions as a header comment, then document in CHANGELOG.md.
3. **Code comments** — Only for non-obvious invariants: JSDoc on new public functions, one-line note on workarounds or subtle bug fixes.

This applies to ALL changes across all sessions. No exceptions.

## Project Overview

HVAC/R preventive maintenance scheduling SaaS — manages client contracts, scheduling, inventory, job dispatch, invoicing, and QuickBooks Online sync.

## Development Commands

### Build & Run
```bash
npm run dev          # Start development server (backend + Vite)
npm run build        # Build frontend and backend for production
npm start            # Run production build
npm run check        # Type-check TypeScript without emitting files
```

### Database
```bash
npm run db:migrate       # Apply all pending SQL migrations
npm run db:migrate:one -- migrations/FILE.sql  # Apply a single migration
npm run db:sanity        # Check database connectivity
npm run db:check         # Detect schema drift (Drizzle vs live DB)
```

**All schema changes use SQL migration files only.** Never use `drizzle-kit push` — it is interactive and breaks CI/CD. Full rules: `docs/workflows/database.md`.

The Drizzle schema in `shared/schema.ts` is the TypeScript type source of truth; schema changes are applied via SQL files, not `drizzle-kit push`.

### Environment Variables
- `DATABASE_URL` — Neon PostgreSQL connection string
- `SESSION_SECRET` — Session encryption secret (required in production)
- `NODE_ENV` — `"production"` or `"development"`

## Architecture Invariants

### Multi-Tenancy
- Every database query MUST filter by `companyId` from the authenticated user.
- `companies` is the tenant root. All data (`users`, `clients`, `jobs`, `invoices`, etc.) is scoped to `companyId`.
- Isolation middleware: `server/auth/tenantIsolation.ts`.
- Never expose cross-tenant data under any condition.

### Authentication & Authorization
- Auth: Passport.js local strategy, bcrypt, PostgreSQL-backed sessions (connect-pg-simple).
- CSRF: session-based csurf. All mutating requests require a valid CSRF token — endpoint: `GET /api/csrf-token`.
- **Two-layer gate (both required on every protected route):**
  1. **Coarse role gate** — `requireRole(ADMIN_ROLES)` — code-based, no DB read.
  2. **Fine permission gate** — `requirePermission("permissions.manage")` — DB-backed, sits BEHIND the coarse gate.
- New fine-gates MUST be added behind (not replacing) the coarse gate. Never drop `requireRole(...)` when adding `requirePermission(...)`.
- Roles: Owner, Admin, Manager, Dispatcher, Technician. Special: `platform_admin`.
- Middleware: `server/auth/`. Permissions: `server/permissions.ts`.

### Entitlement & Subscription
- **Feature reads:** `entitlementService.getTenantEntitlements(companyId)`. Do NOT read from `tenant_features` columns — they diverge from overrides.
- **Server feature gate:** `requireFeature(key)` — **fail-closed** (resolver errors → HTTP 500). Never silently pass resolver errors.
- **Capacity checks (create paths):** `assertFeatureCapacity(...)` or `assertFeatureCapacityAuto(...)`.
- **Subscription writer:** `subscriptionLifecycleService.transition(...)` is the SOLE writer of `companies.subscriptionStatus` + `companies.trialEndsAt`. Never write these columns directly.
- **Plan-name guard:** `PATCH /api/platform/tenants/:id/subscription` rejects unknown `subscriptionPlan` at HTTP 400.
- **Trial expiration:** Compute-on-read at the entitlement gate. `trialExpireWorker` emits audit events but does NOT mutate `subscriptionStatus`.
- Full detail: `docs/canonical/entitlements.md`.

### Invoice Status
- Stored statuses (`invoiceStatusEnum` in `shared/schema.ts`): `draft`, `awaiting_payment`, `sent`, `partial_paid`, `paid`, `voided`.
- `overdue` is NOT a stored status — computed at read time as `isPastDue` (`dueDate < NOW && balance > 0`) by `server/storage/invoicesFeed.ts::computeIsPastDue()`. Do NOT add an overdue status writer.

## Path Aliases
- `@/` → `client/src/`
- `@shared/` → `shared/`
- `@assets/` → `attached_assets/`

## Canonical UI Rules

### Modal Taxonomy
Classify every new dialog by intent before picking a primitive. Do NOT default to a raw shadcn `Dialog`.

1. **Destructive confirmation** → `AlertDialog`
2. **Generic / simple modal** → `ModalShell` + `Modal*` primitives (`client/src/components/ui/modal.tsx`)
3. **Operational / action-row / list drilldown** → `OperationalActionModal`
4. **Complex reusable workflow** → dedicated domain wrapper

`ModalShell` is width-neutral — sizing lives at the domain-wrapper or callsite layer, never inside `ModalShell`. Only build a new domain wrapper when the workflow is genuinely reusable across pages.

### Form Fields
Primitives: `client/src/components/ui/form-field.tsx` — `<FormField>`, `<FormLabel>`, `<FormHelperText>`, `<FormErrorText>`, `<FormSection>`, `<FormRow>`.

**Rules:**
- Use these primitives inside modal forms. Do NOT use ad hoc `text-xs` / `text-sm font-medium` / hardcoded pixel sizes for label, helper, or error text.
- **Placeholder-first:** Text/email/phone/address/number/textarea inputs use `placeholder` for identity. Render `<FormLabel srOnly>` (screen-reader accessible, visually hidden). Keep visible labels for checkboxes, switches, radio groups, and selects. `<FormSection>` legends always remain visible.
- Do NOT add new typography tokens. Do NOT couple `FormField` to react-hook-form. Do NOT bake `grid-cols-N` into `<FormRow>`.
- Full reference + examples: `docs/canonical/form-fields.md`.

### Typography
Canonical layer: `client/src/components/ui/typography.tsx` — single source of truth for entity-name / entity-meta / section-label / link-text classes.

**Required for all new feature components** (communications, activity-feed, detail-rail, hub/page modules):
- Use `<EntityName>`, `<EntityMeta>`, `<SectionLabel>`, `<EntityLink>`, `<EntityRow>` for entity names, metadata, section labels, and links.
- Import class constants (`ENTITY_NAME_CLASS`, `ENTITY_META_CLASS`, `SECTION_LABEL_CLASS`, `ENTITY_LINK_CLASS`) from `@/components/ui/typography` for `cn()` composition — do NOT redeclare locally.
- Dense-secondary token: `text-helper` (13px) for panels/rails. `text-caption` (14px) for tabular metadata only.
- Muted color: `text-muted-foreground`. `text-text-muted` is legacy — not for new code.

**Forbidden in feature components** (enforced by `tests/typography-canonical.test.ts`):
- Local `*_CLASS` constants whose value contains a `text-*` class.
- Legacy size ramp: `text-xs / -sm / -base / -lg / -xl / -2xl`.
- Weight overrides on role tokens: `font-bold`, `font-semibold`.
- Arbitrary `text-[Npx]` values.
- Full reference + examples: `docs/canonical/typography.md`.

### Chips
Source of truth: `client/src/lib/chipVariants.ts` (cva config + tone palette). Primitives: `client/src/components/ui/chip.tsx`.

| Use case | Primitive |
|---|---|
| Job / invoice / quote / lead status | `<StatusChip tone={meta.tone}>` |
| Job number, entity reference, scope visibility | `<EntityChip entity="job\|invoice\|quote\|maintenance">` |
| List-page filter toggle | `<FilterChip selected={bool}>` |
| Anything else chip-shaped | `<Chip>` |

Tones: `neutral` / `success` / `warning` / `danger` / `info` / `purple` (quote only) / `active` (FilterChip only). All tones defined in `chipVariants.ts` only.

Status→tone mapping: `STATUS_TO_CHIP_TONE` in `chipVariants.ts`; precedence rules in `getInvoiceStatusMeta` / `getJobStatusMeta` / `getQuoteStatusMeta` / `getLeadStatusMeta` in `lib/statusBadges.ts`.

**Forbidden** (enforced by `tests/chip-canonical.test.ts`):
- `<span className="rounded-full px-2 py-0.5 text-xs ...">` ad-hoc chips.
- Ad-hoc color triplets (`bg-emerald-50 text-emerald-700 border-emerald-200`) on chip-shaped surfaces.
- Local `FilterChips` / `StatusPill` re-implementations.
- `font-bold` / `font-semibold` weight overrides on chip text.
- Full reference + examples: `docs/canonical/chips.md`.

## Canonical Form System — Required

All new and modified form-bearing components MUST use primitives from `client/src/components/ui/form-field.tsx`. Drift is enforced by `tests/form-canonical-drift.test.ts`. Full reference: `docs/canonical/form-fields.md`.

**Required primitives:**
- `<FormField>` — wraps any label + input + helper/error stack
- `<FormLabel srOnly>` — sr-only label for text/email/phone/number/textarea inputs
- `<FormLabel>` — visible label for selects; use raw `<Label>` (not `<FormLabel>`) for checkboxes and switches
- `<FormHelperText>` — hint/instruction text below an input
- `<FormErrorText>` — validation error below an input (`role="alert"` baked in)
- `<FormSection title="">` — section grouping with visible legend
- `<FormRow className="grid-cols-N">` — multi-column field rows

**Banned patterns** (must have an allowlist entry in `tests/form-canonical-drift.test.ts` to use):
- `<p className="text-xs text-destructive">` — use `<FormErrorText>`
- `<p className="text-xs text-muted-foreground">` — use `<FormHelperText>` in form context
- `<div className="space-y-1">` or `"space-y-1.5"` as field wrappers — use `<FormField>`
- `<fieldset>` / `<legend>` for form section grouping — use `<FormSection>`
- `<div className="grid grid-cols-2|3">` as field rows — use `<FormRow>`
- `<Label className=...>` for input labels — use `<FormLabel>`

**Permanent exceptions — do NOT migrate:**
- Raw `<Label htmlFor="...">` for checkbox and switch rows — visible labels required; not a FormLabel use case.
- `<label className="text-[10px]">` in tech-app compact scheduling inputs — intentional density constraint.
- Page-level and server-level error banners — not form field validation feedback.
- Non-form descriptive paragraphs using `text-xs text-muted-foreground` — not helper text.
- AddressAutocomplete internal markup — specialized widget, not a standard form field.

## Dashboard Widget Rules
Registry: `shared/dashboardWidgetRegistry.ts` — single source of truth for widget keys, order, visibility, permissions, and column-span.

**Invariants:**
- Widget `key` values are persisted user data — renaming requires a SQL migration or compat alias.
- Hidden widgets MUST NOT mount or fetch: gate queries with `enabled: visibleSet.has(widgetKey)`.
- Drag-to-reorder lives on the live grid only (`DashboardWidgetGrid.tsx`). Customize drawer is show/hide only.
- Persistence: once on drag-end, once per toggle — not on drag-over. Optimistic update + rollback on error.
- Orphan keys (removed from registry) silently ignored on GET; rejected at HTTP 400 on PUT.
- Permissions enforced in two places: GET resolver filters by permission, PUT rejects unauthorized keys at HTTP 403.

**How to add a widget:**
1. Append `DashboardWidgetDefinition` to `shared/dashboardWidgetRegistry.ts`. Stable snake_case `key`, `defaultOrder` at next free slot (spaced by 10).
2. Set `requiredPermission` if permission-gated (e.g., `"finance.view"`).
3. Add renderer to the page's `Record<widgetKey, ReactNode>` map. Page owns data-fetching.
4. Gate expensive queries: `enabled: visibleSet.has("widget_key")`.
5. Add registry-pin assertion to `tests/dashboard-customize-framework.test.ts`.
6. Update `CHANGELOG.md`.

Full detail: `docs/canonical/dashboard-widgets.md`.

## Performance Guardrails (2026-03-18 Baseline — Mandatory)

Reject any change that violates these rules without explicit justification.

### 1. Invoice Tax Must Remain Batched
- Do NOT reintroduce per-line `updateInvoiceLine()` loops during invoice creation.
- Do NOT reintroduce repeated `recalculateInvoiceTotalsInTx()` calls per line during invoice creation.
- New invoices MUST use `batchApplyLineTax()` in `server/storage/invoices.ts` (single UPDATE + one recalculation).
- `updateInvoiceLine()` is for single-line manual edits only.

### 2. Background Polling Must Stay Guarded
- All `refetchInterval` hooks MUST include `refetchIntervalInBackground: false`.
- Exception requires explicit documentation (only documented exception: `ImpersonationBanner.tsx` security timeout).

### 3. Visit Hot-Path Queries Must Preserve Index
- Index: `idx_job_visits_job_company_active ON job_visits(job_id, company_id) WHERE is_active = true`.
- Do NOT rewrite `scheduleEligibleVisitFilter`, `reconciliationActionableVisitFilter`, or `uncompletedVisitFilter` in ways that bypass this index without explicit performance review.

**Exception policy:** Any override must: (a) be explicitly justified, (b) cite the affected path, (c) explain the override, (d) be treated as a review blocker.

## Coding Standards

- **DRY first:** Check for an existing function before writing a new one. Logic in 2+ places gets extracted into a shared utility or service.
- **Thin Controller, Thick Service:** Route handlers stay slim; push logic into services. Files under 300 lines where possible.
- **Unified error handling:** Use `asyncHandler` + `createError` in routes. No individual try/catch per handler.
- **Dead code:** Flag and remove unused variables, orphaned imports, and unreachable functions.
- **Early returns** over nested if/else chains. ES6+ features (destructuring, arrow functions) for conciseness.
- **Comments:** Only for non-obvious invariants, hidden constraints, or bug workarounds. Never restate what the code says.
- **No speculative features.** Implement exactly what the task requires. No abstractions beyond scope.

## Special Considerations

- **Money/Quantities:** PostgreSQL `numeric` type, stored as strings in TypeScript for precision.
- **Dates:** ISO strings or PostgreSQL date type; use date-fns for formatting.
- **Job Numbers:** Atomic sequences per company to prevent collisions.
- **Calendar Cleanup:** System auto-removes invalid calendar assignments when client PM months change.
- **QBO Optimistic Locking:** `qboSyncToken` prevents concurrent update conflicts.

## Testing

- No automated test suite. Manual testing required.
- `npm run check` — run before every commit to validate TypeScript compilation.

## Reference Docs

- Architecture: `docs/architecture/` (structure, stack, domain models, integrations, design)
- Canonical systems: `docs/canonical/` (form-fields, typography, chips, dashboard-widgets, entitlements)
- Workflows: `docs/workflows/` (api, database, forms, pages)
- Migration history: `docs/archive/`
