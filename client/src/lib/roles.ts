/**
 * Shared role constants for frontend permission checks.
 * Canonical source: server/auth/roles.ts
 * Must stay in sync with backend MANAGER_ROLES.
 */
export const MANAGER_ROLES = ["owner", "admin", "manager", "dispatcher"] as const;
export type ManagerRole = typeof MANAGER_ROLES[number];

/** Check if a user role is in MANAGER_ROLES */
export function isManagerRole(role: string | undefined | null): boolean {
  return !!(role && (MANAGER_ROLES as readonly string[]).includes(role));
}
