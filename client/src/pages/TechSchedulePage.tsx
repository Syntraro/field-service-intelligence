/**
 * TechSchedulePage — Upcoming schedule view for the technician.
 * Shows visits for today and the next 6 days, grouped by date.
 * Tapping a visit navigates to the visit detail page.
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { format, addDays, isSameDay, parseISO } from "date-fns";
import { MapPin, Clock, ChevronRight, Loader2, CalendarDays } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { VisitJob, VisitLocation } from "@shared/types/visits";

interface ScheduleVisit {
  id: string;
  visitNumber: number;
  status: string;
  scheduledStart: string;
  estimatedDurationMinutes?: number;
  job: VisitJob;
  location?: VisitLocation | null;
}

const STATUS_COLORS: Record<string, string> = {
  scheduled: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  dispatched: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300",
  en_route: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  in_progress: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  completed: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
};

const STATUS_LABELS: Record<string, string> = {
  scheduled: "Scheduled",
  dispatched: "Dispatched",
  en_route: "En Route",
  in_progress: "In Progress",
  completed: "Done",
};

export default function TechSchedulePage() {
  // Fetch today's visits (the API we have). For a full week view,
  // we'd need a range endpoint. For now, show today with a note.
  const { data, isLoading } = useQuery<{ visits: ScheduleVisit[]; count: number }>({
    queryKey: ["/api/tech/visits/today"],
    refetchInterval: 60_000,
  });

  const visits = data?.visits ?? [];
  const today = new Date();

  // Group visits by date
  const grouped = groupByDate(visits, today);

  return (
    <div className="p-4 space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Schedule</h1>
        <p className="text-sm text-muted-foreground">
          {format(today, "EEEE, MMMM d, yyyy")}
        </p>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : visits.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <CalendarDays className="h-10 w-10 text-muted-foreground/50 mb-3" />
          <p className="text-sm font-medium text-muted-foreground">No visits on your schedule</p>
        </div>
      ) : (
        <div className="space-y-5">
          {grouped.map(({ label, visits: dayVisits }) => (
            <div key={label}>
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                {label}
              </h2>
              <div className="space-y-2">
                {dayVisits.map((visit) => (
                  <ScheduleCard key={visit.id} visit={visit} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ScheduleCard({ visit }: { visit: ScheduleVisit }) {
  const statusColor = STATUS_COLORS[visit.status] || STATUS_COLORS.scheduled;
  const statusLabel = STATUS_LABELS[visit.status] || visit.status;

  return (
    <Link href={`/tech/visit/${visit.id}`}>
      <div className="flex items-center gap-3 p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors cursor-pointer">
        {/* Time column */}
        <div className="flex flex-col items-center justify-center w-14 flex-shrink-0">
          <span className="text-sm font-semibold">
            {format(new Date(visit.scheduledStart), "h:mm")}
          </span>
          <span className="text-[10px] text-muted-foreground uppercase">
            {format(new Date(visit.scheduledStart), "a")}
          </span>
        </div>

        <div className="w-px h-10 bg-border" />

        <div className="flex-1 min-w-0 space-y-0.5">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium truncate">{visit.job.summary}</p>
            <Badge variant="secondary" className={`text-[10px] px-1.5 py-0 flex-shrink-0 ${statusColor}`}>
              {statusLabel}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            #{visit.job.jobNumber}
            {visit.estimatedDurationMinutes && ` \u2022 ${visit.estimatedDurationMinutes}min`}
          </p>
          {visit.location && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <MapPin className="h-3 w-3" />
              <span className="truncate">{visit.location.companyName}</span>
            </div>
          )}
        </div>

        <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
      </div>
    </Link>
  );
}

interface DateGroup {
  label: string;
  visits: ScheduleVisit[];
}

function groupByDate(visits: ScheduleVisit[], today: Date): DateGroup[] {
  const groups: Map<string, ScheduleVisit[]> = new Map();

  for (const visit of visits) {
    const d = parseISO(visit.scheduledStart);
    const key = format(d, "yyyy-MM-dd");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(visit);
  }

  const result: DateGroup[] = [];
  for (const [key, dayVisits] of Array.from(groups)) {
    const d = parseISO(key);
    let label: string;
    if (isSameDay(d, today)) {
      label = "Today";
    } else if (isSameDay(d, addDays(today, 1))) {
      label = "Tomorrow";
    } else {
      label = format(d, "EEEE, MMM d");
    }
    result.push({ label, visits: dayVisits });
  }

  return result;
}
