/**
 * Week matrix view-model adapter.
 *
 * Projects /api/admin/timesheets/week entries into a job×day matrix:
 *   Rows: General Time | Travel Time (if any) | one row per job
 *   Cols: Mon–Sun | Week Total
 *
 * Pure function — no fetching, no UI imports.
 */

import { addDays, format, parseISO } from "date-fns";
import { categoryForType } from "../categoryMap";

export interface WeekMatrixInputEntry {
  jobId: string | null;
  jobNumber: number | null;
  jobSummary: string | null;
  locationName: string | null;
  type: string;
  date: string;
  durationMinutes: number | null;
}

export type MatrixRowKind = "general" | "travel" | "job";

export interface WeekMatrixRow {
  key: string;
  kind: MatrixRowKind;
  jobId: string | null;
  jobNumber: number | null;
  jobSummary: string | null;
  locationName: string | null;
  /** Minutes per day, Mon→Sun (7 elements). */
  dayMinutes: number[];
  weekTotal: number;
}

export interface WeekMatrixViewModel {
  weekDates: string[];
  rows: WeekMatrixRow[];
  /** Sum of all row cells per day (7 elements). */
  dayTotals: number[];
  weekGrandTotal: number;
  weekTotals: {
    generalMinutes: number;
    travelMinutes: number;
    jobMinutes: number;
    totalMinutes: number;
  };
}

export function buildWeekMatrixViewModel({
  weekStart,
  entries,
}: {
  weekStart: string;
  entries: WeekMatrixInputEntry[];
}): WeekMatrixViewModel {
  const monday = parseISO(weekStart);
  const weekDates = Array.from({ length: 7 }, (_, i) =>
    format(addDays(monday, i), "yyyy-MM-dd"),
  );

  const generalRow: WeekMatrixRow = {
    key: "__general__",
    kind: "general",
    jobId: null,
    jobNumber: null,
    jobSummary: null,
    locationName: null,
    dayMinutes: [0, 0, 0, 0, 0, 0, 0],
    weekTotal: 0,
  };
  const travelRow: WeekMatrixRow = {
    key: "__travel__",
    kind: "travel",
    jobId: null,
    jobNumber: null,
    jobSummary: null,
    locationName: null,
    dayMinutes: [0, 0, 0, 0, 0, 0, 0],
    weekTotal: 0,
  };
  const jobMap = new Map<string, WeekMatrixRow>();

  for (const e of entries) {
    const dayIdx = weekDates.indexOf(e.date);
    if (dayIdx < 0) continue;
    const minutes = e.durationMinutes ?? 0;
    const cat = categoryForType(e.type);

    if (e.jobId) {
      if (!jobMap.has(e.jobId)) {
        jobMap.set(e.jobId, {
          key: e.jobId,
          kind: "job",
          jobId: e.jobId,
          jobNumber: e.jobNumber,
          jobSummary: e.jobSummary,
          locationName: e.locationName,
          dayMinutes: [0, 0, 0, 0, 0, 0, 0],
          weekTotal: 0,
        });
      }
      const row = jobMap.get(e.jobId)!;
      row.dayMinutes[dayIdx] += minutes;
      row.weekTotal += minutes;
      if (!row.jobNumber && e.jobNumber != null) row.jobNumber = e.jobNumber;
      if (!row.locationName && e.locationName) row.locationName = e.locationName;
      if (!row.jobSummary && e.jobSummary) row.jobSummary = e.jobSummary;
    } else if (cat === "drive") {
      travelRow.dayMinutes[dayIdx] += minutes;
      travelRow.weekTotal += minutes;
    } else {
      generalRow.dayMinutes[dayIdx] += minutes;
      generalRow.weekTotal += minutes;
    }
  }

  const jobRows = Array.from(jobMap.values()).sort((a, b) => {
    const an = a.jobNumber ?? 0;
    const bn = b.jobNumber ?? 0;
    return an - bn || (a.jobSummary ?? "").localeCompare(b.jobSummary ?? "");
  });

  const rows: WeekMatrixRow[] = [generalRow];
  if (travelRow.weekTotal > 0) rows.push(travelRow);
  rows.push(...jobRows);

  const dayTotals = [0, 0, 0, 0, 0, 0, 0];
  for (const row of rows) {
    for (let i = 0; i < 7; i++) dayTotals[i] += row.dayMinutes[i];
  }

  const weekGrandTotal = dayTotals.reduce((s, v) => s + v, 0);

  return {
    weekDates,
    rows,
    dayTotals,
    weekGrandTotal,
    weekTotals: {
      generalMinutes: generalRow.weekTotal,
      travelMinutes: travelRow.weekTotal,
      jobMinutes: jobRows.reduce((s, r) => s + r.weekTotal, 0),
      totalMinutes: weekGrandTotal,
    },
  };
}

export function formatHm(minutes: number): string {
  if (minutes <= 0) return "0:00";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}:${m.toString().padStart(2, "0")}`;
}
