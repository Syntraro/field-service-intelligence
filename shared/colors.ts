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
