/** Technician PWA — Visit display helpers
 *  2026-04-03: Updated action labels for state-driven single primary action. */

import type { VisitStatus, JobType } from "../types";

export const STATUS_LABELS: Record<VisitStatus, string> = {
  scheduled: "Scheduled",
  en_route: "En Route",
  in_progress: "On Site",
  completed: "Completed",
  on_hold: "On Hold",
};

export const STATUS_COLORS: Record<VisitStatus, string> = {
  scheduled: "bg-slate-100 text-slate-600",
  en_route: "bg-blue-100 text-blue-700",
  in_progress: "bg-[#22c55e]/10 text-[#22c55e]",
  completed: "bg-emerald-100 text-emerald-700",
  on_hold: "bg-red-100 text-red-700",
};

/** State-driven primary action label */
export const PRIMARY_ACTION: Partial<Record<VisitStatus, string>> = {
  scheduled: "Start Travel",
  en_route: "Start Job",
};

/** Primary action button styling per status */
export const ACTION_COLORS: Partial<Record<VisitStatus, string>> = {
  scheduled: "bg-blue-600 hover:bg-blue-700 text-white",
  en_route: "bg-[#22c55e] hover:bg-[#1db350] text-white",
};

/** Job type badge config */
export const JOB_TYPE_LABELS: Record<JobType, string> = {
  pm: "PM",
  service: "Service",
  urgent: "Urgent",
  install: "Install",
};

export const JOB_TYPE_COLORS: Record<JobType, string> = {
  pm: "bg-blue-100 text-blue-700",
  service: "bg-slate-100 text-slate-600",
  urgent: "bg-red-100 text-red-700",
  install: "bg-purple-100 text-purple-700",
};
