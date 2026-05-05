/**
 * Permission Packs — UI grouping for the role customization surfaces.
 *
 * 2026-05-04 PR 2: this module is the SOLE source of truth for how the
 * 8 product packs from `docs/ACCESS_CONTROL_MATRIX.md` map onto the
 * raw permission keys returned by `GET /api/permissions`. Both the
 * Manage Roles editor and the per-user override editor in
 * `RolesAccessTab` consume this module so the two surfaces stay
 * coherent.
 *
 * Notes:
 *   - The mapping is a soft UI grouping. Backend authorization still
 *     reads individual permission keys; this module does NOT change
 *     what gets saved.
 *   - "Advanced" keys are still saved through the same endpoint when
 *     toggled — they're just hidden by default to reduce noise.
 *   - "Enforced" flags are derived from a hand-maintained allowlist of
 *     keys that the backend currently consults at the route level.
 *     Other keys are accepted by `/api/roles/:id/permissions` and
 *     `/api/team/:id/permissions` but do not change observable app
 *     behavior — they're surfaced with a subtle helper label so admins
 *     don't think a toggle does something it doesn't.
 *
 * Update process: when a new permission is seeded server-side, add it
 * to `PERMISSION_PACK_MAPPING` (or to `ADVANCED_PERMISSION_KEYS` if it
 * is internal/unenforced). If a backend gate is added that consults a
 * permission key, add the key to `ENFORCED_PERMISSION_KEYS`.
 */

/** Stable id used in URLs / data-testid; never user-visible directly. */
export type PermissionPackId =
  | "operations"
  | "dispatch"
  | "field-access"
  | "financials"
  | "reports"
  | "price-book"
  | "team-management"
  | "admin-settings";

export interface PermissionPack {
  id: PermissionPackId;
  label: string;
  description: string;
  /** Permission keys that belong to this pack. May be empty for packs
   *  whose enforcement lives outside the permission catalog (e.g. Field
   *  Access is gated by `users.isSchedulable` + tech-app routes, not
   *  by individual permission keys). */
  permissionKeys: readonly string[];
}

/**
 * 8 packs in display order. Matches Section 3 of
 * `docs/ACCESS_CONTROL_MATRIX.md`.
 */
export const PERMISSION_PACKS: readonly PermissionPack[] = [
  {
    id: "operations",
    label: "Operations",
    description:
      "Day-to-day work surface: dashboard, jobs, clients/locations, equipment, leads, tasks.",
    permissionKeys: [
      "dashboard.view",
      "jobs.view",
      "jobs.edit",
      "jobs.delete", // advanced
      "clients.view.basic",
      "clients.view.full", // advanced
      "clients.edit",
      "clients.delete", // advanced
    ],
  },
  {
    id: "dispatch",
    label: "Dispatch",
    description:
      "Calendar, scheduling, assigning and reassigning visits, team workload visibility.",
    permissionKeys: [
      "schedule.all.view",
      "schedule.all.edit",
      "schedule.all.delete", // advanced
    ],
  },
  {
    id: "field-access",
    label: "Field Access",
    description:
      "Technician PWA access — assigned visits, own time clock, field notes. Additionally gated by Schedulable.",
    permissionKeys: [
      "schedule.own.view",
      "schedule.own.complete",
      "schedule.own.edit",
      "time.own.edit",
      "notes.jobs.view",
      "expenses.own.edit",
    ],
  },
  {
    id: "financials",
    label: "Financials",
    description:
      "Quotes, invoices, payments, job costing and margins. Split between view and collect-payments.",
    permissionKeys: [
      "quotes.view",
      "quotes.edit",
      "quotes.approve", // advanced
      "invoices.view",
      "invoices.edit",
      "invoices.send",
      "payments.view",
      "payments.collect",
      "payments.refund", // advanced
      "pricing.view",
      "job_costing.view",
      "expenses.all.view", // advanced
      "expenses.all.edit", // advanced
    ],
  },
  {
    id: "reports",
    label: "Reports",
    description: "Operational and financial reporting.",
    permissionKeys: ["reports.view.basic", "reports.view.financial"],
  },
  {
    id: "price-book",
    label: "Price Book",
    description: "Catalog items, tax rules, job templates, equipment types.",
    permissionKeys: ["pricing.edit"],
  },
  {
    id: "team-management",
    label: "Team Management",
    description:
      "Invite, edit, and deactivate users. Approve timesheets. Does NOT include role assignment.",
    permissionKeys: [
      "team.view",
      "team.manage",
      "time.all.view",
      "time.all.edit",
      "time.approve",
      "expenses.approve", // advanced
    ],
  },
  {
    id: "admin-settings",
    label: "Admin / Settings",
    description:
      "Company profile, integrations, role management, tenant subscription. Highest-trust pack.",
    permissionKeys: [
      "settings.manage",
      "integrations.manage",
      "roles.manage",
      "permissions.manage",
      "notes.all.view", // advanced
      "notes.all.edit", // advanced
      "notes.all.delete", // advanced
    ],
  },
];

/**
 * Permission keys that should be HIDDEN behind the "Advanced" disclosure
 * by default. These map roughly to:
 *   - micro-permissions whose product question is already answered by
 *     a higher-level pack toggle (e.g. `schedule.own.*` inside the
 *     Field Access pack — but kept here too so individual keys can be
 *     hidden when the pack is collapsed, even though they're listed
 *     inside Field Access).
 *   - destructive deletes that should remain role-fixed per the matrix
 *   - approval / refund flows that don't have a UI today
 *   - unenforced keys (also flagged via `ENFORCED_PERMISSION_KEYS`)
 *
 * Per ACCESS_CONTROL_MATRIX.md Section 7.
 */
export const ADVANCED_PERMISSION_KEYS: ReadonlySet<string> = new Set([
  // Destructive deletes (role-fixed per matrix)
  "schedule.all.delete",
  "jobs.delete",
  "clients.delete",
  "notes.all.delete",
  // Refunds (admin-fixed)
  "payments.refund",
  // Approval flows without a dedicated UI
  "quotes.approve",
  "expenses.approve",
  // "Full" client view that no UI distinguishes today
  "clients.view.full",
  // Note read/edit at scale — piggybacks on parent entity in the UI
  "notes.all.view",
  "notes.all.edit",
  // Expense read/edit at scale — Operations / Team Management pack
  // already covers this from the user's perspective.
  "expenses.all.view",
  "expenses.all.edit",
]);

/**
 * Permission keys that the backend ACTUALLY consults at the route
 * layer today (Phase 1 + Phase 2 PR 4 + Phase 2 PR 4 office-route
 * lockdown + Phase 2 PR 4 high-value permission wiring).
 *
 * Other keys are accepted by the role/override save endpoints but
 * do not change observable app behavior — the UI labels them with
 * a "Available for future access controls" hint so admins don't
 * think a toggle controls something it doesn't.
 *
 * Update this list when a new `requirePermission(...)` gate is added.
 */
export const ENFORCED_PERMISSION_KEYS: ReadonlySet<string> = new Set([
  // Phase 1 + Phase 2 dashboard authz fix.
  "dashboard.view",
  "jobs.view",
  "clients.view.basic",
  "invoices.view",
  "quotes.view",
  "roles.manage",
  "permissions.manage",
  // Phase 2 PR 4 — high-value permission wiring (2026-05-04).
  "payments.view",
  "payments.collect",
  "reports.view.basic",
  "reports.view.financial",
  "pricing.edit",
  "team.view",
  "team.manage",
  "settings.manage",
  "integrations.manage",
]);

/** Lookup: permission key → pack id. null if uncategorized (goes into Advanced > Other). */
export function packIdForPermissionKey(
  key: string,
): PermissionPackId | null {
  for (const pack of PERMISSION_PACKS) {
    if (pack.permissionKeys.includes(key)) return pack.id;
  }
  return null;
}

export function isAdvancedPermission(key: string): boolean {
  return ADVANCED_PERMISSION_KEYS.has(key);
}

export function isPermissionEnforced(key: string): boolean {
  return ENFORCED_PERMISSION_KEYS.has(key);
}

/**
 * Generic shape: any permission record with a `name` (the key) is
 * accepted. Both the office Manage Roles surface and the per-user
 * override editor can pass their own fuller types in.
 */
export interface PermissionLike {
  name: string;
}

export interface PackGroup<T extends PermissionLike> {
  pack: PermissionPack;
  /** Permissions in this pack that are NOT in the Advanced list. */
  primary: T[];
  /** Permissions in this pack that ARE in the Advanced list (rolled
   *  up under the pack's "Advanced" disclosure). */
  advanced: T[];
}

export interface GroupedPermissions<T extends PermissionLike> {
  /** Packs in display order; only those that have at least one
   *  matching permission in the catalog are returned. */
  packs: PackGroup<T>[];
  /** Permissions whose key is not mapped into any pack. Surface
   *  these under a generic "Other (Advanced)" disclosure. */
  unmapped: T[];
}

// ── Pack-rollup status (Phase 2 PR 3) ────────────────────────────────

/**
 * Per-pack access status used by the "Effective Access" preview.
 *   - "full"      = at least one ENFORCED key in this pack is in the
 *                   user's effective set. The user genuinely has the
 *                   pack from a backend-gate perspective.
 *   - "partial"   = no enforced key is granted, but at least one
 *                   permission in the pack is granted. The toggle is
 *                   "set" but doesn't currently change app behavior
 *                   (informational only).
 *   - "none"      = no permission in the pack is granted.
 */
export type PackAccessStatus = "full" | "partial" | "none";

export interface PackAccessRow {
  pack: PermissionPack;
  status: PackAccessStatus;
  /** How many permissions in this pack are in `effective`. */
  grantedCount: number;
  /** Total permissions declared in the pack. */
  totalCount: number;
  /** Whether at least one ENFORCED permission in this pack is granted. */
  hasEnforcedAccess: boolean;
}

/**
 * Roll an effective-permissions list up into per-pack status. Used
 * by the read-only "What this user can access" panel introduced in
 * PR 3.
 *
 * Returns one row per pack in the canonical display order, plus a
 * convenience map keyed by pack id.
 */
export function getPackAccess(
  effectivePermissions: readonly string[],
): { rows: PackAccessRow[]; byPackId: Record<PermissionPackId, PackAccessRow> } {
  const granted = new Set(effectivePermissions);
  const rows: PackAccessRow[] = [];
  const byPackId = {} as Record<PermissionPackId, PackAccessRow>;
  for (const pack of PERMISSION_PACKS) {
    let grantedCount = 0;
    let hasEnforcedAccess = false;
    for (const key of pack.permissionKeys) {
      if (!granted.has(key)) continue;
      grantedCount++;
      if (ENFORCED_PERMISSION_KEYS.has(key)) hasEnforcedAccess = true;
    }
    let status: PackAccessStatus;
    if (hasEnforcedAccess) status = "full";
    else if (grantedCount > 0) status = "partial";
    else status = "none";
    const row: PackAccessRow = {
      pack,
      status,
      grantedCount,
      totalCount: pack.permissionKeys.length,
      hasEnforcedAccess,
    };
    rows.push(row);
    byPackId[pack.id] = row;
  }
  return { rows, byPackId };
}

/**
 * Group an arbitrary permissions list into the 8 packs + the
 * Advanced disclosure. Stable order: packs render in the order
 * declared above, primary entries before advanced entries within
 * each pack.
 */
export function groupPermissionsByPack<T extends PermissionLike>(
  permissions: readonly T[],
): GroupedPermissions<T> {
  const byPack = new Map<PermissionPackId, { primary: T[]; advanced: T[] }>();
  for (const pack of PERMISSION_PACKS) {
    byPack.set(pack.id, { primary: [], advanced: [] });
  }
  const unmapped: T[] = [];
  for (const perm of permissions) {
    const id = packIdForPermissionKey(perm.name);
    if (!id) {
      unmapped.push(perm);
      continue;
    }
    const bucket = byPack.get(id)!;
    if (isAdvancedPermission(perm.name)) bucket.advanced.push(perm);
    else bucket.primary.push(perm);
  }
  const packs: PackGroup<T>[] = [];
  for (const pack of PERMISSION_PACKS) {
    const bucket = byPack.get(pack.id)!;
    if (bucket.primary.length === 0 && bucket.advanced.length === 0) continue;
    packs.push({ pack, primary: bucket.primary, advanced: bucket.advanced });
  }
  return { packs, unmapped };
}
