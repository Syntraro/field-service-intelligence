import { Calendar, CheckSquare, FileText, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { WorkspaceSectionCard } from "@/components/workspace/WorkspaceSectionCard";
import { useLocation } from "wouter";
import type { JobHeaderDetail } from "@/hooks/useJobsFeed";

interface JobQuickActionsCardProps {
  job: JobHeaderDetail | undefined;
  loading: boolean;
}

export function JobQuickActionsCard({ job, loading }: JobQuickActionsCardProps) {
  const [, setLocation] = useLocation();

  return (
    <WorkspaceSectionCard
      title="Quick Actions"
      variant="card"
      loading={loading}
      empty={!job && !loading}
      emptyText="Select a job to see actions."
      data-testid="job-quick-actions-card"
    >
      {job && (
        <div className="flex flex-col gap-1.5">
          <Button
            variant="outline"
            size="sm"
            className="w-full justify-start gap-2 rounded-lg h-8 text-row"
            onClick={() => setLocation(`/jobs/${job.id}`)}
            data-testid="action-open-job"
          >
            <FileText className="h-3.5 w-3.5 text-muted-foreground" />
            Open Job Detail
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="w-full justify-start gap-2 rounded-lg h-8 text-row"
            onClick={() => setLocation(`/dispatch?jobId=${job.id}`)}
            data-testid="action-schedule-visit"
          >
            <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
            Schedule Visit
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="w-full justify-start gap-2 rounded-lg h-8 text-row"
            onClick={() => setLocation(`/jobs/${job.id}?tab=line-items`)}
            data-testid="action-add-line-item"
          >
            <Plus className="h-3.5 w-3.5 text-muted-foreground" />
            Add Line Item
          </Button>
          {!job.invoiceId && (
            <Button
              variant="outline"
              size="sm"
              className="w-full justify-start gap-2 rounded-lg h-8 text-row"
              onClick={() => setLocation(`/invoices/new?jobId=${job.id}`)}
              data-testid="action-create-invoice"
            >
              <FileText className="h-3.5 w-3.5 text-muted-foreground" />
              Create Invoice
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            className="w-full justify-start gap-2 rounded-lg h-8 text-row"
            onClick={() => setLocation(`/jobs/${job.id}?tab=notes`)}
            data-testid="action-add-note"
          >
            <CheckSquare className="h-3.5 w-3.5 text-muted-foreground" />
            Add Note
          </Button>
        </div>
      )}
    </WorkspaceSectionCard>
  );
}
