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

/** Roles that can perform field work (task check-in/out, job completion) */
export const TECH_ROLES = ["owner", "admin", "manager", "dispatcher", "technician"] as const;

/** All valid roles in the system */
export const ALL_ROLES = ["owner", "admin", "manager", "dispatcher", "technician"] as const;

/** Type for role strings */
export type Role = typeof ALL_ROLES[number];

/** Type for role groups */
export type RoleGroup = readonly Role[];
