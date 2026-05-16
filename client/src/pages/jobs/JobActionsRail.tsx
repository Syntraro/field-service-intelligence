import { useQuery } from "@tanstack/react-query";
import { WorkspaceRailEmptyState } from "@/components/workspace/WorkspaceRailEmptyState";
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
}

interface JobActionsRailProps {
  context: SelectedJobContext | null;
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

  return (
    <div className="h-full overflow-y-auto scrollbar-none bg-app-bg py-2" data-testid="jobs-actions-rail">
      <JobQuickActionsCard job={job} loading={jobLoading} />
      <JobWarningsCard job={job} visits={visits} loading={railLoading} />
      <JobLatestNotesCard notes={notes} loading={notesLoading} />
      <JobNextVisitCard visits={visits} loading={visitsLoading} />
      <JobSummaryCard job={job} loading={jobLoading} />
      <JobTimelineCard notes={notes} visits={visits} loading={railLoading} />
    </div>
  );
}
