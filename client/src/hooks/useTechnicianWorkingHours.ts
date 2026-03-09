/**
 * useTechnicianWorkingHours — fetches bulk working hours for all schedulable technicians.
 * Used by dispatch board to determine on-shift vs off-shift grouping.
 * Returns a lookup: technicianId → day-of-week → { isWorking, startTime, endTime }
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getDay } from "date-fns";

interface DaySchedule {
  dayOfWeek: number;
  isWorking: boolean;
  startTime: string | null;
  endTime: string | null;
}

interface TechnicianSchedule {
  technicianId: string;
  source: "custom" | "company";
  days: DaySchedule[];
}

interface WorkingHoursResponse {
  technicianSchedules: TechnicianSchedule[];
}

/** Map: technicianId → DaySchedule[7] (indexed by dayOfWeek 0-6) */
export type TechScheduleMap = Map<string, DaySchedule[]>;

export function useTechnicianWorkingHours() {
  const query = useQuery<WorkingHoursResponse>({
    queryKey: ["/api/team/technicians/working-hours"],
    // Item 5: Reduced from 5min to 2min for faster availability sync after schedule changes
    staleTime: 2 * 60 * 1000,
    // Item 2: Always refetch on window focus to pick up working-hours edits from settings page
    refetchOnWindowFocus: "always",
  });

  const scheduleMap: TechScheduleMap = useMemo(() => {
    const map = new Map<string, DaySchedule[]>();
    if (!query.data) return map;
    for (const ts of query.data.technicianSchedules) {
      map.set(ts.technicianId, ts.days);
    }
    return map;
  }, [query.data]);

  return { scheduleMap, isLoading: query.isLoading };
}

/**
 * Check whether a technician is working on a specific date.
 * Returns true if no schedule data found (safe fallback — don't hide techs with missing data).
 */
export function isTechWorkingOnDate(
  scheduleMap: TechScheduleMap,
  techId: string,
  date: Date,
): boolean {
  const days = scheduleMap.get(techId);
  if (!days || days.length === 0) return true; // No data → assume working (safe fallback)
  const dow = getDay(date); // 0=Sun ... 6=Sat
  const daySchedule = days.find(d => d.dayOfWeek === dow);
  if (!daySchedule) return true; // Missing day → assume working
  return daySchedule.isWorking;
}

/**
 * Check whether a technician is working during any day in a date range (week view).
 * Returns true if they work on at least one day in the range.
 */
export function isTechWorkingInRange(
  scheduleMap: TechScheduleMap,
  techId: string,
  dates: Date[],
): boolean {
  const days = scheduleMap.get(techId);
  if (!days || days.length === 0) return true;
  return dates.some(date => {
    const dow = getDay(date);
    const daySchedule = days.find(d => d.dayOfWeek === dow);
    return !daySchedule || daySchedule.isWorking;
  });
}
