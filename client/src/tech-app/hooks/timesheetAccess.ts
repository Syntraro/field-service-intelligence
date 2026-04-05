/**
 * timesheetAccess — centralized permission/access scaffold for the Timesheet page.
 *
 * Phase 2: frontend-only permission layer.
 * Phase 3 (2026-04-04): Updated to work with real TimesheetEntry type from backend.
 *
 * This module answers: can the user view/edit a given entry, which fields
 * are editable, and why an entry might be view-only.
 *
 * Rules:
 *   - Active (running) entries are view-only
 *   - Locked entries (lockedAt set) are view-only
 *   - Job field is always read-only from Timesheet
 *   - Duration is always derived from start/end, never directly editable
 */
import { useMemo } from "react";
import type { TimesheetEntry } from "../types/timesheet";

// ── Permission source (swap internals with real resolution later) ──

export interface TimesheetPermissions {
  canEditOwnTime: boolean;
}

export function useTimesheetPermissions(): TimesheetPermissions {
  return useMemo(() => ({
    canEditOwnTime: true,
  }), []);
}

// ── Entry-level access ──

export type SheetMode = "edit" | "view-only";

export type ViewOnlyReason =
  | "active"
  | "locked"
  | "no-permission";

const VIEW_ONLY_LABELS: Record<ViewOnlyReason, string> = {
  active: "View only — active entry",
  locked: "View only — entry is locked",
  "no-permission": "View only — editing not permitted",
};

export interface EntryAccess {
  canView: boolean;
  canOpen: boolean;
  mode: SheetMode;
  viewOnlyReason: ViewOnlyReason | null;
  viewOnlyLabel: string | null;
  fields: {
    startTime: boolean;
    endTime: boolean;
    notes: boolean;
    job: false;
    duration: false;
  };
}

/** Compute access for a single entry given base permissions */
export function getEntryAccess(
  entry: TimesheetEntry,
  permissions: TimesheetPermissions,
): EntryAccess {
  const isActive = entry.endAt === null;
  const isLocked = entry.lockedAt !== null;

  let viewOnlyReason: ViewOnlyReason | null = null;
  if (isActive) viewOnlyReason = "active";
  else if (isLocked) viewOnlyReason = "locked";
  else if (!permissions.canEditOwnTime) viewOnlyReason = "no-permission";

  const mode: SheetMode = viewOnlyReason ? "view-only" : "edit";
  const editable = mode === "edit";

  return {
    canView: true,
    canOpen: true,
    mode,
    viewOnlyReason,
    viewOnlyLabel: viewOnlyReason ? VIEW_ONLY_LABELS[viewOnlyReason] : null,
    fields: {
      startTime: editable,
      endTime: editable,
      notes: editable,
      job: false as const,
      duration: false as const,
    },
  };
}

// ── Validation (retained for Phase 4 edit wiring) ──

export interface EntryValidation {
  valid: boolean;
  errors: {
    startTime: string | null;
    endTime: string | null;
  };
}

export function validateEntryTimes(startTime: string, endTime: string): EntryValidation {
  const errors: EntryValidation["errors"] = { startTime: null, endTime: null };

  if (!startTime) {
    errors.startTime = "Start time is required";
    return { valid: false, errors };
  }
  if (!endTime) {
    errors.endTime = "End time is required";
    return { valid: false, errors };
  }

  const [sh, sm] = startTime.split(":").map(Number);
  const [eh, em] = endTime.split(":").map(Number);
  if ((eh * 60 + em) <= (sh * 60 + sm)) {
    errors.endTime = "End time must be after start time";
    return { valid: false, errors };
  }

  return { valid: true, errors };
}
