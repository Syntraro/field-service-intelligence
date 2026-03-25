/**
 * Job Status Utilities - Normalized 4-Status Model
 *
 * LIFECYCLE STATUSES (stored in jobs.status):
 * - "open"      - Active job that can be worked on
 * - "completed" - Work finished (may need invoicing)
 * - "invoiced"  - Invoice created (locked for billing)
 * - "archived"  - Historical archive (includes canceled jobs)
 *
 * DERIVED STATES (computed from fields, NOT status):
 * - isScheduled = scheduledStart IS NOT NULL (canonical - isAllDay is display flag only)
 * - isAssigned = assignedTechnicianIds.length > 0 OR primaryTechnicianId IS NOT NULL
 *
 * WORKFLOW SUB-STATUS (openSubStatus, only when status = 'open'):
 * - null         - Default state
 * - in_progress  - Work actively being performed
 * - on_hold      - Job is blocked
 * - on_route     - Technician traveling to job
 * - (needs_review: removed — migrated to on_hold, columns dropped)
 */

import {
  FileText,
  Calendar,
  Play,
  CheckCircle,
  Receipt,
  Archive,
  Pause,
  AlertCircle,
  Truck,
  Clock,
  AlertTriangle,
} from "lucide-react";
import type { JobStatus, OpenSubStatus } from "@shared/schema";
import { isJobScheduled, isJobAssigned, isJobOverdue } from "@shared/schema";

// Valid lifecycle statuses - the ONLY allowed values for jobs.status
export const VALID_JOB_STATUSES: readonly JobStatus[] = ["open", "completed", "invoiced", "archived"];

// 2026-03-20 F-05: JOB_TERMINAL_STATUSES removed — zero client consumers.
// Canonical owner: server/domain/jobLifecycle.ts

// Status flow visualization for UI (lifecycle only)
export const JOB_STATUS_FLOW = [
  { key: "open" as const, label: "Open", icon: FileText },
  { key: "completed" as const, label: "Completed", icon: CheckCircle },
  { key: "invoiced" as const, label: "Invoiced", icon: Receipt },
  { key: "archived" as const, label: "Archived", icon: Archive },
] as const;

// Valid status transitions (lifecycle)
export const STATUS_TRANSITIONS: Record<JobStatus, JobStatus[]> = {
  open: ["completed", "invoiced", "archived"],
  completed: ["invoiced", "archived", "open"],
  invoiced: ["archived"],
  archived: ["open"],
};

// Sub-status display info
export const SUB_STATUS_INFO: Record<NonNullable<OpenSubStatus>, { label: string; icon: any }> = {
  in_progress: { label: "In Progress", icon: Play },
  on_hold: { label: "On Hold", icon: Pause },
  on_route: { label: "On Route", icon: Truck },
};

export type JobStatusDisplay = {
  label: string;
  variant: "default" | "destructive" | "secondary" | "outline";
  icon: any;
  priority: number; // Sort priority (lower = more important, shown first)
  isOverdue?: boolean;
};

/**
 * Get display information for a job's status.
 * Combines lifecycle status, sub-status, and derived states for UI display.
 * Phase 2 Step 5: Overdue = effectiveEnd < now
 * effectiveEnd priority: scheduledEnd > scheduledStart + durationMinutes > scheduledStart
 */
export function getJobStatusDisplay(
  job: {
    status: string;
    openSubStatus?: string | null;
    scheduledStart?: Date | string | null;
    scheduledEnd?: Date | string | null;
    durationMinutes?: number | null;
    isAllDay?: boolean | null;
    primaryTechnicianId?: string | null;
    assignedTechnicianIds?: string[] | null;
  }
): JobStatusDisplay {
  const now = new Date();
  const status = job.status as JobStatus;

  // Terminal statuses (priority 4-6: lowest priority for sorting)
  if (status === "archived") {
    return { label: "Archived", variant: "outline", icon: Archive, priority: 6 };
  }
  if (status === "invoiced") {
    return { label: "Invoiced", variant: "default", icon: Receipt, priority: 5 };
  }
  if (status === "completed") {
    return { label: "Completed", variant: "secondary", icon: CheckCircle, priority: 4 };
  }

  // Open status - check sub-status and derived states
  if (status === "open") {
    const subStatus = job.openSubStatus as OpenSubStatus | null;
    if (subStatus === "on_hold") {
      return { label: "On Hold", variant: "destructive", icon: Pause, priority: 0 };
    }
    if (subStatus === "in_progress") {
      return { label: "In Progress", variant: "default", icon: Play, priority: 1 };
    }
    if (subStatus === "on_route") {
      return { label: "On Route", variant: "default", icon: Truck, priority: 1 };
    }

    // Check for overdue (using canonical predicate - effectiveEnd < now)
    if (isJobOverdue(job, now)) {
      return { label: "Overdue", variant: "destructive", icon: AlertTriangle, priority: 0, isOverdue: true };
    }

    // Check derived states for display label
    if (isJobScheduled(job)) {
      return { label: "Scheduled", variant: "default", icon: Calendar, priority: 2 };
    }

    const assigned = isJobAssigned(job);
    if (assigned) {
      return { label: "Assigned", variant: "secondary", icon: Clock, priority: 2 };
    }

    // Default open state (backlog)
    return { label: "Open", variant: "outline", icon: FileText, priority: 3 };
  }

  // Fallback for any unknown status (should not happen with normalized data)
  return { label: status, variant: "outline", icon: FileText, priority: 3 };
}

/**
 * Simplified status display for status column (without derived state checks)
 * Phase 2 Step 5: Overdue = effectiveEnd < now
 * effectiveEnd priority: scheduledEnd > scheduledStart + durationMinutes > scheduledStart
 */
export function getSimpleStatusDisplay(
  status: string,
  scheduledStart: Date | string | null,
  scheduledEnd?: Date | string | null,
  durationMinutes?: number | null
): JobStatusDisplay {
  const now = new Date();
  // Create minimal job object for canonical predicates (includes fields for effectiveEnd calculation)
  const job = { status, scheduledStart, scheduledEnd, durationMinutes };

  switch (status as JobStatus) {
    case "archived":
      return { label: "Archived", variant: "outline", icon: Archive, priority: 6 };
    case "invoiced":
      return { label: "Invoiced", variant: "default", icon: Receipt, priority: 5 };
    case "completed":
      return { label: "Completed", variant: "secondary", icon: CheckCircle, priority: 4 };
    case "open":
      // Check for overdue using canonical predicate (based on effectiveEnd < now)
      if (isJobOverdue(job, now)) {
        return { label: "Overdue", variant: "destructive", icon: AlertTriangle, priority: 0, isOverdue: true };
      }
      if (scheduledStart) {
        return { label: "Scheduled", variant: "default", icon: Calendar, priority: 2 };
      }
      return { label: "Open", variant: "outline", icon: FileText, priority: 3 };
    default:
      // Unknown status - return as-is
      return { label: status, variant: "outline", icon: FileText, priority: 3 };
  }
}

export type PriorityDisplay = {
  label: string;
  variant: "default" | "destructive" | "secondary" | "outline";
};

export function getPriorityDisplay(priority: string): PriorityDisplay {
  switch (priority) {
    case "urgent":
      return { label: "Urgent", variant: "destructive" };
    case "high":
      return { label: "High", variant: "default" };
    case "medium":
      return { label: "Medium", variant: "secondary" };
    case "low":
      return { label: "Low", variant: "outline" };
    default:
      return { label: priority, variant: "outline" };
  }
}

// 2026-03-20 F-05: isTerminalStatus() removed — zero client consumers.
// Canonical owner: server/domain/jobLifecycle.ts

/**
 * Check if a job can transition to a target status
 */
export function canTransitionTo(currentStatus: string, targetStatus: string): boolean {
  const allowed = STATUS_TRANSITIONS[currentStatus as JobStatus] ?? [];
  return allowed.includes(targetStatus as JobStatus);
}
