/**
 * DnD Performance Instrumentation
 *
 * DEV-only timing logs to identify lag sources in drag-and-drop operations.
 * Enable via: development mode or ?dnd-perf=1 query param
 *
 * Measures:
 * - onDragEnd → mutation start
 * - onMutate optimistic update duration
 * - Server response time
 * - Query invalidation count
 * - Total time to UI stable
 */

// ============================================================================
// Types
// ============================================================================

interface PerfMark {
  name: string;
  timestamp: number;
  data?: Record<string, unknown>;
}

interface PerfSession {
  id: string;
  operation: "schedule" | "reschedule" | "unschedule";
  jobId: string;
  marks: PerfMark[];
  startTime: number;
  endTime?: number;
}

// ============================================================================
// State
// ============================================================================

let currentSession: PerfSession | null = null;
let sessionHistory: PerfSession[] = [];
const MAX_HISTORY = 20;

// ============================================================================
// Public API
// ============================================================================

export function isDndPerfEnabled(): boolean {
  if (typeof window === "undefined") return false;
  if (process.env.NODE_ENV === "development") return true;
  const params = new URLSearchParams(window.location.search);
  return params.get("dnd-perf") === "1";
}

/**
 * Start a new performance measurement session
 */
export function startPerfSession(
  operation: PerfSession["operation"],
  jobId: string
): string {
  if (!isDndPerfEnabled()) return "";

  const id = `perf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  currentSession = {
    id,
    operation,
    jobId,
    marks: [],
    startTime: performance.now(),
  };

  mark("session-start", { operation, jobId });
  console.log(`[DnD-Perf] ▶ Session started: ${operation} job=${jobId}`);

  return id;
}

/**
 * Add a timing mark to the current session
 */
export function mark(name: string, data?: Record<string, unknown>): void {
  if (!isDndPerfEnabled() || !currentSession) return;

  const timestamp = performance.now();
  const elapsed = timestamp - currentSession.startTime;

  currentSession.marks.push({ name, timestamp, data });

  console.log(
    `[DnD-Perf] 📍 ${name}: +${elapsed.toFixed(1)}ms`,
    data ? data : ""
  );
}

/**
 * End the current session and log summary
 */
export function endPerfSession(success: boolean = true): void {
  if (!isDndPerfEnabled() || !currentSession) return;

  currentSession.endTime = performance.now();
  const totalTime = currentSession.endTime - currentSession.startTime;

  mark("session-end", { success, totalTime });

  // Calculate phase durations
  const marks = currentSession.marks;
  const phases: Record<string, number> = {};

  for (let i = 1; i < marks.length; i++) {
    const phaseName = `${marks[i - 1].name} → ${marks[i].name}`;
    phases[phaseName] = marks[i].timestamp - marks[i - 1].timestamp;
  }

  // Log summary
  console.log(`[DnD-Perf] ⏱ Session complete: ${currentSession.operation}`);
  console.log(`[DnD-Perf] Total: ${totalTime.toFixed(1)}ms`);
  console.log(`[DnD-Perf] Phases:`, phases);

  // Identify bottlenecks
  const bottleneck = Object.entries(phases).sort((a, b) => b[1] - a[1])[0];
  if (bottleneck && bottleneck[1] > 100) {
    console.warn(
      `[DnD-Perf] ⚠️ Bottleneck: "${bottleneck[0]}" took ${bottleneck[1].toFixed(1)}ms`
    );
  }

  // Archive session
  sessionHistory = [currentSession, ...sessionHistory].slice(0, MAX_HISTORY);
  currentSession = null;
}

/**
 * Track query invalidations
 */
export function trackInvalidation(queryKey: unknown[]): void {
  if (!isDndPerfEnabled()) return;

  const keyStr = JSON.stringify(queryKey).slice(0, 80);
  mark("query-invalidated", { queryKey: keyStr });
}

/**
 * Track query refetch start
 */
export function trackRefetchStart(queryKey: unknown[]): void {
  if (!isDndPerfEnabled()) return;

  const keyStr = JSON.stringify(queryKey).slice(0, 80);
  mark("refetch-start", { queryKey: keyStr });
}

/**
 * Track query refetch complete
 */
export function trackRefetchComplete(queryKey: unknown[]): void {
  if (!isDndPerfEnabled()) return;

  const keyStr = JSON.stringify(queryKey).slice(0, 80);
  mark("refetch-complete", { queryKey: keyStr });
}

/**
 * Get session history for debugging
 */
export function getPerfHistory(): PerfSession[] {
  return sessionHistory;
}

/**
 * Clear session history
 */
export function clearPerfHistory(): void {
  sessionHistory = [];
  currentSession = null;
}
