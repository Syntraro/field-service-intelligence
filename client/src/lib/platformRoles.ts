/**
 * Canonical platform-role detection on the client. Mirrors the server-side
 * PLATFORM_ROLES constant in server/auth/roles.ts.
 *
 * Platform-role users must NEVER render the tenant shell. Tenant-scoped
 * React Query calls must NEVER fire for them unless an explicit support
 * session is active. Use this helper at every shell/gate decision.
 */

export const PLATFORM_ROLES = [
  "platform_admin",
  "platform_support",
  "platform_billing",
  "platform_readonly_audit",
] as const;

export type PlatformRole = typeof PLATFORM_ROLES[number];

export function isPlatformRole(role: string | undefined | null): role is PlatformRole {
  return !!role && (PLATFORM_ROLES as readonly string[]).includes(role);
}
