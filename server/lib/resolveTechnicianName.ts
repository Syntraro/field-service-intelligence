/**
 * Canonical technician display name resolution — Phase 4 Part B.
 *
 * Single fallback chain used everywhere instead of 6 divergent patterns.
 *
 * Priority: fullName → (firstName + " " + lastName) → firstName → lastName → email → "Unknown"
 *
 * Replaces:
 *   - calendar.ts:346, 568 (fullName → first+last → first → "Unknown")
 *   - timeTracking.ts:2429 (first+last → first → last → email)
 *   - team.ts:270 (fullName → first+last → email)
 *   - scheduling.ts:568 (fullName → email → id)
 *   - jobs.ts:1416 (fullName only, no fallback)
 */

/** Input shape — accepts any user-like object with optional name fields. */
interface UserNameFields {
  fullName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
}

/**
 * Resolve a single display name for a technician/user.
 * Uses the most robust fallback chain from the codebase (calendar.ts pattern)
 * extended with lastName and email fallbacks.
 */
export function resolveTechnicianName(user: UserNameFields): string {
  if (user.fullName?.trim()) return user.fullName.trim();

  const first = user.firstName?.trim();
  const last = user.lastName?.trim();
  if (first && last) return `${first} ${last}`;
  if (first) return first;
  if (last) return last;
  if (user.email?.trim()) return user.email.trim();

  return "Unknown";
}

/** Profile shape for color resolution. */
interface TechnicianProfile {
  color?: string | null;
}

/**
 * Resolve both display name and color for a technician.
 * Companion to resolveTechnicianName for calendar/schedule contexts.
 */
export function resolveTechnicianDisplay(
  user: UserNameFields,
  profile?: TechnicianProfile
): { name: string; color: string } {
  return {
    name: resolveTechnicianName(user),
    color: profile?.color || "#6B7280",
  };
}
