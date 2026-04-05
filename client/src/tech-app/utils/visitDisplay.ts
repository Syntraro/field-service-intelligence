/**
 * Technician PWA — Shared visit display constants.
 *
 * Single source of truth for status/job-type labels, colors,
 * outcome labels, and display fallback strings used across
 * TodayPage, VisitDetailPage, and visit adapters.
 */

// ── Display fallback strings (shared across adapters) ──

export const UNKNOWN_LOCATION = "Unknown location";
export const NO_ADDRESS = "No address";

// ── Status display ──

export const STATUS_LABELS: Record<string, string> = {
  scheduled: "Scheduled", dispatched: "Scheduled",
  en_route: "En Route",
  in_progress: "On Site", on_site: "On Site",
  completed: "Completed",
  on_hold: "On Hold", cancelled: "Cancelled",
};

export const STATUS_COLORS: Record<string, string> = {
  scheduled: "bg-slate-100 text-slate-600", dispatched: "bg-slate-100 text-slate-600",
  en_route: "bg-blue-100 text-blue-700",
  in_progress: "bg-[#22c55e]/10 text-[#22c55e]", on_site: "bg-[#22c55e]/10 text-[#22c55e]",
  completed: "bg-emerald-100 text-emerald-700",
  on_hold: "bg-red-100 text-red-700", cancelled: "bg-slate-100 text-slate-400",
};

export const DEFAULT_STATUS_COLOR = "bg-slate-100 text-slate-600";

// ── Job type display ──

export const JOB_TYPE_LABELS: Record<string, string> = {
  pm: "PM", service: "Service", urgent: "Urgent", install: "Install",
  repair: "Repair", inspection: "Inspection", maintenance: "PM",
};

export const JOB_TYPE_COLORS: Record<string, string> = {
  pm: "bg-blue-100 text-blue-700",
  maintenance: "bg-blue-100 text-blue-700",
  service: "bg-slate-100 text-slate-600",
  urgent: "bg-red-100 text-red-700",
  install: "bg-purple-100 text-purple-700",
  repair: "bg-amber-100 text-amber-700",
};

export const DEFAULT_JOB_TYPE_COLOR = "bg-slate-100 text-slate-600";

// ── Outcome display ──

export const OUTCOME_LABELS: Record<string, string> = {
  completed: "Completed",
  needs_parts: "Needs Parts",
  needs_followup: "Needs Follow-Up",
};

export const OUTCOME_COLORS: Record<string, string> = {
  completed: "bg-emerald-100 text-emerald-700",
  needs_parts: "bg-amber-100 text-amber-700",
  needs_followup: "bg-blue-100 text-blue-700",
};

export const DEFAULT_OUTCOME_COLOR = "bg-slate-100 text-slate-600";
