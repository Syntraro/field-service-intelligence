/**
 * Scheduling Permission Guards
 *
 * Centralizes RBAC checks for scheduling operations.
 *
 * ROLE POLICY:
 * - Allowed to schedule (create/update/delete): owner, admin, dispatcher
 * - View-only (cannot schedule): technician, manager
 *
 * NOTE: manager is view-only for scheduling per this slice's requirements.
 */

import type { User } from "@shared/schema";

// Roles allowed to modify schedules
const SCHEDULING_WRITE_ROLES = ["owner", "admin", "dispatcher"] as const;

/**
 * Check if a user can edit schedules (create/update/delete assignments).
 *
 * @param user - The user object (must have role property)
 * @returns true if user can modify schedules
 */
export function canEditSchedule(user: { role?: string } | null | undefined): boolean {
  if (!user?.role) return false;
  return SCHEDULING_WRITE_ROLES.includes(user.role as typeof SCHEDULING_WRITE_ROLES[number]);
}

/**
 * Error thrown when user lacks scheduling permission.
 */
export class SchedulingForbiddenError extends Error {
  public readonly statusCode = 403;
  public readonly code = "FORBIDDEN";

  constructor() {
    super("You do not have permission to modify scheduling.");
    this.name = "SchedulingForbiddenError";
  }

  toJSON() {
    return {
      code: this.code,
      error: this.message,
    };
  }
}

/**
 * Assert that user can edit schedules. Throws 403 if not.
 *
 * @param user - The user object from req.user
 * @throws SchedulingForbiddenError if user lacks permission
 */
export function assertCanEditSchedule(user: { role?: string } | null | undefined): void {
  if (!canEditSchedule(user)) {
    throw new SchedulingForbiddenError();
  }
}
