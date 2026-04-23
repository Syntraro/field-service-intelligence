/**
 * Tests for the canonical platform capability registry.
 *
 * 2026-04-22 Revised Phase 1 Internal Console Separation: proves the
 * role → capability mapping matches the documented contract and that
 * the UNION helper composes multi-role capability sets correctly (forward
 * compat for Phase 2's multi-role identity table).
 */
import { describe, it, expect } from "vitest";
import {
  PLATFORM_CAPABILITIES,
  PLATFORM_ROLE_CAPS,
  capabilitiesForRoles,
  roleSetHasCapability,
  type PlatformCapability,
} from "./platformCapabilities";

describe("PLATFORM_CAPABILITIES registry", () => {
  it("includes every capability referenced by Phase 1 surfaces", () => {
    const required: PlatformCapability[] = [
      "tenant:read",
      "tenant:lifecycle:write",
      "entitlement:override:write",
      "plan:write",
      "feature:catalog:write",
      "support:session:create",
      "support:session:manage",
      "feedback:triage",
      "bulk:write",
      "bulk:dry-run",
      "bulk:history:read",
      "audit:read",
      "platform:user:manage",
      "kpi:read",
    ];
    for (const cap of required) {
      expect(PLATFORM_CAPABILITIES).toContain(cap);
    }
  });
});

describe("PLATFORM_ROLE_CAPS", () => {
  it("platform_admin holds every capability in the registry", () => {
    const adminCaps = PLATFORM_ROLE_CAPS.platform_admin;
    for (const cap of PLATFORM_CAPABILITIES) {
      expect(adminCaps).toContain(cap);
    }
  });

  it("platform_support has read + triage + support session + dry-run (no lifecycle/override/bulk writes)", () => {
    const caps = PLATFORM_ROLE_CAPS.platform_support;
    expect(caps).toContain("tenant:read");
    expect(caps).toContain("support:session:create");
    expect(caps).toContain("support:session:manage");
    expect(caps).toContain("feedback:triage");
    expect(caps).toContain("bulk:dry-run");
    expect(caps).toContain("bulk:history:read");

    expect(caps).not.toContain("tenant:lifecycle:write");
    expect(caps).not.toContain("entitlement:override:write");
    expect(caps).not.toContain("bulk:write");
    expect(caps).not.toContain("plan:write");
    expect(caps).not.toContain("feature:catalog:write");
  });

  it("platform_billing has lifecycle + plan + bulk writes, no feature catalog or override writes", () => {
    const caps = PLATFORM_ROLE_CAPS.platform_billing;
    expect(caps).toContain("tenant:lifecycle:write");
    expect(caps).toContain("plan:write");
    expect(caps).toContain("bulk:write");
    expect(caps).toContain("bulk:dry-run");

    expect(caps).not.toContain("entitlement:override:write");
    expect(caps).not.toContain("feature:catalog:write");
    expect(caps).not.toContain("support:session:create");
    expect(caps).not.toContain("feedback:triage");
  });

  it("platform_readonly_audit holds only read capabilities", () => {
    const caps = PLATFORM_ROLE_CAPS.platform_readonly_audit;
    expect(caps).toContain("tenant:read");
    expect(caps).toContain("audit:read");
    expect(caps).toContain("kpi:read");
    expect(caps).toContain("bulk:history:read");
    expect(caps).toContain("bulk:dry-run");

    expect(caps).not.toContain("tenant:lifecycle:write");
    expect(caps).not.toContain("entitlement:override:write");
    expect(caps).not.toContain("plan:write");
    expect(caps).not.toContain("feature:catalog:write");
    expect(caps).not.toContain("bulk:write");
    expect(caps).not.toContain("support:session:create");
    expect(caps).not.toContain("feedback:triage");
  });
});

describe("capabilitiesForRoles (UNION semantics)", () => {
  it("returns the role's capabilities for a single role", () => {
    const set = capabilitiesForRoles(["platform_support"]);
    expect(set.has("support:session:create")).toBe(true);
    expect(set.has("bulk:write")).toBe(false);
  });

  it("returns the UNION of capabilities across multiple roles", () => {
    // Support + billing should yield BOTH feedback:triage (support-only) AND
    // bulk:write (billing-only). This proves multi-role readiness for Phase 2.
    const set = capabilitiesForRoles(["platform_support", "platform_billing"]);
    expect(set.has("feedback:triage")).toBe(true);
    expect(set.has("bulk:write")).toBe(true);
    expect(set.has("tenant:lifecycle:write")).toBe(true);
    // Neither role holds feature:catalog:write, so the union must not.
    expect(set.has("feature:catalog:write")).toBe(false);
  });

  it("returns an empty set for unknown roles", () => {
    const set = capabilitiesForRoles(["not_a_real_role"]);
    expect(set.size).toBe(0);
  });

  it("skips unknown roles but still unions known ones", () => {
    const set = capabilitiesForRoles(["platform_support", "bogus_role"]);
    expect(set.has("support:session:create")).toBe(true);
  });
});

describe("roleSetHasCapability", () => {
  it("returns true when any role in the set grants the capability", () => {
    expect(roleSetHasCapability(["platform_billing"], "bulk:write")).toBe(true);
    expect(
      roleSetHasCapability(["platform_support", "platform_billing"], "bulk:write"),
    ).toBe(true);
  });

  it("returns false when no role in the set grants the capability", () => {
    expect(
      roleSetHasCapability(["platform_support", "platform_readonly_audit"], "bulk:write"),
    ).toBe(false);
  });

  it("admin satisfies every capability", () => {
    for (const cap of PLATFORM_CAPABILITIES) {
      expect(roleSetHasCapability(["platform_admin"], cap)).toBe(true);
    }
  });
});
