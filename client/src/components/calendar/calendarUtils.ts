// Calendar constants and utility functions
// Extracted from Calendar.tsx to reduce file size and improve maintainability

export const MONTH_ABBREV = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Technician color palette - colors for left border indicator
export const TECHNICIAN_COLORS = [
  { bg: 'bg-blue-50 dark:bg-blue-950/20', border: 'border-blue-500', borderLeft: 'border-l-blue-500', dot: 'bg-blue-500', text: 'text-blue-700 dark:text-blue-300', label: 'Blue' },
  { bg: 'bg-green-50 dark:bg-green-950/20', border: 'border-green-500', borderLeft: 'border-l-green-500', dot: 'bg-green-500', text: 'text-green-700 dark:text-green-300', label: 'Green' },
  { bg: 'bg-purple-50 dark:bg-purple-950/20', border: 'border-purple-500', borderLeft: 'border-l-purple-500', dot: 'bg-purple-500', text: 'text-purple-700 dark:text-purple-300', label: 'Purple' },
  { bg: 'bg-amber-50 dark:bg-amber-950/20', border: 'border-amber-500', borderLeft: 'border-l-amber-500', dot: 'bg-amber-500', text: 'text-amber-700 dark:text-amber-300', label: 'Amber' },
  { bg: 'bg-rose-50 dark:bg-rose-950/20', border: 'border-rose-500', borderLeft: 'border-l-rose-500', dot: 'bg-rose-500', text: 'text-rose-700 dark:text-rose-300', label: 'Rose' },
  { bg: 'bg-cyan-50 dark:bg-cyan-950/20', border: 'border-cyan-500', borderLeft: 'border-l-cyan-500', dot: 'bg-cyan-500', text: 'text-cyan-700 dark:text-cyan-300', label: 'Cyan' },
  { bg: 'bg-orange-50 dark:bg-orange-950/20', border: 'border-orange-500', borderLeft: 'border-l-orange-500', dot: 'bg-orange-500', text: 'text-orange-700 dark:text-orange-300', label: 'Orange' },
  { bg: 'bg-indigo-50 dark:bg-indigo-950/20', border: 'border-indigo-500', borderLeft: 'border-l-indigo-500', dot: 'bg-indigo-500', text: 'text-indigo-700 dark:text-indigo-300', label: 'Indigo' },
];

export type TechnicianColor = typeof TECHNICIAN_COLORS[0];

export type CalendarDensity = 'compact' | 'comfortable' | 'expanded';

export const DRAG_ENABLED = true;

export const DENSITY_STYLES = {
  compact: { card: 'py-1 px-2', row: 'min-h-10', gap: 'gap-1', rowHeight: 40 },
  comfortable: { card: 'py-1.5 px-2.5', row: 'min-h-12', gap: 'gap-1', rowHeight: 48 },
  expanded: { card: 'py-2 px-3', row: 'min-h-14', gap: 'gap-1.5', rowHeight: 56 },
};

export const ALLDAY_ROW_HEIGHTS: Record<string, number> = { compact: 72, comfortable: 84, roomy: 96 };

// Get start minutes for an assignment
export function getAssignmentStartMinutes(a: any): number {
  if (a == null) return 0;
  const hour = a.scheduledHour;
  if (hour == null) return 0;
  const offset = a.scheduledStartMinutes != null ? Number(a.scheduledStartMinutes) : 0;
  return hour * 60 + offset;
}

// Calculate lanes for overlapping jobs
export function calculateLanes(assignments: any[]): Map<string, { laneIndex: number; totalLanes: number }> {
  const laneMap = new Map<string, { laneIndex: number; totalLanes: number }>();

  if (assignments.length === 0) return laneMap;

  // Get time range for each assignment
  const getTimeRange = (a: any) => {
    const start = getAssignmentStartMinutes(a);
    const duration = a.durationMinutes || 60;
    return { start, end: start + duration };
  };

  // Sort by start time
  const sorted = [...assignments].sort((a, b) => {
    return getTimeRange(a).start - getTimeRange(b).start;
  });

  // Track active lanes (each lane has an end time)
  const lanes: number[] = [];

  // First pass: assign lane indices using greedy allocation
  for (const assignment of sorted) {
    const range = getTimeRange(assignment);

    // Find the first lane that's free (ends before this job starts)
    let laneIndex = lanes.findIndex(laneEnd => laneEnd <= range.start);

    if (laneIndex === -1) {
      // No free lane, create a new one
      laneIndex = lanes.length;
      lanes.push(range.end);
    } else {
      // Use this lane and update its end time
      lanes[laneIndex] = range.end;
    }

    laneMap.set(assignment.id, { laneIndex, totalLanes: 1 });
  }

  // Second pass: use sweep-line to find max concurrent at each moment
  type Event = { time: number; type: 'start' | 'end'; id: string };
  const events: Event[] = [];
  for (const assignment of assignments) {
    const range = getTimeRange(assignment);
    events.push({ time: range.start, type: 'start', id: assignment.id });
    events.push({ time: range.end, type: 'end', id: assignment.id });
  }
  // Sort: by time, then 'end' before 'start' at same time
  events.sort((a, b) => a.time - b.time || (a.type === 'end' ? -1 : 1));

  // Track max concurrent for each active assignment during sweep
  const maxConcurrentMap = new Map<string, number>();
  const activeSet = new Set<string>();

  for (const event of events) {
    if (event.type === 'start') {
      activeSet.add(event.id);
      const currentCount = activeSet.size;
      // Update max concurrent for ALL currently active assignments
      activeSet.forEach(id => {
        const existing = maxConcurrentMap.get(id) || 1;
        maxConcurrentMap.set(id, Math.max(existing, currentCount));
      });
    } else {
      activeSet.delete(event.id);
    }
  }

  // Apply max concurrent to lane map
  for (const assignment of assignments) {
    const lane = laneMap.get(assignment.id);
    if (lane) {
      lane.totalLanes = maxConcurrentMap.get(assignment.id) || 1;
    }
  }

  // Third pass: ensure directly overlapping assignments share the same totalLanes
  for (const assignment of assignments) {
    const range = getTimeRange(assignment);
    const lane = laneMap.get(assignment.id);
    if (!lane) continue;

    for (const other of assignments) {
      if (other.id === assignment.id) continue;
      const otherRange = getTimeRange(other);
      const otherLane = laneMap.get(other.id);
      if (!otherLane) continue;

      // If they directly overlap, ensure same totalLanes (take max)
      if (otherRange.start < range.end && otherRange.end > range.start) {
        const maxLanes = Math.max(lane.totalLanes, otherLane.totalLanes);
        lane.totalLanes = maxLanes;
        otherLane.totalLanes = maxLanes;
      }
    }
  }

  return laneMap;
}

// Format time from minutes
export function formatTimeFromMinutes(minutes: number): string {
  const h24 = Math.floor(minutes / 60) % 24;
  const min = minutes % 60;
  const ampm = h24 >= 12 ? 'PM' : 'AM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(min).padStart(2, '0')} ${ampm}`;
}

// Get Monday of the week for a given date
export function getMondayOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const daysToMonday = day === 0 ? 6 : day - 1;
  d.setDate(d.getDate() - daysToMonday);
  return d;
}

// Create technician color map
export function createTechnicianColorMap(technicians: any[]): Map<string, TechnicianColor> {
  const map = new Map<string, TechnicianColor>();
  technicians.forEach((tech: any, index: number) => {
    map.set(tech.id, TECHNICIAN_COLORS[index % TECHNICIAN_COLORS.length]);
  });
  return map;
}

// Get technician color for an assignment
export function getTechnicianColorForAssignment(
  assignment: any,
  colorMap: Map<string, TechnicianColor>
): TechnicianColor {
  const techIds = assignment?.assignedTechnicianIds || [];
  const legacyTechId = assignment?.assignedTechnicianId;

  if (techIds.length > 0) {
    return colorMap.get(techIds[0]) || TECHNICIAN_COLORS[0];
  }
  if (legacyTechId) {
    return colorMap.get(legacyTechId) || TECHNICIAN_COLORS[0];
  }
  // Unassigned - use neutral color
  return {
    bg: 'bg-muted/50',
    border: 'border-muted-foreground/30',
    borderLeft: 'border-l-muted-foreground/30',
    dot: 'bg-muted-foreground/30',
    text: 'text-muted-foreground',
    label: 'Unassigned'
  };
}
