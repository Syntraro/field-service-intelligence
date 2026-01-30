/**
 * Client-side Scheduling Permission Helpers
 *
 * Mirrors server-side RBAC for UI gating.
 * Server is source of truth - this is only for UX (disable buttons, etc.)
 *
 * ROLE POLICY:
 * - Allowed to schedule: owner, admin, dispatcher
 * - View-only: technician, manager
 */

// Roles allowed to modify schedules (must match server)
const SCHEDULING_WRITE_ROLES = ["owner", "admin", "dispatcher"] as const;

/**
 * Check if a user role can edit schedules.
 *
 * @param role - User role string
 * @returns true if user can modify schedules
 */
export function canEditSchedule(role: string | undefined | null): boolean {
  if (!role) return false;
  return SCHEDULING_WRITE_ROLES.includes(role as typeof SCHEDULING_WRITE_ROLES[number]);
}

/**
 * Check if a user role is view-only for scheduling.
 *
 * @param role - User role string
 * @returns true if user can only view (not edit) schedules
 */
export function isScheduleViewOnly(role: string | undefined | null): boolean {
  return !canEditSchedule(role);
}
