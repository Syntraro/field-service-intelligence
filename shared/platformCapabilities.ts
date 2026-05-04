/**
 * Platform Capabilities — Canonical Registry (2026-04-22 Revised Phase 1).
 *
 * Single source of truth for "what can this platform user see and do?"
 * Shared between server and client so both agree on the mapping. Rewrites
 * scattered `requirePlatformRole([...])` whitelists across `/api/platform/*`
 * into a single capability plane.
 *
 * Design rules:
 *   - Every platform feature maps to exactly one capability.
 *   - A role maps to a set of capabilities via `PLATFORM_ROLE_CAPS`.
 *   - A user's effective capability set is the UNION over every role they
 *     hold. Today users have exactly one platform role (users.role); the
 *     union shape is already multi-role-ready for the Phase 2 migration
 *     to `platform_users` + `platform_user_roles`.
 *   - `platform_admin` is the superset by definition — it holds every
 *     capability. Other roles are strict subsets tuned to their job.
 *   - No secondary "admin console vs support console" split. Visibility +
 *     access differences are expressed purely as capability differences
 *     inside the single internal console.
 */

// ============================================================================
// Capability registry
// ============================================================================

export const PLATFORM_CAPABILITIES = [
  /** Read tenant list + detail + timeline + health + KPIs. */
  "tenant:read",
  /** Extend trial / assign plan / pause / reactivate — single-tenant lifecycle writes. */
  "tenant:lifecycle:write",
  /** Upsert / delete per-tenant feature overrides. */
  "entitlement:override:write",
  /** Plans CRUD (create/update/deactivate). */
  "plan:write",
  /** Feature catalog CRUD (subscription_features). */
  "feature:catalog:write",
  /** Start an impersonation or read-only support session. */
  "support:session:create",
  /** Activate / revoke / close an existing support session. */
  "support:session:manage",
  /** Feedback + issues status / priority / assignee writes. */
  "feedback:triage",
  /** Execute bulk tenant actions LIVE (writes + audit rows). */
  "bulk:write",
  /** Preview bulk actions (dryRun; no writes). */
  "bulk:dry-run",
  /** Read bulk-run history + detail. */
  "bulk:history:read",
  /** Read the platform audit log (future reader surface). */
  "audit:read",
  /** Manage other platform users (Phase 2+; surface not yet built). */
  "platform:user:manage",
  /** Read platform-wide KPIs. */
  "kpi:read",

  // ──────────────────────────────────────────────────────────────────
  // 2026-05-04 — Tenant teardown / hard-delete (HIGH RISK).
  //
  // Four-phase deletion flow (preview → request → approve → execute).
  // Capabilities are deliberately split so a SINGLE role cannot drive
  // the full flow end-to-end — separation of duties is structural,
  // not just policy.
  //
  // Mapping summary:
  //   • preview  — platform_support (read-only feasibility check),
  //                platform_admin, platform_super_admin
  //   • request  — platform_admin, platform_super_admin (initiator)
  //   • approve  — platform_super_admin ONLY (must be a different
  //                user than the initiator; enforced in the route)
  //   • execute  — NEVER granted to a human role. The background
  //                worker checks this capability against a synthetic
  //                "system" actor; any human attempting to execute is
  //                denied at the capability gate.
  // ──────────────────────────────────────────────────────────────────
  "platform:tenant_teardown_preview",
  "platform:tenant_teardown_request",
  "platform:tenant_teardown_approve",
  "platform:tenant_teardown_execute",
] as const;

export type PlatformCapability = (typeof PLATFORM_CAPABILITIES)[number];

// ============================================================================
// Role → capability mapping
// ============================================================================

/**
 * 2026-05-04 — `platform_super_admin` is the new privileged role for
 * tenant teardown approval. It holds every capability INCLUDING
 * `platform:tenant_teardown_approve` (which `platform_admin` does not
 * hold). Everything else is a strict subset.
 *
 * `platform:tenant_teardown_execute` is intentionally NOT in any role's
 * cap set — the background worker passes it as a synthetic system
 * actor; a human cannot execute regardless of role.
 *
 * Delta vs. the pre-Revised-Phase-1 scattered role whitelists:
 *   - `platform_support` LOSES: bulk:write, tenant:lifecycle:write,
 *     entitlement:override:write. Support previously appeared in
 *     BULK_WRITE_ROLES on the server but had no UI to match; now the
 *     capability system denies both sides.
 *   - `platform_billing` LOSES: entitlement:override:write,
 *     feature:catalog:write. Billing is revenue state, not feature
 *     wiring.
 *   - `platform_readonly_audit` stays read-only everywhere.
 */

// 2026-05-04 — split the canonical cap list so neither role auto-grants
// teardown:execute, and only platform_super_admin auto-grants approve.
const HUMAN_NEVER_EXECUTES: readonly PlatformCapability[] =
  PLATFORM_CAPABILITIES.filter(
    (c) => c !== "platform:tenant_teardown_execute",
  );
const ADMIN_NEVER_APPROVES: readonly PlatformCapability[] =
  HUMAN_NEVER_EXECUTES.filter((c) => c !== "platform:tenant_teardown_approve");

export const PLATFORM_ROLE_CAPS: Record<string, readonly PlatformCapability[]> = {
  // Super admin: every human-grantable capability INCLUDING approve.
  platform_super_admin: HUMAN_NEVER_EXECUTES,
  // Admin: every cap EXCEPT approve. Can preview + request, cannot
  // sign off on the second-actor approval. The teardown workflow's
  // structural defense is not just "different user" — it's "different
  // role" too, so an attacker who compromises a single platform-admin
  // account still cannot complete a deletion alone.
  platform_admin: ADMIN_NEVER_APPROVES,

  platform_billing: [
    "tenant:read",
    "tenant:lifecycle:write",
    "plan:write",
    "bulk:write",
    "bulk:dry-run",
    "bulk:history:read",
    "audit:read",
    "kpi:read",
  ],

  platform_support: [
    "tenant:read",
    "support:session:create",
    "support:session:manage",
    "feedback:triage",
    "bulk:dry-run",
    "bulk:history:read",
    "audit:read",
    "kpi:read",
    // 2026-05-04 — Support can run a teardown PREVIEW (read-only
    // feasibility check) but cannot create a request, approve, or
    // execute. Useful for triaging "can we delete this tenant?"
    // without escalating to admin.
    "platform:tenant_teardown_preview",
  ],

  platform_readonly_audit: [
    "tenant:read",
    "bulk:dry-run",
    "bulk:history:read",
    "audit:read",
    "kpi:read",
  ],
};

// ============================================================================
// Helpers
// ============================================================================

/**
 * UNION of capabilities across every role the user holds.
 * Today every platform user has exactly one role, so the array is
 * always single-element. Phase 2's multi-role storage plugs in here
 * without any client changes.
 */
export function capabilitiesForRoles(roles: readonly string[]): Set<PlatformCapability> {
  const out = new Set<PlatformCapability>();
  for (const role of roles) {
    const caps = PLATFORM_ROLE_CAPS[role];
    if (!caps) continue;
    for (const c of caps) out.add(c);
  }
  return out;
}

/** Narrow check — does the given role set include the requested capability? */
export function roleSetHasCapability(
  roles: readonly string[],
  cap: PlatformCapability,
): boolean {
  for (const role of roles) {
    const caps = PLATFORM_ROLE_CAPS[role];
    if (!caps) continue;
    if (caps.includes(cap)) return true;
  }
  return false;
}
