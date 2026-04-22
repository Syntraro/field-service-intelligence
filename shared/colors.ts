/**
 * Shared Technician Color Palette
 *
 * Phase 1 Map Convergence: Single source of truth for technician colors
 * used by both the dispatch board and the live map.
 *
 * Previously: dispatch used DEFAULT_COLORS (8 colors), map used TECH_COLORS (10 colors).
 * Now: both import from here.
 */

export const TECHNICIAN_COLORS = [
  "#3b82f6", // blue
  "#10b981", // emerald
  "#f59e0b", // amber
  "#ef4444", // red
  "#8b5cf6", // violet
  "#ec4899", // pink
  "#06b6d4", // cyan
  "#84cc16", // lime
  "#9333ea", // purple
  "#d97706", // amber-dark
] as const;

/** 2026-03-31: Canonical gray for unassigned visits/technicians (Tailwind slate-400) */
export const UNASSIGNED_COLOR = "#94a3b8";

/** Get a deterministic color for a technician by roster index. */
export function getTechnicianColor(index: number): string {
  return TECHNICIAN_COLORS[index % TECHNICIAN_COLORS.length];
}

/**
 * Resolve the canonical display color for a technician.
 *
 * Single source of truth used by dispatch, team hub, profile page, tech selector,
 * and the tech-app scope picker. Same inputs always return the same color across
 * every surface — no more drift between "Team shows one color, dispatch shows
 * another" (2026-04-20 Phase 3 fix).
 *
 * Resolution rules:
 *   1. If the user has a custom color set in `technician_profiles.color`, use it.
 *   2. Otherwise, derive a stable palette color from the userId. A userId-based
 *      hash means the fallback is order-independent — a tech's color no longer
 *      shifts when the roster is filtered/sorted differently.
 *
 * Do NOT re-implement this inline anywhere. If you need a color, call this.
 */
export function resolveTechnicianColor(
  userId: string,
  profileColor: string | null | undefined,
): string {
  if (profileColor) return profileColor;
  // Cheap, stable string hash — FNV-ish. UUIDs spread cleanly across 10 slots.
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) | 0;
  }
  return TECHNICIAN_COLORS[Math.abs(hash) % TECHNICIAN_COLORS.length];
}
