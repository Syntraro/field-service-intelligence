import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
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
import { useTechniciansDirectory } from "@/hooks/useTechnicians";
import { useJobLifecycleActions } from "@/hooks/useJobLifecycleActions";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { jobKeys } from "@/lib/queryKeys/jobs";
import { AddVisitDialog } from "@/components/AddVisitDialog";
import { EntityNoteDialog } from "@/components/notes/EntityNoteDialog";
import { JobLatestNotesCard, type JobNote } from "./sections/JobLatestNotesCard";
import { JobQuickActionsCard } from "./sections/JobQuickActionsCard";
import { JobScheduledVisitsCard } from "./sections/JobScheduledVisitsCard";
import { JobEquipmentCard, type RailEquipmentItem } from "./sections/JobEquipmentCard";
import { JobRequiredSkillsCard } from "@/components/jobs/JobRequiredSkillsCard";

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

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatCreated(createdAt: string | undefined): string {
  if (!createdAt) return "—";
  try { return format(parseISO(createdAt), "MMM d, yyyy"); }
  catch { return "—"; }
}

function formatSubStatus(subStatus: string | null | undefined): string {
  if (!subStatus) return "—";
  return subStatus.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Job right rail — assembly-only.
 *
 * Query ownership:
 * - useJobHeader: job detail for lifecycle actions
 * - useJobVisits: visits for scheduled-visits card
 * - GET /api/jobs/:id/notes: tech notes for latest-notes card (canonical key)
 * - GET /api/jobs/:id/equipment: equipment linked to this job
 * - useTechniciansDirectory: resolves assignedTechnicianIds → display names
 *
 * Action ownership:
 * - useJobLifecycleActions: close-job modal + mutation (POST /api/jobs/:id/close)
 * - AddVisitDialog: schedule-visit modal
 * - EntityNoteDialog: add-note modal (POST /api/jobs/:id/notes)
 * - createInvoiceMutation: POST /api/invoices/from-job/:id (same as JobDetailPage)
 */
export function JobActionsRail({ context }: JobActionsRailProps) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const jobId = context?.jobId ?? null;

  // ── Shared rail-root fetches ───────────────────────────────────────────────

  const { data: job, isLoading: jobLoading } = useJobHeader(jobId ?? undefined);

  const { visits, isLoading: visitsLoading } = useJobVisits(jobId ?? "", {
    enabled: !!jobId,
  });

  const { data: notes = [], isLoading: notesLoading } = useQuery<JobNote[]>({
    queryKey: jobKeys.notes(jobId ?? ""),
    queryFn: async () => {
      const res = await fetch(`/api/jobs/${jobId}/notes`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load job notes");
      return res.json();
    },
    enabled: !!jobId,
    staleTime: 30_000,
  });

  const { data: equipment = [], isLoading: equipmentLoading } = useQuery<RailEquipmentItem[]>({
    queryKey: jobKeys.equipment(jobId ?? ""),
    queryFn: async () => {
      const res = await fetch(`/api/jobs/${jobId}/equipment`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch job equipment");
      return res.json();
    },
    enabled: !!jobId,
    staleTime: 30_000,
  });

  const { teamMembers } = useTechniciansDirectory();
  const techMap = new Map(teamMembers.map((t) => [t.id, t.fullName]));

  // ── Action wiring ─────────────────────────────────────────────────────────

  const lifecycleActions = useJobLifecycleActions({ job: job ?? null });

  const [addVisitOpen, setAddVisitOpen] = useState(false);
  const [addNoteOpen, setAddNoteOpen] = useState(false);

  // Reuses the exact same from-job mutation path as JobDetailPage.
  const createInvoiceMutation = useMutation({
    mutationFn: async () => {
      if (!jobId) throw new Error("No job selected");
      return apiRequest<{ id: string }>(`/api/invoices/from-job/${jobId}`, {
        method: "POST",
        body: JSON.stringify({ markJobCompleted: false }),
      });
    },
    onSuccess: (invoice) => {
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      setLocation(`/invoices/${invoice.id}`);
    },
    onError: (error: Error) => {
      toast({
        title: "Could not create invoice",
        description: error.message || "Failed to create invoice. Please try again.",
        variant: "destructive",
      });
    },
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

  // ── Render ────────────────────────────────────────────────────────────────

  const jobPath = `/jobs/${context.jobId}`;
  const clientPath = `/clients/${context.locationId}`;
  const jobStatusMeta = getJobStatusMeta({
    status: context.status,
    openSubStatus: context.openSubStatus,
    _overdue: context._overdue,
    scheduledStart: context.scheduledStart,
  });

  return (
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
            { label: "Created", value: formatCreated(job?.createdAt) },
            { label: "Sub-Status", value: formatSubStatus(context.openSubStatus) },
          ]}
        />
        <div className="-mx-3 mt-3 border-t border-slate-100" />
      </div>

      {/* ── Sections ──────────────────────────────────────────────────────── */}
      <JobQuickActionsCard
        job={job}
        loading={jobLoading}
        onCompleteJob={lifecycleActions.openCloseJobDialog}
        onScheduleVisit={() => setAddVisitOpen(true)}
        onAddNote={() => setAddNoteOpen(true)}
        onCreateInvoice={() => createInvoiceMutation.mutate()}
        creatingInvoice={createInvoiceMutation.isPending}
      />
      <JobScheduledVisitsCard
        visits={visits}
        loading={visitsLoading}
        techMap={techMap}
        jobId={context.jobId}
      />
      <JobRequiredSkillsCard jobId={context.jobId} />
      <JobLatestNotesCard notes={notes} loading={notesLoading} />
      <JobEquipmentCard
        equipment={equipment}
        loading={equipmentLoading}
        jobId={context.jobId}
      />

      {/* ── Dialogs (portaled) ────────────────────────────────────────────── */}
      {lifecycleActions.dialogsElement}

      {jobId && (
        <AddVisitDialog
          jobId={jobId}
          open={addVisitOpen}
          onOpenChange={setAddVisitOpen}
        />
      )}

      {jobId && (
        <EntityNoteDialog
          entityType="job"
          entityId={jobId}
          note={null}
          open={addNoteOpen}
          onOpenChange={setAddNoteOpen}
        />
      )}
    </div>
  );
}
