/**
 * Canonical query key definitions for team / user / role queries.
 *
 * All team keys use Pattern A (URL-string). No semantic variants exist.
 */

export const teamKeys = {
  /** ["/api/team"] — full team member list */
  all: () => ["/api/team"] as const,

  /** ["/api/team/technicians"] — technician-only list */
  technicians: () => ["/api/team/technicians"] as const,

  /** ["/api/team/technicians/live-state"] — realtime technician activity status */
  liveState: () => ["/api/team/technicians/live-state"] as const,

  /** ["/api/roles"] — role definitions */
  roles: () => ["/api/roles"] as const,

  /** ["/api/permissions"] — permission definitions */
  permissions: () => ["/api/permissions"] as const,
};
