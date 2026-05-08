# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Change Tracking Requirements (MANDATORY)

**Every code change MUST include:**

1. **Code Comments** - Add comments explaining significant changes:
   - For new functions/methods: JSDoc-style comments explaining purpose, params, return values
   - For refactors: Comment noting what changed and why (e.g., `// Phase 2 Step 6: Renamed from statusDefault`)
   - For bug fixes: Comment describing the bug that was fixed

2. **CHANGELOG.md Updates** - Update `/CHANGELOG.md` under `## [Unreleased]` with:
   - What changed (feature, fix, refactor)
   - Files affected
   - Migration files created (if any)
   - Breaking changes (if any)

3. **Migration Documentation** - For database changes:
   - Create migration file in `migrations/` with descriptive name
   - Add header comment with run instructions
   - Document in CHANGELOG.md

This applies to ALL changes, even across chat sessions. No exceptions.

## Project Overview

This is an HVAC/R preventive maintenance scheduling application for contractors. The application manages client contracts, automates maintenance scheduling, tracks parts inventory, handles job dispatching, invoicing, and integrates with QuickBooks Online.

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

**Important:** All schema changes are done via plain SQL migration files in `/migrations/`. Never use `drizzle-kit push` — it is interactive and breaks CI/CD. See `docs/MIGRATIONS.md` for full rules and procedures.

The Drizzle schema in `shared/schema.ts` is the TypeScript type source of truth, but schema changes are applied via SQL files, not `drizzle-kit push`.

### Environment Setup
Required environment variables:
- `DATABASE_URL` - Neon PostgreSQL connection string
- `SESSION_SECRET` - Session encryption secret (required in production)
- `NODE_ENV` - Set to "production" or "development"

## Architecture

### Monorepo Structure
- **`client/`** - React frontend (Vite, TypeScript)
  - `src/components/` - UI components (shadcn/ui + custom)
  - `src/pages/` - Route pages
  - `src/hooks/` - Custom React hooks
  - `src/lib/` - Client utilities (auth, queryClient, etc.)
- **`server/`** - Express backend (TypeScript, ESM)
  - `routes/` - API route handlers
  - `services/` - Business logic services
  - `auth/` - Authentication & authorization middleware
  - `middleware/` - Shared middleware (error handling, etc.)
  - `guards/` - Business rule guards (ownership protection, etc.)
  - `utils/` - Server utilities (validation, pagination, etc.)
  - `qbo/` - QuickBooks Online integration
  - `storage/` - Repository layer for database access
  - `index.ts` - Server entry point
- **`shared/`** - Shared code between client and server
  - `schema.ts` - Drizzle ORM schema (single source of truth for database structure)
- **`migrations/`** - SQL migration files (manual execution)

### Multi-Tenancy
The app is **multi-tenant by company**. Each HVAC business is a separate company:
- `companies` table is the tenant root
- `users`, `clients`, `jobs`, `invoices`, etc. are scoped to `companyId`
- Tenant isolation enforced via middleware: `server/auth/tenantIsolation.ts`
- All database queries MUST filter by `companyId` from the authenticated user
- Never expose cross-tenant data

### Authentication & Authorization
- **Authentication:** Passport.js with local strategy, bcrypt for password hashing
- **Sessions:** PostgreSQL-backed sessions (connect-pg-simple)
- **CSRF Protection:** csurf middleware (session-based, not cookie-based)
  - CSRF token endpoint: `GET /api/csrf-token`
  - All mutating API requests require valid CSRF token
- **Authorization:** Role-Based Access Control (RBAC)
  - 5 default roles: Owner, Admin, Manager, Dispatcher, Technician
  - 24 granular permissions (defined in `server/permissions.ts`)
  - User-level permission overrides supported
  - Middleware: `requireAuth`, `requireRole`, `requirePermission` in `server/auth/`
  - Special role: `platform_admin` for cross-tenant support operations

### Security Features
- **Impersonation System:** Platform admins can impersonate company admins/owners
  - 60-minute max session, 15-minute idle timeout
  - Full audit trail in `audit_logs` table
  - See `SECURITY.md` for details
- **Helmet:** Security headers with CSP
- **Rate Limiting:** express-rate-limit on sensitive endpoints
- **Trust Proxy:** Enabled for deployment behind proxies

### Canonical Policy Architecture (2026-04-21 Phase 1)

The app has ONE canonical answer for "is feature X available for tenant T at limit L?" and ONE canonical writer for subscription state.

**Two-layer permission model.** Both layers enforce server-side on every protected route:
1. **Coarse role gate** (`requireRole(ADMIN_ROLES)`, etc.) — code-based. Role string on `users.role`. Fast check; no DB read.
2. **Fine permission gate** (`requirePermission("permissions.manage")`) — DB-backed. Sits BEHIND the coarse gate. Role permissions + per-user `user_permission_overrides` merged into an effective set; overrides support `grant`, `revoke`, `inherit`. Admin cannot edit their own overrides (anti-lockout).

New fine-gates MUST be added BEHIND (not replacing) the existing coarse gate. Never drop `requireRole(...)` in favor of `requirePermission(...)` — they are complementary.

**Canonical entitlement resolver.** `entitlementService.getTenantEntitlements(companyId)` → `{ companyId, planId, planName, entitlements: [{ featureKey, enabled, isCore, isUnlimited, limitValue, source, ... }] }`.
Precedence: tenant_override → plan_feature → isCore → deny.
All feature reads go through it:
- Server middleware: `requireFeature(key)` translates legacy camelCase via `LEGACY_TO_CANONICAL_KEY` → canonical snake_case → resolver. **Fail-closed** — resolver errors return HTTP 500.
- Server enforcement on create paths: `assertFeatureCapacity(companyId, featureKey, currentCount, 1)` or `assertFeatureCapacityAuto(...)` (auto-counts via `usageMetricsService`).
- Client foundation: `GET /api/me/entitlements` + `useEntitlements` hook. `GET /api/me/permissions` + `useEffectivePermissions` hook. Phase 2 migrates existing `useTenantFeatures` callers onto these.

**Canonical subscription writer.** `subscriptionLifecycleService.transition({ companyId, to, trialEndsAt, source, reason, actorUserId })` is the SOLE writer of `companies.subscriptionStatus` + `companies.trialEndsAt`. Validates transitions against `ALLOWED_TRANSITIONS`, writes, appends `subscription_events` audit row (`type='status_changed'`), invalidates the resolver cache. Every writer (admin PATCH, platform PATCH, trial-expire worker) routes through it. The ONE carve-out is `onboardingService.createCompanyWithOwner` for birth-state seeding.

**Plan-name guard.** `PATCH /api/platform/tenants/:id/subscription` rejects unknown `subscriptionPlan` at 400. Prevents orphan plan strings on `companies.subscription_plan`. (The legacy `PATCH /api/admin/tenants/:id/billing` was removed 2026-04-26 — it gated on tenant-`owner` role and could be invoked cross-tenant; all callers now use the platform-scoped endpoint above.)

**Trial expiration.** Compute-on-read at the entitlement gate. `trialExpireWorker` emits a one-shot `trial_expired` audit event per tenant but does NOT mutate `subscriptionStatus`.

**What NOT to do:**
- Do NOT write `companies.subscriptionStatus` directly. Route through `subscriptionLifecycleService.transition()`.
- Do NOT read feature state from `tenant_features` columns. Use the resolver (the legacy table is kept alive only as a Phase 1 compat surface; reads there will diverge from overrides).
- Do NOT drop `requireRole(...)` when adding `requirePermission(...)`. The two-layer contract is intentional.
- Do NOT silently pass on resolver errors. `requireFeature` fails closed — if you write a new gate, do the same.

### Frontend Stack
- **Routing:** wouter (lightweight client-side routing)
- **State Management:** TanStack Query (React Query) for server state
- **Forms:** React Hook Form + Zod validation
- **UI Components:** shadcn/ui (Radix UI primitives + Tailwind CSS)
  - Material Design-inspired
  - Defined in `components.json` - uses `@/components/ui/` import alias
- **Icons:** Lucide React
- **Date Handling:** date-fns
- **Maps:** Leaflet / react-leaflet for route visualization

### Backend Stack
- **API:** RESTful Express.js (TypeScript, ESM modules)
- **Database:** Neon PostgreSQL (serverless)
- **ORM:** Drizzle ORM (`shared/schema.ts` is schema source of truth)
- **Validation:** Zod schemas (shared between client and server)

### Key Domain Models
- **Companies** - Tenant root, subscription data, tax settings
- **Users** - Scoped to company, roles/permissions, technician profiles
- **Customer Companies** - Main client companies (e.g., "Basil Box")
- **Client Locations** (`client_locations` table, formerly `clients`) - Service locations under customer companies
- **Jobs** - Work orders with status workflow, assigned technicians, equipment tracking (linked to client_locations)
  - Job statuses: Scheduled, In Progress, Completed, Cancelled, Invoiced, etc.
  - Job types: PM, Repair, Install, etc.
  - Supports recurring job series
- **Invoices** - Billing with QBO sync, line items, tax calculation
  - Invoice statuses (canonical, see `shared/schema.ts:1519` `invoiceStatusEnum`): `draft`, `awaiting_payment`, `sent`, `partial_paid`, `paid`, `voided`. `Overdue` is NOT a stored status — it is computed at read time as `isPastDue` (`dueDate < NOW && balance > 0`) by `server/storage/invoicesFeed.ts::computeIsPastDue()`. Do NOT add an `overdue` status writer.
  - Client visibility toggles (show/hide prices, quantities, etc.)
- **Parts** - Inventory tracking with categories
- **Equipment** - Location-level asset tracking, linked to jobs
- **Job Templates** - Reusable parts/billing configurations per job type
- **Tasks** - Supplier visit tracking and task management

### QuickBooks Online Integration
- **Bidirectional sync:** Clients, Invoices, Payments
- **Customer hierarchy:** Clients map to QBO Customers, Locations to Sub-Customers
- **Sync fields:** `qboCustomerId`, `qboInvoiceId`, `qboSyncToken` for optimistic locking
- **Services:** `server/qbo/syncService.ts`, `server/qbo/mappers.ts`
- **Sync triggers:** Manual sync buttons, automatic on invoice creation/update

### Route Optimization
- **OpenRouteService API** integration for technician routing
- GPS coordinate conversion for client locations
- Optimal sequencing and map visualization
- Service: `server/routeOptimizationService.ts`

## Important Patterns

### Path Aliases
- `@/` - Resolves to `client/src/`
- `@shared/` - Resolves to `shared/`
- `@assets/` - Resolves to `attached_assets/`

### Database Schema Management
1. Modify `shared/schema.ts` (single source of truth)
2. Run `npm run db:push` to apply changes to database
3. Schema is typed via Drizzle - use `typeof tableName.$inferSelect` for types
4. Always use Drizzle queries, not raw SQL, for type safety

### API Route Pattern
```typescript
// server/routes/example.ts
import { Router } from "express";
import { requireAuth, requirePermission } from "../auth/routeHelpers";
import { db } from "../db";

const router = Router();

router.get("/api/example", requireAuth, requirePermission("view_clients"), async (req, res) => {
  const { companyId } = req.user!;  // Always filter by companyId
  const data = await db.query.tableName.findMany({
    where: eq(tableName.companyId, companyId)
  });
  res.json(data);
});
```

### Frontend Query Pattern
```typescript
// Use TanStack Query for API calls
const { data, isLoading } = useQuery({
  queryKey: ['/api/example'],
  queryFn: async () => {
    const res = await fetch('/api/example');
    if (!res.ok) throw new Error('Failed to fetch');
    return res.json();
  }
});
```

### Component Structure
- Atomic design: `components/ui/` for primitives, `components/` for composed components
- Page components in `pages/`
- Protected routes use `<ProtectedRoute>` wrapper with optional `requireAdmin` prop
- Modals follow the canonical taxonomy below — do NOT default to a raw shadcn `Dialog` for new work

### Modal Taxonomy

Pick the modal primitive by intent, not by visual. There are exactly five categories — anything that doesn't fit should be raised before inventing a sixth.

1. **Destructive confirmation** → `AlertDialog`
2. **Generic / simple modal** → `ModalShell` + `Modal*` primitives (`client/src/components/ui/modal.tsx`)
3. **Operational / action-row / list drilldown** → `OperationalActionModal`
4. **Complex reusable workflow** (payment, communication, invoice composition, etc.) → dedicated domain wrapper
5. **`ModalShell` is width-neutral** — pattern/domain wrappers own dimensions. Do NOT add sizing styles to `ModalShell` itself.

When adding a new dialog/modal, classify against rules 1–4 first and reach for the existing primitive. Only build a new domain wrapper when the workflow is genuinely reusable across pages. Width/sizing concerns live at the domain-wrapper or callsite layer, never inside `ModalShell`.

### Phase 2: Form Field Canonicalization

The Phase 1 modal-shell sweep standardized modal **wrappers**. Phase 2 standardizes the **interior** of modal forms — labels, inputs, helper/error text, field stacks, multi-column rows, and section grouping. The canonical primitives live in `client/src/components/ui/form-field.tsx`:

- **`<FormField>`** — single-field wrapper with `space-y-1.5` between label, input, and helper/error.
- **`<FormLabel required? srOnly?>`** — composes the existing `<Label>` primitive with the `text-form-label` typography lock + an optional destructive `*` for required fields. The asterisk is `aria-hidden` because the required state should be communicated semantically on the input itself. The `srOnly` flag visually hides the label (Tailwind `sr-only`) while keeping it readable by screen readers — use this for the canonical placeholder-first pattern below.
- **`<FormHelperText>`** — hint/instruction line below an input. Bakes `text-xs text-muted-foreground`.
- **`<FormErrorText>`** — validation error line below an input. Bakes `text-xs text-destructive` and carries `role="alert"` so screen readers announce the error when it appears.
- **`<FormSection title="">`** — `<fieldset>` + `<legend>` for grouped fields. Legend bakes `text-sm font-medium`. No borders unless added via `className`.
- **`<FormRow>`** — grid wrapper for multi-column layouts. Defaults to `grid gap-3`. The caller supplies `grid-cols-2` / `grid-cols-3` via `className`.

Use these **inside migrated modal forms** that consume `<ModalBody>`. Do not use ad hoc `text-xs` / `text-sm font-medium` / hardcoded pixel sizes for label, helper, or error text in modal forms.

**Placeholder-first visual style (canonical).** In modal forms, basic text / email / phone / address / number / textarea inputs render their identity **inside the field via `placeholder`** — not as a visible label above the input. The visual reference is `QuickAddJobDialog`: field identity inside the box, no header above each text box.

- For these input types, render `<FormLabel htmlFor="..." srOnly>...</FormLabel>` so the label is hidden visually but still announced by screen readers when the input receives focus. The `htmlFor` / `id` association is the actual a11y mechanism.
- Mirror the placeholder text in the sr-only label so screen-reader users get the same identity sighted users see.
- Helper text and error text below the input may stay visible.
- **Keep visible labels** for checkboxes, switches, radio groups, and complex selects — the field identity can't live in a placeholder for those.
- **`<FormSection title="...">`** legends remain visible — section headings group related fields and are not field identities.

```tsx
{/* Canonical placeholder-first text input */}
<FormField>
  <FormLabel htmlFor="phone" srOnly>Phone</FormLabel>
  <Input id="phone" placeholder="Phone" value={phone} onChange={...} />
</FormField>

{/* Visible label retained for a checkbox row */}
<div className="flex items-center gap-2">
  <Checkbox id="opt-in" checked={...} onCheckedChange={...} />
  <Label htmlFor="opt-in">Send me marketing emails</Label>
</div>
```

**Framework-agnostic.** These primitives compose the existing `<Label>`, `<Input>`, `<Textarea>`, `<Select>`, `<Checkbox>`, `<Switch>` primitives without coupling to `react-hook-form`. The 12 Phase-1-migrated tenant modals all use `useState` directly; the FormField primitives slot in without a state-library refactor. If a future modal uses `react-hook-form` (via the shadcn `<Form>` wrapper in `@/components/ui/form`), these primitives still compose cleanly inside its `<FormItem>` slots.

**What stays as-is.**
- `<Label>`, `<Input>`, `<Textarea>`, `<Select>`, `<Checkbox>`, `<Switch>` — already canonical at the atomic layer; FormField primitives compose them, not replace them.
- `<ModalShell>` / `<ModalHeader>` / `<ModalTitle>` / `<ModalBody>` / `<ModalFooter>` — Phase 1 primitives unchanged.
- The existing shadcn `<Form>` family in `@/components/ui/form` — kept available for callers that want react-hook-form integration.

**What NOT to do.**
- Do NOT globally refactor `<Label>` / `<Input>` to bake more classes — those primitives are correct as-is; the drift was in field *layout* and *helper/error text patterns*, which is what FormField targets.
- Do NOT add new typography tokens. Every typography lock here references an existing token (`text-form-label`, `text-xs`, `text-muted-foreground`, `text-destructive`).
- Do NOT couple FormField primitives to `react-hook-form`. They stay framework-agnostic.
- Do NOT bake `grid-cols-N` into `<FormRow>`. Callers supply the column count via `className`.
- Do NOT impose a fieldset border on `<FormSection>`. Tailwind's preflight resets fieldset borders to 0 — keep that default.

**Migration plan.**
- **Phase 2A** (this PR): primitives only. No modal changes. Pinned by `tests/form-field-canonical.test.ts`.
- **Phase 2B** (next): bellwether migration on `EditCompanyDialog` — smallest field set, no `<Textarea>` / `<Select>`, already uses `<fieldset><legend>` so the swap is mostly cosmetic. Land + visual diff before continuing.
- **Phase 2C**: batch the remaining 11 migrated modals in 3 clusters (client → location → other), once Phase 2B validates the pattern in production.

**Standard form body** (placeholder-first text inputs + sr-only labels):

```tsx
<ModalBody className="space-y-4">
  <FormSection title="Client Identity (first name or company required)">
    <FormRow className="grid-cols-2">
      <FormField>
        <FormLabel htmlFor="first" srOnly>First name</FormLabel>
        <Input id="first" placeholder="First name" value={...} onChange={...} />
      </FormField>
      <FormField>
        <FormLabel htmlFor="last" srOnly>Last name</FormLabel>
        <Input id="last" placeholder="Last name" value={...} onChange={...} />
      </FormField>
    </FormRow>
    <FormField>
      <FormLabel htmlFor="company" srOnly>Company name</FormLabel>
      <Input id="company" placeholder="Company name" value={...} onChange={...} />
    </FormField>
  </FormSection>

  <FormField>
    <FormLabel htmlFor="email" srOnly>Email</FormLabel>
    <Input id="email" type="email" placeholder="Email" value={email} onChange={...} />
    {emailError ? (
      <FormErrorText>{emailError}</FormErrorText>
    ) : (
      <FormHelperText>Used for invoices and notifications</FormHelperText>
    )}
  </FormField>
</ModalBody>
```

Custom layouts are still allowed when the body has its own padding/scrolling concerns (e.g., `ContactFormDialog`'s 2-section flex layout, `EditTagsModal`'s tag-chip + search structure). In those cases the body owns its own structure, but individual fields inside should still use `<FormField>` / `<FormLabel>` / `<FormHelperText>` / `<FormErrorText>` where practical.

### Phase H1: Typography Primitives (2026-05-07)

The typography token system in `tailwind.config.ts` defines real Tailwind utility classes (`text-row`, `text-row-emphasis`, `text-helper`, `text-caption`, `text-label`, `text-section-title`, etc.). The Phase H1 audit (see CHANGELOG > "Communications Hub Typography Drift") found that feature components kept drifting from the canonical roles because:
1. The canonical class strings were re-derived per file (`PRIMARY_VALUE_CLASS`, `LINK_CLASS`).
2. The pre-existing constant library lived under `list-surface.tsx > listPrimaryClass`, named for list pages — detail panels never reached for it.
3. Source-pin tests asserted *presence* of the canonical token, not architectural composition — a file could import the right token AND fork it locally.

The canonical layer lives at `client/src/components/ui/typography.tsx` and is the SINGLE source of truth for entity-name / entity-meta / section-label / link-text classes. It exports:

- **Class constants** for callers that need the raw string (e.g. composing with `cn()` on a wrapper not made with our component primitives):
  - `ENTITY_NAME_CLASS` — `text-row-emphasis truncate`
  - `ENTITY_NAME_LINK_CLASS` — `text-row-emphasis truncate text-brand hover:underline`
  - `ENTITY_META_CLASS` — `text-helper text-muted-foreground truncate`
  - `SECTION_LABEL_CLASS` — `text-label text-muted-foreground`
  - `ENTITY_LINK_CLASS` — `text-brand hover:underline`
- **Component primitives** — the preferred surface:
  - `<EntityName href? children>` — primary identifier. Renders as a wouter `<Link>` (brand-green, hover underline) when `href` is set, `<span>` with `text-foreground` otherwise.
  - `<EntityMeta>` — recessed secondary metadata line.
  - `<SectionLabel>` — uppercase tracked section header (Client / Location / Open Jobs).
  - `<EntityLink href>` — inline brand-green link without entity-name sizing.
  - `<EntityRow icon name meta trailing href>` — stacked composition primitive (name on top, optional meta below, optional leading icon and trailing slot).

**Required for new feature components.**

Feature components in `client/src/components/communications/`, `client/src/components/activity-feed/`, `client/src/components/detail-rail/`, and any future hub/page module **MUST**:

- **Use the primitives** when rendering an entity name, secondary metadata line, section label, or inline link. Don't compose the class strings yourself.
- **Import the constants from `@/components/ui/typography`** when you need a raw class for `cn()` composition. Don't redeclare them locally.
- **Pick `text-helper` (13px) as the dense-secondary token** for panels and side rails. `text-caption` (14px) is reserved for tabular metadata (timestamps in tables, list-page footer rows). The two coexist as canonical tokens but they have different roles.
- **Use `text-muted-foreground` for muted color.** `text-text-muted` survives only inside `list-surface.tsx > listSecondaryClass` for visual back-compat with existing list pages — it is NOT a target for new code.

**Forbidden in feature components** (enforced by `tests/typography-canonical.test.ts`):

- Local `*_CLASS` constants whose value contains a `text-*` class — these belong in `typography.tsx`.
- The legacy size ramp (`text-xs / -sm / -base / -lg / -xl / -2xl`). Use canonical role tokens instead.
- Heavier weights layered on top of role tokens (`font-bold`, `font-semibold`). Role tokens like `text-row-emphasis` already bake in the right weight (500).
- Arbitrary `text-[Npx]` values.

**Allowlist policy.** The guard test `tests/typography-canonical.test.ts > LEGACY_ALLOWLIST` lists files that fail the strict guard today. Each entry has a paired `TODO(H2)` comment naming the migration target. Adding a new file to the allowlist is a deliberate choice — the entry itself documents the debt. The default expectation for new files in the scanned directories is that they pass the strict guard, not that they get allowlisted.

**Standard usage:**

```tsx
import {
  EntityName,
  EntityMeta,
  EntityRow,
  SectionLabel,
} from "@/components/ui/typography";

<SectionLabel>Open Jobs</SectionLabel>
<EntityRow
  icon={<Briefcase className="h-3.5 w-3.5 text-muted-foreground" />}
  name="Job #1023"
  meta="Walk-in cooler PM"
  href={`/jobs/${jobId}`}
/>

<EntityName href={`/clients/${customerCompanyId}`}>{client.name}</EntityName>
<EntityMeta>{[address, phone, email].filter(Boolean).join(" · ")}</EntityMeta>
```

**What stays as-is.**

- `<Label>` / `<FormLabel>` / `<FormHelperText>` / `<FormErrorText>` — form field primitives stay canonical at the form layer (Phase 2 above). Feature components inside a form still use those, NOT the new `<EntityName>` family.
- The list-page constants (`listPrimaryClass`, `listHeaderRowClass`) still ship from `list-surface.tsx` for back-compat with the existing list pages. Phase H1 makes those derive from the new typography primitives where the values match (`listPrimaryClass = ENTITY_NAME_CLASS`); Phase H2 migrates list-page consumers to the primitive components.
- `<MetaRow>` (`components/ui/meta-row.tsx`) — kept for now; will migrate in H2.

## Customizable Dashboard Widgets (2026-05-07 framework)

The dashboard pages (currently `FinancialDashboard`) are driven by a per-user widget framework with **one canonical registry** at `shared/dashboardWidgetRegistry.ts`. Visibility + ordering are persisted to `user_dashboard_widgets` and edited via the right-side customize drawer.

**Architecture rules:**
- The registry is the SINGLE source of truth for which widgets exist, their default order, default visibility, required permission, and column-span. No hardcoded widget order anywhere else.
- Widget `key` values are PERSISTED user data — see the file-level "STABILITY WARNING" in the registry. Renaming a key requires a SQL migration or a compatibility alias.
- Drag-to-reorder lives on the LIVE GRID — `DashboardWidgetGrid.tsx` mounts `DndContext` + `SortableContext` (`rectSortingStrategy`), wraps each visible widget cell with `useSortable`, and renders a small drag handle in the cell's top-right corner. The customize drawer (`DashboardCustomizeDrawer.tsx`) is a pure show/hide toggle list — NO drag wiring lives there. The drag handle button is the only DnD activator (`attributes` + `listeners` are spread on the button, NOT on the cell wrapper) so clicks anywhere else on the card behave normally and never start a drag. (2026-05-07 RALPH — relocated from drawer to live grid per user request.)
- Persistence happens once on drag-end and once per toggle — not on drag-over. Optimistic update + rollback on error.
- The grid receives `onReorder` as a prop and the page (`FinancialDashboard.tsx`) wires it to `useDashboardLayout.setOrder`. The grid only sees visible widget keys; the hook's `setOrder` preserves hidden widgets' relative order via its append-any-omitted loop, so dragging visible cards never re-enables hidden ones.
- Hidden widgets MUST NOT mount or fetch. Page-level queries gate on `enabled: visibleSet.has(widgetKey)` so toggling a widget off in the drawer also stops its data load.
- Orphan persisted rows (a `widget_key` that no longer exists in the registry) are silently ignored by the GET resolver — it iterates the registry, not the override rows. `PUT` rejects unknown keys at HTTP 400 so a stale client cannot persist orphans forward.
- Permissions are enforced in TWO places: the GET resolver filters out widgets the user lacks, and the PUT handler rejects unauthorized widget keys at HTTP 403.

**How to add a widget (canonical recipe):**
1. Append a `DashboardWidgetDefinition` to the appropriate `*_DASHBOARD_WIDGETS` array in `shared/dashboardWidgetRegistry.ts`. Pick a stable snake_case `key`. Set `defaultOrder` to the next free slot (existing rows are spaced by 10).
2. If the widget is permission-gated, set `requiredPermission` to the canonical permission key (e.g. `"finance.view"`). The server filters it out for users without that permission.
3. On the page (e.g. `FinancialDashboard.tsx`), add the renderer entry to the `Record<widgetKey, ReactNode>` map. The page owns data-fetching for each widget.
4. If the widget triggers an expensive query, gate it on visibility: `useQuery({ ..., enabled: visibleSet.has("widget_key") })`. Hidden widgets MUST NOT fetch.
5. Add a registry-pin assertion to `tests/dashboard-customize-framework.test.ts` for the new key, sizePreset, and permission.
6. Update `CHANGELOG.md` under `[Unreleased]`.

## Common Development Tasks

### Adding a New Database Table
1. Add table definition to `shared/schema.ts`
2. Include `companyId` foreign key for tenant scoping
3. Create insert/update schemas with `createInsertSchema` from drizzle-zod
4. Run `npm run db:push`
5. Add types: `export type TableName = typeof tableName.$inferSelect;`

### Adding a New API Endpoint
1. Create/edit route file in `server/routes/`
2. Use `asyncHandler` wrapper to eliminate try/catch boilerplate
3. Use `validateSchema` helper for Zod validation
4. Use `createError(status, message)` for consistent error handling
5. Add tenant isolation: filter queries by `req.user.companyId`
6. Add authorization: `requireRole(...)` if needed
7. Register route in `server/routes/index.ts`

**Example:**
```typescript
import { asyncHandler, createError } from "../middleware/errorHandler";
import { validateSchema } from "../utils/validationHelpers";

router.post("/endpoint", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const data = validateSchema(mySchema, req.body);

  // Validation throws automatically on failure
  if (!someCondition) {
    throw createError(400, "Invalid operation");
  }

  const result = await db.query...;
  res.json(result);
}));
```

### Adding a New Page
1. Create page component in `client/src/pages/`
2. Add route in `client/src/App.tsx` Router
3. Wrap with `<ProtectedRoute>` if authentication required
4. Add navigation link in `client/src/components/AppSidebar.tsx`

### Working with Forms
1. Use React Hook Form + Zod schema
2. Reuse Zod schemas from `shared/schema.ts` where possible
3. Use shadcn form components for consistent UI
4. Include CSRF token from `/api/csrf-token` for mutations

## Testing Notes
- No automated test suite currently configured
- Manual testing required for changes
- Use `npm run check` to verify TypeScript compilation

## Design Guidelines
- Follow Material Design principles (see `design_guidelines.md`)
- Use Inter font family
- Tailwind spacing: consistent use of units 2, 4, 6, 8
- Mobile-first responsive design
- Information density is important - contractors need scannable data views
- Minimize clicks for common workflows (e.g., mark job complete, create invoice)

## Special Considerations
- **Numeric Types:** Money amounts and quantities use PostgreSQL `numeric` type (stored as strings in TypeScript for precision)
- **Date Handling:** Dates stored as ISO strings or PostgreSQL date type; use date-fns for formatting
- **Calendar Cleanup:** System automatically removes invalid calendar assignments when client PM months change
- **Job Numbers:** Atomic sequences per company to prevent collisions
- **Optimistic Locking:** QBO sync uses version tokens to prevent concurrent update 
conflicts


# Project Instructions: Dispatching Software Optimization

## Role
You are a Senior Systems Architect specializing in high-performance dispatching software and DRY (Don't Repeat Yourself) principles.

## Objectives for Analysis & Development
1. **Prioritize Line Count Reduction:** Every time we touch a module, identify redundant logic. If the same logic appears in 2+ places, refactor it into a shared utility or service.
2. **Modular Architecture:** Aim for a "Thin Controller, Thick Service" model. Keep files under 300 lines where possible.
3. **Dead Code Elimination:** Automatically flag and suggest removal for unused variables, imported but unused libraries, and "hallucinated" or orphaned functions common in AI-generated code.
4. **Data Integrity:** Since this is dispatching software, prioritize the reliability of state management (e.g., driver status, GPS coordinates, and job assignments).

## Coding Standards
- Use ES6+ features to shorten code (e.g., destructuring, arrow functions).
- Consolidate multiple `if/else` chains into early returns or lookup objects.
- Ensure all API calls have a unified error handling wrapper rather than individual try/catch blocks in every file.

## Workflow
- Before writing new code, check the existing codebase for a similar function.
- If a proposed change increases line count significantly, explain why it is necessary or offer a more concise alternative.

## Performance Regression Guardrail — 2026-03-18 Baseline

A surgical performance hardening pass was completed and verified on 2026-03-18. The following baseline rules are mandatory. **Reject** any change that violates them.

### 1. Invoice Tax Application Must Remain Batched
- Do NOT reintroduce per-line `updateInvoiceLine()` loops during invoice creation.
- Do NOT reintroduce repeated `recalculateInvoiceTotalsInTx()` calls per line during invoice creation.
- Tax application for new invoices must use `batchApplyLineTax()` in `server/storage/invoices.ts` (single UPDATE + one recalculation).
- The per-line `updateInvoiceLine()` method remains for single-line manual edits only.

### 2. Background Polling Must Remain Guarded
- All `refetchInterval` polling hooks must include `refetchIntervalInBackground: false` unless there is an explicit, documented safety-critical reason (e.g., `ImpersonationBanner.tsx` security timeout).
- Do NOT introduce new polling queries that run in hidden/background tabs without documenting the exception.

### 3. Visit Hot-Path Queries Must Preserve Indexed Access
- Per-job visit lookups use `idx_job_visits_job_company_active ON job_visits(job_id, company_id) WHERE is_active = true`.
- Do NOT rewrite canonical visit predicates (`scheduleEligibleVisitFilter`, `reconciliationActionableVisitFilter`, `uncompletedVisitFilter`) in ways that bypass this index without explicit performance review.
- Any change to these query predicates is performance-sensitive and must be reviewed against this baseline.

### Exceptions
Any exception to these rules must: (a) be explicitly justified, (b) cite the affected path, (c) explain why the baseline is being intentionally overridden, and (d) be treated as a review blocker until acknowledged.

**Reference:** See the completed performance hardening handoff record and `CHANGELOG.md` Performance section (2026-03-18) for full implementation details.