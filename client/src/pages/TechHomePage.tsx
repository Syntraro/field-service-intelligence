/**
 * TechHomePage — Today's assigned visits for the technician.
 * Shows a greeting, today's date, visit count, and a scrollable list of visit cards.
 * Each card shows job info, location, time, and status badge.
 */
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { Link } from "wouter";
import { format } from "date-fns";
import { MapPin, Clock, ChevronRight, Loader2, CalendarOff } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { VisitJob, VisitLocation } from "@shared/types/visits";

interface TodayVisit {
  id: string;
  visitNumber: number;
  status: string;
  scheduledStart: string;
  scheduledEnd?: string;
  estimatedDurationMinutes?: number;
  job: VisitJob;
  location?: VisitLocation | null;
}

const STATUS_COLORS: Record<string, string> = {
  scheduled: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  dispatched: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300",
  en_route: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  in_progress: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  on_site: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  completed: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
  cancelled: "bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400",
};

const STATUS_LABELS: Record<string, string> = {
  scheduled: "Scheduled",
  dispatched: "Dispatched",
  en_route: "En Route",
  on_site: "On Site",
  in_progress: "In Progress",
  on_hold: "On Hold",
  completed: "Completed",
  cancelled: "Cancelled",
};

export default function TechHomePage() {
  const { user } = useAuth();

  const { data, isLoading } = useQuery<{ visits: TodayVisit[]; count: number }>({
    queryKey: ["/api/tech/visits/today"],
    refetchInterval: 60_000,
  });

  const visits = data?.visits ?? [];
  const greeting = getGreeting();
  const firstName = user?.firstName || "Tech";

  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold">
          {greeting}, {firstName}
        </h1>
        <p className="text-sm text-muted-foreground">
          {format(new Date(), "EEEE, MMMM d")}
          {!isLoading && ` \u2022 ${visits.length} visit${visits.length !== 1 ? "s" : ""} today`}
        </p>
      </div>

      {/* Visit list */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : visits.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <CalendarOff className="h-10 w-10 text-muted-foreground/50 mb-3" />
          <p className="text-sm font-medium text-muted-foreground">No visits scheduled today</p>
          <p className="text-xs text-muted-foreground/70 mt-1">Check your schedule for upcoming visits</p>
        </div>
      ) : (
        <div className="space-y-3">
          {visits.map((visit) => (
            <VisitCard key={visit.id} visit={visit} />
          ))}
        </div>
      )}
    </div>
  );
}

function VisitCard({ visit }: { visit: TodayVisit }) {
  const statusColor = STATUS_COLORS[visit.status] || STATUS_COLORS.scheduled;
  const statusLabel = STATUS_LABELS[visit.status] || visit.status;

  return (
    <Link href={`/tech/visit/${visit.id}`}>
      <div className="flex items-center gap-3 p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors cursor-pointer">
        <div className="flex-1 min-w-0 space-y-1">
          {/* Job number + summary */}
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono text-muted-foreground">
              #{visit.job.jobNumber}
            </span>
            <Badge variant="secondary" className={`text-[10px] px-1.5 py-0 ${statusColor}`}>
              {statusLabel}
            </Badge>
          </div>
          <p className="text-sm font-medium truncate">{visit.job.summary}</p>

          {/* Location */}
          {visit.location && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <MapPin className="h-3 w-3 flex-shrink-0" />
              <span className="truncate">
                {visit.location.companyName}
                {visit.location.address && ` \u2014 ${visit.location.address}`}
              </span>
            </div>
          )}

          {/* Time */}
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Clock className="h-3 w-3 flex-shrink-0" />
            <span>
              {format(new Date(visit.scheduledStart), "h:mm a")}
              {visit.estimatedDurationMinutes && ` \u2022 ${visit.estimatedDurationMinutes}min`}
            </span>
          </div>
        </div>

        <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
      </div>
    </Link>
  );
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}
