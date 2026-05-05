# Access Control Matrix

> **Status:** Product contract. Locked by PR 1 of the 2026-05-04 access-control work.
> All subsequent PRs (PR 2 — PR 6) build on the model described here.
>
> **Scope:** Tenant app only. Platform admin / support identity is out of scope.

---

## 1. Purpose

This document defines the **product rules** for tenant-app access control:
which roles exist, what each role can do by default, what tenants can
customize, and what stays fixed. It is the source of truth that the
team management UI, the role customization UI, and the backend
permission gates must agree with.

This document **does not** define platform admin or platform support
access. Platform identity (`platform_admin`, `platform_support`,
`platform_billing`, `platform_readonly_audit`) is a **separate identity
surface** governed by `platform_user_roles`, the platform session
(`psid`), and the support-access flow. Tenant RBAC has no authority
over platform identity, and platform identity is not a tenant-
configurable role. See `server/auth/roles.ts` for the canonical
tenant-vs-platform split and the DB CHECK constraint that enforces it.

---

## 2. Access Model Summary

- **System roles are fixed.** The five system roles —
  `owner`, `admin`, `manager`, `dispatcher`, `technician` — are
  immutable. Their default permission sets are defined in this
  document and seeded by migration. They cannot be edited or
  deleted from the UI; the backend rejects any attempt.
- **Custom roles are configured through simplified permission packs**
  (Section 3), not raw permission keys. Tenants build a custom role
  by selecting from ~8 packs that map to product-meaningful
  capabilities.
- **Raw permission keys may exist internally** (the catalog still
  contains fine-grained keys like `clients.view.basic`,
  `invoices.send`, `schedule.own.complete`) **but should not be the
  default user-facing UI.** The default editor surfaces packs;
  raw keys live behind an "Advanced" disclosure for power users
  and developer debugging.
- **Backend enforcement remains authoritative.** The frontend may
  hide affordances based on permissions, but every gate that
  matters is enforced server-side. Frontend visibility alone is
  never the security boundary.

---

## 3. Permission Packs

Every customer-meaningful capability lives in exactly one pack.
A pack maps to a clear product question an admin can answer
("can this person see invoices?") without reading the permission
catalog.

### A. Operations
Day-to-day work surface for office staff.
- Dashboard
- Jobs (list, detail, view)
- Clients / locations (read + edit)
- Equipment (read)
- Leads / tasks
- Basic operational data (visit feed, attention queue, activity)

### B. Dispatch
Scheduling and assignment authority.
- Calendar / dispatch board
- Scheduling and rescheduling
- Assigning / reassigning visits
- Team workload visibility (whose plate has what)

### C. Field Access
Technician PWA — assignment-scoped.
- Tech PWA shell (`/tech/*`)
- Assigned visits and their detail
- Assigned job + location data (read, scope-limited)
- Own time clock (clock in/out, sub-1-min discard policy)
- Field notes / parts on assigned visits
- Gated additionally by `users.isSchedulable` (must be true)

### D. Financials
All money-touching surfaces.
- Quotes (view, edit, send)
- Invoices (view, edit, send)
- Payments (view balances, transactions)
- Job costing / margins
- Customer balances

Financials splits into two sub-capabilities (both still inside this
pack, both surfaced as one toggle in the default UI):
- **Financials view** — see invoices/quotes/payments/margins
- **Financials collect payments** — record a payment, send a payment
  link

### E. Reports
- Operational reports (job throughput, technician utilization,
  schedule density)
- Financial reports (revenue, AR aging, profitability)

The default UI surfaces these as two separate toggles so a
dispatcher can have operational reports without seeing financials.

### F. Price Book
Pricing and catalog setup.
- Products / services / items catalog
- Tax rules
- Job templates
- Equipment types / reference field setup

### G. Team Management
Day-to-day team admin. **Does NOT include role / permission management.**
- Invite users
- Edit user profile, contact info, color, labor rate
- Deactivate / reactivate users
- Manage schedules / working hours
- Approve timesheets

### H. Admin / Settings
Tenant-level configuration. Highest-trust pack.
- Company profile (legal name, address, tax IDs)
- Communication templates
- Business hours
- Integrations (QBO + others) — connect, disconnect, credentials
- Import center
- Roles / permissions management
- **Tenant subscription / billing** (the tenant's own SaaS plan and
  the payment method used to pay for it — see Section 5 for the
  distinction from platform billing)

---

## 4. Default Role Matrix

The recommended out-of-the-box mapping of packs onto system roles.
The seed migration MUST land each system role with these defaults;
custom roles are configured by the tenant.

|                   | Owner | Admin | Manager      | Dispatcher | Technician        | Custom         |
|-------------------|:-----:|:-----:|:------------:|:----------:|:-----------------:|:--------------:|
| Operations        | ✓     | ✓     | ✓            | ✓          | —                 | configurable   |
| Dispatch          | ✓     | ✓     | ✓            | ✓          | —                 | configurable   |
| Field Access      | ✓ †   | ✓ †   | ✓ †          | ✓ †        | ✓                 | configurable † |
| Financials        | ✓     | ✓     | ✓            | —          | —                 | configurable   |
| Reports           | ✓     | ✓     | ✓ (both)     | ✓ (op only)| —                 | configurable   |
| Price Book        | ✓     | ✓     | ✓            | —          | —                 | configurable   |
| Team Management   | ✓     | ✓     | ✓ (limited)‡ | —          | —                 | configurable ‡ |
| Admin / Settings  | ✓     | ✓ §   | —            | —          | —                 | not exposed    |

**Legend:**
- **†** Field Access is additionally gated by `users.isSchedulable = true`.
  An owner who is not schedulable will not appear in the tech app even
  with the pack granted.
- **‡** "Limited" Team Management = manager can invite/edit/deactivate
  users and manage schedules, but **cannot change a user's role**.
  Role assignment is admin-only. Custom roles configured for Team
  Management inherit this same limitation.
- **§** Admin retains all Settings access **except tenant subscription /
  billing changes**, which are owner-only (see Section 5 below).

**Notes:**
- **Owner is the only role that can change tenant subscription /
  billing.** A tenant can have multiple admins, but only the owner
  can upgrade the SaaS plan or change the payment method that pays
  for it.
- **Role / permission management is owner / admin only.** The
  Admin / Settings pack contains it, and the pack itself is not
  granted below admin.
- **Hard deletes, refunds, imports, and integration setup are
  owner / admin only** unless explicitly changed in a future PR.
  These are not granular toggles in the custom-role editor.

---

## 5. Non-Configurable Controls

The following controls **must not be exposed as tenant-customizable
toggles** in the role customization UI. They remain fixed by role.

1. **Tenant subscription plan changes** (upgrade, downgrade, cancel)
2. **Tenant billing / payment method changes** (the credit card / ACH
   on file used to pay for the SaaS plan)
3. **Platform / admin support access** — owned entirely by the platform
   identity surface, never reachable through tenant RBAC
4. **Integrations setup / credential connection** (initial OAuth,
   credential rotation, disconnect)
5. **Role / permission management** itself (cannot be granted to
   non-admin custom roles; admin anti-lockout enforced server-side)
6. **Refunds**
7. **Hard deletes** of jobs, clients, invoices, locations
8. **Destructive bulk operations** (`/api/admin/*` cleanup endpoints,
   already owner-only)
9. **Data imports** (`/api/imports/*`)
10. **Company legal / tax identity fields** (legal name, registered
    address, tax registrations)
11. **Security / session controls** (password reset paths, session
    invalidation, audit log access)

### Clarification: tenant billing vs. platform billing

These are two different things and must not be conflated in the UI
or in the access-control model.

- **Tenant subscription / billing** (this document, **owner-only**) =
  the customer's own SaaS plan and the payment method that pays for
  it. Lives under the tenant's `Settings` surface. Governed by
  tenant RBAC.
- **Platform admin billing / tenant controls** (out of scope) =
  internal staff tools for issuing credits, viewing tenant payment
  history across companies, and adjusting plans on behalf of
  tenants. Lives behind the platform session and platform identity.
  Has no representation in tenant RBAC and no toggle here.

---

## 6. Custom Role Controls Worth Exposing

The custom-role editor should surface **only** these toggles. Anything
finer is hidden behind an "Advanced" disclosure.

- **Dashboard / Operations access** (Operations pack)
- **Dispatch access** (Dispatch pack)
- **Job / client access** (Operations pack — bundled toggle)
- **Quote / invoice / payment visibility** (Financials view)
- **Payment collection** (Financials collect payments)
- **Reports access** — split toggle (operational / financial)
- **Price book edit** (Price Book pack)
- **Timesheet approval** (Team Management — sub-capability)
- **Team member management** (Team Management — without role assignment)
- **Field access if schedulable** (Field Access pack)

Everything else (legal/tax fields, role management, integrations
setup, subscription, refunds, destructive operations) is fixed by
role per Section 5 and is not a toggle.

---

## 7. Permissions to Hide From Default UI

Raw fine-grained permission keys exist in the catalog and may stay
in the database, but they should be **hidden from the default custom-
role editor.** They live only in an "Advanced" disclosure for power
users / debugging, and may be removed from the catalog entirely once
the pack-based UI is the steady state.

Examples to hide:

- `schedule.own.*` (covered by Field Access + `isSchedulable`)
- `schedule.all.delete`
- `notes.all.*` (note access piggybacks on the parent entity)
- `expenses.own.*` (covered by Field Access)
- `expenses.all.*` (covered by Operations / Team Management)
- `expenses.approve` (no approval workflow exists today)
- `clients.view.full` (no UI distinguishes "full" today)
- `clients.delete`
- `jobs.delete`
- `payments.refund` (admin-only, fixed)
- `quotes.approve` (no separate approval surface)
- All other destructive `*.delete` permissions
- Any internal / legacy permission key not currently enforced by
  a server-side gate

The principle: **if toggling a permission in the editor changes
nothing observable in the app, that permission does not belong in
the default UI.**

---

## 8. Implementation Principles

- **Backend must enforce access.** Every pack maps to one or more
  server-side gates. The frontend may hide affordances for clarity,
  but a malicious or stale client cannot bypass the backend.
- **Frontend visibility is secondary.** UI hiding is a UX nicety;
  it is not the security boundary.
- **Use two-layer protection where needed.** Per the canonical
  policy in `CLAUDE.md`:
  ```
  requireRole(MANAGER_ROLES)        // coarse, fast, no DB read
  requirePermission("...")          // fine, DB-backed, honors overrides
  ```
  New fine-permission gates are added **behind**, never in place of,
  the existing coarse role gate.
- **No frontend-only security.** A route hidden in the sidebar but
  reachable by URL must still 403 server-side.
- **Tech app uses `/api/tech/*`.** The technician PWA never reads
  from the office API surface (verified in Phase 2 PR 1 — PR 4).
- **Office app uses office APIs.** No silent path between the two.
- **Custom roles should not rely on raw role-name string checks
  long-term.** As the frontend migrates to permission-based
  visibility (PR 6), the few remaining hardcoded `user.role === ...`
  checks in the office app shell are replaced with
  `useHasPermission(...)` reads. After that point, a custom role
  can navigate the app correctly purely from its permission set.

---

## 9. Future PR Plan

This doc is **PR 1**. The implementation flows in five subsequent
small, reversible PRs.

### PR 2 — UI grouping / readability only

- System-role badges + lock icon in the Manage Roles list
- System roles cannot be edited from the UI (server already rejects;
  add the visual + a "Clone to customize" CTA)
- Show permission packs as one-click toggles in the role and per-user
  override editors
- Hide raw fine-grained permissions behind an "Advanced" disclosure
- Reveal Create Custom Role button (hidden today) with safe defaults

No backend changes. No new permission keys. No new gates.

### PR 3 — Effective access preview

- New endpoint that returns the resolved permission set for a user,
  grouped by pack
- New "What this user can access" panel in the Roles & Access tab,
  showing pack-rollup status (all / partial / none) plus an
  override breakdown (inherited / granted / revoked)
- Read-only audit-log surface for role and override changes on the
  selected user

### PR 4 — Wire high-value backend permissions

Add `requirePermission(...)` mount-level gates **behind** the existing
role gates for the packs that currently lack fine enforcement:

- **Payments** — `financials.collect_payments`
- **Reports** — `reports.operational` / `reports.financial`
- **Price Book** — `pricebook.manage` on writes
- **Team Management** — `team.manage` on writes
- **Settings & Admin** — `settings.manage`, `integrations.manage`,
  `subscription.manage` (owner-only) on the relevant routes

Seed any new permission keys required. Two-layer model preserved
throughout. Tests pin the new gates and verify technician /
unauthorized roles remain blocked.

### PR 5 — Custom role workflow

- "Create custom role from template" wizard (start from owner /
  admin / manager / dispatcher / technician, pick packs, save)
- Clone-system-role flow (replaces the current Edit affordance on
  system roles)
- Reassignment helper inline on Delete (move members to another
  role before the row goes away)

### PR 6 — Frontend permission-based visibility

- Replace the remaining hardcoded role-string checks in the office
  app shell (`ProtectedRoute.tsx`, `AppSidebar.tsx`,
  `OnboardingWizard.tsx`, `SupportConsole.tsx`) with
  `useHasPermission(...)` reads driven by the new effective-access
  endpoint
- Replace `<ProtectedRoute requireAdmin>` etc. with a
  `permission="..."` prop where a clean mapping exists
- Sidebar items become permission-gated

---

## 10. Explicit Non-Goals

This work explicitly **does NOT**:

- Redesign or expand platform admin / platform support
- Allow tenants to configure platform roles or impersonate platform
  identity
- Expose every raw fine-grained permission key in the default UI
- Make tenant subscription / billing controls customizable per role
- Move the security boundary to the frontend
- Replace the existing two-layer (role + permission) model with
  permission-only or role-only enforcement
- Introduce per-tenant permission catalogs (permissions remain global
  per the existing schema; per-user overrides are tied to user IDs)
- Enable destructive operations (refunds, hard deletes, bulk cleanup)
  as customizable toggles
