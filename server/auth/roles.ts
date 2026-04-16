/**
 * Centralized Role Definitions
 * 
 * This file defines all role groups used for RBAC across the application.
 * Import from here instead of defining roles inline in route files.
 * 
 * Role Hierarchy (highest to lowest):
 * - owner: Full access to everything
 * - admin: Full access except ownership transfer
 * - manager: Operational access, no user management
 * - dispatcher: Scheduling and job management, no HR/settings
 * - technician: Field work only, limited read access
 */

/** All roles that can perform write operations (create, update, delete) */
export const MANAGER_ROLES = ["owner", "admin", "manager", "dispatcher"] as const;

/** Roles for sensitive operations (team management, company settings, technician creation) */
export const RESTRICTED_MANAGER_ROLES = ["owner", "admin", "manager"] as const;

/** Admin-level roles only (user management, role changes) */
export const ADMIN_ROLES = ["owner", "admin"] as const;

/** Owner-only access (platform admin, tenant health dashboard) */
export const OWNER_ONLY = ["owner"] as const;

/** Roles that can perform field work (task check-in/out, job completion) */
export const TECH_ROLES = ["owner", "admin", "manager", "dispatcher", "technician"] as const;

// 2026-04-10: FIELD_TECHNICIAN_ROLES removed. The tech task route now uses
// requireSchedulable (same as every other tech route) instead of a role-restricted
// gate. Self-assignment is enforced for ALL mobile users regardless of role.

/** All valid tenant roles in the system */
export const ALL_ROLES = ["owner", "admin", "manager", "dispatcher", "technician"] as const;

/** Type for tenant role strings */
export type Role = typeof ALL_ROLES[number];

/** Type for role groups */
export type RoleGroup = readonly Role[];

/**
 * Platform-level roles (staff of the SaaS vendor, not tenant users).
 *
 * Platform roles exist to grant access to the internal Ops Portal and
 * (in a later phase) to initiate support sessions into tenants.
 *
 * Phase 1 rule: holding a platform role does NOT grant tenant data access.
 * Tenant access still requires an active impersonation / support session.
 */
export const PLATFORM_ROLES = [
  "platform_admin",
  "platform_support",
  "platform_billing",
  "platform_readonly_audit",
] as const;

export type PlatformRole = typeof PLATFORM_ROLES[number];

/** True if the given role string is a platform (non-tenant) role. */
export function isPlatformRole(role: string | undefined | null): role is PlatformRole {
  return !!role && (PLATFORM_ROLES as readonly string[]).includes(role);
}

/**
 * Role Hierarchy for Authorization
 *
 * Defines which roles can be assigned/invited by which roles.
 * This prevents privilege escalation (e.g., dispatcher inviting admin).
 *
 * Rules:
 * - owner: Can assign any role
 * - admin: Can assign admin, manager, dispatcher, technician (NOT owner)
 * - manager: Can assign dispatcher, technician only
 * - dispatcher: Can assign technician only
 * - technician: Cannot assign any roles
 */
const ROLE_ASSIGNMENT_PERMISSIONS: Record<Role, readonly Role[]> = {
  owner: ["owner", "admin", "manager", "dispatcher", "technician"] as const,
  admin: ["admin", "manager", "dispatcher", "technician"] as const,
  manager: ["dispatcher", "technician"] as const,
  dispatcher: ["technician"] as const,
  technician: [] as const,
};

/**
 * Check if an inviter role can assign/invite a target role.
 * Used to enforce role hierarchy and prevent privilege escalation.
 *
 * @param inviterRole - The role of the user attempting to assign/invite
 * @param targetRole - The role being assigned/invited
 * @returns true if the assignment is allowed, false otherwise
 */
export function canAssignRole(inviterRole: Role, targetRole: Role): boolean {
  const allowedRoles = ROLE_ASSIGNMENT_PERMISSIONS[inviterRole];
  return allowedRoles.includes(targetRole);
}

/**
 * Asserts that a role assignment is allowed, throws if not.
 *
 * @param inviterRole - The role of the user attempting to assign/invite
 * @param targetRole - The role being assigned/invited
 * @throws Error with message if assignment is not allowed
 */
export function assertCanAssignRole(inviterRole: Role, targetRole: Role): void {
  if (!canAssignRole(inviterRole, targetRole)) {
    throw new Error(`Insufficient permissions to assign role: ${targetRole}`);
  }
}
