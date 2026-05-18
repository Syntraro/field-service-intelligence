import { Calendar, CheckSquare, FileText, CheckCircle2, Loader2 } from "lucide-react";
import { WorkspaceSectionCard } from "@/components/workspace/WorkspaceSectionCard";
import type { JobHeaderDetail } from "@/hooks/useJobsFeed";

interface JobQuickActionsCardProps {
  job: JobHeaderDetail | undefined;
  loading: boolean;
  onCompleteJob: () => void;
  onScheduleVisit: () => void;
  onAddNote: () => void;
  onCreateInvoice: () => void;
  creatingInvoice?: boolean;
}

export function JobQuickActionsCard({
  job,
  loading,
  onCompleteJob,
  onScheduleVisit,
  onAddNote,
  onCreateInvoice,
  creatingInvoice = false,
}: JobQuickActionsCardProps) {
  return (
    <WorkspaceSectionCard
      title="Quick Actions"
      variant="section"
      loading={loading}
      empty={!job && !loading}
      emptyText="Select a job to see actions."
      data-testid="job-quick-actions-card"
    >
      {job && (
        <div className="space-y-2">
          <button
            type="button"
            className="w-full flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-left text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-60"
            onClick={onCompleteJob}
            data-testid="action-complete-job"
          >
            <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="text-row font-medium">Complete Job</span>
          </button>
          <button
            type="button"
            className="w-full flex items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-left hover:bg-accent transition-colors"
            onClick={onScheduleVisit}
            data-testid="action-schedule-visit"
          >
            <Calendar className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="text-row font-medium">Schedule Visit</span>
          </button>
          <button
            type="button"
            className="w-full flex items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-left hover:bg-accent transition-colors"
            onClick={onAddNote}
            data-testid="action-add-note"
          >
            <CheckSquare className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="text-row font-medium">Add Note</span>
          </button>
          {!job.invoiceId && (
            <button
              type="button"
              className="w-full flex items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-left hover:bg-accent transition-colors disabled:opacity-60"
              onClick={onCreateInvoice}
              disabled={creatingInvoice}
              data-testid="action-create-invoice"
            >
              {creatingInvoice ? (
                <Loader2 className="h-4 w-4 shrink-0 text-muted-foreground animate-spin" aria-hidden="true" />
              ) : (
                <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              )}
              <span className="text-row font-medium">Create Invoice</span>
            </button>
          )}
        </div>
      )}
    </WorkspaceSectionCard>
  );
}
