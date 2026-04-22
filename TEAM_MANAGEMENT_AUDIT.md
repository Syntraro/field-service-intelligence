# TEAM_MANAGEMENT_AUDIT.md

**Audit date:** 2026-04-20
**Scope:** Phase 1 — research only, no code changes
**Goal:** Convert Team Management from a fragmented "list of profiles" into a centralized workforce-management console at `/settings/team`

---

## 1. Current Architecture

### 1.1 Frontend surfaces (all under `client/src/pages/`)

| Route | Component | Purpose | Sidebar link |
|---|---|---|---|
| `/settings/team` | `TechnicianManagementPage.tsx` | Legacy invite/delete/reset-password page, calls `/api/technicians/*` | **Not linked** (orphan URL) |
| `/manage-team` | `ManageTeam.tsx` | Canonical roster with Add Member + (stub) Invite | Settings → "Team Management" |
| `/manage-team/:userId` | `TeamMemberDetail.tsx` | The *actual* hub — edits basic info, schedule, billing, permissions, activate/deactivate, password reset, email change | Via clicking a row in `/manage-team` |
| `/manage-roles` | `ManageRoles.tsx` | Role CRUD + role→permission matrix | Settings → "Roles & Permissions" |

Routing declarations: `client/src/App.tsx:412, 509, 514, 519`.

### 1.2 Backend surfaces

| Area | Canonical path | File |
|---|---|---|
| Team CRUD hub (900+ lines, real source of truth) | `/api/team/*` | `server/routes/team.ts` |
| Roles + permissions catalog | `/api/roles`, `/api/permissions` | `server/routes/roles.ts` |
| Invitations (token + accept) | `/api/invitations/*` | `server/routes/invitations.ts` |
| Technician live GPS (active) | `GET /api/technicians/live` | `server/routes/technicians.ts` |
| Legacy technician invite/delete/reset | `/api/technicians/*` (non-live) | `server/routes/technicians.ts` |
| Legacy role/disable (dead code) | `/api/users-admin/*` | `server/routes/users_admin.ts` (mounted `routes/index.ts:221`) |
| Calendar + scheduling | `/api/calendar/*` | `server/routes/scheduling.ts` |
| Admin timesheets + payroll | `/api/admin/timesheets/*`, `/api/payroll/*` | `server/routes/timeTracking.ts`, adminTimesheets router |
| Time-billing rules (multipliers, rounding) | `/api/time-billing/rules` | `server/routes/timeBillingRules.ts` |

Auth stack on every team route: `requireAuth` → `ensureTenantContext` → impersonation middleware → `requireRole(RESTRICTED_MANAGER_ROLES | ADMIN_ROLES)` or `requirePermission(...)`.

### 1.3 Storage layer

| Repository | File | Tables touched |
|---|---|---|
| TeamRepository | `server/storage/team.ts` | users, user_identities, technician_profiles, working_hours, user_permission_overrides |
| PermissionRepository | `server/storage/permissions.ts` | roles, permissions, role_permissions, user_permission_overrides |
| InvitationRepository | `server/storage/invitations.ts` | invitations, users, user_identities |
| TechnicianRepository (legacy) | `server/storage/technicians.ts` | technicians (standalone legacy table) |
| SchedulingRepository | `server/storage/scheduling.ts` | jobs, job_visits, job_schedule_audit |
| TimeTrackingRepository | `server/storage/timeTracking.ts` | work_sessions, time_entries, time_approvals, technician_profiles (rate snapshots) |

---

## 2. Canonical Sources of Truth

Use these for the new hub. Everything else is either derived or legacy.

### 2.1 Database

- **User identity** → `users` (`shared/schema.ts:166`). Soft delete via `deletedAt`; `disabled` flag for session lockout; `status` enum for UX only.
- **Login credentials** → `user_identities` (`shared/schema.ts:209`), one row per provider.
- **Role assignment** → `users.roleId` (FK to `roles`). `users.role` (text) is the legacy shadow.
- **Role → permission mapping** → `role_permissions` (`shared/schema.ts:3005`).
- **Per-user permission overrides** → `user_permission_overrides` (`shared/schema.ts:3018`), `override ∈ {grant, revoke}`.
- **Technician pay/billable/color/notes** → `technician_profiles` (`shared/schema.ts:3037`), PK = `userId`.
- **Weekly schedule** → `working_hours` (`shared/schema.ts:3066`), one row per `(userId, dayOfWeek 0–6)`.
- **Tenant default hours (fallback when `users.useCustomSchedule=false`)** → `company_business_hours` (`shared/schema.ts:831`).
- **Invite tokens** → `invitations` (`shared/schema.ts:896`). `invitation_tokens` is a dead parallel table (see §4).
- **Schedulability filter input** → `users.isSchedulable` + `users.disabled` + `users.status`, consumed by `filterSchedulableTechnicians()` (`server/domain/scheduling.ts:507`).

### 2.2 Backend endpoints (already centralized under `/api/team`)

All reachable and production-wired:

```
GET   /api/team                            — roster
POST  /api/team                            — create directly (no invite)
GET   /api/team/:userId                    — detail (includes profile, hours, overrides)
PATCH /api/team/:userId                    — basic info + useCustomSchedule + isSchedulable
PATCH /api/team/:userId/role               — role change (owner/admin safeguards)
PATCH /api/team/:userId/status             — active/inactive toggle
POST  /api/team/:userId/activate           — reactivate
POST  /api/team/:userId/deactivate         — soft delete
PUT   /api/team/:userId/profile            — laborCostPerHour, billableRatePerHour, color, note
PUT   /api/team/:userId/working-hours      — 7-row weekly replace
PUT   /api/team/:userId/permissions        — overrides array
GET   /api/team/:userId/effective-permissions
PUT   /api/team/:userId/email              — login email change (global uniqueness)
PUT   /api/team/:userId/password           — admin reset
POST  /api/team/:userId/send-password-reset
GET   /api/team/:userId/identities
GET   /api/team/roles
GET   /api/team/technicians                — schedulable-only projection (dispatch feed)
GET   /api/team/technicians/live-state     — clocked/on-site/idle
GET   /api/team/technicians/working-hours  — bulk for dispatch/capacity
```

Roles/permissions are handled by `server/routes/roles.ts` (`/api/roles`, `/api/permissions`, `/api/roles/:roleId/permissions`).

Invites are handled by `server/routes/invitations.ts` (`POST /api/invitations`, `POST /api/invitations/:id/resend`, `POST /api/invitations/accept`).

### 2.3 Domain invariants that MUST NOT break

- `filterSchedulableTechnicians(users)` (`server/domain/scheduling.ts:507`) — predicate = `disabled=false AND isSchedulable!=false AND status='active'`. Every assignment dropdown, dispatch lane, and capacity calculation depends on this exact predicate.
- Visit-filter predicates in `server/lib/visitPredicates.ts` (`scheduleEligibleVisitFilter`, `reconciliationActionableVisitFilter`, `uncompletedVisitFilter`) — frozen by the 2026-03-18 performance baseline (`CLAUDE.md`). Do not touch, regardless of team-hub work.
- `batchApplyLineTax()` in `server/storage/invoices.ts` — untouched by this refactor, but listed in baseline; be defensive.
- `refetchIntervalInBackground: false` on all polling hooks — must be preserved on any new hub polling.

---

## 3. Duplicate Flows

### 3.1 Two "/team" pages with overlapping responsibilities

- `/settings/team` (`TechnicianManagementPage.tsx`) — talks to legacy `/api/technicians/invite`, `/api/technicians/:id`, `/api/technicians/:id/reset-password` (`client/src/pages/TechnicianManagementPage.tsx:27, 41, 54`).
- `/manage-team` (`ManageTeam.tsx`) — talks to canonical `/api/team`.
- Sidebar only links to `/manage-team`. `/settings/team` is reachable only by URL and is effectively an unlabeled ghost of the feature.

### 3.2 Three ways to add/invite a user

- `ManageTeam.tsx:257-356` "Add Member" dialog → `POST /api/team` (creates user, password-reset flow assumed).
- `ManageTeam.tsx:358-437` "Invite Member" dialog → **stub only**. `handleInviteSubmit` at `ManageTeam.tsx:235` just shows a toast and never calls `/api/invitations`. This is broken UX shipped as-is.
- `TechnicianManagementPage.tsx:27` "Invite Technician" → `POST /api/technicians/invite` (legacy, unknown server status).

The invitations backend (`POST /api/invitations`) exists, works, enforces `canAssignRole`, and is tied to `acceptInvitation()` + email identity creation. **No UI currently reaches it.**

### 3.3 Two legacy backend role/disable endpoints

- `PATCH /api/users-admin/:id/role` and `POST /api/users-admin/:id/disable` (`server/routes/users_admin.ts`, mounted at `server/routes/index.ts:221`).
- Superseded entirely by `PATCH /api/team/:userId/role` and `POST /api/team/:userId/deactivate`.
- No frontend in `client/src/**` references `/api/users-admin` (grep confirms only backend self-refs + docs).

### 3.4 Two technician tables at the DB layer

- `technicians` (`shared/schema.ts:950`) — legacy, keyed independently of users; has both `isActive` and `deletedAt`.
- `technician_profiles` (`shared/schema.ts:3037`) — modern, PK = `userId`, holds pay/rate/color.
- `server/routes/technicians.ts:POST /api/technicians` still writes to `technicians`. No modern code path reads it.

### 3.5 Two invitation tables

- `invitations` (`shared/schema.ts:896`) — actively used by `invitationRepository`.
- `invitation_tokens` (`shared/schema.ts:992`) — parallel schema, no repository or route references it in the tree. Dead.

### 3.6 Two status flags on `users`

- `status` text enum: `active | invited | deactivated`.
- `disabled` boolean.
- Both are written by `deactivateTeamMember()` / `activateTeamMember()` simultaneously. Reading code is inconsistent (`disabled` drives schedulability; `status` drives UI badges).

### 3.7 Two role columns on `users`

- `role` text (legacy).
- `roleId` FK (modern).
- Writes happen to both; reads vary by surface. Migration is in progress; hub must read `roleId` + join `roles`.

### 3.8 Two permission caches

- In-memory Map in `server/storage/permissions.ts:clearPermissionCache`.
- Service cache via `server/services/cache.ts` (`CacheKeys.userPermissions`).
- Both get invalidated together in `team.ts:setUserPermissionOverrides` — no bug today, but the redundancy is a foot-gun for future contributors.

---

## 4. Dead Flows

Confirmed by grep across `client/src/**` and `server/**`:

| Target | Status | Evidence |
|---|---|---|
| `server/routes/users_admin.ts` (entire file) | Dead — no frontend caller | grep `users-admin` returns only `server/routes/index.ts:221` registration + docs |
| `POST /api/technicians` (`server/routes/technicians.ts`) | Legacy — writes to dead `technicians` table | No FE caller |
| `technicians` table | Legacy — shadowed by `users + technician_profiles` | Only written by the dead POST above |
| `invitation_tokens` table | Dead — no repository, no route, no FE reference | grep confirms |
| "Invite Member" dialog in `ManageTeam.tsx` | Stub — calls `handleInviteSubmit` which only toasts | `ManageTeam.tsx:235` |
| `/api/technicians/invite`, `/api/technicians/:id DELETE`, `/api/technicians/:id/reset-password` | Still wired on both ends via `TechnicianManagementPage.tsx`, but the page is the orphan at `/settings/team` and duplicates `/api/team/*` functionality | `TechnicianManagementPage.tsx:27, 41, 54` |
| `users.role` text column | Legacy shadow of `roleId` — still read in auth deserialization; cannot delete yet | Migration in progress |

**Nothing is safe to delete during Phase 2.** All removals wait until after the hub is live and every consumer is verified migrated.

---

## 5. UX Pain Points

Root cause of the refactor: **every workforce operation forces a navigate-into-detail-page → edit → back → repeat cycle.**

Concrete examples (all grep-verified):

1. **Schedule editing is trapped in `TeamMemberDetail.tsx:756-841`.** To edit three technicians' hours, admin navigates: list → Alice → save → back → Bob → save → back → Charlie. The canonical endpoint `PUT /api/team/:userId/working-hours` is already bulk-capable; the UX is the bottleneck.
2. **Active/Inactive toggles exist only on detail page** (`TeamMemberDetail.tsx:1172-1207`). The list view (`ManageTeam.tsx`) shows status as a read-only badge. No bulk disable.
3. **Pay rate + billable rate live on detail page** (`TeamMemberDetail.tsx:844-935`) behind multi-click navigation. Finance ops reviewing rates for 10 techs = 20+ navigations.
4. **Role changes and permission overrides are in different places** (`ManageRoles.tsx` vs `TeamMemberDetail.tsx:938-1165`). No single view of "who can do X".
5. **The invite UI that the backend actually supports doesn't exist.** `/api/invitations` works; no page calls it.
6. **Two discoverable team routes** (`/settings/team`, `/manage-team`) with different capabilities. Sidebar points to `/manage-team`; the orphan at `/settings/team` is the route name the user wants.
7. **Dispatch capacity + Today's Operations cards already consume `/api/team/technicians/working-hours`** — edits made in a new centralized schedule editor will propagate without backend changes.

---

## 6. Cross-System Dependencies (Do Not Regress)

| System | Reads | Hot-path risk |
|---|---|---|
| Dispatch board (`DispatchPreview.tsx`, `dispatchDataCore.ts`) | `/api/team/technicians`, `/api/team/technicians/live-state`, `/api/team/technicians/working-hours`, `/api/calendar` | HIGH — indexed visit filter; schedulable predicate |
| Dashboard "Today's Operations" (`Dashboard.tsx`, `TodaysOperationsCard.tsx`) | `/api/dashboard/capacity` (uses `teamRepository.getWorkingHours` + `businessHoursRepository.getCompanyBusinessHours`) | HIGH — canonical capacity math in `server/storage/capacity.ts:22-43` |
| Calendar grids (`WeekDispatchGrid.tsx`, `MonthDispatchGrid.tsx`) | Same as dispatch | MEDIUM |
| Tech app Today (`tech-app/pages/TodayPage.tsx`) | `/api/tech/visits/today`, `/api/tech/time/summary`; role-scoped | MEDIUM — `schedule.all.view` permission gate |
| Timesheets + Payroll (`PayrollPage.tsx`, `TimesheetReportPage.tsx`) | `/api/admin/timesheets/*`, `/api/payroll/*`, `laborCostPerHour` from technician profile | MEDIUM — cost-rate snapshots |
| Job assignment selectors (`TechnicianSelector.tsx`, `VisitTeamAssignment.tsx`) | `/api/team/technicians` filtered through `filterSchedulableTechnicians()` | **CRITICAL** — guards every dispatch assignment |
| Live GPS (`useLiveTechnicians.ts`) | `/api/technicians/live` | LOW — unrelated to hub scope; leave alone |
| Reports (`Reports.tsx`, timesheet reports) | Technician names + rates | LOW |

**Performance baseline (CLAUDE.md 2026-03-18):**

- Do NOT modify `scheduleEligibleVisitFilter`, `reconciliationActionableVisitFilter`, `uncompletedVisitFilter`.
- Do NOT add polling without `refetchIntervalInBackground: false`.
- Do NOT reintroduce per-line tax loops (invoice area, unrelated to this work but listed for completeness).

---

## 7. Safe Implementation Plan (Phase 2 preview — awaiting approval)

### 7.1 Scope rule: backend is already done

Nearly every capability the new hub needs is already live on `/api/team/*`, `/api/roles`, `/api/permissions`, `/api/invitations`. Phase 2 is **predominantly a frontend consolidation** plus two small backend deletions. No schema changes required.

### 7.2 New page at `/settings/team` replaces `TechnicianManagementPage.tsx`

Layout per prompt: top bar (title, member count, Add, search/filter) + tabs.

| Tab | Contents | Reuses |
|---|---|---|
| **Members** | Roster grid (name, role, email, status, isSchedulable, actions). Row actions: Edit basics, Disable/Enable, Send password reset, Open full profile. | `GET /api/team`, `POST /api/team/:userId/activate\|deactivate`, `POST /api/team/:userId/send-password-reset` |
| **Schedules** | Left selector (all techs) + right editor (7-day grid, start/end, "Copy Mon→Fri", "Apply to selected"). Inline switch between techs without leaving page. | `GET /api/team/technicians/working-hours`, `PUT /api/team/:userId/working-hours` |
| **Compensation** | Per-user `laborCostPerHour` + `billableRatePerHour` + overtime reference (from `time_billing_rules`). Inline edit, one row per user. | `GET /api/team` joined with profile data, `PUT /api/team/:userId/profile`, `GET/PUT /api/time-billing/rules` (read-only display in this tab if appropriate) |
| **Roles & Access** | Tech selector + role dropdown + permission-override matrix. Also surfaces the existing `ManageRoles.tsx` role CRUD as a secondary panel. | `PATCH /api/team/:userId/role`, `PUT /api/team/:userId/permissions`, `GET /api/roles`, `GET /api/permissions`, `GET /api/team/:userId/effective-permissions` |
| **Availability** *(placeholder)* | Stub card noting "Coming soon". No schema changes, no dead UI left in. Only add if Phase 2 scope grows — per prompt rule "use placeholders wired to existing fields only". |

### 7.3 Add functional Invite flow

Wire the already-broken `ManageTeam.tsx:358-437` dialog — or its replacement in the new Members tab — to `POST /api/invitations`. Success toast + row appearing in roster with `status='invited'` comes for free from existing backend.

### 7.4 Keep `/manage-team/:userId` alive as the personal profile page

Per prompt: "User profile page becomes personal-detail page." `TeamMemberDetail.tsx` stays and keeps its sections. The hub tabs duplicate none of it — hub = bulk/ops, detail = drill-down. Row "Open full profile" navigates to `/manage-team/:userId`.

### 7.5 Route migration

- `/settings/team` → new hub (replaces `TechnicianManagementPage.tsx`).
- `/manage-team` → redirect to `/settings/team` (wouter `Redirect`) OR keep as alias; prompt says the user wants the canonical URL at `/settings/team`.
- `/manage-team/:userId` → unchanged (personal profile).
- `/manage-roles` → either keep as-is and link from "Roles & Access" tab, or embed. Preference: embed minus the role-CRUD flow (admin-only sub-panel) to reduce route count.
- Sidebar `AppSidebar.tsx` Settings → "Team Management" updated to point at `/settings/team`.

### 7.6 Cleanup (Phase 2 final step only)

After the hub is verified end-to-end:

1. Delete `TechnicianManagementPage.tsx` and its imports from `App.tsx`.
2. Delete `server/routes/users_admin.ts` and its `app.use()` line at `server/routes/index.ts:221`.
3. Delete the legacy `POST /api/technicians` route handler in `server/routes/technicians.ts` (keep `GET /api/technicians/live` — that one is live-used by GPS).
4. Consider scheduling a migration to drop `invitation_tokens` table — defer unless asked; no code references it, but drop is destructive.
5. Keep `technicians` table + `users.role` column. Both are referenced in live code paths outside team-hub scope; dropping them is a separate refactor.

Per `CLAUDE.md`: every code change in Phase 2 must include code comments, CHANGELOG entry, and (if any DB change occurs) migration file. Phase 2 should be DB-free.

### 7.7 Verification matrix (Phase 2 exit gate)

- [ ] Add user via Members tab → row appears → can log in after password reset
- [ ] Invite user via Members tab → email sent → accept creates user with correct role
- [ ] Edit schedule in Schedules tab → `/api/dashboard/capacity` reflects change without reload
- [ ] Change role in Roles tab → dispatch assignment dropdown updates (schedulable predicate)
- [ ] Disable user from Members row → disappears from `/api/team/technicians` → dispatch lanes update
- [ ] `/manage-team/:userId` still renders and saves (personal profile intact)
- [ ] Tech-app Today page still loads for a technician with modified schedule
- [ ] Impersonation banner still polls unaffected
- [ ] No new polling hook lacks `refetchIntervalInBackground: false`

---

## 8. Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | Breaking `filterSchedulableTechnicians()` semantics by exposing `isSchedulable` toggle in hub | Reuse `PATCH /api/team/:userId` — server already enforces predicate |
| R2 | Cache divergence when hub bulk-edits schedules | `PUT /api/team/:userId/working-hours` already invalidates downstream via TanStack; confirm hub mutations call `queryClient.invalidateQueries(["/api/team/technicians/working-hours"])` |
| R3 | Performance regression on Members tab if it fetches all per-user profiles individually | Use existing `GET /api/team` (list) + `GET /api/team/technicians` (rates/colors); avoid N+1 per-user detail fetches |
| R4 | Invite email flow untested in production (UI previously never called it) | Send one real invite in staging before shipping; verify `acceptInvitation` path and email delivery |
| R5 | Removing `/manage-team` route could break bookmarks | Keep as `Redirect` to `/settings/team` |
| R6 | Role migration (`role` vs `roleId`) is incomplete — hub must tolerate users with null `roleId` | Read `roleId` first, fall back to `role` text; do not write only one side |
| R7 | `users.status` vs `users.disabled` inconsistency — hub UI must pick one | Read `disabled` for schedulability; display `status` only in a badge. Writes continue to update both (via existing storage layer). |
| R8 | Compensation tab surfacing billable rate could be misread as invoice line-rate | Label clearly; this is the default per-user rate, not the per-invoice override |
| R9 | Dropping `invitation_tokens` without prior migration check could fail in production if any old data exists | Defer. Not required for Phase 2. |
| R10 | Tech-app changes — refactoring hub MUST NOT alter `/api/tech/*` endpoints | Hub is strictly admin-side. Verified: no tech-app file reads `/api/team/*` directly. |

---

## 9. Phase 2 Summary (one-paragraph pitch, for approval)

Replace `TechnicianManagementPage.tsx` at `/settings/team` with a tabbed hub (Members / Schedules / Compensation / Roles & Access). Reuse the already-canonical `/api/team/*`, `/api/roles`, `/api/permissions`, `/api/invitations` endpoints — no new routes, no schema changes. Wire the currently-broken invite dialog to `POST /api/invitations`. Keep `/manage-team/:userId` as the personal profile page. Delete three dead files after the hub ships: `TechnicianManagementPage.tsx`, `server/routes/users_admin.ts`, and the legacy `POST /api/technicians` handler. Expected diff: ~4 new client files, ~3 deletions, zero migrations, zero backend-route additions.

**STOP — awaiting Phase 2 approval before implementation.**
