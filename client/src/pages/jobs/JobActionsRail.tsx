import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { ExternalLink, Wrench } from "lucide-react";
import { format, parseISO } from "date-fns";
import { WorkspaceRailEmptyState } from "@/components/workspace/WorkspaceRailEmptyState";
import { WorkspaceRailEntityCard } from "@/components/workspace/WorkspaceRailEntityCard";
import { StatusChip } from "@/components/ui/chip";
import { SectionLabel } from "@/components/ui/typography";
import { getJobStatusMeta } from "@/lib/statusBadges";
import { useJobHeader } from "@/hooks/useJobsFeed";
import { useJobVisits } from "@/hooks/useJobVisits";
import { JobWarningsCard } from "./sections/JobWarningsCard";
import { JobLatestNotesCard, type JobNote } from "./sections/JobLatestNotesCard";
import { JobNextVisitCard } from "./sections/JobNextVisitCard";
import { JobQuickActionsCard } from "./sections/JobQuickActionsCard";
import { JobSummaryCard } from "./sections/JobSummaryCard";
import { JobTimelineCard } from "./sections/JobTimelineCard";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SelectedJobContext {
  jobId: string;
  jobNumber: number;
  locationDisplayName: string | null;
  locationId: string;
  locationAddress: string | null;
  locationCity: string | null;
  status: string;
  openSubStatus: string | null;
  scheduledStart: string | null;
  jobType: string;
  priority: string;
  _overdue: boolean;
}

interface JobActionsRailProps {
  context: SelectedJobContext | null;
}

// ── Entity card helpers ───────────────────────────────────────────────────────

function formatScheduled(scheduledStart: string | null): string {
  if (!scheduledStart) return "Not scheduled";
  try { return format(parseISO(scheduledStart), "MMM d, yyyy"); }
  catch { return "Not scheduled"; }
}

function priorityTone(priority: string): "neutral" | "warning" | "danger" {
  const p = priority?.toLowerCase();
  if (p === "urgent") return "danger";
  if (p === "high") return "warning";
  return "neutral";
}

/**
 * Job right rail — assembly-only.
 *
 * Query ownership:
 * - useJobHeader: job detail for summary, warnings, quick actions
 * - useJobVisits: visits for next-visit card and timeline
 * - GET /api/jobs/:jobId/notes: tech notes for latest-notes and timeline
 *
 * Section cards receive data via props; they own only their own mutations.
 * No modal state here — section cards own their modal state.
 */
export function JobActionsRail({ context }: JobActionsRailProps) {
  const [, setLocation] = useLocation();
  const jobId = context?.jobId ?? null;

  // ── Shared rail-root fetches ───────────────────────────────────────────────

  const { data: job, isLoading: jobLoading } = useJobHeader(jobId ?? undefined);

  const { visits, isLoading: visitsLoading } = useJobVisits(jobId ?? "", {
    enabled: !!jobId,
  });

  const { data: notes = [], isLoading: notesLoading } = useQuery<JobNote[]>({
    queryKey: ["jobs", jobId, "notes"],
    queryFn: async () => {
      const res = await fetch(`/api/jobs/${jobId}/notes`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load job notes");
      return res.json();
    },
    enabled: !!jobId,
    staleTime: 30_000,
  });

  // ── No selection ──────────────────────────────────────────────────────────

  if (!context) {
    return (
      <WorkspaceRailEmptyState
        message="Select a job to see actions"
        data-testid="jobs-actions-rail-empty"
      />
    );
  }

  // ── Render — urgency-first ordering ──────────────────────────────────────

  const railLoading = jobLoading || visitsLoading;

  const jobPath = `/jobs/${context.jobId}`;
  const clientPath = `/clients/${context.locationId}`;
  const priorityLabel = context.priority
    ? context.priority.charAt(0).toUpperCase() + context.priority.slice(1).toLowerCase()
    : "Normal";
  const jobStatusMeta = getJobStatusMeta({
    status: context.status,
    openSubStatus: context.openSubStatus,
    _overdue: context._overdue,
    scheduledStart: context.scheduledStart,
  });

  return (
    // WorkspaceRailScrollContainer owns scroll, overflow, padding (px-3 py-3).
    <div data-testid="jobs-actions-rail">
      {/* ── Entity card ───────────────────────────────────────────────────── */}
      <div className="pb-1">
        <SectionLabel className="mb-2">Job</SectionLabel>
        <WorkspaceRailEntityCard
          icon={Wrench}
          entityLabel={
            <div className="flex items-center gap-1.5 min-w-0">
              <button
                className="text-row text-brand hover:underline cursor-pointer text-left truncate min-w-0"
                onClick={() => setLocation(jobPath)}
              >
                #{context.jobNumber}
              </button>
              <StatusChip tone={jobStatusMeta.tone} className="shrink-0">
                {jobStatusMeta.label}
              </StatusChip>
            </div>
          }
          clientName={
            <button
              className="text-subheader font-semibold text-foreground hover:underline cursor-pointer text-left truncate block w-full mt-0.5"
              onClick={() => setLocation(clientPath)}
            >
              {context.locationDisplayName ?? "Unknown"}
            </button>
          }
          action={
            <button
              className="text-muted-foreground hover:text-foreground"
              onClick={() => setLocation(jobPath)}
              aria-label="Open job detail"
            >
              <ExternalLink className="h-4 w-4" />
            </button>
          }
          meta={[
            { label: "Scheduled", value: formatScheduled(context.scheduledStart) },
            { label: "Priority", value: priorityLabel, tone: priorityTone(context.priority) },
          ]}
        />
        <div className="-mx-3 mt-3 border-t border-slate-100" />
      </div>

      <JobQuickActionsCard job={job} loading={jobLoading} />
      <JobWarningsCard job={job} visits={visits} loading={railLoading} />
      <JobLatestNotesCard notes={notes} loading={notesLoading} />
      <JobNextVisitCard visits={visits} loading={visitsLoading} />
      <JobSummaryCard job={job} loading={jobLoading} />
      <JobTimelineCard notes={notes} visits={visits} loading={railLoading} />
    </div>
  );
}
