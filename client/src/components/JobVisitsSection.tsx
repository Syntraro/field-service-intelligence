import { useState, useEffect, useRef } from "react";
import { useJobVisits, isVisitInactive, isVisitIneligible, getVisitDisplayStatus } from "@/hooks/useJobVisits";
import { useTechniciansDirectory } from "@/hooks/useTechnicians";
import { useUnscheduleJob } from "@/hooks/useCalendarApi";
import { format } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Calendar,
  Plus,
  ChevronDown,
  ChevronRight,
  Clock,
  User,
  CalendarX,
  CalendarCheck,
  History,
  AlertCircle,
  ArrowRight,
  RefreshCw,
  CalendarPlus,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { JobVisit } from "@shared/schema";
import { AddVisitDialog } from "./AddVisitDialog";

interface JobVisitsSectionProps {
  jobId: string;
  jobVersion: number;
  defaultOpen?: boolean;
  /** External control to force open (e.g., from URL deep link ?section=visits) */
  forceOpen?: boolean;
}

const STATUS_COLORS: Record<string, string> = {
  scheduled: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  dispatched: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
  en_route: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200",
  on_site: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  in_progress: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
  on_hold: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
  completed: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200",
  cancelled: "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300",
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

// ============================================================================
// TIMELINE TAGS - Explicit labels to show visit eligibility for office users
// ============================================================================
// Tag types:
// - CURRENT (mirrored): The visit that syncJobScheduleFromVisits() picks
//   This is what shows on the calendar and drives job.scheduledStart/End
// - UPCOMING: Future eligible visits after current (will become current later)
// - HISTORY: Visits not eligible due to:
//   - status=completed (work finished)
//   - status=cancelled (visit was cancelled)
//   - is_active=false (unscheduled via calendar)
// ============================================================================

type TimelineTag = "current" | "upcoming" | "history";

interface TimelineTagConfig {
  label: string;
  tooltip: string;
  badgeClass: string;
  icon: React.ElementType;
}

const TIMELINE_TAGS: Record<TimelineTag, TimelineTagConfig> = {
  current: {
    label: "CURRENT",
    tooltip: "This visit drives the job's calendar position (mirrored to job.scheduledStart/End)",
    badgeClass: "bg-primary text-primary-foreground",
    icon: RefreshCw,
  },
  upcoming: {
    label: "UPCOMING",
    tooltip: "Eligible future visit - will become CURRENT when time comes",
    badgeClass: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
    icon: ArrowRight,
  },
  history: {
    label: "HISTORY",
    tooltip: "Not eligible for calendar sync",
    badgeClass: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
    icon: History,
  },
};

/**
 * Get the reason why a visit is in history (not eligible for sync)
 * Uses same eligibility rules as server: is_active=true AND status NOT IN ('completed','cancelled')
 */
function getHistoryReason(visit: { status: string; isActive: boolean }): string {
  if (!visit.isActive) {
    return "Unscheduled (is_active=false)";
  }
  if (visit.status === "completed") {
    return "Completed (status=completed)";
  }
  if (visit.status === "cancelled") {
    return "Cancelled (status=cancelled)";
  }
  // Past eligible visit that's not current (another visit was selected as current)
  return "Past eligible - another visit is current";
}

export default function JobVisitsSection({ jobId, jobVersion, defaultOpen = false, forceOpen }: JobVisitsSectionProps) {
  const { toast } = useToast();
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  // Confirmation dialog state for unschedule action
  const [showUnscheduleConfirm, setShowUnscheduleConfirm] = useState(false);
  // Track newly created visit for highlighting and scrolling
  const [highlightedVisitId, setHighlightedVisitId] = useState<string | null>(null);
  const highlightTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Deep link support: Force open when forceOpen prop is true (from URL ?section=visits)
  useEffect(() => {
    if (forceOpen) {
      setIsOpen(true);
    }
  }, [forceOpen]);

  // Clear highlight after 3 seconds
  useEffect(() => {
    if (highlightedVisitId) {
      // Clear any existing timeout
      if (highlightTimeoutRef.current) {
        clearTimeout(highlightTimeoutRef.current);
      }
      // Set new timeout to clear highlight
      highlightTimeoutRef.current = setTimeout(() => {
        setHighlightedVisitId(null);
      }, 3000);
    }
    return () => {
      if (highlightTimeoutRef.current) {
        clearTimeout(highlightTimeoutRef.current);
      }
    };
  }, [highlightedVisitId]);

  // Callback when new visit is created - highlight and scroll to it
  const handleVisitCreated = (visitId: string) => {
    setHighlightedVisitId(visitId);
    // Ensure section is open to show the new visit
    setIsOpen(true);
    // Scroll to the new visit after a brief delay for DOM update
    setTimeout(() => {
      const visitElement = document.querySelector(`[data-testid="visit-card-${visitId}"]`);
      if (visitElement) {
        visitElement.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }, 100);
  };

  const {
    visits,
    currentEligibleVisit,
    upcomingVisits,
    historyVisits,
    isLoading,
    isError,
    refetchVisits,
    isScheduled,
  } = useJobVisits(jobId);

  const { teamMembers: technicians } = useTechniciansDirectory();

  // Unschedule mutation - uses centralized hook from useCalendarApi
  // The hook handles all standard invalidations: calendar, unscheduled, jobs, visits
  // Server selects current eligible visit and sets is_active=false
  // Then calls syncJobScheduleFromVisits to update jobs table
  const unscheduleMutation = useUnscheduleJob();

  const getTechnicianName = (techId: string | null) => {
    if (!techId) return "Unassigned";
    const tech = technicians.find((t: any) => t.id === techId);
    if (!tech) return "Unknown";
    return tech.firstName && tech.lastName ? `${tech.firstName} ${tech.lastName}` : tech.email;
  };

  const formatVisitDateTime = (visit: JobVisit) => {
    if (!visit.scheduledStart) return "No date set";
    const start = new Date(visit.scheduledStart);
    if (visit.isAllDay) {
      return format(start, "MMM dd, yyyy") + " (All day)";
    }
    const end = visit.scheduledEnd ? new Date(visit.scheduledEnd) : null;
    const dateStr = format(start, "MMM dd, yyyy");
    const timeStr = format(start, "h:mm a");
    const endTimeStr = end ? format(end, "h:mm a") : "";
    return `${dateStr} ${timeStr}${endTimeStr ? ` - ${endTimeStr}` : ""}`;
  };

  const getDurationDisplay = (visit: JobVisit) => {
    if (visit.actualDurationMinutes) return `${visit.actualDurationMinutes} min (actual)`;
    if (visit.estimatedDurationMinutes) return `${visit.estimatedDurationMinutes} min (est.)`;
    if (visit.scheduledStart && visit.scheduledEnd && !visit.isAllDay) {
      const start = new Date(visit.scheduledStart).getTime();
      const end = new Date(visit.scheduledEnd).getTime();
      const mins = Math.round((end - start) / 60000);
      return `${mins} min`;
    }
    return "-";
  };

  // Render a timeline tag badge with tooltip
  const renderTimelineTag = (tag: TimelineTag, visit: JobVisit) => {
    const config = TIMELINE_TAGS[tag];
    const IconComponent = config.icon;

    // For history items, show specific reason why it's not eligible
    const tooltipText = tag === "history"
      ? `${config.tooltip}: ${getHistoryReason(visit)}`
      : config.tooltip;

    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge
              className={`text-[10px] font-semibold tracking-wide ${config.badgeClass}`}
              data-testid={`tag-${tag}`}
            >
              <IconComponent className="h-3 w-3 mr-1" />
              {config.label}
              {tag === "current" && (
                <span className="ml-1 opacity-75">(mirrored)</span>
              )}
            </Badge>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs">
            <p className="text-xs">{tooltipText}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  };

  // Get ineligibility reason badge for history items
  const renderIneligibilityReason = (visit: JobVisit) => {
    if (!visit.isActive) {
      return (
        <Badge variant="outline" className="text-[10px] bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400">
          <CalendarX className="h-3 w-3 mr-1" />
          is_active=false
        </Badge>
      );
    }
    if (visit.status === "completed") {
      return (
        <Badge variant="outline" className="text-[10px] bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300">
          status=completed
        </Badge>
      );
    }
    if (visit.status === "cancelled") {
      return (
        <Badge variant="outline" className="text-[10px] bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400">
          status=cancelled
        </Badge>
      );
    }
    return null;
  };

  const renderVisitCard = (visit: JobVisit, timelineTag: TimelineTag, showActions: boolean = false) => {
    const inactive = isVisitInactive(visit);
    const ineligible = isVisitIneligible(visit);
    const displayStatus = getVisitDisplayStatus(visit);
    const isCurrent = timelineTag === "current";
    const isHistory = timelineTag === "history";
    const isHighlighted = highlightedVisitId === visit.id;

    return (
      <div
        key={visit.id}
        className={`p-3 rounded-lg border transition-all duration-500 ${
          inactive || ineligible ? "bg-muted/50 border-dashed" : "bg-card"
        } ${isCurrent ? "ring-2 ring-primary/30 border-primary/50" : ""} ${
          isHighlighted ? "ring-2 ring-green-500 bg-green-50 dark:bg-green-950/30 animate-pulse" : ""
        }`}
        data-testid={`visit-card-${visit.id}`}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            {/* Timeline Tag - prominent at top */}
            <div className="flex items-center gap-2 mb-2">
              {renderTimelineTag(timelineTag, visit)}
              {isHistory && renderIneligibilityReason(visit)}
            </div>

            {/* DateTime */}
            <div className="flex items-center gap-2 text-sm font-medium">
              <Calendar className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              <span className={inactive || ineligible ? "text-muted-foreground line-through" : ""}>
                {formatVisitDateTime(visit)}
              </span>
            </div>

            {/* Status + Duration row */}
            <div className="flex items-center gap-3 mt-2">
              {inactive ? (
                <Badge variant="outline" className="text-xs bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                  <CalendarX className="h-3 w-3 mr-1" />
                  Unscheduled
                </Badge>
              ) : (
                <Badge className={`text-xs ${STATUS_COLORS[visit.status] || ""}`}>
                  {STATUS_LABELS[visit.status] || visit.status}
                </Badge>
              )}
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {getDurationDisplay(visit)}
              </span>
            </div>

            {/* Technician */}
            <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
              <User className="h-3 w-3" />
              {getTechnicianName(visit.assignedTechnicianId)}
            </div>

            {/* Notes */}
            {visit.visitNotes && (
              <p className="text-xs text-muted-foreground mt-2 line-clamp-2">{visit.visitNotes}</p>
            )}
          </div>

          {/* Actions - only show on current eligible visit (SAFETY: never on non-current) */}
          {showActions && !inactive && isCurrent && (
            <div className="flex-shrink-0">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs text-destructive hover:text-destructive"
                onClick={() => {
                  // Show confirmation dialog before unscheduling
                  // SAFETY: This button only renders for isCurrent=true
                  setShowUnscheduleConfirm(true);
                }}
                disabled={unscheduleMutation.isPending}
                data-testid="button-unschedule-visit"
              >
                <CalendarX className="h-3 w-3 mr-1" />
                Unschedule
              </Button>
            </div>
          )}
        </div>

        {/* Visit number */}
        {visit.visitNumber && (
          <div className="mt-2 pt-2 border-t text-xs text-muted-foreground">
            Visit #{visit.visitNumber}
          </div>
        )}
      </div>
    );
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="py-3 px-4">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold">
            <Calendar className="h-4 w-4" />
            Visits
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          <Skeleton className="h-24 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card>
        <CardHeader className="py-3 px-4">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold text-destructive">
            <AlertCircle className="h-4 w-4" />
            Error loading visits
          </CardTitle>
        </CardHeader>
      </Card>
    );
  }

  return (
    <>
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <Card data-testid="card-job-visits">
          <CollapsibleTrigger asChild>
            <button
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-accent/50 transition-colors"
              data-testid="trigger-visits"
            >
              <span className="text-sm font-semibold flex items-center gap-2">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                Visits {visits.length > 0 && `(${visits.length})`}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs h-auto p-0 text-primary hover:text-primary"
                  onClick={(e) => {
                    e.stopPropagation();
                    // INVARIANT: Always creates NEW visit via POST /api/calendar/schedule
                    // Default technician from current visit (same as OfficeActionsStrip)
                    setIsAddDialogOpen(true);
                  }}
                  data-testid="button-schedule-visit"
                >
                  <CalendarPlus className="h-3 w-3 mr-1" />
                  Schedule Visit
                </Button>
                {isOpen ? (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                )}
              </div>
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="border-t px-4 pb-4 pt-3 space-y-4">
              {visits.length === 0 ? (
                <div className="text-center py-6 text-muted-foreground">
                  <Calendar className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">No visits scheduled</p>
                  <p className="text-xs mt-1">Click "Schedule Visit" to schedule a site visit.</p>
                </div>
              ) : (
                <>
                  {/* Current Scheduled Visit - The visit mirrored to job.scheduledStart/End */}
                  <div>
                    <h4 className="text-xs font-semibold uppercase text-muted-foreground mb-2 flex items-center gap-1">
                      <RefreshCw className="h-3 w-3" />
                      Current Visit (Mirrored to Calendar)
                    </h4>
                    <p className="text-[10px] text-muted-foreground mb-2">
                      This visit determines the job's position on the calendar
                    </p>
                    {currentEligibleVisit ? (
                      renderVisitCard(currentEligibleVisit, "current", true)
                    ) : (
                      <div className="p-3 rounded-lg border border-dashed bg-muted/30 text-center">
                        <p className="text-sm text-muted-foreground">No active visit scheduled</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          Eligibility: is_active=true AND status NOT IN ('completed','cancelled')
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Upcoming Visits - Future eligible visits after current */}
                  {upcomingVisits.length > 0 && (
                    <div>
                      <h4 className="text-xs font-semibold uppercase text-muted-foreground mb-2 flex items-center gap-1">
                        <ArrowRight className="h-3 w-3" />
                        Upcoming ({upcomingVisits.length})
                      </h4>
                      <p className="text-[10px] text-muted-foreground mb-2">
                        Eligible future visits - will become CURRENT when their time comes
                      </p>
                      <div className="space-y-2">
                        {upcomingVisits.map((visit) => renderVisitCard(visit, "upcoming", true))}
                      </div>
                    </div>
                  )}

                  {/* Visit History - Ineligible visits (completed, cancelled, or inactive) */}
                  {historyVisits.length > 0 && (
                    <div>
                      <h4 className="text-xs font-semibold uppercase text-muted-foreground mb-2 flex items-center gap-1">
                        <History className="h-3 w-3" />
                        History ({historyVisits.length})
                      </h4>
                      <p className="text-[10px] text-muted-foreground mb-2">
                        Not eligible for sync: status=completed/cancelled OR is_active=false
                      </p>
                      <div className="space-y-2">
                        {historyVisits.slice(0, 5).map((visit) => renderVisitCard(visit, "history", false))}
                        {historyVisits.length > 5 && (
                          <p className="text-xs text-muted-foreground text-center py-2">
                            + {historyVisits.length - 5} more visits
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      {/* AddVisitDialog - always creates NEW visit via POST /api/calendar/schedule */}
      {/* INVARIANT: Never modifies existing visits, preserves history */}
      <AddVisitDialog
        jobId={jobId}
        jobVersion={jobVersion}
        open={isAddDialogOpen}
        onOpenChange={setIsAddDialogOpen}
        technicians={technicians}
        // Default technician from current visit (same pattern as OfficeActionsStrip)
        defaultTechnicianId={currentEligibleVisit?.assignedTechnicianId}
        // Callback to highlight and scroll to newly created visit
        onVisitCreated={handleVisitCreated}
      />

      {/* Unschedule Confirmation Dialog */}
      {/* SAFETY: This dialog can only be triggered from CURRENT visit's unschedule button */}
      <AlertDialog open={showUnscheduleConfirm} onOpenChange={setShowUnscheduleConfirm}>
        <AlertDialogContent data-testid="dialog-unschedule-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>Unschedule Visit</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the job from the calendar by setting is_active=false on the current visit. History is preserved.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-unschedule">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                // Uses canonical endpoint: POST /api/calendar/unschedule/:jobId
                // Server selects current eligible visit, sets is_active=false
                // Then calls syncJobScheduleFromVisits to update jobs table
                // Centralized hook handles all invalidations: calendar, unscheduled, jobs, visits
                unscheduleMutation.mutate(
                  { jobId, version: jobVersion },
                  {
                    onSuccess: () => {
                      toast({ title: "Visit Unscheduled", description: "The visit has been removed from the calendar." });
                    },
                    onError: (error: Error) => {
                      toast({ title: "Error", description: error.message || "Failed to unschedule visit.", variant: "destructive" });
                    },
                  }
                );
                setShowUnscheduleConfirm(false);
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-unschedule"
            >
              {unscheduleMutation.isPending ? "Unscheduling..." : "Unschedule"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
