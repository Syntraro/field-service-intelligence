/**
 * Technician PWA — Shared timesheet entry display constants.
 *
 * Single source of truth for entry type labels, colors, and defaults
 * used by TimesheetPage and any future timesheet-related UI.
 */

/** Map backend entry type to human-readable label */
export const ENTRY_TYPE_LABELS: Record<string, string> = {
  travel_to_job: "Travel",
  on_site: "Work",
  travel_to_supplier: "Supplier Run",
  supplier_run: "Supplier Run",
  travel_between_jobs: "Travel",
  admin: "Admin",
  break: "Break",
  other: "Other",
};

/** Map backend entry type to badge color */
export const ENTRY_TYPE_COLORS: Record<string, string> = {
  travel_to_job: "bg-blue-100 text-blue-700",
  on_site: "bg-emerald-100 text-emerald-700",
  travel_to_supplier: "bg-purple-100 text-purple-700",
  supplier_run: "bg-purple-100 text-purple-700",
  travel_between_jobs: "bg-blue-100 text-blue-700",
  admin: "bg-slate-100 text-slate-600",
  break: "bg-amber-100 text-amber-700",
  other: "bg-slate-100 text-slate-600",
};

export const DEFAULT_ENTRY_TYPE_COLOR = "bg-slate-100 text-slate-600";
