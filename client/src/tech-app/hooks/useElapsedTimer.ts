/**
 * useElapsedTimer — reusable timer hook for the technician app.
 *
 * Extracted from inline hooks in TodayPage (useShiftTimer) and
 * VisitDetailPage (useElapsedTimer). Both computed elapsed time
 * from a start timestamp on an interval.
 *
 * Returns formatted elapsed string and raw elapsed minutes.
 */
import { useState, useEffect, useRef } from "react";

interface ElapsedResult {
  /** Formatted string, e.g. "5h 40m" or "23m" */
  formatted: string;
  /** Raw elapsed minutes (floored) */
  minutes: number;
}

function formatElapsed(ms: number): string {
  const totalMinutes = Math.floor(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  if (hours > 0) return `${hours}h ${String(mins).padStart(2, "0")}m`;
  return `${mins}m`;
}

/**
 * Tracks elapsed time from `startIso` while `running` is true.
 * @param startIso - ISO timestamp of the start time
 * @param running - whether the timer is active
 * @param intervalMs - tick interval in ms (default 10000 = 10s)
 */
export function useElapsedTimer(
  startIso: string | null | undefined,
  running: boolean,
  intervalMs = 10000,
): ElapsedResult {
  const [now, setNow] = useState(Date.now());
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (running && startIso) {
      setNow(Date.now());
      intervalRef.current = setInterval(() => setNow(Date.now()), intervalMs);
      return () => {
        if (intervalRef.current) clearInterval(intervalRef.current);
      };
    }
    if (intervalRef.current) clearInterval(intervalRef.current);
    return undefined;
  }, [running, startIso, intervalMs]);

  if (!startIso || !running) {
    return { formatted: "0m", minutes: 0 };
  }

  const elapsed = now - new Date(startIso).getTime();
  return {
    formatted: formatElapsed(elapsed),
    minutes: Math.floor(elapsed / 60000),
  };
}
